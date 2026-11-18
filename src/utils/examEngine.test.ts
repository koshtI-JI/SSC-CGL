import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeTestResultAnalytics,
  applyActivityMultiplier,
  buildAdaptiveQuestionSelection,
  buildCompletedRevisionQuestionIds,
  buildDailySectionalTestId,
  buildStudentGitReportPayloads,
  calculateTestOutcome,
  computeLifetimeStudentStats,
  computeRankTierFromStep,
  computeStudentActivitySummary,
  computeStudentRankTier,
  computeTaskProgress,
  computeUpdatedLeaderboardStats,
  computeWeeklyActivitySeries,
  computeWeeklyProgressSeries,
  emailToInviteKey,
  extractCustomMockFilterCatalog,
  formatDailyMockTitle,
  formatDailySectionalTitle,
  formatHumanAvgSeconds,
  formatLastSeen,
  formatSeconds,
  formatWelcomeTitle,
  getAttemptCompletionPercent,
  getAttemptStatusLabel,
  getLocalDateKey,
  getMinQuestionsForXp,
  getPaletteStatus,
  getPendingResolutionNotifications,
  getQualifyingTestsForTask,
  groupSessionLogsByDate,
  isAttemptComplete,
  isDailyMockTest,
  isDailySectionalTest,
  isPresenceOnline,
  isSessionLogLive,
  isTaskExpired,
  loginIdToKey,
  rankLeaderboard,
  selectCustomMockQuestions,
  summarizeCompletedTests,
  summarizePendingTests,
  TICKET_RESOLVED_PUSH_MESSAGE,
  toLocalDateKey,
} from './examEngine';
import {
  calcBackspace,
  calcClear,
  calcEquals,
  calcInputDecimal,
  calcInputDigit,
  calcInputOperator,
  calcUnaryOp,
  INITIAL_CALC_STATE,
} from './calculatorEngine';
import {
  DEFAULT_SCORING_CONFIG,
  type CohortTaskDoc,
  type LeaderboardEntry,
  type MockTestDoc,
  type QuestionDoc,
  type QuestionResponseState,
  type RevisionItemDoc,
  type StudentSessionLogDoc,
  type SupportTicketDoc,
  type TestAttemptDoc,
  type TestDraftDoc,
} from '../types/exam';

const sampleQuestions: QuestionDoc[] = [
  {
    id: 'q1',
    subject: 'quant',
    topic: 'Percentage',
    difficulty: 'medium',
    source: 'SSC CGL PYQ',
    questionEn: 'What is 25% of 200?',
    optionsEn: ['25', '50', '75', '100'],
    correctIndex: 1,
    createdBy: 'admin1',
  },
  {
    id: 'q2',
    subject: 'reasoning',
    topic: 'Series',
    difficulty: 'easy',
    source: 'SSC CGL PYQ',
    questionEn: 'Next in 2, 4, 8, ?',
    optionsEn: ['10', '12', '16', '20'],
    correctIndex: 2,
    createdBy: 'admin1',
  },
  {
    id: 'q3',
    subject: 'ga',
    topic: 'Polity',
    difficulty: 'hard',
    source: 'SSC CGL PYQ',
    questionEn: 'Article 14 relates to?',
    optionsEn: ['Equality', 'Speech', 'Life', 'Religion'],
    correctIndex: 0,
    createdBy: 'admin1',
  },
];

test('loginIdToKey and emailToInviteKey match Firestore CEL sanitizer', () => {
  assert.equal(emailToInviteKey('Aspirant.One+CGL@Gmail.com '), 'aspirant_one_cgl_gmail_com');
  assert.equal(loginIdToKey(' VIP-Student_01 '), 'vip_student_01');
  assert.equal(loginIdToKey('   '), 'invalid_id');
});

test('getPaletteStatus evaluates all 5 TCS iON states', () => {
  assert.equal(getPaletteStatus(undefined), 'not_visited');
  assert.equal(
    getPaletteStatus({ questionId: 'q1', visited: true, selectedIndex: -1, markedForReview: false, timeSpentSec: 5 }),
    'not_answered'
  );
  assert.equal(
    getPaletteStatus({ questionId: 'q1', visited: true, selectedIndex: 2, markedForReview: false, timeSpentSec: 5 }),
    'answered'
  );
  assert.equal(
    getPaletteStatus({ questionId: 'q1', visited: true, selectedIndex: -1, markedForReview: true, timeSpentSec: 5 }),
    'marked'
  );
  assert.equal(
    getPaletteStatus({ questionId: 'q1', visited: true, selectedIndex: 1, markedForReview: true, timeSpentSec: 5 }),
    'answered_marked'
  );
});

test('calculateTestOutcome applies +2/-0.5 marking, strict >80% XP formula, section stats, and extracts wrong/skipped items', () => {
  const tenQuestions: QuestionDoc[] = Array.from({ length: 10 }, (_, idx) => ({
    id: `qt_${idx + 1}`,
    subject: (['quant', 'reasoning', 'ga', 'english'][idx % 4]) as QuestionDoc['subject'],
    topic: 'Mixed',
    difficulty: 'medium',
    source: 'SSC CGL PYQ',
    questionEn: `Question ${idx + 1}`,
    optionsEn: ['A', 'B', 'C', 'D'],
    correctIndex: 1,
    createdBy: 'admin1',
  }));
  // 9 out of 10 attempted (90% > 80%): 7 correct, 2 wrong, 1 skipped
  const responses: Record<string, QuestionResponseState> = {};
  tenQuestions.forEach((q, idx) => {
    if (idx < 7) {
      responses[q.id] = { questionId: q.id, visited: true, selectedIndex: 1, markedForReview: false, timeSpentSec: 10 };
    } else if (idx < 9) {
      responses[q.id] = { questionId: q.id, visited: true, selectedIndex: 0, markedForReview: false, timeSpentSec: 10 };
    } else {
      responses[q.id] = { questionId: q.id, visited: true, selectedIndex: -1, markedForReview: true, timeSpentSec: 5 };
    }
  });

  const outcome = calculateTestOutcome(
    tenQuestions,
    responses,
    { positiveMarks: 2, negativeMarks: 0.5 },
    DEFAULT_SCORING_CONFIG
  );

  assert.equal(outcome.correctCount, 7);
  assert.equal(outcome.wrongCount, 2);
  assert.equal(outcome.skippedCount, 1);
  assert.equal(outcome.completionPercent, 90);
  assert.equal(outcome.isComplete, true);
  assert.equal(outcome.score, 13); // 7*2 - 2*0.5
  assert.equal(outcome.maxScore, 20);
  assert.equal(outcome.accuracy, 77.8);
  assert.equal(outcome.totalTimeSec, 95);
  // 10 base + 7*2 correct = 24 (accuracy 77.8 < 80 threshold so no bonus)
  assert.equal(outcome.xpEarned, 24);
  assert.equal(outcome.wrongItems.length, 2);
  assert.equal(outcome.skippedItems.length, 1);
  assert.equal(outcome.skippedItems[0].questionId, 'qt_10');
  assert.equal(outcome.skippedItems[0].lastSelectedIndex, -1);

  // Exactly 80% attempted (8/10) must NOT award XP under strict >80% rule
  const exactlyEightyResponses = { ...responses };
  exactlyEightyResponses.qt_9 = { questionId: 'qt_9', visited: true, selectedIndex: -1, markedForReview: false, timeSpentSec: 5 };
  const eightyOutcome = calculateTestOutcome(
    tenQuestions,
    exactlyEightyResponses,
    { positiveMarks: 2, negativeMarks: 0.5 },
    DEFAULT_SCORING_CONFIG
  );
  assert.equal(eightyOutcome.completionPercent, 80);
  assert.equal(eightyOutcome.isComplete, false);
  assert.equal(eightyOutcome.xpEarned, 0);
});

