import { BUILTIN_CONTENT } from '../content/builtin';
import { ContentRegistry } from '../content/registry';
import { DebriefService } from '../debrief/debriefService';
import { PROVIDER_KINDS, type AppSettings, type ModelSnapshot, type SessionRecord } from '../domain/types';
import { SessionController, type ControllerDeps } from '../engine/sessionController';
import { isTerminal, restoreAfterReload } from '../engine/sessionMachine';
import { createClients, resolveModels } from '../llm/clients';
import { ENV, loadEnvKeys, providerSettingsFor } from '../llm/env';
import { keyVault } from '../llm/keyVault';
import { MemoryManager } from '../memory/memoryManager';
import { seedQuestions } from '../questions/seed';
import { kv, loadSettings, repo, secretStore } from '../storage/db';

// Composition root: wires storage, content, memory and provider clients. No backend, no accounts.

export const USER_PROFILE_ID = 'mem-user-profile';
export const USER_GOALS_ID = 'mem-user-goals';

export const memory = new MemoryManager({
  all: () => repo.all('memory'),
  putMany: (records) => repo.putMany('memory', records),
  delete: (id) => repo.delete('memory', id),
});

export const nowIso = () => new Date().toISOString();

export async function loadRegistry(): Promise<ContentRegistry> {
  return ContentRegistry.fromCustomRecords(BUILTIN_CONTENT, await repo.all('customContent'));
}

export async function bootstrap(): Promise<{ settings: AppSettings; registry: ContentRegistry }> {
  loadEnvKeys();
  let settings = await loadSettings();
  if (settings.persistApiKey) {
    for (const kind of PROVIDER_KINDS) {
      const stored = await secretStore.get(kind);
      if (stored && !keyVault.has(kind)) keyVault.set(kind, stored);
    }
  }
  // First run with keys in `.env`: preselect that provider instead of the offline demo.
  if (!settings.onboarded && ENV.preferred) settings = { ...settings, provider: providerSettingsFor(ENV.preferred) };
  if (!(await kv.get<boolean>('questionsSeeded'))) {
    await repo.putMany('questions', seedQuestions(nowIso()));
    await kv.set('questionsSeeded', true);
  }
  return { settings, registry: await loadRegistry() };
}

export function modelSnapshot(settings: AppSettings): ModelSnapshot {
  const { actorModel, coachModel } = resolveModels(settings.provider);
  // Model ids and non-secret parameters only; keys are never written into a session record.
  return { provider: settings.provider.kind, actorModel, coachModel, params: { actorEffort: 'low', coachEffort: 'medium' } };
}

export async function userProfileText(): Promise<string> {
  return (await repo.all('memory'))
    .filter((m) => m.scope === 'user' && m.status !== 'superseded')
    .map((m) => m.content)
    .join('\n\n');
}

async function baseDeps(settings: AppSettings) {
  const clients = createClients(settings.provider, keyVault.get(settings.provider.kind));
  return {
    actor: clients.actor,
    coach: clients.coach,
    memory,
    now: nowIso,
    personalization: settings.personalizationEnabled,
    profileText: settings.personalizationEnabled ? await userProfileText() : '',
  };
}

export async function createController(record: SessionRecord, settings: AppSettings): Promise<SessionController> {
  const deps: ControllerDeps = {
    ...(await baseDeps(settings)),
    save: (r) => repo.put('sessions', r),
    saveLearningPointers: (pointers) => repo.putMany('learningPointers', pointers),
  };
  return new SessionController(record, deps);
}

export async function createDebrief(settings: AppSettings): Promise<DebriefService> {
  return new DebriefService({ ...(await baseDeps(settings)), saveDialogue: (d) => repo.put('dialogues', d) });
}

/** Loads a session for the session screen; an in-flight one comes back paused (SPECS §14, §17). */
export async function loadSessionForResume(id: string): Promise<SessionRecord | undefined> {
  const record = await repo.get('sessions', id);
  if (!record) return undefined;
  const restored = restoreAfterReload(record, nowIso());
  if (restored !== record) await repo.put('sessions', restored);
  return restored;
}

export async function findUnfinishedSession(): Promise<SessionRecord | undefined> {
  return (await repo.all('sessions'))
    .filter((s) => !isTerminal(s.status) && s.status !== 'created')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export async function deleteSession(id: string): Promise<void> {
  await repo.delete('sessions', id);
  for (const d of await repo.all('dialogues')) {
    if (d.relatedSessionIds.includes(id)) await repo.delete('dialogues', d.id);
  }
  await memory.rebuildReferences(new Set((await repo.all('sessions')).map((s) => s.id)));
}
