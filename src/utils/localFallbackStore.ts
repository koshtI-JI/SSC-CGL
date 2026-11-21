import type {
  CohortTaskDoc,
  CorrectedQuestionOverrideDoc,
  LeaderboardEntry,
  MockTestDoc,
  QuestionDoc,
  ReportedQueryDoc,
  RevisionItemDoc,
  ScoringConfig,
  StudentProfile,
  StudentSessionLogDoc,
  SupportTicketDoc,
  TestAttemptDoc,
  VipInvite,
  XpLedgerEntryDoc,
} from '../types/exam';
import {
  hydrateLocalDbFromIndexedDb,
  hydrateSyncQueuesFromIndexedDb,
  mirrorLocalDbToIndexedDb,
  mirrorSyncQueuesToIndexedDb,
} from './indexedDbStore';
import type { PlatformConfig } from './platformConfig';

export const LOCAL_DB_STORAGE_KEY = 'getcgl_local_db_v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalAdminCredentials {
  adminId: string;
  passwordHash: string;
  updatedAtMs: number;
}

export interface LocalSavedAttemptResponse {
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
  timeSpentSec: number;
  markedForReview: boolean;
}

export type PendingSyncEntity =
  | 'adminCredentials'
  | 'scoring'
  | 'platformConfig'
  | 'vipInvite'
  | 'vipInviteDelete'
  | 'student'
  | 'leaderboard'
  | 'question'
  | 'questionDelete'
  | 'test'
  | 'testDelete'
  | 'attempt'
  | 'revisionItem'
  | 'revisionItemDelete'
  | 'task'
  | 'taskDelete'
  | 'xpLedger'
  | 'supportTicket'
  | 'reportedQuery'
  | 'correctedQuestionOverride';

export interface PendingSyncOp {
  key: string;
  entity: PendingSyncEntity;
  docId: string;
  uid?: string;
  queuedAtMs: number;
  attempts?: number;
  lastError?: string;
  lastAttemptAtMs?: number;
  nextRetryAtMs?: number;
}

export interface FailedSyncOp extends PendingSyncOp {
  errorCode?: string;
  errorMessage: string;
  failedAtMs: number;
  permanent: boolean;
}

export interface LocalDeletedIds {
  vipInvites: string[];
  questions: string[];
  tests: string[];
  tasks: string[];
  revisionVault: string[]; // formatted `${uid}::${questionId}`
}

export interface LocalFallbackDatabase {
  version: 1;
  updatedAtMs: number;
  adminCredentials: LocalAdminCredentials | null;
  scoring: ScoringConfig | null;
  platformConfig?: PlatformConfig | null;
  vipInvites: Record<string, VipInvite>;
  students: Record<string, StudentProfile>;
  leaderboard: Record<string, LeaderboardEntry>;
  questions: Record<string, QuestionDoc>;
  tests: Record<string, MockTestDoc>;
  attempts: Record<string, TestAttemptDoc>;
  attemptResponses: Record<string, Record<string, LocalSavedAttemptResponse>>;
  tasks: Record<string, CohortTaskDoc>;
  revisionVault: Record<string, Record<string, RevisionItemDoc>>;
  xpLedger: Record<string, XpLedgerEntryDoc>;
  supportTickets: Record<string, SupportTicketDoc>;
  reportedQueries: Record<string, ReportedQueryDoc>;
  correctedQuestionsBank: Record<string, CorrectedQuestionOverrideDoc>;
  sessionLogs: Record<string, StudentSessionLogDoc>;
  deletedIds: LocalDeletedIds;
  pendingSyncOps: PendingSyncOp[];
  failedSyncOps?: FailedSyncOp[];
}