test('calculateTestOutcome awards accuracy bonus when threshold met', () => {
  const responses: Record<string, QuestionResponseState> = {
    q1: { questionId: 'q1', visited: true, selectedIndex: 1, markedForReview: false, timeSpentSec: 10 },
    q2: { questionId: 'q2', visited: true, selectedIndex: 2, markedForReview: false, timeSpentSec: 10 },
    q3: { questionId: 'q3', visited: true, selectedIndex: 0, markedForReview: false, timeSpentSec: 10 },
  };
  const outcome = calculateTestOutcome(
    sampleQuestions,
    responses,
    { positiveMarks: 2, negativeMarks: 0.5 },
    DEFAULT_SCORING_CONFIG
  );
  assert.equal(outcome.accuracy, 100);
  // 10 base + 3*2 + 25 accuracy bonus = 41
  assert.equal(outcome.xpEarned, 41);
});

test('rankLeaderboard orders by XP then bestScore then avgAccuracy', () => {
  const list: LeaderboardEntry[] = [
    { uid: 'u1', displayName: 'A', targetPost: 'MEA', cohortId: 'ssc_cgl_vip', totalXp: 100, testsAttempted: 2, bestScore: 140, avgAccuracy: 75, totalTimeSec: 1000 },
    { uid: 'u2', displayName: 'B', targetPost: 'ITI', cohortId: 'ssc_cgl_vip', totalXp: 150, testsAttempted: 2, bestScore: 130, avgAccuracy: 70, totalTimeSec: 900 },
    { uid: 'u3', displayName: 'C', targetPost: 'GST', cohortId: 'ssc_cgl_vip', totalXp: 100, testsAttempted: 3, bestScore: 145, avgAccuracy: 60, totalTimeSec: 1200 },
  ];
  const ranked = rankLeaderboard(list);
  assert.deepEqual(
    ranked.map((r) => r.uid),
    ['u2', 'u3', 'u1']
  );
});

test('computeUpdatedLeaderboardStats and computeTaskProgress update deterministically', () => {
  const next = computeUpdatedLeaderboardStats(
    { totalXp: 20, testsAttempted: 1, bestScore: 10, avgAccuracy: 80, totalTimeSec: 300 },
    { score: 15, accuracy: 90, totalTimeSec: 400, xpEarned: 30 }
  );
  assert.equal(next.totalXp, 50);
  assert.equal(next.testsAttempted, 2);
  assert.equal(next.bestScore, 15);
  assert.equal(next.avgAccuracy, 85);
  assert.equal(next.totalTimeSec, 700);

  const task: CohortTaskDoc = {
    id: 't1',
    title: 'GS Sprint',
    description: 'Give 2 GA tests',
    targetTests: 2,
    targetSubject: 'ga',
    bonusXp: 50,
    dueDate: '2026-11-20',
    active: true,
  };
  const attempts: TestAttemptDoc[] = [
    {
      id: 'a1',
      uid: 'u1',
      studentName: 'A',
      testId: 'test1',
      testTitle: 'GA Mini',
      subjectScope: 'ga',
      score: 16,
      maxScore: 20,
      accuracy: 100,
      correctCount: 9,
      wrongCount: 0,
      skippedCount: 1,
      totalTimeSec: 120,
      xpEarned: 53,
      sectionStats: { ga: { correct: 9, wrong: 0, skipped: 1, timeSec: 120 } },
    },
  ];
  const prog = computeTaskProgress(task, attempts, new Date(2026, 10, 13));
  assert.equal(prog.completedCount, 1);
  assert.equal(prog.percent, 50);
  assert.equal(prog.isEligible, false);
  assert.equal(prog.isExpired, false);
});

test('formatSeconds formats mm:ss and hh:mm:ss cleanly', () => {
  assert.equal(formatSeconds(65), '01:05');
  assert.equal(formatSeconds(3661), '01:01:01');
});

test('getQualifyingTestsForTask filters sectional and combined tests accurately and prioritizes direct subject tests', () => {
  const sampleTests: MockTestDoc[] = [
    {
      id: 't_full',
      title: 'Full Mock',
      subjectScope: 'full',
      durationMinutes: 60,
      positiveMarks: 2,
      negativeMarks: 0.5,
      questionIds: ['ssc_q_quant_01', 'ssc_q_ga_01'],
      questionCount: 2,
      published: true,
      createdBy: 'admin',
    },
    {
      id: 't_reas_eng',
      title: 'Reas + Eng',
      subjectScope: 'full',
      durationMinutes: 15,
      positiveMarks: 2,
      negativeMarks: 0.5,
      questionIds: ['ssc_q_reas_01', 'ssc_q_eng_01'],
      questionCount: 2,
      published: true,
      createdBy: 'admin',
    },
    {
      id: 't_ga',
      title: 'GA Booster',
      subjectScope: 'ga',
      durationMinutes: 8,
      positiveMarks: 2,
      negativeMarks: 0.5,
      questionIds: ['ssc_q_ga_01'],
      questionCount: 1,
      published: true,
      createdBy: 'admin',
    },
  ];

  const gaTask: CohortTaskDoc = {
    id: 'task_ga',
    title: 'GA Sprint',
    description: 'Attempt 1 GA test',
    targetTests: 1,
    targetSubject: 'ga',
    bonusXp: 40,
    dueDate: '2026-11-30',
    active: true,
  };

  const qualifying = getQualifyingTestsForTask(gaTask, sampleTests);
  assert.deepEqual(
    qualifying.map((t) => t.id),
    ['t_ga', 't_full']
  );

  const allTask: CohortTaskDoc = { ...gaTask, id: 'task_all', targetSubject: 'all' };
  assert.equal(getQualifyingTestsForTask(allTask, sampleTests).length, 3);
});

test('isPresenceOnline and formatLastSeen detect active vs stale or offline sessions', () => {
  const now = 1_000_000;
  assert.equal(isPresenceOnline(undefined, now), false);
  assert.equal(isPresenceOnline({ status: 'offline', lastSeenMs: now }, now), false);
  assert.equal(isPresenceOnline({ status: 'online', lastSeenMs: now - 10_000 }, now), true);
  assert.equal(isPresenceOnline({ status: 'in_exam', lastSeenMs: now - 35_000 }, now), true);
  assert.equal(isPresenceOnline({ status: 'in_exam', lastSeenMs: now - 40_000 }, now), false);

  assert.equal(formatLastSeen(now - 5_000, now), 'Just now');
  assert.equal(formatLastSeen(now - 45_000, now), '45s ago');
  assert.equal(formatLastSeen(now - 180_000, now), '3m ago');
});

