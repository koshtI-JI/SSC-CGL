import assert from 'node:assert/strict';
import test from 'node:test';
import { STARTER_QUESTIONS } from '../data/sscStarterBank';
import { normalizeQuestionDoc } from './questionSchema';
import {
  assembleTier1Questions,
  buildInitialSectionTimers,
  computeExamSectionRanges,
  TIER1_SECTION_DURATION_SEC,
  TIER1_SECTION_ORDER,
} from './tier1Engine';

test('assembleTier1Questions builds exact 100Q (25x4) exam in strict Reasoning -> GA -> Quant -> English order', () => {
  const bank = STARTER_QUESTIONS.map((s) =>
    normalizeQuestionDoc(s as unknown as Record<string, unknown>, s.seedId)
  ).filter((q): q is NonNullable<typeof q> => q !== null);

  const result = assembleTier1Questions(bank, 'tier1_test_seed');
  assert.equal(result.isComplete100, true);
  assert.equal(result.questionIds.length, 100);
  assert.equal(result.shortfalls.length, 0);
  assert.equal(result.countsBySubject.reasoning, 25);
  assert.equal(result.countsBySubject.ga, 25);
  assert.equal(result.countsBySubject.quant, 25);
  assert.equal(result.countsBySubject.english, 25);

  const byId = new Map(bank.map((q) => [q.id, q]));
  const orderedQuestions = result.questionIds.map((id) => byId.get(id)!);
  const ranges = computeExamSectionRanges(orderedQuestions, TIER1_SECTION_ORDER);

  assert.equal(ranges.length, 4);
  assert.deepEqual(
    ranges.map((r) => [r.subject, r.startIdx, r.endIdx, r.count]),
    [
      ['reasoning', 0, 24, 25],
      ['ga', 25, 49, 25],
      ['quant', 50, 74, 25],
      ['english', 75, 99, 25],
    ]
  );

  const timers = buildInitialSectionTimers(ranges, TIER1_SECTION_DURATION_SEC);
  assert.equal(timers.reasoning, 900);
  assert.equal(timers.ga, 900);
  assert.equal(timers.quant, 900);
  assert.equal(timers.english, 900);
});
