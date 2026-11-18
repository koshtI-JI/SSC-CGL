import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isFirestoreQuotaExceeded,
  isQuotaExceededError,
  markFirestoreQuotaExceeded,
  PROGRESS_BACKUP_MIN_INTERVAL_MS,
  resetFirestoreQuotaStateForTests,
  shouldSyncProgressBackupRemote,
  subscribeFirestoreQuotaExceeded,
} from './firestoreQuota';

test('isQuotaExceededError detects Firebase resource-exhausted errors and ignores normal errors', () => {
  assert.equal(isQuotaExceededError({ code: 'resource-exhausted', message: 'Quota limit exceeded' }), true);
  assert.equal(
    isQuotaExceededError(new Error('FirebaseError: [code=resource-exhausted]: Quota limit exceeded.')),
    true
  );
  assert.equal(
    isQuotaExceededError(new Error("Free daily write units per project (free tier database) per day")),
    true
  );
  assert.equal(isQuotaExceededError(new Error('Missing or insufficient permissions.')), false);
  assert.equal(isQuotaExceededError(null), false);
});

test('markFirestoreQuotaExceeded trips circuit breaker and notifies subscribers', () => {
  resetFirestoreQuotaStateForTests();
  const seen: boolean[] = [];
  const unsub = subscribeFirestoreQuotaExceeded((val) => seen.push(val));

  assert.equal(isFirestoreQuotaExceeded(), false);
  markFirestoreQuotaExceeded(new Error('Permission denied'));
  assert.equal(isFirestoreQuotaExceeded(), false);

  markFirestoreQuotaExceeded({ code: 'resource-exhausted', message: 'Quota exceeded.' });
  assert.equal(isFirestoreQuotaExceeded(), true);
  assert.deepEqual(seen, [false, true]);

  unsub();
  resetFirestoreQuotaStateForTests();
});

test('shouldSyncProgressBackupRemote blocks 1-second study-time ticks and syncs on milestones or 5m interval', () => {
  const base = {
    uid: 'stu_1',
    attemptCount: 2,
    totalXp: 120,
    testsAttempted: 2,
    bestScore: 145,
    displayName: 'Aarav',
    targetPost: 'ASO in MEA',
    totalStudySec: 100,
  };

  // Initial login sync allowed
  const r1 = shouldSyncProgressBackupRemote(null, base, 1_000_000);
  assert.equal(r1.shouldSync, true);

  // 1 second later with studySec = 101 -> blocked
  const r2 = shouldSyncProgressBackupRemote(
    r1.nextState,
    { ...base, totalStudySec: 101 },
    1_001_000
  );
  assert.equal(r2.shouldSync, false);

  // New test attempt submitted 10s later -> immediate sync allowed
  const r3 = shouldSyncProgressBackupRemote(
    r2.nextState,
    { ...base, attemptCount: 3, totalXp: 180, totalStudySec: 110 },
    1_010_000
  );
  assert.equal(r3.shouldSync, true);

  // 5 minutes + 300s study elapsed -> periodic sync allowed
  const r4 = shouldSyncProgressBackupRemote(
    r3.nextState,
    { ...base, attemptCount: 3, totalXp: 180, totalStudySec: 410 },
    1_010_000 + PROGRESS_BACKUP_MIN_INTERVAL_MS
  );
  assert.equal(r4.shouldSync, true);
});
