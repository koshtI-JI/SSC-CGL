import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BASE_SYNC_BACKOFF_MS,
  classifySyncFailure,
  computeSyncBackoffDelayMs,
  computeSyncHealthState,
  isPendingOpReadyForRetry,
  MAX_SYNC_RETRY_ATTEMPTS,
  recordTransientOpRetry,
  requeueFailedOpsForRetry,
  toPermanentFailedOp,
} from './cloudFirstSync';
import {
  createEmptyLocalDb,
  type PendingSyncOp,
  queuePendingSyncOp,
} from './localFallbackStore';

test('queuePendingSyncOp retains more than 500 pending operations without silent drops', () => {
  const db = createEmptyLocalDb();
  for (let i = 0; i < 620; i += 1) {
    queuePendingSyncOp(db, { entity: 'question', docId: `q_${i}` });
  }
  assert.equal(db.pendingSyncOps.length, 620);
  assert.equal(db.pendingSyncOps[0].docId, 'q_0');
  assert.equal(db.pendingSyncOps[619].docId, 'q_619');
});

test('classifySyncFailure separates transient network/quota errors from permanent validation/permission errors', () => {
  const quotaErr = classifySyncFailure({ code: 'resource-exhausted', message: 'Quota exceeded' });
  assert.equal(quotaErr.kind, 'transient');
  assert.equal(quotaErr.quotaBlocked, true);

  const netErr = classifySyncFailure(new Error('Failed to fetch from server'));
  assert.equal(netErr.kind, 'transient');
  assert.equal(netErr.quotaBlocked, false);

  const permErr = classifySyncFailure({ code: 'permission-denied', message: 'Missing permissions' });
  assert.equal(permErr.kind, 'permanent');
  assert.equal(permErr.quotaBlocked, false);
});

test('recordTransientOpRetry applies exponential backoff and quarantines after max attempts', () => {
  const op: PendingSyncOp = {
    key: 'attempt:u1:att_1',
    entity: 'attempt',
    docId: 'att_1',
    uid: 'u1',
    queuedAtMs: 1_000,
    attempts: 0,
  };

  assert.equal(computeSyncBackoffDelayMs(1), BASE_SYNC_BACKOFF_MS);
  assert.equal(computeSyncBackoffDelayMs(2), BASE_SYNC_BACKOFF_MS * 2);

  let current: PendingSyncOp = op;
  for (let i = 1; i < MAX_SYNC_RETRY_ATTEMPTS; i += 1) {
    const res = recordTransientOpRetry(current, 'Client offline', 10_000);
    assert.ok(res.updatedOp);
    assert.equal(res.quarantinedOp, undefined);
    assert.equal(isPendingOpReadyForRetry(res.updatedOp, 10_500, false), false);
    assert.equal(isPendingOpReadyForRetry(res.updatedOp, 10_500, true), true);
    current = res.updatedOp;
  }

  const finalRes = recordTransientOpRetry(current, 'Still failing', 20_000);
  assert.equal(finalRes.updatedOp, undefined);
  assert.ok(finalRes.quarantinedOp);
  assert.equal(finalRes.quarantinedOp.attempts, MAX_SYNC_RETRY_ATTEMPTS);
});

test('toPermanentFailedOp and requeueFailedOpsForRetry preserve failed writes and allow manual retry', () => {
  const op = {
    key: 'student:damini_01',
    entity: 'student' as const,
    docId: 'damini_01',
    queuedAtMs: 1_000,
  };
  const failed = toPermanentFailedOp(op, 'invalid-argument', 'Schema mismatch', 5_000);
  assert.equal(failed.permanent, true);
  assert.equal(failed.errorCode, 'invalid-argument');

  const health = computeSyncHealthState({
    isOnline: true,
    isSyncing: false,
    quotaExceeded: false,
    pendingCount: 0,
    failedOps: [failed],
    lastSyncAtMs: 4_000,
  });
  assert.equal(health.status, 'failed');
  assert.equal(health.failedCount, 1);

  const requeued = requeueFailedOpsForRetry([failed], [], failed.key, 9_000);
  assert.equal(requeued.requeuedCount, 1);
  assert.equal(requeued.nextFailedOps.length, 0);
  assert.equal(requeued.nextPendingOps.length, 1);
  assert.equal(requeued.nextPendingOps[0].attempts, 0);
});