export function createEmptyLocalDb(): LocalFallbackDatabase {
  return {
    version: 1,
    updatedAtMs: Date.now(),
    adminCredentials: null,
    scoring: null,
    platformConfig: null,
    vipInvites: {},
    students: {},
    leaderboard: {},
    questions: {},
    tests: {},
    attempts: {},
    attemptResponses: {},
    tasks: {},
    revisionVault: {},
    xpLedger: {},
    supportTickets: {},
    reportedQueries: {},
    correctedQuestionsBank: {},
    sessionLogs: {},
    deletedIds: {
      vipInvites: [],
      questions: [],
      tests: [],
      tasks: [],
      revisionVault: [],
    },
    pendingSyncOps: [],
    failedSyncOps: [],
  };
}

function resolveDefaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Ignore storage unavailability
  }
  return null;
}

function sanitizeDbShape(raw: unknown): LocalFallbackDatabase {
  const empty = createEmptyLocalDb();
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Partial<LocalFallbackDatabase>;
  const rawInvites = r.vipInvites && typeof r.vipInvites === 'object' ? r.vipInvites : {};
  const cleanInvites: Record<string, VipInvite> = {};
  for (const [k, v] of Object.entries(rawInvites)) {
    if (!v || typeof v !== 'object') continue;
    cleanInvites[k] = sanitizeVipInviteForStorage(v as VipInvite);
  }
  return {
    version: 1,
    updatedAtMs: typeof r.updatedAtMs === 'number' ? r.updatedAtMs : Date.now(),
    adminCredentials:
      r.adminCredentials && typeof r.adminCredentials.adminId === 'string'
        ? r.adminCredentials
        : null,
    scoring: r.scoring && typeof r.scoring === 'object' ? r.scoring : null,
    platformConfig:
      r.platformConfig && typeof r.platformConfig === 'object' ? r.platformConfig : null,
    vipInvites: cleanInvites,
    students: r.students && typeof r.students === 'object' ? r.students : {},
    leaderboard: r.leaderboard && typeof r.leaderboard === 'object' ? r.leaderboard : {},
    questions: r.questions && typeof r.questions === 'object' ? r.questions : {},
    tests: r.tests && typeof r.tests === 'object' ? r.tests : {},
    attempts: r.attempts && typeof r.attempts === 'object' ? r.attempts : {},
    attemptResponses:
      r.attemptResponses && typeof r.attemptResponses === 'object' ? r.attemptResponses : {},
    tasks: r.tasks && typeof r.tasks === 'object' ? r.tasks : {},
    revisionVault: r.revisionVault && typeof r.revisionVault === 'object' ? r.revisionVault : {},
    xpLedger: r.xpLedger && typeof r.xpLedger === 'object' ? r.xpLedger : {},
    supportTickets:
      r.supportTickets && typeof r.supportTickets === 'object' ? r.supportTickets : {},
    reportedQueries:
      r.reportedQueries && typeof r.reportedQueries === 'object' ? r.reportedQueries : {},
    correctedQuestionsBank:
      r.correctedQuestionsBank && typeof r.correctedQuestionsBank === 'object'
        ? r.correctedQuestionsBank
        : {},
    sessionLogs: r.sessionLogs && typeof r.sessionLogs === 'object' ? r.sessionLogs : {},
    deletedIds: {
      vipInvites: Array.isArray(r.deletedIds?.vipInvites) ? r.deletedIds.vipInvites : [],
      questions: Array.isArray(r.deletedIds?.questions) ? r.deletedIds.questions : [],
      tests: Array.isArray(r.deletedIds?.tests) ? r.deletedIds.tests : [],
      tasks: Array.isArray(r.deletedIds?.tasks) ? r.deletedIds.tasks : [],
      revisionVault: Array.isArray(r.deletedIds?.revisionVault) ? r.deletedIds.revisionVault : [],
    },
    pendingSyncOps: Array.isArray(r.pendingSyncOps) ? r.pendingSyncOps : [],
    failedSyncOps: Array.isArray(r.failedSyncOps) ? r.failedSyncOps : [],
  };
}

