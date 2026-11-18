import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { DebriefService } from '../src/debrief/debriefService';
import { DemoActorClient, DemoCoachClient } from '../src/llm/demo';
import { MemoryManager } from '../src/memory/memoryManager';
import { seedQuestions } from '../src/questions/seed';
import { buildBackup, importBackup, importSessionJson, sessionToJson } from '../src/storage/backup';
import { DATA_STORES, loadSettings, repo, resetDbForTests, saveSettings, secretStore, wipeAllData } from '../src/storage/db';
import { loadSessionForResume } from '../src/app/services';
import { harness } from './helpers';

const SECRET = 'sk-ant-super-secret-key-000';

async function freshDb() {
  await resetDbForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('executive-reflexes');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

const dbMemory = () =>
  new MemoryManager({ all: () => repo.all('memory'), putMany: (r) => repo.putMany('memory', r), delete: (id) => repo.delete('memory', id) });

/** Plays a full kata persisted to (fake) IndexedDB, with a coach dialogue, memory and questions. */
async function populate() {
  const memory = dbMemory();
  const { controller, time } = await harness({}, { memory, save: (r) => repo.put('sessions', r), saveLearningPointers: (p) => repo.putMany('learningPointers', p) });
  await controller.start();
  await controller.submitUserTurn('What evidence do we have on failure tests?', 'text');
  await controller.requestEnd();
  await controller.acknowledgeFeedback();
  const debrief = new DebriefService({
    coach: new DemoCoachClient(), actor: new DemoActorClient(), memory, saveDialogue: (d) => repo.put('dialogues', d), now: time.now, personalization: true, profileText: '',
  });
  let dialogue = debrief.create(controller.record);
  dialogue = await debrief.addUserMessage(dialogue, 'Why did the CEO object?');
  dialogue = await debrief.coachReply(dialogue, controller.record);
  dialogue = await debrief.actorExplanation(dialogue, controller.record, 'ceo-impatient', 'Why?');
  await memory.setUserFact('mem-user-profile', 'profile', 'CTO and technical advisor', 'en', time.now());
  await repo.putMany('questions', seedQuestions(time.now()).slice(0, 4));
  await saveSettings({ ...(await loadSettings()), onboarded: true, persistApiKey: true, role: 'CTO', provider: { kind: 'anthropic', baseUrl: '', actorModel: '', coachModel: '' } });
  await secretStore.set('anthropic', SECRET);
  return { controller, dialogue };
}

async function snapshotAll() {
  const out: Record<string, unknown[]> = {};
  for (const store of DATA_STORES) out[store] = (await repo.all(store)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return out;
}

describe('local persistence and portability', () => {
  beforeEach(freshDb);

  it('a full export/import round trip restores sessions, memory, dialogues and questions, and never contains a key', async () => {
    const { controller, dialogue } = await populate();
    const before = await snapshotAll();
    expect(before.sessions).toHaveLength(1);
    expect(before.dialogues).toHaveLength(1);
    expect((before.memory as unknown[]).length).toBeGreaterThanOrEqual(3);

    const zip = await buildBackup('2026-11-18T12:00:00Z');
    const files = unzipSync(zip);
    expect(Object.keys(files)).toContain(`sessions/${controller.record.id}.json`);
    expect(JSON.parse(strFromU8(files['manifest.json']!))).toMatchObject({ format: 'executive-reflexes-backup', counts: { sessions: 1, dialogues: 1 } });
    // No secret anywhere in the archive, and the exported settings do not even ask to persist one.
    for (const [name, bytes] of Object.entries(files)) expect(strFromU8(bytes), name).not.toContain(SECRET);
    expect(JSON.parse(strFromU8(files['settings.json']!)).persistApiKey).toBe(false);

    await wipeAllData();
    expect(await repo.all('sessions')).toEqual([]);
    expect(await secretStore.get('anthropic')).toBe('');

    const report = await importBackup(zip, 'skip', { restoreSettings: true });
    expect(report.invalid).toEqual([]);
    expect(report.settingsRestored).toBe(true);
    expect(await snapshotAll()).toEqual(before);
    expect((await loadSettings()).role).toBe('CTO');
    expect(await secretStore.get('anthropic')).toBe('');
    // The coach dialogue came back intact, including its labelled segments.
    const restored = (await repo.all('dialogues'))[0]!;
    expect(restored.messages.map((m) => m.role)).toEqual(dialogue.messages.map((m) => m.role));
    expect(restored.messages[1]!.segments![0]!.epistemicStatus).toBe('scenario_fact');
  });

  it('collisions are never overwritten silently: skip keeps local data, replace is explicit, both are reported', async () => {
    const { controller } = await populate();
    const zip = await buildBackup('2026-11-18T12:00:00Z');
    await repo.put('sessions', { ...controller.record, tags: ['edited-locally'] });

    const skipped = await importBackup(zip, 'skip', { restoreSettings: false });
    expect(skipped.skipped.sessions).toBe(1);
    expect(skipped.imported.sessions).toBeUndefined();
    expect((await repo.get('sessions', controller.record.id))!.tags).toEqual(['edited-locally']);

    const replaced = await importBackup(zip, 'replace', { restoreSettings: false });
    expect(replaced.replaced.sessions).toBe(1);
    expect((await repo.get('sessions', controller.record.id))!.tags).toEqual([]);
  });

  it('rejects foreign, corrupt and newer archives, and counts invalid records without importing them', async () => {
    await expect(importBackup(strToU8('not a zip'), 'skip', { restoreSettings: false })).rejects.toThrow('backup_unreadable');
    await expect(importBackup(zipSync({ 'x.json': strToU8('{}') }), 'skip', { restoreSettings: false })).rejects.toThrow('backup_not_recognized');
    const manifest = (version: number) => strToU8(JSON.stringify({ format: 'executive-reflexes-backup', backupVersion: version }));
    await expect(importBackup(zipSync({ 'manifest.json': manifest(99) }), 'skip', { restoreSettings: false })).rejects.toThrow('backup_newer_version');
    const report = await importBackup(
      zipSync({
        'manifest.json': manifest(1),
        'sessions/bad.json': strToU8(JSON.stringify({ id: 'x', turns: 'nope' })),
        'memory.json': strToU8(JSON.stringify([{ id: 'm', scope: 'coach' }, 'junk'])),
        'customContent.json': strToU8(JSON.stringify([{ key: 'actor:evil:en', source: '<script>alert(1)</script>' }])),
      }),
      'replace',
      { restoreSettings: false },
    );
    expect(report.invalid.sort()).toEqual(['customContent', 'memory', 'memory', 'sessions']);
    for (const store of DATA_STORES) expect(await repo.all(store), store).toEqual([]);
  });

  it('exports and re-imports a single session as JSON', async () => {
    const { controller } = await populate();
    const json = sessionToJson(controller.record);
    expect(json).not.toContain(SECRET);
    await repo.delete('sessions', controller.record.id);
    const report = await importSessionJson(json, 'skip');
    expect(report.imported.sessions).toBe(1);
    expect(await repo.get('sessions', controller.record.id)).toEqual(controller.record);
    await expect(importSessionJson('{', 'skip')).rejects.toThrow('backup_unreadable');
  });

  it('a session persisted mid-kata resumes after a reload as paused, with its turns intact', async () => {
    const { controller } = await harness({}, { memory: dbMemory(), save: (r) => repo.put('sessions', r) });
    await controller.start();
    await controller.submitUserTurn('What evidence do we have on failure tests?', 'text');
    expect(controller.record.status).toBe('user_turn');
    await resetDbForTests(); // simulates closing the tab: only what was persisted survives
    const loaded = (await loadSessionForResume(controller.record.id))!;
    expect(loaded.status).toBe('paused');
    expect(loaded.resumeStatus).toBe('user_turn');
    expect(loaded.turns).toEqual(controller.record.turns);
    expect((await repo.get('sessions', loaded.id))!.status).toBe('paused');
  });

  it('settings load with defaults and survive partial stored data', async () => {
    const defaults = await loadSettings();
    expect(defaults).toMatchObject({ onboarded: false, persistApiKey: false, provider: { kind: 'demo' } });
    expect(defaults.heuristics.swotProvisionalAt).toBe(10);
    await saveSettings({ ...defaults, uiLocale: 'en', heuristics: { ...defaults.heuristics, swotProvisionalAt: 12 } });
    expect(await loadSettings()).toMatchObject({ uiLocale: 'en', heuristics: { swotProvisionalAt: 12, swotHypothesizeAt: 5 } });
  });
});