test('applyActivityMultiplier and calculateTestOutcome scale XP up or down by activity tier', () => {
  assert.equal(applyActivityMultiplier(50, 0.85), 43);
  assert.equal(applyActivityMultiplier(50, 1.25), 63);
  assert.equal(applyActivityMultiplier(50, 1.4), 70);

  const responses: Record<string, QuestionResponseState> = {
    q1: { questionId: 'q1', visited: true, selectedIndex: 1, markedForReview: false, timeSpentSec: 10 },
    q2: { questionId: 'q2', visited: true, selectedIndex: 2, markedForReview: false, timeSpentSec: 10 },
    q3: { questionId: 'q3', visited: true, selectedIndex: 0, markedForReview: false, timeSpentSec: 10 },
  };
  const lowOutcome = calculateTestOutcome(
    sampleQuestions,
    responses,
    { positiveMarks: 2, negativeMarks: 0.5 },
    DEFAULT_SCORING_CONFIG,
    0.85
  );
  assert.equal(lowOutcome.baseXp, 41);
  assert.equal(lowOutcome.xpEarned, 35);

  const highOutcome = calculateTestOutcome(
    sampleQuestions,
    responses,
    { positiveMarks: 2, negativeMarks: 0.5 },
    DEFAULT_SCORING_CONFIG,
    1.25
  );
  assert.equal(highOutcome.baseXp, 41);
  assert.equal(highOutcome.xpEarned, 51);
});

test('computeStudentActivitySummary evaluates Low Activity, Dedicated, and Top Hustler tiers', () => {
  const now = new Date('2026-11-13T10:00:00Z').getTime();
  const yesterday = now - 86_400_000;

  const lowSummary = computeStudentActivitySummary('u_low', [], [], now);
  assert.equal(lowSummary.tierLabel, 'Low Activity');
  assert.equal(lowSummary.rewardMultiplier, 0.85);

  const attempts: TestAttemptDoc[] = [
    {
      id: 'a1',
      uid: 'u_top',
      studentName: 'Top Student',
      testId: 't1',
      testTitle: 'Full Mock #1',
      subjectScope: 'full',
      score: 120,
      maxScore: 200,
      accuracy: 80,
      correctCount: 50,
      wrongCount: 15,
      skippedCount: 5,
      totalTimeSec: 3600,
      xpEarned: 150,
      sectionStats: {
        quant: { correct: 15, wrong: 5, skipped: 0, timeSec: 1000 },
        reasoning: { correct: 15, wrong: 2, skipped: 1, timeSec: 900 },
        english: { correct: 10, wrong: 4, skipped: 2, timeSec: 800 },
        ga: { correct: 10, wrong: 4, skipped: 2, timeSec: 900 },
      },
      createdAt: new Date(yesterday),
    },
  ];
  const sessions: StudentSessionLogDoc[] = [
    {
      id: 's1',
      uid: 'u_top',
      displayName: 'Top Student',
      loginId: 'top1',
      status: 'ended',
      loginAtMs: yesterday,
      lastActiveAtMs: yesterday + 3600_000,
      logoutAtMs: yesterday + 3600_000,
      activeDurationSec: 3600,
      testsCompleted: 1,
      questionsAttempted: 65,
      subjectsStudied: ['quant', 'reasoning', 'english', 'ga'],
      lastActivityTitle: 'Full Mock #1',
    },
    {
      id: 's2',
      uid: 'u_top',
      displayName: 'Top Student',
      loginId: 'top1',
      status: 'active',
      loginAtMs: now - 2400_000,
      lastActiveAtMs: now,
      logoutAtMs: 0,
      activeDurationSec: 2400,
      testsCompleted: 0,
      questionsAttempted: 10,
      subjectsStudied: ['quant'],
      lastActivityTitle: 'Revision Vault',
    },
  ];

  const topSummary = computeStudentActivitySummary('u_top', attempts, sessions, now);
  assert.equal(topSummary.tierLabel, 'Top Hustler');
  assert.equal(topSummary.rewardMultiplier, 1.4);
  assert.equal(topSummary.subjectsCoveredCount, 4);
  assert.equal(topSummary.activeDays7d, 2);
  assert.equal(topSummary.totalStudyMinutes, 100);

  const series = computeWeeklyActivitySeries(attempts, sessions, new Date(now));
  assert.equal(series.length, 7);
  assert.equal(series[5].studyMinutes, 60);
  assert.equal(series[6].studyMinutes, 40);
});

test('daily mock helpers and adaptive Revision Vault selection prioritize weak + unseen questions', () => {
  const key = getLocalDateKey(new Date(2026, 10, 13));
  assert.equal(key, '2026_11_13');
  assert.equal(isDailyMockTest(`daily_mock_${key}`), true);
  assert.equal(isDailyMockTest('starter_test_01'), false);
  assert.match(formatDailyMockTitle(key), /Daily Live Mock/);

  const bank: QuestionDoc[] = [
    ...sampleQuestions,
    {
      id: 'q4',
      subject: 'english',
      topic: 'Idioms',
      difficulty: 'easy',
      source: 'SSC CGL PYQ',
      questionEn: 'Once in a blue moon means?',
      optionsEn: ['Rarely', 'Daily', 'Never', 'Always'],
      correctIndex: 0,
      createdBy: 'admin1',
    },
    {
      id: 'q5',
      subject: 'quant',
      topic: 'Algebra',
      difficulty: 'hard',
      source: 'SSC CGL PYQ',
      questionEn: 'If x + 1/x = 2, find x^5 + 1/x^5',
      optionsEn: ['1', '2', '4', '5'],
      correctIndex: 1,
      createdBy: 'admin1',
    },
  ];

  const vault: RevisionItemDoc[] = [
    {
      id: 'q2',
      uid: 'u1',
      questionId: 'q2',
      testId: 't1',
      testTitle: 'Mock 1',
      subject: 'reasoning',
      lastSelectedIndex: 0,
      mastered: false,
    },
    {
      id: 'q5',
      uid: 'u1',
      questionId: 'q5',
      testId: 't1',
      testTitle: 'Mock 1',
      subject: 'quant',
      lastSelectedIndex: 0,
      mastered: true,
    },
  ];

  // Adaptive blend includes pending revision (q2) plus unseen balanced questions
  const adaptive = buildAdaptiveQuestionSelection({
    allQuestions: bank,
    revisionItems: vault,
    recentQuestionIds: ['q1'],
    subjectScope: 'full',
    count: 4,
    includeRevisionVault: true,
    seedKey: 'seed1',
  });
  assert.equal(adaptive.questionIds.length, 4);
  assert.equal(adaptive.questionIds.includes('q2'), true);
  assert.equal(adaptive.revisionCount, 1);

  // Only Revision Vault mode respects mastered toggle
  const onlyPending = buildAdaptiveQuestionSelection({
    allQuestions: bank,
    revisionItems: vault,
    subjectScope: 'full',
    count: 10,
    onlyRevisionVault: true,
    includeMasteredVault: false,
    seedKey: 'seed2',
  });
  assert.deepEqual(onlyPending.questionIds, ['q2']);

  const withMastered = buildAdaptiveQuestionSelection({
    allQuestions: bank,
    revisionItems: vault,
    subjectScope: 'full',
    count: 10,
    onlyRevisionVault: true,
    includeMasteredVault: true,
    seedKey: 'seed3',
  });
  assert.equal(withMastered.questionIds.length, 2);
  assert.equal(withMastered.questionIds[0], 'q2');
  assert.equal(withMastered.questionIds.includes('q5'), true);
});

