export const FIRESTORE_QUOTA_RESET_MESSAGE =
  'Quota exceeded. Firestore daily free write limit reached — local progress continues saving automatically and cloud quota resets tomorrow (Spark plan limits: https://firebase.google.com/pricing#cloud-firestore).';

export const FIRESTORE_QUOTA_STORAGE_KEY = 'getcgl_firestore_quota_v1';
export const FIRESTORE_QUOTA_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
export const REMOTE_WRITE_TIMEOUT_MS = 2500;

export class RemoteWriteTimeoutError extends Error {
  constructor(ms: number) {
    super(`Firestore remote write timed out after ${ms}ms`);
    this.name = 'RemoteWriteTimeoutError';
  }
}

type QuotaListener = (exceeded: boolean) => void;

function readPersistedQuotaFlag(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(FIRESTORE_QUOTA_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { exceededAtMs?: number };
    if (
      typeof parsed?.exceededAtMs === 'number' &&
      Date.now() - parsed.exceededAtMs < FIRESTORE_QUOTA_COOLDOWN_MS
    ) {
      return true;
    }
    localStorage.removeItem(FIRESTORE_QUOTA_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
  return false;
}

function persistQuotaFlag(exceeded: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (exceeded) {
      localStorage.setItem(
        FIRESTORE_QUOTA_STORAGE_KEY,
        JSON.stringify({ exceededAtMs: Date.now() })
      );
    } else {
      localStorage.removeItem(FIRESTORE_QUOTA_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

let quotaExceededFlag = readPersistedQuotaFlag();
const listeners = new Set<QuotaListener>();

export function isQuotaExceededError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.toLowerCase().includes('resource-exhausted')) {
      return true;
    }
  }
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  const lower = (msg || '').toLowerCase();
  return (
    lower.includes('resource-exhausted') ||
    lower.includes('quota limit exceeded') ||
    lower.includes('quota exceeded') ||
    lower.includes('free daily write units')
  );
}

export function isFirestoreQuotaExceeded(): boolean {
  return quotaExceededFlag;
}

export function markFirestoreQuotaExceeded(error?: unknown): void {
  if (error !== undefined && !isQuotaExceededError(error)) return;
  persistQuotaFlag(true);
  if (quotaExceededFlag) return;
  quotaExceededFlag = true;
  for (const listener of listeners) {
    try {
      listener(true);
    } catch {
      // Ignore listener errors
    }
  }
}

export function clearFirestoreQuotaExceeded(): void {
  persistQuotaFlag(false);
  if (!quotaExceededFlag) return;
  quotaExceededFlag = false;
  for (const listener of listeners) {
    try {
      listener(false);
    } catch {
      // Ignore listener errors
    }
  }
}

export function resetFirestoreQuotaStateForTests(): void {
  persistQuotaFlag(false);
  quotaExceededFlag = false;
  for (const listener of listeners) {
    try {
      listener(false);
    } catch {
      // Ignore listener errors
    }
  }
}

export function subscribeFirestoreQuotaExceeded(listener: QuotaListener): () => void {
  listeners.add(listener);
  listener(quotaExceededFlag);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Races a remote Firestore write against a fast timeout so exponential backoff
 * on quota-exhausted or offline connections never freezes the UI for 45+ seconds.
 * If the underlying promise later fails with resource-exhausted, quota state is updated silently.
 */
export function raceWithWriteTimeout<T>(
  remotePromise: Promise<T>,
  timeoutMs: number = REMOTE_WRITE_TIMEOUT_MS
): Promise<T> {
  // Attach late-rejection observer so background Firestore backoff never emits unhandled rejections
  remotePromise.catch((err) => {
    if (isQuotaExceededError(err)) {
      markFirestoreQuotaExceeded(err);
    }
  });

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new RemoteWriteTimeoutError(timeoutMs));
    }, timeoutMs);

    remotePromise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface ProgressBackupSyncSnapshot {
  uid: string;
  attemptCount: number;
  totalXp: number;
  testsAttempted: number;
  bestScore: number;
  displayName: string;
  targetPost: string;
  totalStudySec: number;
}

export interface ProgressBackupSyncGateState {
  fingerprint: string;
  studySec: number;
  syncedAtMs: number;
}

export const PROGRESS_BACKUP_MIN_INTERVAL_MS = 300_000; // 5 minutes for time-only updates

export function buildProgressBackupFingerprint(snap: ProgressBackupSyncSnapshot): string {
  return [
    snap.uid,
    snap.attemptCount,
    snap.totalXp,
    snap.testsAttempted,
    snap.bestScore,
    snap.displayName,
    snap.targetPost,
  ].join('|');
}

/**
 * Prevents 1-second study-timer ticks from spamming Firestore `progressBackups` writes.
 * Allows immediate sync when attempts/XP/profile change, or once every 5 minutes for study time.
 */
export function shouldSyncProgressBackupRemote(
  prev: ProgressBackupSyncGateState | null,
  next: ProgressBackupSyncSnapshot,
  nowMs: number
): { shouldSync: boolean; nextState: ProgressBackupSyncGateState } {
  const fingerprint = buildProgressBackupFingerprint(next);
  if (!prev || prev.fingerprint !== fingerprint) {
    return {
      shouldSync: true,
      nextState: { fingerprint, studySec: next.totalStudySec, syncedAtMs: nowMs },
    };
  }
  const studyDelta = Math.abs(next.totalStudySec - prev.studySec);
  const elapsed = nowMs - prev.syncedAtMs;
  if (studyDelta >= 300 && elapsed >= PROGRESS_BACKUP_MIN_INTERVAL_MS) {
    return {
      shouldSync: true,
      nextState: { fingerprint, studySec: next.totalStudySec, syncedAtMs: nowMs },
    };
  }
  return { shouldSync: false, nextState: prev };
}
