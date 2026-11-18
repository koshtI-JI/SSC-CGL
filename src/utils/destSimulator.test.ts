import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPUTER_KNOWLEDGE_QUESTIONS,
  computeDestTypingMetrics,
  DEST_DURATION_SECONDS,
  DEST_PASSAGES,
  DEST_TARGET_KEYSTROKES,
  scoreComputerQuiz,
} from './destSimulator';

test('DEST simulator tracks up to 2000 key depressions and accuracy accurately', () => {
  assert.equal(DEST_DURATION_SECONDS, 900);
  assert.equal(DEST_TARGET_KEYSTROKES, 2000);
  assert.ok(DEST_PASSAGES.every((p) => p.text.length >= 2000));

  const target = DEST_PASSAGES[0].text;
  const typedExact = target.slice(0, 2000);
  const m1 = computeDestTypingMetrics(target, typedExact, 600);
  assert.equal(m1.keyDepressions, 2000);
  assert.equal(m1.accuracy, 100);
  assert.equal(m1.errorCount, 0);
  assert.equal(m1.progressPercent, 100);
  assert.equal(m1.qualified, true);
  assert.equal(m1.grossWpm, 40);

  // Introduce 20 wrong characters out of 200 (90% accuracy -> 10% error -> not qualified)
  const corrupted = 'X'.repeat(20) + target.slice(20, 200);
  const m2 = computeDestTypingMetrics(target, corrupted, 60);
  assert.equal(m2.keyDepressions, 200);
  assert.ok(m2.accuracy <= 91);
  assert.equal(m2.qualified, false);
});

test('Computer Knowledge 20-question quiz scores +3/-1 and evaluates qualifying cut-off', () => {
  assert.equal(COMPUTER_KNOWLEDGE_QUESTIONS.length, 20);
  const allCorrect: Record<string, number> = {};
  COMPUTER_KNOWLEDGE_QUESTIONS.forEach((q) => {
    allCorrect[q.id] = q.correctIndex;
  });
  const perfect = scoreComputerQuiz(COMPUTER_KNOWLEDGE_QUESTIONS, allCorrect);
  assert.equal(perfect.score, 60);
  assert.equal(perfect.maxScore, 60);
  assert.equal(perfect.accuracy, 100);
  assert.equal(perfect.qualifyingPassed, true);

  const partial: Record<string, number> = {};
  COMPUTER_KNOWLEDGE_QUESTIONS.slice(0, 5).forEach((q) => {
    partial[q.id] = (q.correctIndex + 1) % 4;
  });
  const failed = scoreComputerQuiz(COMPUTER_KNOWLEDGE_QUESTIONS, partial);
  assert.equal(failed.correctCount, 0);
  assert.equal(failed.wrongCount, 5);
  assert.equal(failed.unattemptedCount, 15);
  assert.equal(failed.score, -5);
  assert.equal(failed.qualifyingPassed, false);
});