test('calculateTestOutcome blocks XP on <80% incomplete and repeat attempts, and excludes unvisited skips from Revision Vault', () => {
  // 2 of 3 attempted (67% < 80%) -> incomplete (0 XP); q3 is unvisited so should NOT enter skippedItems
  const incompleteResponses: Record<string, QuestionResponseState> = {
    q1: { questionId: 'q1', visited: true, selectedIndex: 1, markedForReview: false, timeSpentSec: 12 },
    q2: { questionId: 'q2', visited: true, selectedIndex: -1, markedForReview: false, timeSpentSec: 5 },
    q3: { questionId: 'q3', visited: false, selectedIndex: -1, markedForReview: false, timeSpentSec: 0 },
  };
  const incOutcome = calculateTestOutcome(
    sampleQuestions,
    incompleteResponses,
    { positiveMarks: 2, negativeMarks: 0 },
    DEFAULT_SCORING_CONFIG,
    1.4
  );
  assert.equal(incOutcome.isComplete, false);
  assert.equal(incOutcome.attemptedCount, 1);
  assert.equal(incOutcome.completionPercent, 33);
  assert.equal(incOutcome.baseXp, 0);
  assert.equal(incOutcome.xpEarned, 0);
  assert.deepEqual(
    incOutcome.skippedItems.map((s) => s.questionId),
    ['q2']
  );

  // Repeat attempt on >=80% complete mock -> 0 XP, marked as repeat
  const fullResponses: Record<string, QuestionResponseState> = {
    q1: { questionId: 'q1', visited: true, selectedIndex: 1, markedForReview: false, timeSpentSec: 10 },
    q2: { questionId: 'q2', visited: true, selectedIndex: 2, markedForReview: false, timeSpentSec: 10 },
    q3: { questionId: 'q3', visited: true, selectedIndex: 0, markedForReview: false, timeSpentSec: 10 },
  };
  const repeatOutcome = calculateTestOutcome(
    sampleQuestions,
    fullResponses,
    { positiveMarks: 2, negativeMarks: 0.5 },
    DEFAULT_SCORING_CONFIG,
    1.25,
    { isRepeatAttempt: true }
  );
  assert.equal(repeatOutcome.isComplete, true);
  assert.equal(repeatOutcome.isRepeatAttempt, true);
  assert.equal(repeatOutcome.baseXp, 0);
  assert.equal(repeatOutcome.xpEarned, 0);
});

test('computeTaskProgress deduplicates testId, rejects <80% & prac_ drills, respects task creation & dueDate expiry', () => {
  const taskCreated = new Date(2026, 10, 10, 10, 0, 0);
  const task: CohortTaskDoc = {
    id: 'weekly_goal',
    title: 'Weekly Cohort Consistency Goal',
    description: 'Complete 3 unique mocks',
    targetTests: 3,
    targetSubject: 'all',
    bonusXp: 100,
    dueDate: '2026-11-15',
    active: true,
    createdAt: taskCreated,
  };

  const makeAttempt = (
    id: string,
    testId: string,
    correct: number,
    skipped: number,
    createdAt: Date
  ): TestAttemptDoc => ({
    id,
    uid: 'u1',
    studentName: 'Aarav',
    testId,
    testTitle: testId,
    subjectScope: 'full',
    score: correct * 2,
    maxScore: (correct + skipped) * 2,
    accuracy: 100,
    correctCount: correct,
    wrongCount: 0,
    skippedCount: skipped,
    totalTimeSec: 120,
    xpEarned: 20,
    sectionStats: { quant: { correct, wrong: 0, skipped, timeSec: 120 } },
    createdAt,
  });

  const attempts: TestAttemptDoc[] = [
    // Same test submitted 3 times (>80%) -> counts ONLY 1
    makeAttempt('a1', 'mock_01', 9, 1, new Date(2026, 10, 11, 12, 0)),
    makeAttempt('a2', 'mock_01', 9, 1, new Date(2026, 10, 11, 13, 0)),
    makeAttempt('a3', 'mock_01', 10, 0, new Date(2026, 10, 11, 14, 0)),
    // Ephemeral smart practice drill -> ignored
    makeAttempt('a4', 'prac_12345', 10, 0, new Date(2026, 10, 11, 15, 0)),
    // Incomplete (<=80% solved: 8/10 = 80% is NOT >80%) -> ignored
    makeAttempt('a5', 'mock_02', 8, 2, new Date(2026, 10, 12, 10, 0)),
    // Predates task creation -> ignored
    makeAttempt('a6', 'mock_03', 10, 0, new Date(2026, 10, 1, 10, 0)),
    // Valid second unique mock (9/10 = 90% > 80%)
    makeAttempt('a7', 'daily_mock_2026_11_12', 9, 1, new Date(2026, 10, 12, 18, 0)),
  ];

  assert.equal(isAttemptComplete(attempts[4]), false);
  assert.equal(isAttemptComplete(attempts[6]), true);

  const inWindow = computeTaskProgress(task, attempts, new Date(2026, 10, 13, 10, 0));
  assert.equal(inWindow.completedCount, 2);
  assert.equal(inWindow.isEligible, false);
  assert.equal(inWindow.isExpired, false);

  // Add 3rd unique qualifying mock -> eligible before deadline
  attempts.push(makeAttempt('a8', 'mock_04', 9, 1, new Date(2026, 10, 13, 11, 0)));
  const eligible = computeTaskProgress(task, attempts, new Date(2026, 10, 13, 12, 0));
  assert.equal(eligible.completedCount, 3);
  assert.equal(eligible.isEligible, true);

  // After dueDate -> expired & not claimable
  assert.equal(isTaskExpired(task, new Date(2026, 10, 16, 0, 1)), true);
  const expired = computeTaskProgress(task, attempts, new Date(2026, 10, 16, 0, 1));
  assert.equal(expired.isExpired, true);
  assert.equal(expired.isEligible, false);
});

test('toLocalDateKey handles local midnight and isSessionLogLive detects stale closed sessions', () => {
  const earlyMorning = new Date(2026, 10, 13, 1, 30, 0);
  assert.equal(toLocalDateKey(earlyMorning), '2026-11-13');

  const now = 5_000_000;
  assert.equal(isSessionLogLive({ status: 'active', lastActiveAtMs: now - 30_000 }, now), true);
  assert.equal(isSessionLogLive({ status: 'active', lastActiveAtMs: now - 90_000 }, now), false);
  assert.equal(isSessionLogLive({ status: 'ended', lastActiveAtMs: now - 5_000 }, now), false);
});

