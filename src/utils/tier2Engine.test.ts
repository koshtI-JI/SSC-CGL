import assert from 'node:assert/strict';
import test from 'node:test';
import { STARTER_QUESTIONS } from '../data/sscStarterBank';
import { normalizeQuestionDoc } from './questionSchema';
import {
  assembleTier2Questions,
  TIER2_NEGATIVE_MARKS,
  TIER2_POSITIVE_MARKS,
  TIER2_SECTION_ORDER,
  TIER2_SECTION_QUOTAS,
  TIER2_TOTAL_QUESTIONS,
} from './tier2Engine';
import type { QuestionDoc } from '../types/exam';

function getNormalizedStarter(): QuestionDoc[] {
  return STARTER_QUESTIONS.map((s) =>
    normalizeQuestionDoc(s as unknown as Record<string, unknown>, s.seedId)
  ).filter((q): q is QuestionDoc => q !== null);
}

test('assembleTier2Questions builds complete 100-Q Tier-II simulation from bundled starter bank', () => {
  const starter = getNormalizedStarter();
  const res = assembleTier2Questions(starter, 'tier2_seed_01');

  assert.equal(res.isComplete100, true);
  assert.equal(res.questionIds.length, TIER2_TOTAL_QUESTIONS);
  assert.deepEqual(res.shortfalls, []);
  assert.deepEqual(res.countsBySubject, TIER2_SECTION_QUOTAS);
  assert.equal(new Set(res.questionIds).size, TIER2_TOTAL_QUESTIONS);
  assert.equal(TIER2_POSITIVE_MARKS, 3);
  assert.equal(TIER2_NEGATIVE_MARKS, 1);
  assert.deepEqual(TIER2_SECTION_ORDER, ['quant', 'reasoning', 'english', 'ga']);
});

test('assembleTier2Questions reports shortfalls accurately on partial question bank', () => {
  const starter = getNormalizedStarter().slice(0, 12);
  const res = assembleTier2Questions(starter, 'tier2_partial');

  assert.equal(res.isComplete100, false);
  assert.ok(res.shortfalls.length > 0);
  assert.equal(res.questionIds.length, 12);
});
