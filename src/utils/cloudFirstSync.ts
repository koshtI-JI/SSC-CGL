import type { FailedSyncOp, PendingSyncOp } from './localFallbackStore';

export const BASE_SYNC_BACKOFF_MS = 2_000;
export const MAX_SYNC_BACKOFF_MS = 60_000;
export const MAX_SYNC_RETRY_ATTEMPTS = 5;

export type SyncHealthStatus =
  | 'synced'
  | 'syncing'
  | 'pending'
  | 'offline'
  | 'quota_limited'
  | 'failed';

export interface SyncHealthState {
  status: SyncHealthStatus;
  pendingCount: number;
  failedCount: number;
  lastSyncAtMs: number | null;
  lastError: string | null;
  isSyncing: boolean;
}

export interface ErrorClassification {
  kind: 'transient' | 'permanent';
  code: string;
  message: string;
  quotaBlocked: boolean;
}

export function extractErrorMessage(err: unknown): { code: string; message: string } {
  if (!err) return { code: 'unknown', message: 'Unknown error' };
  if (err instanceof Error) {
    const code =
      typeof (err as { code?: unknown }).code === 'string'
        ? String((err as { code?: unknown }).code)
        : err.name || 'error';
    return { code, message: err.message || 'Operation failed' };
  }
  if (typeof err === 'object') {
    const obj = err as { code?: unknown; message?: unknown };
    const code = typeof obj.code === 'string' ? obj.code : 'unknown';
    const message =
      typeof obj.message === 'string' ? obj.message : JSON.stringify(err);
    return { code, message };
  }
  return { code: 'unknown', message: String(err) };
}

export function classifySyncFailure(err: unknown): ErrorClassification {
  const { code, message } = extractErrorMessage(err);
  const lowerCode = code.toLowerCase();
  const lowerMsg = message.toLowerCase();

  const quotaBlocked =
    lowerCode.includes('resource-exhausted') ||
    lowerMsg.includes('resource-exhausted') ||
    lowerMsg.includes('quota limit exceeded') ||
    lowerMsg.includes('quota exceeded') ||
    lowerMsg.includes('free daily write units');

  const transient =
    quotaBlocked ||
    lowerCode.includes('unavailable') ||
    lowerCode.includes('deadline-exceeded') ||
    lowerCode.includes('aborted') ||
    lowerCode.includes('remotewritetimeouterror') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('client is offline') ||
    lowerMsg.includes('network error') ||
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('unavailable');

  return {
    kind: transient ? 'transient' : 'permanent',
    code,
    message: message.slice(0, 240),
    quotaBlocked,
  };
}

export function computeSyncBackoffDelayMs(attempts: number): number {
  const safeAttempts = Math.max(1, Math.round(attempts));
  const raw = BASE_SYNC_BACKOFF_MS * Math.pow(2, safeAttempts - 1);
  return Math.min(MAX_SYNC_BACKOFF_MS, raw);
}

export function isPendingOpReadyForRetry(
  op: PendingSyncOp,
  nowMs: number = Date.now(),
  force: boolean = false
): boolean {
  if (force) return true;
  if (!op.nextRetryAtMs || !Number.isFinite(op.nextRetryAtMs)) return true;
  return nowMs >= op.nextRetryAtMs;
}

export function recordTransientOpRetry(
  op: PendingSyncOp,
  errorMessage: string,
  nowMs: number = Date.now()
): { updatedOp?: PendingSyncOp; quarantinedOp?: FailedSyncOp } {
  const nextAttempts = (op.attempts ?? 0) + 1;
  if (nextAttempts >= MAX_SYNC_RETRY_ATTEMPTS) {
    return {
      quarantinedOp: {
        ...op,
        attempts: nextAttempts,
        lastAttemptAtMs: nowMs,
        lastError: errorMessage.slice(0, 240),
        errorCode: 'max_retries_exceeded',
        errorMessage: errorMessage.slice(0, 240),
        failedAtMs: nowMs,
        permanent: false,
      },
    };
  }
  const delay = computeSyncBackoffDelayMs(nextAttempts);
  return {
    updatedOp: {
      ...op,
      attempts: nextAttempts,
      lastAttemptAtMs: nowMs,
      nextRetryAtMs: nowMs + delay,
      lastError: errorMessage.slice(0, 240),
    },
  };
}

export function toPermanentFailedOp(
  op: PendingSyncOp,
  errorCode: string,
  errorMessage: string,
  nowMs: number = Date.now()
): FailedSyncOp {
  return {
    ...op,
    attempts: (op.attempts ?? 0) + 1,
    lastAttemptAtMs: nowMs,
    lastError: errorMessage.slice(0, 240),
    errorCode: errorCode.slice(0, 64),
    errorMessage: errorMessage.slice(0, 240),
    failedAtMs: nowMs,
    permanent: true,
  };
}

export function requeueFailedOpsForRetry(
  failedOps: readonly FailedSyncOp[],
  pendingOps: readonly PendingSyncOp[],
  targetKey?: string,
  nowMs: number = Date.now()
): { nextPendingOps: PendingSyncOp[]; nextFailedOps: FailedSyncOp[]; requeuedCount: number } {
  const toMove = targetKey
    ? failedOps.filter((f) => f.key === targetKey)
    : [...failedOps];
  if (toMove.length === 0) {
    return {
      nextPendingOps: [...pendingOps],
      nextFailedOps: [...failedOps],
      requeuedCount: 0,
    };
  }
  const movedKeys = new Set(toMove.map((m) => m.key));
  const nextFailedOps = failedOps.filter((f) => !movedKeys.has(f.key));
  const existingFiltered = pendingOps.filter((p) => !movedKeys.has(p.key));
  const resetOps: PendingSyncOp[] = toMove.map((item) => ({
    key: item.key,
    entity: item.entity,
    docId: item.docId,
    ...(item.uid ? { uid: item.uid } : {}),
    queuedAtMs: nowMs,
    attempts: 0,
    nextRetryAtMs: nowMs,
  }));
  return {
    nextPendingOps: [...existingFiltered, ...resetOps],
    nextFailedOps,
    requeuedCount: resetOps.length,
  };
}

export function computeSyncHealthState(params: {
  isOnline: boolean;
  isSyncing: boolean;
  quotaExceeded: boolean;
  pendingCount: number;
  failedOps: readonly FailedSyncOp[];
  lastSyncAtMs: number | null;
  lastError?: string | null;
}): SyncHealthState {
  const failedCount = params.failedOps.length;
  const latestFailedMsg =
    failedCount > 0 ? params.failedOps[failedCount - 1]?.errorMessage ?? null : null;
  const lastError = params.lastError ?? latestFailedMsg ?? null;

  let status: SyncHealthStatus = 'synced';
  if (params.isSyncing) {
    status = 'syncing';
  } else if (failedCount > 0) {
    status = 'failed';
  } else if (!params.isOnline) {
    status = 'offline';
  } else if (params.quotaExceeded) {
    status = 'quota_limited';
  } else if (params.pendingCount > 0) {
    status = 'pending';
  }

  return {
    status,
    pendingCount: params.pendingCount,
    failedCount,
    lastSyncAtMs: params.lastSyncAtMs,
    lastError,
    isSyncing: params.isSyncing,
  };
}