test('computeWeeklyProgressSeries ignores <80% incomplete attempts while computeWeeklyActivitySeries preserves genuine study effort', () => {
  const now = new Date(2026, 10, 13, 18, 0, 0);
  const attempts: TestAttemptDoc[] = [
    // Incomplete (<80%): 1 correct, 9 skipped -> must NOT inflate accuracy bars to 100% or test count
    {
      id: 'inc_1',
      uid: 'u1',
      studentName: 'Aarav',
      testId: 'mock_01',
      testTitle: 'Mock 01',
      subjectScope: 'quant',
      score: 2,
      maxScore: 20,
      accuracy: 100,
      correctCount: 1,
      wrongCount: 0,
      skippedCount: 9,
      totalTimeSec: 180,
      xpEarned: 0,
      sectionStats: { quant: { correct: 1, wrong: 0, skipped: 9, timeSec: 180 } },
      createdAt: new Date(2026, 10, 13, 12, 0, 0),
    },
    // Complete (>=50%): 6 correct, 4 wrong -> accuracy 60%
    {
      id: 'comp_1',
      uid: 'u1',
      studentName: 'Aarav',
      testId: 'mock_02',
      testTitle: 'Mock 02',
      subjectScope: 'quant',
      score: 10,
      maxScore: 20,
      accuracy: 60,
      correctCount: 6,
      wrongCount: 4,
      skippedCount: 0,
      totalTimeSec: 300,
      xpEarned: 22,
      sectionStats: { quant: { correct: 6, wrong: 4, skipped: 0, timeSec: 300 } },
      createdAt: new Date(2026, 10, 13, 14, 0, 0),
    },
  ];

  const progress = computeWeeklyProgressSeries(attempts, now);
  const todayProg = progress[6];
  assert.equal(todayProg.attempts, 1);
  assert.equal(todayProg.avgAccuracy, 60);
  assert.equal(todayProg.avgScorePercent, 50);

  const activity = computeWeeklyActivitySeries(attempts, [], now);
  const todayAct = activity[6];
  assert.equal(todayAct.attempts, 1);
  assert.equal(todayAct.questionsSolved, 11);
  assert.equal(todayAct.studyMinutes, 8);
});

test('calculateTestOutcome clamps extreme timers, section durations, and XP within Firestore rules bounds', () => {
  const responses: Record<string, QuestionResponseState> = {
    q1: { questionId: 'q1', visited: true, selectedIndex: 1, markedForReview: false, timeSpentSec: 50_000 },
    q2: { questionId: 'q2', visited: true, selectedIndex: 2, markedForReview: false, timeSpentSec: 50_000 },
    q3: { questionId: 'q3', visited: true, selectedIndex: 0, markedForReview: false, timeSpentSec: 50_000 },
  };
  const extremeScoring = { ...DEFAULT_SCORING_CONFIG, xpAttemptBase: 4000, xpPerCorrect: 1000 };
  const outcome = calculateTestOutcome(
    sampleQuestions,
    responses,
    { positiveMarks: 2, negativeMarks: 0 },
    extremeScoring,
    1.4
  );

  assert.ok(outcome.totalTimeSec <= 30000);
  assert.ok((outcome.sectionStats.quant?.timeSec ?? 0) <= 20000);
  assert.ok(outcome.xpEarned <= 5000);
});

test('computeStudentActivitySummary merges liveOverride seconds and legacy attempts without freezing Study Time', () => {
  const now = new Date(2026, 10, 13, 18, 0, 0).getTime();
  const legacyAttempt: TestAttemptDoc = {
    id: 'legacy_a1',
    uid: 'u1',
    studentName: 'Aarav',
    testId: 'mock_01',
    testTitle: 'Legacy Mock',
    subjectScope: 'quant',
    score: 12,
    maxScore: 20,
    accuracy: 75,
    correctCount: 7,
    wrongCount: 2,
    skippedCount: 1,
    totalTimeSec: 2937, // 48:57 legacy attempt time
    xpEarned: 24,
    sectionStats: { quant: { correct: 7, wrong: 2, skipped: 1, timeSec: 2937 } },
    createdAt: new Date(now - 3 * 86_400_000),
  };

  const activeSession: StudentSessionLogDoc = {
    id: 'sess_live',
    uid: 'u1',
    displayName: 'Aarav',
    loginId: 'student1',
    status: 'active',
    loginAtMs: now - 60_000,
    lastActiveAtMs: now - 5_000,
    logoutAtMs: 0,
    activeDurationSec: 55,
    testsCompleted: 0,
    questionsAttempted: 0,
    subjectsStudied: ['quant'],
    lastActivityTitle: 'Student Dashboard',
  };

  const t0 = computeStudentActivitySummary('u1', [legacyAttempt], [activeSession], now, {
    sessionId: 'sess_live',
    activeDurationSec: 56,
  });
  const t1 = computeStudentActivitySummary('u1', [legacyAttempt], [activeSession], now + 1000, {
    sessionId: 'sess_live',
    activeDurationSec: 57,
  });

  assert.equal(t0.totalStudySec, 2937 + 56);
  assert.equal(t1.totalStudySec, 2937 + 57);
  assert.equal(t1.totalStudySec - t0.totalStudySec, 1);

  const weekly = computeWeeklyActivitySeries([legacyAttempt], [activeSession], new Date(now), {
    sessionId: 'sess_live',
    activeDurationSec: 120,
  });
  assert.equal(weekly[6].studyMinutes, 2);
});

