import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addTombstone,
  createEmptyLocalDb,
  exportLocalCohortSnapshot,
  importLocalCohortSnapshot,
  mergeByIdWithTombstones,
  mutateLocalDb,
  queuePendingSyncOp,
  readLocalDb,
  resetLocalDbForTests,
  shouldFallbackToLocalOnError,
  type StorageLike,
} from './localFallbackStore';
import { RemoteWriteTimeoutError, raceWithWriteTimeout } from './firestoreQuota';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

test('mergeByIdWithTombstones merges local edits and honors deleted tombstones', () => {
  const remote = [
    { id: 'q1', topic: 'Old Topic', updatedAtMs: 100 },
    { id: 'q2', topic: 'Deleted Locally', updatedAtMs: 100 },
  ];
  const local = [
    { id: 'q1', topic: 'Updated Topic', updatedAtMs: 200 },
    { id: 'q3', topic: 'Brand New Local Q', updatedAtMs: 300 },
  ];

  const merged = mergeByIdWithTombstones({
    remoteItems: remote,
    localItems: local,
    deletedIds: ['q2'],
    getId: (item) => item.id,
  });

  assert.equal(merged.length, 2);
  assert.equal(merged.find((m) => m.id === 'q1')?.topic, 'Updated Topic');
  assert.equal(merged.find((m) => m.id === 'q2'), undefined);
  assert.equal(merged.find((m) => m.id === 'q3')?.topic, 'Brand New Local Q');
});

test('queuePendingSyncOp deduplicates operations for same entity and docId', () => {
  const dbState = createEmptyLocalDb();
  queuePendingSyncOp(dbState, { entity: 'student', docId: 'uid_1' });
  queuePendingSyncOp(dbState, { entity: 'student', docId: 'uid_1' });
  queuePendingSyncOp(dbState, { entity: 'attempt', docId: 'att_1', uid: 'uid_1' });

  assert.equal(dbState.pendingSyncOps.length, 2);
  assert.deepEqual(
    dbState.pendingSyncOps.map((op) => op.key),
    ['student:uid_1', 'attempt:uid_1:att_1']
  );
});

test('addTombstone avoids duplicates and caps size cleanly', () => {
  let list: string[] = [];
  list = addTombstone(list, 'a');
  list = addTombstone(list, 'b');
  list = addTombstone(list, 'a');
  assert.deepEqual(list, ['b', 'a']);
});

test('shouldFallbackToLocalOnError identifies quota and offline errors accurately', () => {
  assert.equal(shouldFallbackToLocalOnError({ code: 'resource-exhausted' }), true);
  assert.equal(shouldFallbackToLocalOnError(new Error('Client is offline')), true);
  assert.equal(shouldFallbackToLocalOnError({ code: 'unavailable' }), true);
  assert.equal(shouldFallbackToLocalOnError(new RemoteWriteTimeoutError(2500)), true);
  assert.equal(shouldFallbackToLocalOnError(new Error('Invalid password')), false);
});

test('raceWithWriteTimeout rejects stalled remote writes quickly without unhandled errors', async () => {
  const stalled = new Promise<string>(() => {
    // Never settles (simulates Firestore 48s exponential backoff)
  });
  await assert.rejects(
    () => raceWithWriteTimeout(stalled, 25),
    (err: unknown) => err instanceof RemoteWriteTimeoutError
  );

  const fast = Promise.resolve('ok');
  assert.equal(await raceWithWriteTimeout(fast, 100), 'ok');
});

test('exportLocalCohortSnapshot and importLocalCohortSnapshot preserve student attempts and config', () => {
  const storageA = createMemoryStorage();
  const storageB = createMemoryStorage();
  resetLocalDbForTests(storageA);

  mutateLocalDb((draft) => {
    draft.students.stu_1 = {
      uid: 'stu_1',
      loginId: 'demo_123',
      displayName: 'Demo Aspirant',
      targetPost: 'ASO in MEA',
      slotNumber: 1,
      cohortId: 'ssc_cgl_vip',
    };
    draft.attempts.att_1 = {
      id: 'att_1',
      uid: 'stu_1',
      studentName: 'Demo Aspirant',
      testId: 't_1',
      testTitle: 'Tier-I Mock',
      subjectScope: 'full',
      score: 145,
      maxScore: 200,
      accuracy: 88,
      correctCount: 75,
      wrongCount: 10,
      skippedCount: 15,
      totalTimeSec: 3200,
      xpEarned: 185,
      sectionStats: {},
    };
  }, storageA);

  const snapshot = exportLocalCohortSnapshot(storageA);
  const res = importLocalCohortSnapshot(JSON.stringify(snapshot), storageB);
  assert.ok(res.importedRecords >= 2);

  const restored = readLocalDb(storageB);
  assert.equal(restored.students.stu_1.displayName, 'Demo Aspirant');
  assert.equal(restored.attempts.att_1.score, 145);
});

