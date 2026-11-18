import assert from 'node:assert/strict';
import test from 'node:test';
import type { LeaderboardEntry, QuestionDoc, StudentProfile, TestAttemptDoc, VipInvite } from '../types/exam';
import {
  assembleBlueprintCustomMock,
  buildAdminUserManagementRows,
  buildPortableCustomMockJson,
  buildScopedDataExport,
  computeCohortCommandCenterStats,
  filterAdminUserRows,
  findDuplicateSlotConflicts,
  findNextAvailableSlot,
  inspectLegacyPlaintextInvites,
  parseAndValidateScopedImport,
  parsePortableCustomMockJson,
} from './adminCommandCenter';
import { resetLocalDbForTests, writeLocalDb, createEmptyLocalDb } from './localFallbackStore';

const q = (id: string, subject: QuestionDoc['subject'], topic: string): QuestionDoc => ({
  id,
  subject,
  topic,
  difficulty: 'medium',
  source: 'PYQ',
  questionEn: `Sample ${topic} question ${id}`,
  optionsEn: ['A', 'B', 'C', 'D'],
  correctIndex: 0,
  createdBy: 'admin',
});

test('computeCohortCommandCenterStats computes platform avg score and cross-student weak topics', () => {
  const students: StudentProfile[] = [
    { uid: 'u1', loginId: 's1', displayName: 'Damini', targetPost: 'ASO in MEA', slotNumber: 1, cohortId: 'ssc_cgl_vip' },
    { uid: 'u2', loginId: 's2', displayName: 'Aarav', targetPost: 'Income Tax Inspector', slotNumber: 2, cohortId: 'ssc_cgl_vip' },
  ];
  const leaderboard: LeaderboardEntry[] = [
    { uid: 'u1', displayName: 'Damini', targetPost: 'ASO in MEA', cohortId: 'ssc_cgl_vip', totalXp: 500, testsAttempted: 2, bestScore: 165, avgAccuracy: 88, totalTimeSec: 3600 },
    { uid: 'u2', displayName: 'Aarav', targetPost: 'Income Tax Inspector', cohortId: 'ssc_cgl_vip', totalXp: 350, testsAttempted: 1, bestScore: 140, avgAccuracy: 74, totalTimeSec: 2100 },
  ];
  const attempts: TestAttemptDoc[] = [
    {
      id: 'a1', uid: 'u1', studentName: 'Damini', testId: 't1', testTitle: 'Mock 1', subjectScope: 'full',
      score: 160, maxScore: 200, accuracy: 88, correctCount: 80, wrongCount: 6, skippedCount: 14, totalTimeSec: 3200, xpEarned: 150, sectionStats: {},
    },
    {
      id: 'a2', uid: 'u2', studentName: 'Aarav', testId: 't2', testTitle: 'Trigo Quiz', subjectScope: 'quant', topicTag: 'Trigonometry',
      score: 12, maxScore: 20, accuracy: 60, correctCount: 6, wrongCount: 4, skippedCount: 0, totalTimeSec: 600, xpEarned: 20, sectionStats: {},
    },
  ];
  const q1 = q('q1', 'quant', 'Trigonometry');
  const q2 = q('q2', 'ga', 'Polity');

  const stats = computeCohortCommandCenterStats({
    students,
    attempts,
    leaderboard,
    questions: [q1, q2],
    sessionLogs: [],
    revisionVaultByUid: {
      u1: { q1: { id: 'q1', uid: 'u1', questionId: 'q1', testId: 't1', testTitle: 'Mock 1', subject: 'quant', lastSelectedIndex: 1, mastered: false } },
      u2: { q1: { id: 'q1', uid: 'u2', questionId: 'q1', testId: 't2', testTitle: 'Trigo Quiz', subject: 'quant', lastSelectedIndex: 2, mastered: false } },
    },
  });

  assert.equal(stats.qualifyingAttemptsCount, 2);
  assert.equal(stats.cohortAvgScorePct, 70); // (80% + 60%) / 2
  assert.equal(stats.cohortAvgMock200, 140);
  assert.ok(stats.topWeakTopics.length >= 1);
  assert.equal(stats.topWeakTopics[0].affectedStudentsCount, 2);
  assert.equal(stats.studentMatrix.length, 2);
});

test('assembleBlueprintCustomMock & buildPortableCustomMockJson generate valid portable mock JSONs', () => {
  const bank: QuestionDoc[] = [
    q('q1', 'quant', 'Percentage'),
    q('q2', 'quant', 'Percentage'),
    q('q3', 'ga', 'Polity & Constitution'),
    q('q4', 'english', 'Idioms & Phrases'),
  ];

  const assembled = assembleBlueprintCustomMock({
    allQuestions: bank,
    slots: [
      { subject: 'quant', chapterSlugOrTopic: 'quant_percentage', count: 2 },
      { subject: 'ga', chapterSlugOrTopic: 'ga_polity', count: 2 },
    ],
    seedKey: 'seed1',
  });

  assert.equal(assembled.questionIds.length, 3);
  assert.equal(assembled.subjectScope, 'full');
  assert.equal(assembled.shortfalls.length, 1);

  const payload = buildPortableCustomMockJson({
    title: 'Weekend Quant + Polity Blueprint',
    durationMinutes: 15,
    positiveMarks: 2,
    negativeMarks: 0.5,
    published: true,
    assembled,
  });

  const roundTrip = parsePortableCustomMockJson(JSON.stringify(payload));
  assert.equal(roundTrip.paper.title, 'Weekend Quant + Polity Blueprint');
  assert.equal(roundTrip.paper.questions.length, 3);
});