test('daily sectional helpers, completed tests revision builder, and 1-file-per-student report payload scale dynamically', () => {
  const secId = buildDailySectionalTestId('quant', '2026_11_13');
  assert.equal(secId, 'daily_sec_quant_2026_11_13');
  assert.equal(isDailySectionalTest(secId), true);
  assert.equal(isDailySectionalTest('daily_mock_2026_11_13'), false);
  assert.match(formatDailySectionalTitle('quant', '2026_11_13'), /Daily Quant Sectional/);

  const test1: MockTestDoc = {
    id: 'mock_01',
    title: 'Tier-I Starter',
    subjectScope: 'full',
    durationMinutes: 20,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionIds: ['q1', 'q2'],
    questionCount: 2,
    published: true,
    createdBy: 'admin1',
  };
  const test2: MockTestDoc = {
    id: 'mock_02',
    title: 'GA Capsule',
    subjectScope: 'ga',
    durationMinutes: 10,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionIds: ['q3'],
    questionCount: 1,
    published: true,
    createdBy: 'admin1',
  };

  const att1: TestAttemptDoc = {
    id: 'att1',
    uid: 'damini_uid',
    studentName: 'Damini',
    testId: 'mock_01',
    testTitle: 'Tier-I Starter',
    subjectScope: 'full',
    score: 2,
    maxScore: 4,
    accuracy: 50,
    correctCount: 1,
    wrongCount: 1,
    skippedCount: 0,
    totalTimeSec: 120,
    xpEarned: 12,
    sectionStats: { quant: { correct: 1, wrong: 0, skipped: 0, timeSec: 60 }, reasoning: { correct: 0, wrong: 1, skipped: 0, timeSec: 60 } },
    createdAt: new Date(2026, 10, 12, 10, 0),
  };
  const att2: TestAttemptDoc = {
    ...att1,
    id: 'att2',
    score: 4,
    accuracy: 100,
    correctCount: 2,
    wrongCount: 0,
    xpEarned: 0,
    createdAt: new Date(2026, 10, 13, 10, 0),
  };

  const completed = summarizeCompletedTests([att1, att2], [test1, test2]);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].testId, 'mock_01');
  assert.equal(completed[0].attemptCount, 2);
  assert.equal(completed[0].bestScore, 4);
  assert.equal(completed[0].bestAccuracy, 100);

  const revVault: RevisionItemDoc[] = [
    {
      id: 'q2',
      uid: 'damini_uid',
      questionId: 'q2',
      testId: 'mock_01',
      testTitle: 'Tier-I Starter',
      subject: 'reasoning',
      lastSelectedIndex: 0,
      mastered: false,
    },
  ];
  const revSel = buildCompletedRevisionQuestionIds({
    selectedTestIds: ['mock_01'],
    tests: [test1, test2],
    revisionItems: revVault,
    allQuestions: sampleQuestions,
    maxQuestions: 10,
    prioritizeWeak: true,
    seedKey: 'comp_seed',
  });
  assert.deepEqual(revSel.questionIds, ['q2', 'q1']);
  assert.equal(revSel.weakIncludedCount, 1);

  // Per-student report payloads scale strictly 1:1 with roster size (Damini alone = 1 payload)
  const singleRosterReports = buildStudentGitReportPayloads({
    invites: [
      { id: 'damini_uid', loginId: 'damini', displayName: 'Damini', targetPost: 'Inspector', slotNumber: 1 },
    ],
    students: [],
    leaderboard: [
      {
        uid: 'damini_uid',
        displayName: 'Damini',
        targetPost: 'Inspector',
        cohortId: 'ssc_cgl_vip',
        totalXp: 120,
        testsAttempted: 1,
        bestScore: 4,
        avgAccuracy: 100,
        totalTimeSec: 240,
      },
    ],
    attempts: [att1, att2],
    sessionLogs: [],
  });
  assert.equal(singleRosterReports.length, 1);
  assert.equal(singleRosterReports[0].loginId, 'damini');
  assert.equal(singleRosterReports[0].rank, 1);
  assert.equal(singleRosterReports[0].recentAttempts.length, 2);

  // Adding a second VIP student automatically scales to 2 separate report payloads
  const twoRosterReports = buildStudentGitReportPayloads({
    invites: [
      { id: 'damini_uid', loginId: 'damini', displayName: 'Damini', targetPost: 'Inspector', slotNumber: 1 },
      { id: 'aarav_uid', loginId: 'aarav', displayName: 'Aarav', targetPost: 'ASO MEA', slotNumber: 2 },
    ],
    students: [],
    leaderboard: [],
    attempts: [],
    sessionLogs: [],
  });
  assert.equal(twoRosterReports.length, 2);
  assert.deepEqual(
    twoRosterReports.map((r) => r.loginId),
    ['damini', 'aarav']
  );
});

test('skipped questions count toward effectiveWrongCount & Vault on >80% tests with 0 negative penalty', () => {
  const tenQs: QuestionDoc[] = Array.from({ length: 10 }, (_, idx) => ({
    id: `sv_${idx + 1}`,
    subject: idx % 2 === 0 ? 'quant' : 'ga',
    topic: 'Ratio',
    difficulty: 'easy',
    source: 'SSC CGL PYQ',
    questionEn: `Q${idx + 1}`,
    optionsEn: ['5', '10', '15', '20'],
    correctIndex: 1,
    createdBy: 'admin1',
  }));
  const responses: Record<string, QuestionResponseState> = {};
  for (let i = 0; i < 9; i += 1) {
    responses[tenQs[i].id] = {
      questionId: tenQs[i].id,
      visited: true,
      selectedIndex: 1,
      markedForReview: false,
      timeSpentSec: 10,
    };
  }
  // sv_10 left unvisited skipped -> 9/10 = 90% > 80%
  const outcome = calculateTestOutcome(
    tenQs,
    responses,
    { positiveMarks: 2, negativeMarks: 0.5 },
    DEFAULT_SCORING_CONFIG,
    1.0
  );
  assert.equal(outcome.isComplete, true);
  assert.equal(outcome.correctCount, 9);
  assert.equal(outcome.wrongCount, 0);
  assert.equal(outcome.skippedCount, 1);
  assert.equal(outcome.effectiveWrongCount, 1);
  assert.equal(outcome.marksLostUnanswered, 2);
  // Zero negative marks deducted on unanswered sv_10: 9 * +2 = 18
  assert.equal(outcome.score, 18);
  assert.deepEqual(
    outcome.skippedItems.map((s) => s.questionId),
    ['sv_10']
  );
});

test('computeLifetimeStudentStats aggregates lifetime mocks, attempted Qs, correct, and wrong incl. missed', () => {
  const attempts: TestAttemptDoc[] = [
    {
      id: 'att1',
      uid: 'u1',
      studentName: 'Damini',
      testId: 'm1',
      testTitle: 'Mock 1',
      subjectScope: 'full',
      score: 12,
      maxScore: 20,
      accuracy: 77.8,
      correctCount: 7,
      wrongCount: 2,
      skippedCount: 1,
      totalTimeSec: 300,
      xpEarned: 30,
      sectionStats: {},
    },
    {
      id: 'att2',
      uid: 'u1',
      studentName: 'Damini',
      testId: 'm2',
      testTitle: 'Mock 2',
      subjectScope: 'quant',
      score: 2,
      maxScore: 20,
      accuracy: 50,
      correctCount: 1,
      wrongCount: 1,
      skippedCount: 8, // <50% incomplete
      totalTimeSec: 60,
      xpEarned: 0,
      sectionStats: {},
    },
  ];
  const stats = computeLifetimeStudentStats(attempts);
  assert.equal(stats.mocksCompleted, 1);
  assert.equal(stats.totalSubmissions, 2);
  assert.equal(stats.questionsAttempted, 11); // 7+2 + 1+1
  assert.equal(stats.questionsFaced, 20); // 11 + 9
  assert.equal(stats.correctCount, 8);
  assert.equal(stats.wrongAttemptedCount, 3);
  assert.equal(stats.missedCount, 9);
  assert.equal(stats.wrongIncludingMissedCount, 12);
});

test('computeStudentRankTier progresses cleanly from Bronze 1-5 to Silver, Gold, Platinum, Diamond', () => {
  const starter = computeStudentRankTier({ totalXp: 0, testsCompleted: 0, activeDays: 0, questionsAttempted: 0 });
  assert.equal(starter.division, 'Bronze');
  assert.equal(starter.level, 1);
  assert.equal(starter.step, 1);
  assert.equal(starter.label, 'Bronze Lv.1');

  const silver = computeStudentRankTier({ totalXp: 350, testsCompleted: 4, activeDays: 3, questionsAttempted: 80 });
  // 350 + 100 + 90 + 40 = 580 -> Silver Lv.1 (460..629)
  assert.equal(silver.division, 'Silver');
  assert.equal(silver.level, 1);
  assert.equal(silver.step, 6);

  const diamond = computeStudentRankTier({ totalXp: 11000, testsCompleted: 40, activeDays: 30, questionsAttempted: 2000 });
  assert.equal(diamond.division, 'Diamond');
  assert.equal(diamond.level, 5);
  assert.equal(diamond.step, 25);
  assert.equal(diamond.progressPercent, 100);

  assert.equal(computeRankTierFromStep(11).label, 'Gold Lv.1');
  assert.equal(computeRankTierFromStep(16).label, 'Platinum Lv.1');
});