test('exportLocalCohortSnapshot strips adminCredentials, passwordHash, and legacy currentPassword while importLocalCohortSnapshot protects existing credentials', () => {
  const storageA = createMemoryStorage();
  const storageB = createMemoryStorage();
  resetLocalDbForTests(storageA);
  resetLocalDbForTests(storageB);

  mutateLocalDb((draft) => {
    draft.adminCredentials = {
      adminId: 'admin',
      passwordHash: 'super_secret_admin_hash_1234567890',
      updatedAtMs: 1000,
    };
    draft.vipInvites['damini_01'] = {
      id: 'damini_01',
      loginId: 'damini_888',
      displayName: 'Damini',
      targetPost: 'ASO in MEA',
      slotNumber: 1,
      active: true,
      passwordHash: 'super_secret_student_hash_123456',
      // Simulate legacy dirty object entering hydration
      ...({ currentPassword: 'plaintext_should_be_stripped' } as Record<string, unknown>),
    };
  }, storageA);

  const hydratedA = readLocalDb(storageA);
  assert.equal((hydratedA.vipInvites['damini_01'] as unknown as Record<string, unknown>).currentPassword, undefined);
  assert.equal(hydratedA.vipInvites['damini_01'].legacyPlaintextDetected, true);

  const snapshot = exportLocalCohortSnapshot(storageA);
  const rawJson = JSON.stringify(snapshot);
  assert.equal(snapshot.database.adminCredentials, null);
  assert.equal(snapshot.database.vipInvites['damini_01'].passwordHash, '');
  assert.equal(rawJson.includes('plaintext_should_be_stripped'), false);
  assert.equal(rawJson.includes('super_secret_admin_hash'), false);
  assert.equal(rawJson.includes('super_secret_student_hash'), false);

  // Target B already has adminCredentials + passwordHash: importing an older/legacy JSON must not overwrite them or reintroduce currentPassword
  mutateLocalDb((draft) => {
    draft.adminCredentials = {
      adminId: 'owner_admin',
      passwordHash: 'existing_protected_admin_hash_12345',
      updatedAtMs: 2000,
    };
    draft.vipInvites['damini_01'] = {
      id: 'damini_01',
      loginId: 'damini_888',
      displayName: 'Damini',
      targetPost: 'ASO in MEA',
      slotNumber: 1,
      active: true,
      passwordHash: 'existing_protected_student_hash_12345',
    };
  }, storageB);

  const legacyImportPayload = {
    version: 1,
    adminCredentials: {
      adminId: 'attacker_admin',
      passwordHash: 'attacker_hash_1234567890123456',
      updatedAtMs: 9999,
    },
    vipInvites: {
      damini_01: {
        id: 'damini_01',
        loginId: 'damini_888',
        displayName: 'Damini',
        targetPost: 'ASO in MEA',
        slotNumber: 1,
        active: true,
        passwordHash: '',
        currentPassword: 'leaked_legacy_password',
      },
    },
  };

  importLocalCohortSnapshot(legacyImportPayload, storageB);
  const afterB = readLocalDb(storageB);
  assert.equal(afterB.adminCredentials?.adminId, 'owner_admin');
  assert.equal(afterB.adminCredentials?.passwordHash, 'existing_protected_admin_hash_12345');
  assert.equal(afterB.vipInvites['damini_01'].passwordHash, 'existing_protected_student_hash_12345');
  assert.equal((afterB.vipInvites['damini_01'] as unknown as Record<string, unknown>).currentPassword, undefined);
});
