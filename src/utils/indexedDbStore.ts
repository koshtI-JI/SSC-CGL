import type { MockTestDoc, QuestionDoc, TestDraftDoc } from '../types/exam';
import type { FailedSyncOp, LocalFallbackDatabase, PendingSyncOp } from './localFallbackStore';

export const INDEXED_DB_NAME = 'path_to_cgl_idb_v1';
export const INDEXED_DB_VERSION = 1;

export type IndexedDbStoreName =
  | 'kv_db'
  | 'offline_test_packs'
  | 'exam_drafts'
  | 'ai_cache';

const ALL_STORES: IndexedDbStoreName[] = [
  'kv_db',
  'offline_test_packs',
  'exam_drafts',
  'ai_cache',
];

export interface OfflineMockPack {
  testId: string;
  title: string;
  subjectScope: MockTestDoc['subjectScope'];
  test: MockTestDoc;
  questions: QuestionDoc[];
  cachedAtMs: number;
}

export interface OfflineReadinessSummary {
  totalPublishedTests: number;
  offlineReadyTests: number;
  cachedPacksCount: number;
  cachedQuestionCount: number;
  indexedDbSupported: boolean;
  lastCachedAtMs: number | null;
}

// Synchronous memory fallback mirror so Node tests & restricted browsers never fail
const memoryStore = new Map<IndexedDbStoreName, Map<string, unknown>>();
for (const name of ALL_STORES) {
  memoryStore.set(name, new Map<string, unknown>());
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const storeName of ALL_STORES) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        resolve(null);
      };
      req.onblocked = () => {
        resolve(null);
      };
    } catch {
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

export async function idbGet<T>(storeName: IndexedDbStoreName, key: string): Promise<T | null> {
  const mem = memoryStore.get(storeName);
  const db = await openDatabase();
  if (!db) {
    return (mem?.get(key) as T | undefined) ?? null;
  }

  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => {
        const val = (req.result as T | undefined) ?? null;
        if (val !== null) {
          mem?.set(key, val);
          resolve(val);
        } else {
          resolve((mem?.get(key) as T | undefined) ?? null);
        }
      };
      req.onerror = () => {
        resolve((mem?.get(key) as T | undefined) ?? null);
      };
    } catch {
      resolve((mem?.get(key) as T | undefined) ?? null);
    }
  });
}

export async function idbSet<T>(
  storeName: IndexedDbStoreName,
  key: string,
  value: T
): Promise<boolean> {
  memoryStore.get(storeName)?.set(key, value);
  const db = await openDatabase();
  if (!db) return true;

  return new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbDelete(storeName: IndexedDbStoreName, key: string): Promise<boolean> {
  memoryStore.get(storeName)?.delete(key);
  const db = await openDatabase();
  if (!db) return true;

  return new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbGetAll<T>(storeName: IndexedDbStoreName): Promise<T[]> {
  const memValues = Array.from(memoryStore.get(storeName)?.values() ?? []) as T[];
  const db = await openDatabase();
  if (!db) return memValues;

  return new Promise<T[]>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? (req.result as T[]) : [];
        resolve(rows.length > 0 ? rows : memValues);
      };
      req.onerror = () => resolve(memValues);
    } catch {
      resolve(memValues);
    }
  });
}

export async function clearIndexedDbForTests(): Promise<void> {
  for (const name of ALL_STORES) {
    memoryStore.get(name)?.clear();
  }
  const db = await openDatabase();
  if (!db) return;
  await Promise.all(
    ALL_STORES.map(
      (storeName) =>
        new Promise<void>((resolve) => {
          try {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          } catch {
            resolve();
          }
        })
    )
  );
}

// --- High-level Domain Bridges ---

const LOCAL_DB_IDB_KEY = 'primary_snapshot_v1';
const SYNC_QUEUES_IDB_KEY = 'sync_queues_v1';

export interface MirroredSyncQueues {
  pendingSyncOps: PendingSyncOp[];
  failedSyncOps: FailedSyncOp[];
  updatedAtMs: number;
}

export async function mirrorLocalDbToIndexedDb(snapshot: LocalFallbackDatabase): Promise<boolean> {
  return idbSet('kv_db', LOCAL_DB_IDB_KEY, snapshot);
}

export async function hydrateLocalDbFromIndexedDb(): Promise<LocalFallbackDatabase | null> {
  return idbGet<LocalFallbackDatabase>('kv_db', LOCAL_DB_IDB_KEY);
}

