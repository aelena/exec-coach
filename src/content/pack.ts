import { strFromU8, unzipSync } from 'fflate';
import type { CustomContentRecord } from '../domain/types';
import { MAX_SOURCE_CHARS, validateContent, type Issue } from './markdown';
import { ContentRegistry } from './registry';

// Runtime import of user content: a single Markdown file or a ZIP pack of Markdown files.
// Nothing is translated automatically and nothing requires rebuilding the app (SPECS §7.1, §11).

const MAX_PACK_BYTES = 5 * 1024 * 1024;
const MAX_PACK_FILES = 200;

export interface PackEntryResult {
  name: string;
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  record?: CustomContentRecord;
}

export function validatePackEntry(name: string, source: string, now: string): PackEntryResult {
  const result = validateContent(source);
  if (!result.ok || !result.doc) return { name, ok: false, errors: result.errors, warnings: result.warnings };
  const { kind, id, language } = result.doc;
  return {
    name,
    ok: true,
    errors: [],
    warnings: result.warnings,
    record: { key: ContentRegistry.key(kind, id, language), kind, id, language, source, importedAt: now },
  };
}

export function readPack(filename: string, bytes: Uint8Array, now: string): PackEntryResult[] {
  if (bytes.byteLength > MAX_PACK_BYTES) return [{ name: filename, ok: false, errors: [{ code: 'too_large', params: { max: MAX_PACK_BYTES } }], warnings: [] }];
  if (!filename.toLowerCase().endsWith('.zip')) return [validatePackEntry(filename, strFromU8(bytes), now)];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name.toLowerCase().endsWith('.md') && file.originalSize <= MAX_SOURCE_CHARS * 4 });
  } catch {
    return [{ name: filename, ok: false, errors: [{ code: 'bad_archive' }], warnings: [] }];
  }
  return Object.entries(files)
    .filter(([name]) => !/(^|\/)(README|CONTEXT|SPECS)[^/]*\.md$/i.test(name) && !name.includes('.template.'))
    .slice(0, MAX_PACK_FILES)
    .map(([name, data]) => validatePackEntry(name, strFromU8(data), now));
}