test('groupSessionLogsByDate aggregates daily active study time & supports click-to-expand detail rows', () => {
  const day1Start = new Date(2026, 10, 12, 9, 0, 0).getTime();
  const day1Second = new Date(2026, 10, 12, 18, 0, 0).getTime();
  const day2Start = new Date(2026, 10, 11, 14, 0, 0).getTime();

  const logs: StudentSessionLogDoc[] = [
    {
      id: 's1',
      uid: 'u1',
      displayName: 'Damini',
      loginId: 'damini',
      status: 'active',
      loginAtMs: day1Second,
      lastActiveAtMs: day1Second + 300_000,
      logoutAtMs: 0,
      activeDurationSec: 300,
      testsCompleted: 1,
      questionsAttempted: 20,
      subjectsStudied: ['quant'],
      lastActivityTitle: 'Evening Quant',
    },
    {
      id: 's2',
      uid: 'u1',
      displayName: 'Damini',
      loginId: 'damini',
      status: 'ended',
      loginAtMs: day1Start,
      lastActiveAtMs: day1Start + 600_000,
      logoutAtMs: day1Start + 600_000,
      activeDurationSec: 600,
      testsCompleted: 0,
      questionsAttempted: 15,
      subjectsStudied: ['english'],
      lastActivityTitle: 'Morning Vocab',
    },
    {
      id: 's3',
      uid: 'u2',
      displayName: 'Aarav',
      loginId: 'aarav',
      status: 'ended',
      loginAtMs: day2Start,
      lastActiveAtMs: day2Start + 900_000,
      logoutAtMs: day2Start + 900_000,
      activeDurationSec: 900,
      testsCompleted: 1,
      questionsAttempted: 25,
      subjectsStudied: ['reasoning'],
      lastActivityTitle: 'Reasoning Sprint',
    },
  ];

  const grouped = groupSessionLogsByDate(logs.slice(0, 2), {
    liveOverride: { sessionId: 's1', activeDurationSec: 450 },
    nowMs: day1Second + 305_000,
  });
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].sessionCount, 2);
  assert.equal(grouped[0].totalActiveSec, 1050); // 450 live + 600
  assert.equal(grouped[0].hasLiveSession, true);

  const byStudent = groupSessionLogsByDate(logs, { groupByStudent: true });
  assert.equal(byStudent.length, 2);
  assert.equal(byStudent[0].displayName, 'Damini');
  assert.equal(byStudent[1].displayName, 'Aarav');
});

test('strict >80% threshold, partial status labels (never 100% Complete when skipped), Pending folder & welcome title', () => {
  assert.equal(formatWelcomeTitle('ASO', 'Om'), 'Welcome back, ASO Om');
  assert.equal(formatWelcomeTitle('', 'Damini'), 'Welcome back, Damini');

  assert.equal(getMinQuestionsForXp(10), 9);
  assert.equal(getMinQuestionsForXp(25), 21);
  assert.equal(getMinQuestionsForXp(100), 81);

  const eightOfTen = { correctCount: 7, wrongCount: 1, skippedCount: 2 };
  const nineOfTen = { correctCount: 8, wrongCount: 1, skippedCount: 1 };
  const tenOfTen = { correctCount: 9, wrongCount: 1, skippedCount: 0 };

  assert.equal(isAttemptComplete(eightOfTen), false);
  assert.equal(getAttemptCompletionPercent(eightOfTen), 80);
  assert.equal(getAttemptStatusLabel(eightOfTen), 'Pending (<=80%)');

  assert.equal(isAttemptComplete(nineOfTen), true);
  assert.equal(getAttemptCompletionPercent(nineOfTen), 90);
  assert.equal(getAttemptStatusLabel(nineOfTen), 'Completed · Partial');

  assert.equal(isAttemptComplete(tenOfTen), true);
  assert.equal(getAttemptCompletionPercent(tenOfTen), 100);
  assert.equal(getAttemptStatusLabel(tenOfTen), '100% Complete');

  const test1: MockTestDoc = {
    id: 'm_done',
    title: 'Done Mock',
    subjectScope: 'full',
    durationMinutes: 20,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionIds: ['q1', 'q2'],
    questionCount: 2,
    published: true,
    createdBy: 'admin',
  };
  const test2: MockTestDoc = {
    ...test1,
    id: 'm_pending_att',
    title: 'Incomplete Mock',
    questionCount: 10,
  };
  const test3: MockTestDoc = {
    ...test1,
    id: 'm_draft',
    title: 'Paused Draft Mock',
    questionCount: 20,
  };

  const attDone: TestAttemptDoc = {
    id: 'att_done',
    uid: 'u1',
    studentName: 'Om',
    testId: 'm_done',
    testTitle: 'Done Mock',
    subjectScope: 'full',
    score: 18,
    maxScore: 20,
    accuracy: 100,
    correctCount: 9,
    wrongCount: 0,
    skippedCount: 1,
    totalTimeSec: 120,
    xpEarned: 28,
    sectionStats: {},
    createdAt: new Date(2026, 10, 12, 10, 0),
  };
  const attIncomplete: TestAttemptDoc = {
    ...attDone,
    id: 'att_inc',
    testId: 'm_pending_att',
    testTitle: 'Incomplete Mock',
    correctCount: 5,
    wrongCount: 1,
    skippedCount: 4, // 60% -> <80%
    xpEarned: 0,
    createdAt: new Date(2026, 10, 13, 9, 0),
  };

  // Completed summary excludes <80% m_pending_att
  const completed = summarizeCompletedTests([attDone, attIncomplete], [test1, test2, test3]);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].testId, 'm_done');

  const draft: TestDraftDoc = {
    id: 'm_draft',
    uid: 'u1',
    testId: 'm_draft',
    testTitle: 'Paused Draft Mock',
    subjectScope: 'full',
    currentIdx: 6,
    secondsLeft: 720,
    lang: 'en',
    answeredCount: 5,
    totalQuestions: 20,
    responses: {},
    updatedAtMs: Date.now(),
  };

  const pending = summarizePendingTests({
    tests: [test1, test2, test3],
    attempts: [attDone, attIncomplete],
    drafts: [draft],
  });
  assert.equal(pending.length, 2);
  assert.equal(pending[0].testId, 'm_draft');
  assert.equal(pending[0].source, 'draft');
  assert.equal(pending[0].currentIdx, 6);
  assert.equal(pending[1].testId, 'm_pending_att');
  assert.equal(pending[1].source, 'incomplete_attempt');
  assert.equal(pending[1].skippedCount, 4);
});

