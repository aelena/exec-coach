import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { validateContent } from '../content/markdown';
import { SCHEMA_VERSION, type AppSettings, type SessionRecord } from '../domain/types';
import { DATA_STORES, keyOf, loadSettings, repo, saveSettings, type StoreMap, type StoreName } from './db';

// Portable JSON: one file per session plus one file per other store, zipped with a manifest.
// Secrets are never part of a backup — this module does not import the secret store at all.

export const BACKUP_FORMAT = 'executive-reflexes-backup';
export const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  backupVersion: number;
  schemaVersion: number;
  createdAt: string;
  counts: Record<string, number>;
}

export type CollisionPolicy = 'skip' | 'replace';

export interface ImportReport {
  imported: Record<string, number>;
  skipped: Record<string, number>;
  replaced: Record<string, number>;
  invalid: string[];
  settingsRestored: boolean;
}

/** Settings are portable except for anything that could act as, or point to, a credential. */
function exportableSettings(settings: AppSettings): AppSettings {
  return { ...settings, persistApiKey: false };
}

export async function buildBackup(now: string): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const counts: Record<string, number> = {};
  for (const store of DATA_STORES) {
    const records = await repo.all(store);
    counts[store] = records.length;
    if (store === 'sessions') {
      for (const s of records as SessionRecord[]) files[`sessions/${s.id}.json`] = strToU8(JSON.stringify(s, null, 2));
    } else {
      files[`${store}.json`] = strToU8(JSON.stringify(records, null, 2));
    }
  }
  files['settings.json'] = strToU8(JSON.stringify(exportableSettings(await loadSettings()), null, 2));
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    counts,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(files, { level: 6 });
}

export function sessionToJson(record: SessionRecord): string {
  return JSON.stringify(record, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Minimal structural validation per store; imported data is untrusted. */
export function isValidRecord(store: StoreName, value: unknown): boolean {
  if (!isRecord(value)) return false;
  const str = (k: string) => typeof value[k] === 'string' && value[k] !== '';
  switch (store) {
    case 'sessions':
      return (
        str('id') && value.schemaVersion === SCHEMA_VERSION && str('scenarioId') && str('status') &&
        Array.isArray(value.turns) && Array.isArray(value.evaluations) && Array.isArray(value.snapshots) &&
        Array.isArray(value.causalEvents) && Array.isArray(value.pauseEvents) && isRecord(value.outcome)
      );
    case 'memory':
      return str('id') && str('scope') && str('content') && str('status') && Array.isArray(value.sourceRefs);
    case 'dialogues':
      return str('id') && Array.isArray(value.messages) && Array.isArray(value.relatedSessionIds);
    case 'questions':
      return str('id') && str('text') && str('category') && str('locale');
    case 'customContent':
      return str('key') && str('source') && validateContent(String(value.source)).ok;
    case 'learningPointers':
      return str('id') && str('concept');
    case 'swot':
      return str('id') && Array.isArray(value.items);
  }
}

async function importRecords<S extends StoreName>(
  store: S,
  candidates: unknown[],
  policy: CollisionPolicy,
  report: ImportReport,
): Promise<void> {
  const existing = new Set((await repo.all(store)).map((r) => keyOf(store, r)));
  const toWrite: Array<StoreMap[S]> = [];
  for (const candidate of candidates) {
    if (!isValidRecord(store, candidate)) {
      report.invalid.push(store);
      continue;
    }
    const record = candidate as StoreMap[S];
    if (existing.has(keyOf(store, record))) {
      // Collisions are never overwritten silently: the caller chooses, and the report says what happened.
      if (policy === 'skip') {
        report.skipped[store] = (report.skipped[store] ?? 0) + 1;
        continue;
      }
      report.replaced[store] = (report.replaced[store] ?? 0) + 1;
    } else {
      report.imported[store] = (report.imported[store] ?? 0) + 1;
    }
    toWrite.push(record);
  }
  await repo.putMany(store, toWrite);
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    return undefined;
  }
}

export async function importBackup(
  zip: Uint8Array,
  policy: CollisionPolicy,
  options: { restoreSettings: boolean },
): Promise<ImportReport> {
  if (zip.byteLength > MAX_BACKUP_BYTES) throw new Error('backup_too_large');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new Error('backup_unreadable');
  }
  const manifest = files['manifest.json'] ? parseJson(files['manifest.json']) : undefined;
  if (!isRecord(manifest) || manifest.format !== BACKUP_FORMAT) throw new Error('backup_not_recognized');
  if (typeof manifest.backupVersion !== 'number' || manifest.backupVersion > BACKUP_VERSION) throw new Error('backup_newer_version');

  const report: ImportReport = { imported: {}, skipped: {}, replaced: {}, invalid: [], settingsRestored: false };
  for (const store of DATA_STORES) {
    let candidates: unknown[] = [];
    if (store === 'sessions') {
      candidates = Object.entries(files)
        .filter(([name]) => /^sessions\/[^/]+\.json$/.test(name))
        .map(([, bytes]) => parseJson(bytes));
    } else if (files[`${store}.json`]) {
      const parsed = parseJson(files[`${store}.json`]!);
      candidates = Array.isArray(parsed) ? parsed : [];
    }
    await importRecords(store, candidates, policy, report);
  }
  if (options.restoreSettings && files['settings.json']) {
    const parsed = parseJson(files['settings.json']);
    if (isRecord(parsed) && parsed.schemaVersion === SCHEMA_VERSION) {
      const current = await loadSettings();
      await saveSettings({ ...current, ...(parsed as Partial<AppSettings>), persistApiKey: current.persistApiKey });
      report.settingsRestored = true;
    }
  }
  return report;
}

export async function importSessionJson(text: string, policy: CollisionPolicy): Promise<ImportReport> {
  const report: ImportReport = { imported: {}, skipped: {}, replaced: {}, invalid: [], settingsRestored: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('backup_unreadable');
  }
  await importRecords('sessions', [parsed], policy, report);
  return report;
}

export function downloadBlob(data: Uint8Array | string, filename: string, type: string): void {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
