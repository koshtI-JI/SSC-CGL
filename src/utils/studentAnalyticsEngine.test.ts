import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  QuestionDoc,
  RevisionItemDoc,
  StudentSessionLogDoc,
  TestAttemptDoc,
} from '../types/exam';
import {
  buildQuestionTimeSeries,
  buildRevisionMicroTopicClusters,
  buildStudyCalendarHeatmap,
  computeAchievementBadges,
  computeDynamicEfficiencyRank,
  resolveMicroTopicLabel,
  selectAdaptiveMicroTopicMockQuestions,
} from './studentAnalyticsEngine';

const sampleQuestion = (
  id: string,
  subject: QuestionDoc['subject'],
  topic: string,
  questionEn: string
): QuestionDoc => ({
  id,
  subject,
  topic,
  difficulty: 'medium',
  source: 'PYQ',
  questionEn,
  optionsEn: ['A', 'B', 'C', 'D'],
  correctIndex: 0,
  createdBy: 'admin',
});

test('buildStudyCalendarHeatmap aggregates daily minutes, questions solved, and intensity levels cleanly', () => {
  const now = new Date('2026-11-16T10:00:00Z');
  const todayMs = now.getTime();
  const yesterdayMs = todayMs - 86_400_000;

  const attempts: TestAttemptDoc[] = [
    {
      id: 'att1',
      uid: 'u1',
      studentName: 'Damini',
      testId: 't1',
      testTitle: 'Full Mock',
      subjectScope: 'full',
      score: 160,
      maxScore: 200,
      accuracy: 85,
      correctCount: 82,
      wrongCount: 10,
      skippedCount: 8,
      totalTimeSec: 3200,
      xpEarned: 190,
      sectionStats: {},
      createdAt: todayMs,
    },
    {
      id: 'att2',
      uid: 'u1',
      studentName: 'Damini',
      testId: 't2',
      testTitle: 'Quant Sprint',
      subjectScope: 'quant',
      score: 24,
      maxScore: 30,
      accuracy: 80,
      correctCount: 12,
      wrongCount: 2,
      skippedCount: 1,
      totalTimeSec: 600,
      xpEarned: 35,
      sectionStats: {},
      createdAt: yesterdayMs,
    },
  ];
  const logs: StudentSessionLogDoc[] = [];

  const heatmap = buildStudyCalendarHeatmap({ attempts, sessionLogs: logs, daysCount: 35, now });
  assert.equal(heatmap.days.length, 35);
  assert.equal(heatmap.weeks.length, 5);
  assert.equal(heatmap.currentStreakDays, 2);
  assert.equal(heatmap.days[heatmap.days.length - 1].intensity, 4);
  assert.equal(heatmap.totalQuestionsSolved, 106);
});

test('buildQuestionTimeSeries identifies time sinks and wasted wrong-answer seconds', () => {
  const summary = buildQuestionTimeSeries([
    { questionId: 'q1', subject: 'ga', timeSpentSec: 12, selectedIndex: 0, isCorrect: true },
    { questionId: 'q2', subject: 'quant', timeSpentSec: 95, selectedIndex: 1, isCorrect: false },
    { questionId: 'q3', subject: 'english', timeSpentSec: 22, selectedIndex: -1, isCorrect: false },
  ]);
  assert.equal(summary.points.length, 3);
  assert.equal(summary.points[0].paceBand, 'fast');
  assert.equal(summary.points[1].paceBand, 'time_sink');
  assert.equal(summary.slowestQuestionNumber, 2);
  assert.equal(summary.timeSinksCount, 1);
  assert.equal(summary.wastedTimeOnWrongSec, 95);
});

test('Revision Vault 2.0 auto-categorizes Polity Article 32 and generates adaptive mini-mocks', () => {
  const q1 = sampleQuestion(
    'q1',
    'ga',
    'Polity & Constitution',
    'Which Constitutional Remedy is guaranteed under Article 32 of the Indian Constitution?'
  );
  const q2 = sampleQuestion(
    'q2',
    'quant',
    'Trigonometry',
    'If sin theta + cos theta = 1, evaluate trigonometric identity.'
  );
  const q3 = sampleQuestion(
    'q3',
    'ga',
    'Polity & Constitution',
    'Under Article 32, how many types of writs can the Supreme Court issue?'
  );

  assert.equal(resolveMicroTopicLabel(q1), 'Polity - Article 32');

  const revisionItems: RevisionItemDoc[] = [
    {
      id: 'q1',
      uid: 'u1',
      questionId: 'q1',
      testId: 't1',
      testTitle: 'Daily Mock',
      subject: 'ga',
      lastSelectedIndex: 2,
      mastered: false,
    },
    {
      id: 'q2',
      uid: 'u1',
      questionId: 'q2',
      testId: 't1',
      testTitle: 'Daily Mock',
      subject: 'quant',
      lastSelectedIndex: -1,
      mastered: false,
    },
  ];

  const clusters = buildRevisionMicroTopicClusters({
    revisionItems,
    questionsMap: { q1, q2 },
  });

  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].microTopic, 'Polity - Article 32'); // higher urgency (wrong = 3 vs skipped = 1.5)

  const miniMockIds = selectAdaptiveMicroTopicMockQuestions({
    cluster: clusters[0],
    allQuestions: [q1, q2, q3],
    targetCount: 5,
  });
  assert.deepEqual(miniMockIds, ['q1', 'q3']);
});

test('computeAchievementBadges & computeDynamicEfficiencyRank calculate Sniper rank and Quant Master badge', () => {
  const attempts: TestAttemptDoc[] = [
    {
      id: 'a1',
      uid: 'u1',
      studentName: 'Damini',
      testId: 't1',
      testTitle: 'Tier-I Mock',
      subjectScope: 'full',
      score: 162,
      maxScore: 200,
      accuracy: 90,
      correctCount: 82,
      wrongCount: 4,
      skippedCount: 14,
      totalTimeSec: 2580, // ~30s per question
      xpEarned: 210,
      sectionStats: {
        quant: { correct: 18, wrong: 2, skipped: 5, timeSec: 900 },
        reasoning: { correct: 22, wrong: 0, skipped: 3, timeSec: 600 },
        english: { correct: 23, wrong: 1, skipped: 1, timeSec: 500 },
        ga: { correct: 19, wrong: 1, skipped: 5, timeSec: 580 },
      },
      createdAt: Date.now(),
    },
  ];

  const badges = computeAchievementBadges({
    attempts,
    revisionItems: [],
    sessionLogs: [],
  });
  const quantBadge = badges.find((b) => b.id === 'quant_master');
  const inspectorBadge = badges.find((b) => b.id === 'tier1_inspector');
  const speedBadge = badges.find((b) => b.id === 'speed_demon');

  assert.equal(quantBadge?.unlocked, true);
  assert.equal(inspectorBadge?.unlocked, true);
  assert.equal(speedBadge?.unlocked, true);

  const dyn = computeDynamicEfficiencyRank({ attempts, totalXp: 650 });
  assert.equal(dyn.quadrant, 'Sniper');
  assert.ok(dyn.efficiencyScore >= 75);
  assert.ok(dyn.estimatedPercentile > 70);
});
