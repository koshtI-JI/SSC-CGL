import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReviewModeRows,
  buildTestHistoryEntries,
  classifyAttemptCategory,
  deriveTopicLabelFromAttempt,
  filterReviewModeRows,
  filterTestHistoryEntries,
  summarizeReviewCounts,
} from './revisionHistory';
import type { MockTestDoc, QuestionDoc, TestAttemptDoc } from '../types/exam';

const sampleTests: MockTestDoc[] = [
  {
    id: 'test_full_1',
    title: 'Tier-I Full Mock #1',
    subjectScope: 'full',
    durationMinutes: 60,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionIds: ['q1', 'q2', 'q3'],
    questionCount: 3,
    published: true,
    createdBy: 'admin',
  },
  {
    id: 'prac_u1_geom',
    title: 'Geometry Smart Test (10 Qs)',
    subjectScope: 'quant',
    topicTag: 'Geometry',
    durationMinutes: 15,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionIds: ['q1', 'q2'],
    questionCount: 2,
    published: false,
    createdBy: 'u1',
  },
];

const sampleAttempts: TestAttemptDoc[] = [
  {
    id: 'att_old',
    uid: 'u1',
    studentName: 'Aarav',
    testId: 'test_full_1',
    testTitle: 'Tier-I Full Mock #1',
    subjectScope: 'full',
    score: 142.5,
    maxScore: 200,
    accuracy: 81.5,
    correctCount: 74,
    wrongCount: 11,
    skippedCount: 15,
    totalTimeSec: 3200,
    xpEarned: 190,
    sectionStats: {},
    createdAt: { toMillis: () => 1700000000000 },
  },
  {
    id: 'att_new_custom',
    uid: 'u1',
    studentName: 'Aarav',
    testId: 'prac_u1_geom',
    testTitle: 'Geometry Smart Test (10 Qs)',
    subjectScope: 'quant',
    topicTag: 'Geometry',
    score: 16,
    maxScore: 20,
    accuracy: 90,
    correctCount: 8,
    wrongCount: 1,
    skippedCount: 1,
    totalTimeSec: 420,
    xpEarned: 45,
    sectionStats: {},
    createdAt: { toMillis: () => 1700500000000 },
  },
];

const sampleQuestions: QuestionDoc[] = [
  {
    id: 'q1',
    subject: 'quant',
    topic: 'Geometry',
    difficulty: 'medium',
    source: 'Gemini SSC Generator',
    questionEn: 'Sum of interior angles of a triangle?',
    optionsEn: ['90°', '180°', '270°', '360°'],
    correctIndex: 1,
    explanationEn: 'Angle sum property of triangle is 180 degrees.',
    createdBy: 'u1',
  },
  {
    id: 'q2',
    subject: 'quant',
    topic: 'Geometry',
    difficulty: 'medium',
    source: 'Gemini SSC Generator',
    questionEn: 'Angle in a semicircle is?',
    optionsEn: ['45°', '60°', '90°', '120°'],
    correctIndex: 2,
    explanationEn: 'Thales theorem states angle inscribed in a semicircle is 90°.',
    createdBy: 'u1',
  },
  {
    id: 'q3',
    subject: 'english',
    topic: 'Cloze Test',
    difficulty: 'easy',
    source: 'PYQ',
    questionEn: 'Choose antonym of Abate.',
    optionsEn: ['Subside', 'Intensify', 'Lessen', 'Fade'],
    correctIndex: 1,
    explanationEn: 'Abate means reduce; intensify means increase.',
    createdBy: 'admin',
  },
];

test('buildTestHistoryEntries preserves all attempts newest-first and derives topics cleanly', () => {
  const entries = buildTestHistoryEntries(sampleAttempts, sampleTests);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].attempt.id, 'att_new_custom');
  assert.equal(entries[0].category, 'custom_topic');
  assert.equal(entries[0].topicLabel, 'Geometry');
  assert.equal(entries[0].score, 16);
  assert.equal(entries[0].accuracy, 90);
  assert.deepEqual(entries[0].questionIds, ['q1', 'q2']);

  assert.equal(entries[1].attempt.id, 'att_old');
  assert.equal(entries[1].category, 'full');
  assert.equal(entries[1].topicLabel, 'Tier-I Full Mock');
});

test('deriveTopicLabelFromAttempt falls back cleanly when topicTag is absent on older attempts', () => {
  const legacyAttempt: TestAttemptDoc = {
    ...sampleAttempts[1],
    topicTag: undefined,
    testTitle: 'Active & Passive Voice Smart Test (15 Qs)',
  };
  assert.equal(deriveTopicLabelFromAttempt(legacyAttempt), 'Active & Passive Voice');
  assert.equal(classifyAttemptCategory(legacyAttempt), 'custom_topic');
});

test('filterTestHistoryEntries filters by category and search query', () => {
  const entries = buildTestHistoryEntries(sampleAttempts, sampleTests);
  assert.equal(filterTestHistoryEntries(entries, { category: 'custom_topic' }).length, 1);
  assert.equal(filterTestHistoryEntries(entries, { category: 'full' }).length, 1);
  assert.equal(filterTestHistoryEntries(entries, { searchQuery: 'geom' }).length, 1);
  assert.equal(filterTestHistoryEntries(entries, { searchQuery: 'nonexistent' }).length, 0);
});

test('buildReviewModeRows pairs questions with selected options, status, and filter counts', () => {
  const rows = buildReviewModeRows(sampleQuestions, {
    q1: { selectedIndex: 1, timeSpentSec: 22, markedForReview: false },
    q2: { selectedIndex: 0, timeSpentSec: 30, markedForReview: true },
    q3: { selectedIndex: -1, timeSpentSec: 5, markedForReview: false },
  });

  assert.equal(rows.length, 3);
  assert.equal(rows[0].status, 'correct');
  assert.equal(rows[0].selectedIndex, 1);
  assert.equal(rows[0].correctIndex, 1);

  assert.equal(rows[1].status, 'wrong');
  assert.equal(rows[1].selectedIndex, 0);
  assert.equal(rows[1].correctIndex, 2);
  assert.equal(rows[1].markedForReview, true);

  assert.equal(rows[2].status, 'unanswered');
  assert.equal(rows[2].selectedIndex, -1);

  const counts = summarizeReviewCounts(rows);
  assert.deepEqual(counts, { all: 3, correct: 1, wrong: 1, unanswered: 1 });

  assert.equal(filterReviewModeRows(rows, 'wrong').length, 1);
  assert.equal(filterReviewModeRows(rows, 'correct').length, 1);
  assert.equal(filterReviewModeRows(rows, 'unanswered').length, 1);
});
