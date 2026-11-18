import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContentRegistry, type RawContent } from '../src/content/registry';
import type { LearningPointer, MemoryRecord, ModelSnapshot, SessionRecord } from '../src/domain/types';
import { createSessionRecord, SessionController, type ControllerDeps, type SessionConfig } from '../src/engine/sessionController';
import { DemoActorClient, DemoCoachClient } from '../src/llm/demo';
import { MemoryManager, type MemoryStore } from '../src/memory/memoryManager';

export const ROOT = join(__dirname, '..');
export const CONTENT_DIRS = ['voices', 'scenarios', 'coaches', 'profiles'] as const;
export const LANG_DIRS = { en: 'en', 'es-ES': 'es' } as const;

export function readDir(dir: string): RawContent[] {
  return readdirSync(join(ROOT, dir))
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ path: `${dir}/${name}`, source: readFileSync(join(ROOT, dir, name), 'utf8') }));
}

export function builtinContent(): RawContent[] {
  return CONTENT_DIRS.flatMap((dir) => Object.values(LANG_DIRS).flatMap((lang) => readDir(`${dir}/${lang}`)));
}

export function registry(): ContentRegistry {
  return new ContentRegistry(builtinContent());
}

export const MODELS: ModelSnapshot = { provider: 'demo', actorModel: 'demo-scripted', coachModel: 'demo-heuristic', params: {} };

export function config(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    scenarioId: 'erp-friday-release',
    interactionMode: 'desktop',
    difficulty: 'medium',
    coachingMode: 'end_of_kata',
    drillType: 'quick_kata',
    plannedDurationSeconds: 300,
    locale: 'en',
    spokenLocale: 'en',
    contentLocale: 'en',
    ...overrides,
  };
}

/** A controllable clock: every call advances one second unless told otherwise. */
export function clock(start = '2026-11-18T10:00:00.000Z') {
  let ms = Date.parse(start);
  return {
    now: () => new Date((ms += 1000)).toISOString(),
    advance: (seconds: number) => {
      ms += seconds * 1000;
    },
    peek: () => new Date(ms).toISOString(),
  };
}

export function memoryStore(initial: MemoryRecord[] = []): MemoryStore & { records: Map<string, MemoryRecord> } {
  const records = new Map(initial.map((m) => [m.id, m]));
  return {
    records,
    all: async () => [...records.values()],
    putMany: async (items) => {
      for (const m of items) records.set(m.id, m);
    },
    delete: async (id) => {
      records.delete(id);
    },
  };
}

export async function harness(overrides: Partial<SessionConfig> = {}, depOverrides: Partial<ControllerDeps> = {}) {
  const time = clock();
  const store = memoryStore();
  const saved: SessionRecord[] = [];
  const pointers: LearningPointer[] = [];
  const record = await createSessionRecord(config(overrides), registry(), MODELS, time.now());
  const deps: ControllerDeps = {
    actor: new DemoActorClient(),
    coach: new DemoCoachClient(),
    memory: new MemoryManager(store),
    save: async (r) => {
      saved.push(r);
    },
    saveLearningPointers: async (p) => {
      pointers.push(...p);
    },
    now: time.now,
    personalization: true,
    profileText: '',
    ...depOverrides,
  };
  const controller = new SessionController(record, deps);
  return { controller, time, store, saved, pointers, deps };
}