test('buildScopedDataExport & parseAndValidateScopedImport support scoped portability cleanly', () => {
  resetLocalDbForTests();
  const db = createEmptyLocalDb();
  db.questions['q1'] = q('q1', 'quant', 'Algebra');
  db.students['u1'] = {
    uid: 'u1',
    loginId: 'damini',
    displayName: 'Damini',
    targetPost: 'ASO in MEA',
    slotNumber: 1,
    cohortId: 'ssc_cgl_vip',
  };
  writeLocalDb(db);

  const qExport = buildScopedDataExport('questions_mocks');
  assert.equal(qExport.counts.questions, 1);
  assert.equal(qExport.database.students, undefined);

  const stExport = buildScopedDataExport('students_attempts');
  assert.equal(stExport.counts.students, 1);
  assert.equal(stExport.database.questions, undefined);

  resetLocalDbForTests();
  const res = parseAndValidateScopedImport(JSON.stringify(qExport));
  assert.ok(res.importedRecords >= 1);
});

test('buildAdminUserManagementRows merges canonical UID rows with timestamp precedence and flags slot #1 collision', () => {
  const invites: VipInvite[] = [
    {
      id: 'damini_01',
      loginId: 'damini_888',
      displayName: 'Damini',
      targetPost: 'ASO in MEA',
      slotNumber: 1,
      active: true,
      passwordHash: 'sha256_hash_damini_123456',
      legacyPlaintextDetected: true,
      updatedAt: 2000,
    },
    {
      id: 'demo_123',
      loginId: 'demo@123',
      displayName: 'Demo',
      targetPost: 'Income Tax Inspector',
      slotNumber: 1,
      active: false,
      passwordHash: 'sha256_hash_demo_123456',
      updatedAt: 1000,
    },
    {
      id: 'admin_preview',
      loginId: 'admin_preview',
      displayName: 'Preview Dummy',
      targetPost: 'ASO in MEA',
      slotNumber: 5,
      active: true,
      passwordHash: 'hash_placeholder_123456',
    },
  ];
  const students: StudentProfile[] = [
    {
      uid: 'damini_01',
      loginId: 'damini_01',
      displayName: 'Damini Old Profile',
      targetPost: 'GST Inspector',
      slotNumber: 1,
      cohortId: 'ssc_cgl_vip',
      updatedAt: 1500, // older than invite (2000) -> invite displayName/targetPost wins
    },
    {
      uid: 'demo_123',
      loginId: 'demo@123',
      displayName: 'Demo Updated Name',
      targetPost: 'ASO in CSS',
      slotNumber: 1,
      cohortId: 'ssc_cgl_vip',
      updatedAt: 3000, // newer than invite (1000) -> student profile wins
    },
  ];
  const leaderboard: LeaderboardEntry[] = [
    {
      uid: 'damini_01',
      displayName: 'Damini',
      targetPost: 'ASO in MEA',
      cohortId: 'ssc_cgl_vip',
      totalXp: 530,
      testsAttempted: 4,
      bestScore: 170,
      avgAccuracy: 85,
      totalTimeSec: 4000,
    },
  ];

  const rows = buildAdminUserManagementRows({
    invites,
    students,
    leaderboard,
    attempts: [],
    presences: [],
  });

  // Excludes admin_preview, keeps Damini & Demo as 2 canonical rows
  assert.equal(rows.length, 2);
  const damini = rows.find((r) => r.uid === 'damini_01');
  const demo = rows.find((r) => r.uid === 'demo_123');
  assert.ok(damini);
  assert.ok(demo);
  assert.equal(damini.loginId, 'damini_888');
  assert.equal(damini.displayName, 'Damini');
  assert.equal(damini.totalXp, 530);
  assert.equal(damini.legacyPlaintextDetected, true);
  assert.equal(damini.slotConflictWith.length, 1);
  assert.equal(demo.displayName, 'Demo Updated Name');
  assert.equal(demo.active, false);

  const conflicts = findDuplicateSlotConflicts(rows);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].slotNumber, 1);
  assert.deepEqual(conflicts[0].uids, ['damini_01', 'demo_123']);
  assert.equal(findNextAvailableSlot(rows), 2);
  assert.equal(filterAdminUserRows(rows, 'damini_888', 'active').length, 1);
  assert.equal(filterAdminUserRows(rows, '', 'revoked').length, 1);

  const legacyAudit = inspectLegacyPlaintextInvites(invites);
  assert.deepEqual(legacyAudit, {
    totalInvites: 2,
    affectedCount: 1,
    affectedUids: ['damini_01'],
  });
});
