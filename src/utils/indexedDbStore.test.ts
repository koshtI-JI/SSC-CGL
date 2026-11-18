import assert from 'node:assert/strict';
import test from 'node:test';
import type { MockTestDoc, QuestionDoc, TestDraftDoc } from '../types/exam';
import {
  cacheMockCatalogForOffline,
  clearIndexedDbForTests,
  computeOfflineReadinessSummary,
  deleteOfflineExamDraft,
  getOfflineExamDraft,
  getOfflineMockPack,
  hydrateLocalDbFromIndexedDb,
  hydrateSyncQueuesFromIndexedDb,
  listOfflineMockPacks,
  mirrorLocalDbToIndexedDb,
  mirrorSyncQueuesToIndexedDb,
  saveOfflineExamDraft,
  saveOfflineMockPack,
} from './indexedDbStore';
import { createEmptyLocalDb } from './localFallbackStore';

const makeQuestion = (id: string): QuestionDoc => ({
  id,
  subject: 'quant',
  topic: 'Percentage',
  difficulty: 'medium',
  source: 'Starter',
  questionEn: `Sample question ${id}`,
  optionsEn: ['10', '20', '30', '40'],
  correctIndex: 1,
  createdBy: 'admin',
});

const makeTest = (id: string, qIds: string[], published = true): MockTestDoc => ({
  id,
  title: `Mock ${id}`,
  subjectScope: 'quant',
  durationMinutes: 15,
  positiveMarks: 2,
  negativeMarks: 0.5,
  questionIds: qIds,
  questionCount: qIds.length,
  published,
  createdBy: 'admin',
});

test('indexedDbStore mirrors localFallbackDatabase and hydrates cleanly even when IndexedDB is unavailable', async () => {
  await clearIndexedDbForTests();
  const snap = createEmptyLocalDb();
  snap.questions['q1'] = makeQuestion('q1');
  await mirrorLocalDbToIndexedDb(snap);

  const hydrated = await hydrateLocalDbFromIndexedDb();
  assert.ok(hydrated);
  assert.equal(hydrated.questions['q1'].id, 'q1');
});

test('saveOfflineMockPack & cacheMockCatalogForOffline store ordered question packs cleanly', async () => {
  await clearIndexedDbForTests();
  const q1 = makeQuestion('q1');
  const q2 = makeQuestion('q2');
  const t1 = makeTest('t1', ['q2', 'q1'], true);
  const t2 = makeTest('t2', ['q1'], false);

  await saveOfflineMockPack(t1, [q1, q2], 1_700_000_000_000);
  const pack = await getOfflineMockPack('t1');
  assert.ok(pack);
  assert.deepEqual(
    pack.questions.map((q) => q.id),
    ['q2', 'q1']
  );

  const bulk = await cacheMockCatalogForOffline({
    tests: [t1, t2],
    questions: [q1, q2],
    nowMs: 1_700_000_005_000,
  });
  assert.equal(bulk.cachedPacks, 2);
  assert.equal(bulk.cachedQuestions, 2);

  const allPacks = await listOfflineMockPacks();
  assert.equal(allPacks.length, 2);

  const readiness = computeOfflineReadinessSummary({
    tests: [t1, t2],
    questions: [q1, q2],
    cachedPacks: allPacks,
  });
  assert.equal(readiness.totalPublishedTests, 1);
  assert.equal(readiness.offlineReadyTests, 1);
  assert.equal(readiness.lastCachedAtMs, 1_700_000_005_000);
});

test('saveOfflineExamDraft, getOfflineExamDraft, and deleteOfflineExamDraft manage drafts safely', async () => {
  await clearIndexedDbForTests();
  const draft: TestDraftDoc = {
    id: 't1',
    uid: 'u1',
    testId: 't1',
    testTitle: 'Quant Sprint',
    subjectScope: 'quant',
    currentIdx: 2,
    secondsLeft: 420,
    lang: 'en',
    answeredCount: 2,
    totalQuestions: 10,
    responses: {},
    updatedAtMs: 1_700_000_000_000,
  };
  await saveOfflineExamDraft(draft);
  const loaded = await getOfflineExamDraft('u1', 't1');
  assert.ok(loaded);
  assert.equal(loaded.secondsLeft, 420);

  await deleteOfflineExamDraft('u1', 't1');
  const deleted = await getOfflineExamDraft('u1', 't1');
  assert.equal(deleted, null);
});

test('mirrorSyncQueuesToIndexedDb and hydrateSyncQueuesFromIndexedDb persist pending and failed queues', async () => {
  await clearIndexedDbForTests();
  await mirrorSyncQueuesToIndexedDb(
    [
      {
        key: 'attempt:u1:att_1',
        entity: 'attempt',
        docId: 'att_1',
        uid: 'u1',
        queuedAtMs: 1000,
        attempts: 1,
      },
    ],
    [
      {
        key: 'student:u1',
        entity: 'student',
        docId: 'u1',
        queuedAtMs: 900,
        attempts: 5,
        errorCode: 'permission-denied',
        errorMessage: 'Insufficient permissions',
        failedAtMs: 1200,
        permanent: true,
      },
    ]
  );

  const restored = await hydrateSyncQueuesFromIndexedDb();
  assert.ok(restored);
  assert.equal(restored.pendingSyncOps.length, 1);
  assert.equal(restored.failedSyncOps.length, 1);
  assert.equal(restored.failedSyncOps[0].errorCode, 'permission-denied');
});