export async function mirrorSyncQueuesToIndexedDb(
  pendingSyncOps: PendingSyncOp[],
  failedSyncOps: FailedSyncOp[] = []
): Promise<boolean> {
  return idbSet<MirroredSyncQueues>('kv_db', SYNC_QUEUES_IDB_KEY, {
    pendingSyncOps,
    failedSyncOps,
    updatedAtMs: Date.now(),
  });
}

export async function hydrateSyncQueuesFromIndexedDb(): Promise<MirroredSyncQueues | null> {
  return idbGet<MirroredSyncQueues>('kv_db', SYNC_QUEUES_IDB_KEY);
}

export async function saveOfflineMockPack(
  test: MockTestDoc,
  questions: QuestionDoc[],
  nowMs: number = Date.now()
): Promise<OfflineMockPack> {
  const qById = new Map(questions.map((q) => [q.id, q]));
  const orderedQuestions = test.questionIds
    .map((id) => qById.get(id))
    .filter((q): q is QuestionDoc => Boolean(q));

  const pack: OfflineMockPack = {
    testId: test.id,
    title: test.title,
    subjectScope: test.subjectScope,
    test,
    questions: orderedQuestions.length > 0 ? orderedQuestions : questions,
    cachedAtMs: nowMs,
  };
  await idbSet('offline_test_packs', test.id, pack);
  return pack;
}

export async function getOfflineMockPack(testId: string): Promise<OfflineMockPack | null> {
  if (!testId) return null;
  return idbGet<OfflineMockPack>('offline_test_packs', testId);
}

export async function listOfflineMockPacks(): Promise<OfflineMockPack[]> {
  return idbGetAll<OfflineMockPack>('offline_test_packs');
}

export async function cacheMockCatalogForOffline(params: {
  tests: MockTestDoc[];
  questions: QuestionDoc[];
  nowMs?: number;
}): Promise<{ cachedPacks: number; cachedQuestions: number }> {
  const nowMs = params.nowMs ?? Date.now();
  const qMap = new Map(params.questions.map((q) => [q.id, q]));
  let cachedPacks = 0;
  const cachedQuestionIds = new Set<string>();

  for (const test of params.tests) {
    if (!test.questionIds || test.questionIds.length === 0) continue;
    const matched = test.questionIds
      .map((id) => qMap.get(id))
      .filter((q): q is QuestionDoc => Boolean(q));
    if (matched.length === 0) continue;
    await saveOfflineMockPack(test, matched, nowMs);
    cachedPacks += 1;
    for (const q of matched) {
      cachedQuestionIds.add(q.id);
    }
  }

  return {
    cachedPacks,
    cachedQuestions: cachedQuestionIds.size,
  };
}

export async function saveOfflineExamDraft(draft: TestDraftDoc): Promise<boolean> {
  if (!draft.uid || !draft.testId) return false;
  return idbSet('exam_drafts', `${draft.uid}::${draft.testId}`, draft);
}

export async function getOfflineExamDraft(
  uid: string,
  testId: string
): Promise<TestDraftDoc | null> {
  if (!uid || !testId) return null;
  return idbGet<TestDraftDoc>('exam_drafts', `${uid}::${testId}`);
}

export async function deleteOfflineExamDraft(uid: string, testId: string): Promise<boolean> {
  if (!uid || !testId) return false;
  return idbDelete('exam_drafts', `${uid}::${testId}`);
}

export function computeOfflineReadinessSummary(params: {
  tests: MockTestDoc[];
  questions: QuestionDoc[];
  cachedPacks: OfflineMockPack[];
}): OfflineReadinessSummary {
  const qIds = new Set(params.questions.map((q) => q.id));
  const packMap = new Map(params.cachedPacks.map((p) => [p.testId, p]));
  const published = params.tests.filter((t) => t.published);

  let offlineReadyTests = 0;
  let lastCachedAtMs: number | null = null;

  for (const pack of params.cachedPacks) {
    if (lastCachedAtMs === null || pack.cachedAtMs > lastCachedAtMs) {
      lastCachedAtMs = pack.cachedAtMs;
    }
  }

  for (const t of published) {
    const pack = packMap.get(t.id);
    const hasPack = Boolean(pack && pack.questions.length > 0);
    const hasAllLocalQuestions =
      t.questionIds.length > 0 && t.questionIds.every((id) => qIds.has(id));
    if (hasPack || hasAllLocalQuestions) {
      offlineReadyTests += 1;
    }
  }

  return {
    totalPublishedTests: published.length,
    offlineReadyTests,
    cachedPacksCount: params.cachedPacks.length,
    cachedQuestionCount: params.questions.length,
    indexedDbSupported: isIndexedDbAvailable(),
    lastCachedAtMs,
  };
}