let cachedDb: LocalFallbackDatabase | null = null;
const subscribers = new Set<() => void>();
let crossTabListenerAttached = false;

function ensureCrossTabStorageListener(): void {
  if (crossTabListenerAttached || typeof window === 'undefined') return;
  crossTabListenerAttached = true;
  window.addEventListener('storage', (ev: StorageEvent) => {
    if (ev.key && ev.key !== LOCAL_DB_STORAGE_KEY) return;
    cachedDb = null;
    notifyLocalDbListeners();
  });
}

export function notifyLocalDbListeners(): void {
  for (const listener of subscribers) {
    try {
      listener();
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function subscribeLocalDb(listener: () => void): () => void {
  ensureCrossTabStorageListener();
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function readLocalDb(storage: StorageLike | null = resolveDefaultStorage()): LocalFallbackDatabase {
  if (storage === resolveDefaultStorage() && cachedDb) {
    return cachedDb;
  }
  if (!storage) {
    return cachedDb ?? createEmptyLocalDb();
  }
  try {
    const raw = storage.getItem(LOCAL_DB_STORAGE_KEY);
    if (!raw) {
      const empty = createEmptyLocalDb();
      if (storage === resolveDefaultStorage()) cachedDb = empty;
      return empty;
    }
    const parsed = sanitizeDbShape(JSON.parse(raw));
    if (storage === resolveDefaultStorage()) cachedDb = parsed;
    return parsed;
  } catch {
    return createEmptyLocalDb();
  }
}

export function writeLocalDb(
  dbState: LocalFallbackDatabase,
  storage: StorageLike | null = resolveDefaultStorage()
): LocalFallbackDatabase {
  const next: LocalFallbackDatabase = {
    ...dbState,
    version: 1,
    updatedAtMs: Date.now(),
  };
  if (storage === resolveDefaultStorage()) {
    cachedDb = next;
  }
  if (storage) {
    try {
      storage.setItem(LOCAL_DB_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // If localStorage is full, prune old sessionLogs and retry
      try {
        const logIds = Object.keys(next.sessionLogs);
        if (logIds.length > 25) {
          const kept: Record<string, StudentSessionLogDoc> = {};
          logIds
            .sort((a, b) => (next.sessionLogs[b].loginAtMs || 0) - (next.sessionLogs[a].loginAtMs || 0))
            .slice(0, 25)
            .forEach((id) => {
              kept[id] = next.sessionLogs[id];
            });
          next.sessionLogs = kept;
        }
        storage.setItem(LOCAL_DB_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Keep in memory cleanly even if storage quota is tight
      }
    }
  }
  if (storage === resolveDefaultStorage()) {
    void mirrorLocalDbToIndexedDb(next);
    void mirrorSyncQueuesToIndexedDb(next.pendingSyncOps, next.failedSyncOps ?? []);
  }
  notifyLocalDbListeners();
  return next;
}

export async function bootstrapLocalDbFromIndexedDb(): Promise<boolean> {
  const storage = resolveDefaultStorage();
  if (!storage) return false;
  try {
    const current = readLocalDb(storage);
    const [idbDb, idbQueues] = await Promise.all([
      hydrateLocalDbFromIndexedDb(),
      hydrateSyncQueuesFromIndexedDb(),
    ]);
    let changed = false;
    let targetDb = current;

    if (idbDb && typeof idbDb === 'object') {
      const sanitized = sanitizeDbShape(idbDb);
      const currentItemCount =
        Object.keys(current.vipInvites).length +
        Object.keys(current.questions).length +
        Object.keys(current.tests).length +
        Object.keys(current.attempts).length;
      const idbItemCount =
        Object.keys(sanitized.vipInvites).length +
        Object.keys(sanitized.questions).length +
        Object.keys(sanitized.tests).length +
        Object.keys(sanitized.attempts).length;

      if (
        (currentItemCount === 0 && idbItemCount > 0) ||
        (sanitized.updatedAtMs > current.updatedAtMs && idbItemCount >= currentItemCount)
      ) {
        targetDb = sanitized;
        changed = true;
      }
    }

    if (idbQueues) {
      const existingPendingKeys = new Set(targetDb.pendingSyncOps.map((o) => o.key));
      const missingPending = (idbQueues.pendingSyncOps ?? []).filter(
        (o) => !existingPendingKeys.has(o.key)
      );
      const existingFailed = targetDb.failedSyncOps ?? [];
      const existingFailedKeys = new Set(existingFailed.map((o) => o.key));
      const missingFailed = (idbQueues.failedSyncOps ?? []).filter(
        (o) => !existingFailedKeys.has(o.key)
      );
      if (missingPending.length > 0 || missingFailed.length > 0) {
        targetDb = {
          ...targetDb,
          pendingSyncOps: [...targetDb.pendingSyncOps, ...missingPending],
          failedSyncOps: [...existingFailed, ...missingFailed],
        };
        changed = true;
      }
    }

    if (changed) {
      cachedDb = targetDb;
      try {
        storage.setItem(LOCAL_DB_STORAGE_KEY, JSON.stringify(targetDb));
      } catch {
        // Keep in memory cleanly even if localStorage is tight
      }
      notifyLocalDbListeners();
      return true;
    }
  } catch {
    // Ignore IDB hydration errors cleanly
  }
  return false;
}

export function mutateLocalDb(
  mutator: (draft: LocalFallbackDatabase) => void,
  storage: StorageLike | null = resolveDefaultStorage()
): LocalFallbackDatabase {
  const current = readLocalDb(storage);
  const clone = sanitizeDbShape(JSON.parse(JSON.stringify(current)));
  mutator(clone);
  return writeLocalDb(clone, storage);
}

export function resetLocalDbForTests(storage: StorageLike | null = null): void {
  cachedDb = null;
  if (storage) {
    storage.removeItem(LOCAL_DB_STORAGE_KEY);
  }
  const def = resolveDefaultStorage();
  if (def) {
    def.removeItem(LOCAL_DB_STORAGE_KEY);
  }
  notifyLocalDbListeners();
}

export function queuePendingSyncOp(
  dbState: LocalFallbackDatabase,
  op: Omit<PendingSyncOp, 'key' | 'queuedAtMs'>
): void {
  const key = `${op.entity}:${op.uid ? `${op.uid}:` : ''}${op.docId}`;
  const filtered = dbState.pendingSyncOps.filter((existing) => existing.key !== key);
  filtered.push({
    ...op,
    key,
    queuedAtMs: Date.now(),
    attempts: op.attempts ?? 0,
  });
  // Never silently truncate or drop queued mutations; keep full durable queue.
  dbState.pendingSyncOps = filtered;
}

export function addTombstone(list: string[], id: string): string[] {
  const next = list.filter((item) => item !== id);
  next.push(id);
  return next.slice(-500);
}

export function removeTombstone(list: string[], id: string): string[] {
  return list.filter((item) => item !== id);
}

function readUpdatedMs(item: unknown): number {
  if (!item || typeof item !== 'object') return 0;
  const rec = item as { updatedAtMs?: unknown; updatedAt?: unknown; createdAtMs?: unknown };
  if (typeof rec.updatedAtMs === 'number') return rec.updatedAtMs;
  if (
    rec.updatedAt &&
    typeof rec.updatedAt === 'object' &&
    typeof (rec.updatedAt as { toMillis?: () => number }).toMillis === 'function'
  ) {
    return (rec.updatedAt as { toMillis: () => number }).toMillis();
  }
  if (typeof rec.updatedAt === 'number') return rec.updatedAt;
  if (typeof rec.createdAtMs === 'number') return rec.createdAtMs;
  return 0;
}

/**
 * Merges remote Firestore records with local fallback records while honoring local tombstones.
 * When the same ID exists in both, newer local mutations take priority over older remote snapshots.
 */
export function mergeByIdWithTombstones<T>(params: {
  remoteItems: T[];
  localItems: T[];
  deletedIds?: string[];
  getId: (item: T) => string;
}): T[] {
  const deletedSet = new Set(params.deletedIds ?? []);
  const byId = new Map<string, T>();

  for (const item of params.remoteItems) {
    const id = params.getId(item);
    if (!id || deletedSet.has(id)) continue;
    byId.set(id, item);
  }

  for (const localItem of params.localItems) {
    const id = params.getId(localItem);
    if (!id || deletedSet.has(id)) continue;
    const remoteItem = byId.get(id);
    if (!remoteItem) {
      byId.set(id, localItem);
      continue;
    }
    const localMs = readUpdatedMs(localItem);
    const remoteMs = readUpdatedMs(remoteItem);
    if (localMs >= remoteMs || remoteMs === 0) {
      byId.set(id, localItem);
    }
  }

  return Array.from(byId.values());
}

/**
 * Checks whether a Firestore error represents a recoverable environment/limit failure
 * (daily write quota exhausted, offline, unavailable) where falling back to Local-First
 * persistence keeps the user unblocked. Domain validation errors always return false.
 */
export function shouldFallbackToLocalOnError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error && err.name === 'RemoteWriteTimeoutError') {
    return true;
  }
  if (typeof err === 'object') {
    const code = String((err as { code?: unknown }).code ?? '').toLowerCase();
    if (
      code.includes('resource-exhausted') ||
      code.includes('unavailable') ||
      code.includes('deadline-exceeded') ||
      code.includes('aborted') ||
      code.includes('failed-precondition')
    ) {
      return true;
    }
  }
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : JSON.stringify(err);
  const lower = (msg || '').toLowerCase();
  return (
    lower.includes('resource-exhausted') ||
    lower.includes('quota limit exceeded') ||
    lower.includes('quota exceeded') ||
    lower.includes('free daily write units') ||
    lower.includes('client is offline') ||
    lower.includes('failed to get document because the client is offline') ||
    lower.includes('network error') ||
    lower.includes('timed out after') ||
    lower.includes('unavailable')
  );
}

export interface PortableCohortSnapshot {
  app: 'Path to CGL';
  formatVersion: 1;
  exportedAtIso: string;
  database: LocalFallbackDatabase;
}

export function sanitizeVipInviteForStorage(inv: VipInvite): VipInvite {
  const raw = inv as VipInvite & { currentPassword?: unknown };
  const hadLegacyPlaintext =
    typeof raw.currentPassword === 'string' && raw.currentPassword.length > 0;
  return {
    id: inv.id,
    loginId: inv.loginId,
    displayName: inv.displayName,
    targetPost: inv.targetPost,
    slotNumber: inv.slotNumber,
    active: Boolean(inv.active),
    passwordHash: typeof inv.passwordHash === 'string' ? inv.passwordHash : '',
    ...(inv.legacyPlaintextDetected || hadLegacyPlaintext
      ? { legacyPlaintextDetected: true }
      : {}),
    ...(inv.createdAt !== undefined ? { createdAt: inv.createdAt } : {}),
    ...(inv.updatedAt !== undefined ? { updatedAt: inv.updatedAt } : {}),
  };
}

export function sanitizeVipInviteForExport(inv: VipInvite): VipInvite {
  return {
    id: inv.id,
    loginId: inv.loginId,
    displayName: inv.displayName,
    targetPost: inv.targetPost,
    slotNumber: inv.slotNumber,
    active: Boolean(inv.active),
    passwordHash: '',
    ...(inv.createdAt !== undefined ? { createdAt: inv.createdAt } : {}),
    ...(inv.updatedAt !== undefined ? { updatedAt: inv.updatedAt } : {}),
  };
}

export function exportLocalCohortSnapshot(
  storage: StorageLike | null = resolveDefaultStorage()
): PortableCohortSnapshot {
  const dbState = readLocalDb(storage);
  const sanitizedInvites: Record<string, VipInvite> = {};
  for (const [k, inv] of Object.entries(dbState.vipInvites)) {
    if (!inv || typeof inv !== 'object') continue;
    sanitizedInvites[k] = sanitizeVipInviteForExport(inv);
  }
  return {
    app: 'Path to CGL',
    formatVersion: 1,
    exportedAtIso: new Date().toISOString(),
    database: {
      ...dbState,
      adminCredentials: null,
      vipInvites: sanitizedInvites,
    },
  };
}

export function importLocalCohortSnapshot(
  rawJson: string | unknown,
  storage: StorageLike | null = resolveDefaultStorage()
): { importedRecords: number } {
  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid snapshot JSON structure.');
  }
  const obj = parsed as Partial<PortableCohortSnapshot>;
  const candidateDb =
    obj.database && typeof obj.database === 'object'
      ? sanitizeDbShape(obj.database)
      : sanitizeDbShape(parsed);

  let count = 0;
  mutateLocalDb((draft) => {
    // SECURITY: Never overwrite existing adminCredentials during backup restore.
    if (!draft.adminCredentials && candidateDb.adminCredentials?.adminId && candidateDb.adminCredentials?.passwordHash) {
      draft.adminCredentials = candidateDb.adminCredentials;
      count += 1;
    }
    if (candidateDb.scoring) {
      draft.scoring = candidateDb.scoring;
      count += 1;
    }
    if (candidateDb.platformConfig) {
      draft.platformConfig = candidateDb.platformConfig;
      count += 1;
    }
    const mergeRecord = <V,>(target: Record<string, V>, src: Record<string, V>) => {
      for (const [k, v] of Object.entries(src)) {
        target[k] = v;
        count += 1;
      }
    };
    // Restore VIP metadata without overwriting existing non-empty password hashes or reintroducing plaintext passwords
    for (const [k, incomingInv] of Object.entries(candidateDb.vipInvites)) {
      if (!incomingInv || typeof incomingInv !== 'object') continue;
      const existingInv = draft.vipInvites[k];
      const sanitized = sanitizeVipInviteForStorage(incomingInv);
      draft.vipInvites[k] = {
        ...sanitized,
        passwordHash:
          existingInv?.passwordHash || sanitized.passwordHash || '',
      };
      count += 1;
    }
    mergeRecord(draft.students, candidateDb.students);
    mergeRecord(draft.leaderboard, candidateDb.leaderboard);
    mergeRecord(draft.questions, candidateDb.questions);
    mergeRecord(draft.tests, candidateDb.tests);
    mergeRecord(draft.attempts, candidateDb.attempts);
    mergeRecord(draft.tasks, candidateDb.tasks);
    mergeRecord(draft.xpLedger, candidateDb.xpLedger);
    mergeRecord(draft.supportTickets, candidateDb.supportTickets);
    mergeRecord(draft.reportedQueries, candidateDb.reportedQueries);
    mergeRecord(draft.correctedQuestionsBank, candidateDb.correctedQuestionsBank);
    mergeRecord(draft.sessionLogs, candidateDb.sessionLogs);
    for (const [attId, respMap] of Object.entries(candidateDb.attemptResponses)) {
      draft.attemptResponses[attId] = {
        ...(draft.attemptResponses[attId] ?? {}),
        ...respMap,
      };
      count += Object.keys(respMap).length;
    }
    for (const [uid, vaultMap] of Object.entries(candidateDb.revisionVault)) {
      draft.revisionVault[uid] = {
        ...(draft.revisionVault[uid] ?? {}),
        ...vaultMap,
      };
      count += Object.keys(vaultMap).length;
    }
  }, storage);

  return { importedRecords: count };
}
