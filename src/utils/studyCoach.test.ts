import test from 'node:test';
import assert from 'node:assert/strict';
import type { StudentSessionLogDoc, TestAttemptDoc } from '../types/exam';
import {
  buildPostTestEncouragement,
  computeAspirantCoachSummary,
  computeDailyQuestionGoal,
  computeStudyStreak,
  hasNativeHindiTranslation,
  normalizeAiFormulaCards,
  normalizeTranslationBatchResponse,
  resolveBilingualQuestionView,
} from './studyCoach';

function makeAttempt(overrides: Partial<TestAttemptDoc> & { createdAtMs: number }): TestAttemptDoc {
  const { createdAtMs, ...rest } = overrides;
  return {
    id: `att_${createdAtMs}`,
    uid: 'stu_1',
    studentName: 'Aarav',
    testId: `test_${createdAtMs}`,
    testTitle: 'SSC Mock',
    subjectScope: 'full',
    score: 120,
    maxScore: 200,
    accuracy: 80,
    correctCount: 68,
    wrongCount: 17,
    skippedCount: 15,
    totalTimeSec: 2400,
    xpEarned: 150,
    sectionStats: {
      quant: { correct: 16, wrong: 4, skipped: 5, timeSec: 700 },
      reasoning: { correct: 18, wrong: 2, skipped: 5, timeSec: 500 },
      english: { correct: 18, wrong: 4, skipped: 3, timeSec: 600 },
      ga: { correct: 12, wrong: 6, skipped: 7, timeSec: 600 },
    },
    createdAt: createdAtMs,
    ...rest,
  };
}

function makeLog(ms: number, durationSec: number): StudentSessionLogDoc {
  return {
    id: `log_${ms}`,
    uid: 'stu_1',
    displayName: 'Aarav',
    loginId: 'aarav',
    status: 'ended',
    loginAtMs: ms,
    lastActiveAtMs: ms + durationSec * 1000,
    logoutAtMs: ms + durationSec * 1000,
    activeDurationSec: durationSec,
    testsCompleted: 1,
    questionsAttempted: 20,
    subjectsStudied: ['quant'],
    lastActivityTitle: 'Practice',
    createdAt: ms,
    updatedAt: ms,
  };
}

test('computeStudyStreak counts consecutive active days including yesterday fallback', () => {
  const now = new Date(2026, 10, 14, 10, 0, 0); // Nov 14, 2026
  const dayMs = 86_400_000;
  const attempts = [
    makeAttempt({ createdAtMs: now.getTime() - dayMs }),
    makeAttempt({ createdAtMs: now.getTime() - 2 * dayMs }),
    makeAttempt({ createdAtMs: now.getTime() - 3 * dayMs }),
  ];
  const res = computeStudyStreak(attempts, [], now);
  assert.equal(res.currentStreakDays, 3);
  assert.equal(res.bestStreakDays, 3);
  assert.equal(res.activeToday, false);

  // Add activity today
  const withToday = computeStudyStreak(attempts, [makeLog(now.getTime() - 60_000, 300)], now);
  assert.equal(withToday.currentStreakDays, 4);
  assert.equal(withToday.activeToday, true);
});

test('computeStudyStreak resets current streak when yesterday and today have no activity', () => {
  const now = new Date(2026, 10, 14, 10, 0, 0);
  const dayMs = 86_400_000;
  const attempts = [
    makeAttempt({ createdAtMs: now.getTime() - 3 * dayMs }),
    makeAttempt({ createdAtMs: now.getTime() - 4 * dayMs }),
  ];
  const res = computeStudyStreak(attempts, [], now);
  assert.equal(res.currentStreakDays, 0);
  assert.equal(res.bestStreakDays, 2);
});

test('computeDailyQuestionGoal sums questions attempted today and computes percentage', () => {
  const now = new Date(2026, 10, 14, 15, 0, 0);
  const yesterday = new Date(2026, 10, 13, 15, 0, 0);
  const attempts = [
    makeAttempt({ createdAtMs: now.getTime() - 1000, correctCount: 20, wrongCount: 5, skippedCount: 0 }),
    makeAttempt({ createdAtMs: now.getTime() - 2000, correctCount: 22, wrongCount: 3, skippedCount: 0 }),
    makeAttempt({ createdAtMs: yesterday.getTime(), correctCount: 40, wrongCount: 10, skippedCount: 0 }),
  ];

  const summary = computeDailyQuestionGoal(attempts, 50, now);
  assert.equal(summary.solvedToday, 50);
  assert.equal(summary.percent, 100);
  assert.equal(summary.goalMet, true);
});

