import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_QUESTIONS, STARTER_TASKS, STARTER_TESTS } from './sscStarterBank';

test('STARTER_QUESTIONS contains 120 unique valid bilingual SSC CGL questions', () => {
  assert.equal(STARTER_QUESTIONS.length, 120);
  const seen = new Set<string>();
  const subjectCounts: Record<string, number> = { quant: 0, reasoning: 0, english: 0, ga: 0 };

  for (const q of STARTER_QUESTIONS) {
    assert.ok(!seen.has(q.seedId), `Duplicate seedId: ${q.seedId}`);
    seen.add(q.seedId);
    assert.match(q.seedId, /^[a-zA-Z0-9_-]{1,128}$/);
    assert.ok(['quant', 'reasoning', 'english', 'ga'].includes(q.subject));
    subjectCounts[q.subject] += 1;
    assert.ok(q.questionEn.trim().length >= 5 && q.questionEn.length <= 2000);
    assert.ok((q.questionHi ?? '').trim().length >= 5);
    assert.equal(q.optionsEn.length, 4);
    assert.equal(q.optionsHi?.length, 4);
    assert.ok([0, 1, 2, 3].includes(q.correctIndex));
    assert.ok((q.explanationEn ?? '').trim().length >= 5);
  }

  assert.equal(subjectCounts.quant, 30);
  assert.equal(subjectCounts.reasoning, 30);
  assert.equal(subjectCounts.english, 30);
  assert.equal(subjectCounts.ga, 30);
});

test('STARTER_TESTS contains 22 valid SSC CGL mock tests referencing valid unique questions', () => {
  assert.equal(STARTER_TESTS.length, 22);
  const questionIds = new Set(STARTER_QUESTIONS.map((q) => q.seedId));
  const seenTests = new Set<string>();

  for (const t of STARTER_TESTS) {
    assert.ok(!seenTests.has(t.seedId), `Duplicate test seedId: ${t.seedId}`);
    seenTests.add(t.seedId);
    assert.ok(t.title.length >= 2 && t.title.length <= 120, `Invalid title length: ${t.title}`);
    assert.ok(t.questionSeedIds.length >= 1 && t.questionSeedIds.length <= 100);
    const insideTest = new Set<string>();
    for (const qid of t.questionSeedIds) {
      assert.ok(questionIds.has(qid), `Test ${t.seedId} references missing question ${qid}`);
      assert.ok(!insideTest.has(qid), `Test ${t.seedId} has duplicate question ${qid}`);
      insideTest.add(qid);
    }
  }
});

test('STARTER_TASKS contains 6 valid active cohort tasks', () => {
  assert.equal(STARTER_TASKS.length, 6);
  const seenTasks = new Set<string>();
  for (const task of STARTER_TASKS) {
    assert.ok(!seenTasks.has(task.seedId));
    seenTasks.add(task.seedId);
    assert.ok(task.title.length >= 2 && task.title.length <= 120);
    assert.ok(task.targetTests >= 1 && task.targetTests <= 50);
    assert.ok(task.bonusXp >= 1 && task.bonusXp <= 2000);
  }
});