test('extractCustomMockFilterCatalog and selectCustomMockQuestions handle History, Maths, and All filters', () => {
  const bank: QuestionDoc[] = [
    ...sampleQuestions,
    {
      id: 'q_hist_1',
      subject: 'ga',
      topic: 'History',
      difficulty: 'medium',
      source: 'SSC CGL 2023',
      questionEn: 'Who founded the Gupta dynasty?',
      optionsEn: ['Sri Gupta', 'Chandragupta II', 'Samudragupta', 'Skandagupta'],
      correctIndex: 0,
      createdBy: 'admin1',
    },
    {
      id: 'q_geom_1',
      subject: 'quant',
      topic: 'Geometry',
      difficulty: 'medium',
      source: 'SSC CGL 2023',
      questionEn: 'Sum of interior angles of triangle?',
      optionsEn: ['90°', '180°', '270°', '360°'],
      correctIndex: 1,
      createdBy: 'admin1',
    },
  ];

  const catalog = extractCustomMockFilterCatalog(bank);
  assert.equal(catalog.totalCount, 5);
  assert.equal(catalog.subjectCounts.quant, 2);
  assert.equal(catalog.subjectCounts.ga, 2);
  assert.ok(catalog.topics.some((t) => t.topic === 'History' && t.count === 1));

  const histSel = selectCustomMockQuestions({
    allQuestions: bank,
    filterValue: 'topic:ga::History',
    count: 2,
    seedKey: 'hist_seed',
  });
  assert.equal(histSel.subjectScope, 'ga');
  assert.equal(histSel.exactMatchCount, 1);
  assert.equal(histSel.questionIds[0], 'q_hist_1');
  assert.equal(histSel.questionIds.length, 2);

  const mathsSel = selectCustomMockQuestions({
    allQuestions: bank,
    filterValue: 'Maths',
    count: 2,
    seedKey: 'math_seed',
  });
  assert.equal(mathsSel.subjectScope, 'quant');
  assert.equal(mathsSel.questionIds.length, 2);

  const allSel = selectCustomMockQuestions({
    allQuestions: bank,
    filterValue: 'all',
    count: 4,
    seedKey: 'all_seed',
  });
  assert.equal(allSel.subjectScope, 'full');
  assert.equal(allSel.questionIds.length, 4);
});

test('analyzeTestResultAnalytics computes per-subject avg seconds/question, weak topics, and revision question IDs', () => {
  assert.equal(formatHumanAvgSeconds(120), '2 minutes');
  assert.equal(formatHumanAvgSeconds(15), '15 seconds');

  const qs: QuestionDoc[] = [
    {
      id: 'qm1',
      subject: 'quant',
      topic: 'Geometry',
      difficulty: 'medium',
      source: 'SSC CGL',
      questionEn: 'Triangle angles?',
      optionsEn: ['90', '180', '270', '360'],
      correctIndex: 1,
      createdBy: 'admin',
    },
    {
      id: 'qm2',
      subject: 'quant',
      topic: 'Profit & Loss',
      difficulty: 'medium',
      source: 'SSC CGL',
      questionEn: 'CP=100, SP=120. Profit %?',
      optionsEn: ['10%', '20%', '25%', '30%'],
      correctIndex: 1,
      createdBy: 'admin',
    },
    {
      id: 'qgs1',
      subject: 'ga',
      topic: 'History',
      difficulty: 'easy',
      source: 'SSC CGL',
      questionEn: 'Capital of Magadha?',
      optionsEn: ['Pataliputra', 'Ujjain', 'Taxila', 'Kannauj'],
      correctIndex: 0,
      createdBy: 'admin',
    },
  ];

  const responses: Record<string, QuestionResponseState> = {
    qm1: { questionId: 'qm1', visited: true, selectedIndex: 0, markedForReview: false, timeSpentSec: 120 }, // wrong
    qm2: { questionId: 'qm2', visited: true, selectedIndex: 2, markedForReview: false, timeSpentSec: 120 }, // wrong
    qgs1: { questionId: 'qgs1', visited: true, selectedIndex: 0, markedForReview: false, timeSpentSec: 15 }, // correct
  };

  const outcome = calculateTestOutcome(
    qs,
    responses,
    { positiveMarks: 2, negativeMarks: 0.5 },
    DEFAULT_SCORING_CONFIG
  );

  const analytics = analyzeTestResultAnalytics(qs, outcome);
  assert.equal(analytics.subjectPaces.length, 2);
  assert.equal(analytics.subjectPaces[0].labelShort, 'Maths');
  assert.equal(analytics.subjectPaces[0].avgTimeText, '2 minutes');
  assert.equal(analytics.subjectPaces[1].labelShort, 'GS');
  assert.equal(analytics.subjectPaces[1].avgTimeText, '15 seconds');
  assert.match(analytics.timeInsightEn, /2 minutes\/question in Maths/);
  assert.match(analytics.timeInsightEn, /15 seconds\/question in GS/);

  assert.deepEqual(analytics.revisionTopicNames, ['Geometry', 'Profit & Loss']);
  assert.match(analytics.weaknessInsightEn, /Geometry and Profit & Loss/);
  assert.deepEqual(analytics.revisionQuestionIds, ['qm1', 'qm2']);
});

test('calculatorEngine handles arithmetic, unary operations, backspace, and divide-by-zero', () => {
  let st = INITIAL_CALC_STATE;
  st = calcInputDigit(st, '1');
  st = calcInputDigit(st, '2');
  st = calcInputDigit(st, '5');
  assert.equal(st.display, '125');
  st = calcUnaryOp(st, 'pct');
  assert.equal(st.display, '1.25');

  st = calcClear();
  st = calcInputDigit(st, '1');
  st = calcInputDigit(st, '6');
  st = calcUnaryOp(st, 'sqrt');
  assert.equal(st.display, '4');

  st = calcInputOperator(st, '+');
  st = calcInputDigit(st, '3');
  st = calcInputDecimal(st);
  st = calcInputDigit(st, '5');
  assert.equal(st.display, '3.5');
  st = calcBackspace(st);
  assert.equal(st.display, '3.');
  st = calcInputDigit(st, '5');
  st = calcEquals(st);
  assert.equal(st.display, '7.5');

  st = calcClear();
  st = calcInputDigit(st, '9');
  st = calcInputOperator(st, '/');
  st = calcInputDigit(st, '0');
  st = calcEquals(st);
  assert.equal(st.error, true);
  assert.equal(st.display, 'Error');
});

test('getPendingResolutionNotifications filters resolved unacknowledged tickets for student push toast', () => {
  const tickets: SupportTicketDoc[] = [
    {
      id: 't_open',
      uid: 'u1',
      loginId: 'vip1',
      studentName: 'Om',
      targetPost: 'ASO',
      subject: 'Bug',
      message: 'sir ye work nahi kar raha',
      status: 'open',
      resolutionNotified: false,
      resolutionAcked: false,
      createdAtMs: 1000,
      resolvedAtMs: 0,
    },
    {
      id: 't_resolved_new',
      uid: 'u1',
      loginId: 'vip1',
      studentName: 'Om',
      targetPost: 'ASO',
      subject: 'Timer bug',
      message: 'Timer stuck',
      status: 'resolved',
      resolutionNotified: true,
      resolutionAcked: false,
      createdAtMs: 2000,
      resolvedAtMs: 5000,
    },
    {
      id: 't_other_user',
      uid: 'u2',
      loginId: 'vip2',
      studentName: 'Damini',
      targetPost: 'ITI',
      subject: 'Other',
      message: 'Issue',
      status: 'resolved',
      resolutionNotified: true,
      resolutionAcked: false,
      createdAtMs: 3000,
      resolvedAtMs: 6000,
    },
  ];
  const pending = getPendingResolutionNotifications(tickets, 'u1');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 't_resolved_new');
  assert.equal(
    TICKET_RESOLVED_PUSH_MESSAGE,
    'Problem solved. Thank you for making our website good and bug-free!'
  );
});









