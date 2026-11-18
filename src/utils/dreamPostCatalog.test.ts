import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeTargetCutoffBenchmark,
  evaluateTopicMastery,
  MICRO_SYLLABUS_CHAPTERS,
  normalizeTopicSlug,
  resolveDreamPost,
} from './dreamPostCatalog';
import type { QuestionDoc } from '../types/exam';
import type { CalculatedTestOutcome } from './examEngine';

test('resolveDreamPost identifies inspector posts and cut-offs accurately', () => {
  const itInspector = resolveDreamPost('Income Tax Inspector');
  assert.equal(itInspector.isInspector, true);
  assert.equal(itInspector.tier1Cutoff, 158);
  assert.ok(itInspector.physicalStandards);

  const mea = resolveDreamPost('ASO in MEA');
  assert.equal(mea.isInspector, false);
  assert.equal(mea.tier1Cutoff, 162);

  const customInspector = resolveDreamPost('Narcotics Inspector');
  assert.equal(customInspector.isInspector, true);
});

test('computeTargetCutoffBenchmark scales benchmark proportionally to mock maxScore', () => {
  const fullBenchmark = computeTargetCutoffBenchmark('ASO in MEA', 170, 200);
  assert.equal(fullBenchmark.scaledCutoff, 162);
  assert.equal(fullBenchmark.isAboveCutoff, true);
  assert.equal(fullBenchmark.deltaMarks, 8);

  const customBenchmark = computeTargetCutoffBenchmark('ASO in MEA', 30, 50);
  assert.equal(customBenchmark.scaledCutoff, 40.5);
  assert.equal(customBenchmark.isAboveCutoff, false);
  assert.equal(customBenchmark.deltaMarks, -10.5);
});

test('evaluateTopicMastery marks Smart Topic green when score accuracy > 80%', () => {
  const questions: QuestionDoc[] = [
    {
      id: 'q1',
      subject: 'ga',
      topic: 'History',
      difficulty: 'medium',
      source: 'PYQ',
      questionEn: 'Q1',
      optionsEn: ['A', 'B', 'C', 'D'],
      correctIndex: 0,
      createdBy: 'admin',
    },
  ];
  const outcomePass: CalculatedTestOutcome = {
    score: 18,
    maxScore: 20,
    accuracy: 90,
    correctCount: 9,
    wrongCount: 1,
    skippedCount: 0,
    effectiveWrongCount: 1,
    marksLostUnanswered: 0,
    attemptedCount: 10,
    totalQuestions: 10,
    completionPercent: 100,
    isComplete: true,
    isRepeatAttempt: false,
    totalTimeSec: 180,
    baseXp: 53,
    activityMultiplier: 1,
    xpEarned: 53,
    sectionStats: { ga: { correct: 9, wrong: 1, skipped: 0, timeSec: 180 } },
    wrongItems: [],
    skippedItems: [],
    perQuestionResults: [
      { questionId: 'q1', selectedIndex: 0, isCorrect: true, timeSpentSec: 18, markedForReview: false },
    ],
  };

  const passRes = evaluateTopicMastery({
    topicTag: 'History',
    subjectScope: 'ga',
    questions,
    outcome: outcomePass,
    nowMs: 1000,
  });

  assert.equal(passRes.changed, true);
  assert.equal(passRes.updatedMastery.ga_history?.mastered, true);
  assert.equal(passRes.updatedMastery.ga_history?.bestAccuracy, 90);
  assert.deepEqual(passRes.newlyMasteredTopics, ['History']);

  // Score at 80% exactly should NOT turn green (strictly >80%)
  const failRes = evaluateTopicMastery({
    topicTag: 'Geometry',
    subjectScope: 'quant',
    questions: [{ ...questions[0], subject: 'quant', topic: 'Geometry' }],
    outcome: { ...outcomePass, accuracy: 80 },
    existingMastery: passRes.updatedMastery,
    nowMs: 2000,
  });
  assert.equal(failRes.updatedMastery.quant_geometry?.mastered, false);
  assert.equal(normalizeTopicSlug('Trigonometry', 'quant'), 'quant_trigonometry');
  assert.ok(MICRO_SYLLABUS_CHAPTERS.length >= 25);
});
