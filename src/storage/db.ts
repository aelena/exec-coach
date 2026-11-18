import { openDB, type IDBPDatabase } from 'idb';
import {
  DEFAULT_HEURISTICS,
  DEFAULT_SETTINGS,
  type AppSettings,
  type CoachDialogue,
  type CustomContentRecord,
  type LearningPointer,
  type MemoryRecord,
  type PowerQuestion,
  type ProviderKind,
  type SessionRecord,
  type SwotSnapshot,
} from '../domain/types';

// Local-first persistence: versioned JSON records in IndexedDB. There is no backend and no sync.
// The `secrets` store is deliberately separate: nothing in export/backup code ever reads it.

export const DB_NAME = 'executive-reflexes';
export const DB_VERSION = 1;

export interface StoreMap {
  sessions: SessionRecord;
  memory: MemoryRecord;
  dialogues: CoachDialogue;
  questions: PowerQuestion;
  customContent: CustomContentRecord;
  learningPointers: LearningPointer;
  swot: SwotSnapshot;
}
export type StoreName = keyof StoreMap;

/** Stores included in backups, in a stable order. `secrets` and `kv` are handled separately. */
export const DATA_STORES: StoreName[] = [
  'sessions',
  'memory',
  'dialogues',
  'questions',
  'customContent',
  'learningPointers',
  'swot',
];

const KEY_PATHS: Record<StoreName, string> = {
  sessions: 'id',
  memory: 'id',
  dialogues: 'id',
  questions: 'id',
  customContent: 'key',
  learningPointers: 'id',
  swot: 'id',
};

export function keyOf<S extends StoreName>(store: S, value: StoreMap[S]): string {
  return (value as unknown as Record<string, string>)[KEY_PATHS[store]]!;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Schema migrations are additive and keyed on oldVersion; never drop user data here.
      if (oldVersion < 1) {
        for (const store of DATA_STORES) db.createObjectStore(store, { keyPath: KEY_PATHS[store] });
        db.createObjectStore('kv');
        db.createObjectStore('secrets');
      }
    },
  });
  return dbPromise;
}

/** Test hook: forget the cached connection (used with a fresh fake IndexedDB). */
export async function resetDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export const repo = {
  async all<S extends StoreName>(store: S): Promise<Array<StoreMap[S]>> {
    return (await getDb()).getAll(store);
  },
  async get<S extends StoreName>(store: S, key: string): Promise<StoreMap[S] | undefined> {
    return (await getDb()).get(store, key);
  },
  async put<S extends StoreName>(store: S, value: StoreMap[S]): Promise<void> {
    await (await getDb()).put(store, value);
  },
  async putMany<S extends StoreName>(store: S, values: Array<StoreMap[S]>): Promise<void> {
    const tx = (await getDb()).transaction(store, 'readwrite');
    await Promise.all([...values.map((v) => tx.store.put(v)), tx.done]);
  },
  async delete(store: StoreName, key: string): Promise<void> {
    await (await getDb()).delete(store, key);
  },
  async clear(store: StoreName): Promise<void> {
    await (await getDb()).clear(store);
  },
};

export async function loadSettings(): Promise<AppSettings> {
  const stored = (await (await getDb()).get('kv', 'settings')) as Partial<AppSettings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    provider: { ...DEFAULT_SETTINGS.provider, ...stored?.provider },
    heuristics: { ...DEFAULT_HEURISTICS, ...stored?.heuristics },
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await (await getDb()).put('kv', settings, 'settings');
}

export const kv = {
  async get<T>(key: string): Promise<T | undefined> {
    return (await getDb()).get('kv', key) as Promise<T | undefined>;
  },
  async set(key: string, value: unknown): Promise<void> {
    await (await getDb()).put('kv', value, key);
  },
};

export const secretStore = {
  async get(kind: ProviderKind): Promise<string> {
    return ((await (await getDb()).get('secrets', `apiKey:${kind}`)) as string | undefined) ?? '';
  },
  async set(kind: ProviderKind, key: string): Promise<void> {
    await (await getDb()).put('secrets', key, `apiKey:${kind}`);
  },
  async clear(): Promise<void> {
    await (await getDb()).clear('secrets');
  },
};

/** Deletes every local record, including persisted keys. */
export async function wipeAllData(): Promise<void> {
  const db = await getDb();
  for (const store of [...DATA_STORES, 'kv', 'secrets']) await db.clear(store);
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}
