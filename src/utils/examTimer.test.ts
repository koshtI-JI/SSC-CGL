import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeWallClockRemainingSeconds,
  createExamSessionId,
  resolveBilingualQuestionView,
  resolveDeterministicAttemptId,
  resolveDeterministicXpLedgerId,
} from './examTimer';
import { calculateTestOutcome } from './examEngine';
import type { QuestionDoc, QuestionResponseState, ScoringConfig } from '../types/exam';
import { DEFAULT_SCORING_CONFIG } from '../types/exam';

test('computeWallClockRemainingSeconds derives remaining seconds from wall-clock deadline and ignores throttling', () => {
  const startMs = 1_700_000_000_000;
  const deadlineAtMs = startMs + 60 * 60 * 1000; // 60 min exam

  assert.equal(computeWallClockRemainingSeconds(deadlineAtMs, 3600, startMs), 3600);
  // After 15 minutes real elapsed (even if interval only ticked twice)
  assert.equal(computeWallClockRemainingSeconds(deadlineAtMs, 3598, startMs + 15 * 60 * 1000), 2700);
  // Clamps cleanly at zero once past deadline
  assert.equal(computeWallClockRemainingSeconds(deadlineAtMs, 5, startMs + 65 * 60 * 1000), 0);
  // Falls back safely when paused (no deadlineAtMs)
  assert.equal(computeWallClockRemainingSeconds(undefined, 1425, startMs), 1425);
});

test('deterministic attemptId & xpLedgerId satisfy Firestore isValidId rules and prevent duplicate submissions', () => {
  const sessId = createExamSessionId(1_700_000_000_000);
  assert.match(sessId, /^sess_[a-z0-9]+_[a-z0-9]+$/);

  const id1 = resolveDeterministicAttemptId('damini_01', sessId, () => 'att_random');
  const id2 = resolveDeterministicAttemptId('damini_01', sessId, () => 'att_other');
  assert.equal(id1, id2);
  assert.match(id1, /^[a-zA-Z0-9_-]{1,128}$/);

  const xp1 = resolveDeterministicXpLedgerId(id1);
  const xp2 = resolveDeterministicXpLedgerId(id2);
  assert.equal(xp1, xp2);
  assert.match(xp1, /^[a-zA-Z0-9_-]{1,128}$/);
});

test('resolveBilingualQuestionView switches primary stem/options cleanly and falls back when Hindi is missing', () => {
  const bilingualQ: QuestionDoc = {
    id: 'q_bi',
    subject: 'quant',
    topic: 'Percentage',
    difficulty: 'medium',
    source: 'SSC CGL PYQ',
    questionEn: 'What is 20% of 150?',
    questionHi: '150 का 20% क्या है?',
    optionsEn: ['20', '30', '40', '50'],
    optionsHi: ['२०', '३०', '४०', '५०'],
    correctIndex: 1,
    explanationEn: '150 * 0.2 = 30',
    explanationHi: '150 × 0.2 = 30',
    createdBy: 'admin',
  };

  const enView = resolveBilingualQuestionView({ question: bilingualQ, lang: 'en' });
  assert.equal(enView.primaryStem, 'What is 20% of 150?');
  assert.equal(enView.secondaryStem, '150 का 20% क्या है?');
  assert.equal(enView.primaryOptions[1], '30');
  assert.equal(enView.hindiAvailable, true);
  assert.equal(enView.hindiFallbackUsed, false);

  const hiView = resolveBilingualQuestionView({ question: bilingualQ, lang: 'hi' });
  assert.equal(hiView.primaryStem, '150 का 20% क्या है?');
  assert.equal(hiView.secondaryStem, 'What is 20% of 150?');
  assert.equal(hiView.primaryOptions[1], '३०');
  assert.equal(hiView.hindiAvailable, true);
  assert.equal(hiView.hindiFallbackUsed, false);

  const enOnlyQ: QuestionDoc = {
    ...bilingualQ,
    id: 'q_en_only',
    questionHi: '',
    optionsHi: undefined,
    explanationHi: '',
  };
  const hiFallback = resolveBilingualQuestionView({ question: enOnlyQ, lang: 'hi' });
  assert.equal(hiFallback.primaryStem, 'What is 20% of 150?');
  assert.equal(hiFallback.hindiAvailable, false);
  assert.equal(hiFallback.hindiFallbackUsed, true);
});

test('calculateTestOutcome scores Tier-I (+2/-0.5) and Tier-II (+3/-1) accurately including unanswered zero penalty', () => {
  const qs: QuestionDoc[] = [
    {
      id: 'q1',
      subject: 'quant',
      topic: 'Algebra',
      difficulty: 'medium',
      source: 'PYQ',
      questionEn: 'Q1',
      optionsEn: ['A', 'B', 'C', 'D'],
      correctIndex: 0,
      createdBy: 'admin',
    },
    {
      id: 'q2',
      subject: 'reasoning',
      topic: 'Series',
      difficulty: 'medium',
      source: 'PYQ',
      questionEn: 'Q2',
      optionsEn: ['A', 'B', 'C', 'D'],
      correctIndex: 1,
      createdBy: 'admin',
    },
    {
      id: 'q3',
      subject: 'english',
      topic: 'Grammar',
      difficulty: 'easy',
      source: 'PYQ',
      questionEn: 'Q3',
      optionsEn: ['A', 'B', 'C', 'D'],
      correctIndex: 2,
      createdBy: 'admin',
    },
  ];
  // Wait — 3 questions with 2 answered = 66% (<80%, so isComplete false); let's test Tier-I & Tier-II marks explicitly
  const resps: Record<string, QuestionResponseState> = {
    q1: { questionId: 'q1', visited: true, selectedIndex: 0, markedForReview: false, timeSpentSec: 12 },
    q2: { questionId: 'q2', visited: true, selectedIndex: 0, markedForReview: false, timeSpentSec: 20 },
    q3: { questionId: 'q3', visited: true, selectedIndex: -1, markedForReview: false, timeSpentSec: 5 },
  };
  const scoring: ScoringConfig = { ...DEFAULT_SCORING_CONFIG };

  const tier1 = calculateTestOutcome(qs, resps, { positiveMarks: 2, negativeMarks: 0.5 }, scoring, 1);
  assert.equal(tier1.score, 1.5); // +2 - 0.5 + 0
  assert.equal(tier1.maxScore, 6);
  assert.equal(tier1.accuracy, 50);

  const tier2 = calculateTestOutcome(qs, resps, { positiveMarks: 3, negativeMarks: 1 }, scoring, 1);
  assert.equal(tier2.score, 2); // +3 - 1 + 0
  assert.equal(tier2.maxScore, 9);
});