test('computeAspirantCoachSummary identifies weakest focus subject and Tier-I benchmark', () => {
  const now = new Date(2026, 10, 14, 15, 0, 0);
  const attempts = [
    makeAttempt({
      createdAtMs: now.getTime() - 1000,
      score: 152,
      maxScore: 200,
      accuracy: 84,
      sectionStats: {
        quant: { correct: 22, wrong: 3, skipped: 0, timeSec: 900 },
        reasoning: { correct: 23, wrong: 2, skipped: 0, timeSec: 600 },
        english: { correct: 21, wrong: 4, skipped: 0, timeSec: 600 },
        ga: { correct: 10, wrong: 10, skipped: 5, timeSec: 500 },
      },
    }),
  ];

  const coach = computeAspirantCoachSummary({
    targetPost: 'Income Tax Inspector',
    displayName: 'Rahul',
    attempts,
    sessionLogs: [],
    pendingVaultCount: 4,
    dailyGoal: 50,
    now,
  });

  assert.equal(coach.focusSubject?.subject, 'ga');
  assert.equal(coach.strongestSubject?.subject, 'reasoning');
  assert.equal(coach.recentFullMockAvg200, 152);
  assert.match(coach.actionTip, /General Awareness|GA/i);
});

test('buildPostTestEncouragement celebrates personal best and supports incomplete attempts constructively', () => {
  const pb = buildPostTestEncouragement({
    score: 162,
    maxScore: 200,
    accuracy: 88,
    isComplete: true,
    completionPercent: 95,
    priorBestScore: 150,
    targetPost: 'ASO in MEA',
  });
  assert.equal(pb.tone, 'emerald');
  assert.equal(pb.badge, 'New Personal Best');

  const inc = buildPostTestEncouragement({
    score: 40,
    maxScore: 200,
    accuracy: 65,
    isComplete: false,
    completionPercent: 40,
    priorBestScore: null,
    targetPost: 'ASO in MEA',
  });
  assert.equal(inc.tone, 'amber');
  assert.match(inc.title, /40% attempted/);
});

test('normalizeAiFormulaCards sanitizes valid rows, applies subject fallback, and caps at 6 cards', () => {
  assert.deepEqual(normalizeAiFormulaCards(null), []);

  const validAndInvalid = [
    {
      subject: 'quant',
      topic: 'Boat & Stream',
      title: 'Downstream & Upstream Speed',
      content: 'Downstream = u + v; Upstream = u - v.',
      examTip: 'Speed in still water = (D + U) / 2.',
      example: 'If D=14, U=10 then u = 12 km/h.',
    },
    {
      subject: 'unknown_subject',
      topic: '',
      title: 'Fallback Subject Rule',
      content: 'Use active voice before passive conversion.',
      examTip: '',
      example: '',
    },
    { title: 'Missing Content Only' },
    null,
    'invalid-row',
  ];

  const parsed = normalizeAiFormulaCards(validAndInvalid, 'english');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].subject, 'quant');
  assert.equal(parsed[0].isAi, true);
  assert.equal(parsed[0].example, 'If D=14, U=10 then u = 12 km/h.');

  assert.equal(parsed[1].subject, 'english');
  assert.equal(parsed[1].topic, 'AI Lookup');
  assert.equal('example' in parsed[1], false);

  // Fallback defaults to 'quant' when fallbackSubject is 'all', and output caps at 6
  const many = Array.from({ length: 10 }, (_, idx) => ({
    subject: 'invalid',
    topic: `T${idx}`,
    title: `Formula ${idx}`,
    content: `Rule ${idx}`,
    examTip: `Tip ${idx}`,
  }));
  const capped = normalizeAiFormulaCards(many, 'all');
  assert.equal(capped.length, 6);
  assert.equal(capped[0].subject, 'quant');
});

test('normalizeTranslationBatchResponse and resolveBilingualQuestionView handle native and live translations', () => {
  const mapped = normalizeTranslationBatchResponse(
    [
      {
        index: 0,
        questionHi: 'एक ट्रेन 60 किमी/घंटा से चलती है।',
        optionsHi: ['10 सेकंड', '', '30 सेकंड', '40 सेकंड'],
        explanationHi: 'दूरी = चाल × समय',
      },
      { index: 99, questionHi: 'Out of bounds' },
    ],
    [['10 sec', '20 sec', '30 sec', '40 sec']]
  );

  assert.equal(mapped.size, 1);
  assert.deepEqual(mapped.get(0)?.optionsHi, ['10 सेकंड', '20 sec', '30 सेकंड', '40 सेकंड']);

  const qWithoutHindi = {
    questionEn: 'A train runs at 60 km/h.',
    optionsEn: ['10 sec', '20 sec', '30 sec', '40 sec'] as [string, string, string, string],
    explanationEn: 'Distance = Speed × Time',
  };

  assert.equal(hasNativeHindiTranslation(qWithoutHindi), false);
  const enView = resolveBilingualQuestionView(qWithoutHindi, 'en', mapped.get(0));
  assert.equal(enView.stem, 'A train runs at 60 km/h.');

  const liveHiView = resolveBilingualQuestionView(qWithoutHindi, 'hi', mapped.get(0));
  assert.equal(liveHiView.isTranslated, true);
  assert.equal(liveHiView.stem, 'एक ट्रेन 60 किमी/घंटा से चलती है।');
  assert.equal(liveHiView.explanation, 'दूरी = चाल × समय');
});


