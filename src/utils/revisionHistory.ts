import {
  SUBJECT_LABELS,
  type MockTestDoc,
  type QuestionDoc,
  type SubjectKey,
  type TestAttemptDoc,
} from '../types/exam';
import {
  extractAttemptDateMs,
  formatDateTimeShort,
  getAttemptCompletionPercent,
  isAttemptComplete,
} from './examEngine';

export type TestHistoryCategory = 'full' | 'custom_topic' | 'sectional';
export type TestHistoryCategoryFilter = 'all' | TestHistoryCategory;

export interface TestHistoryEntry {
  attempt: TestAttemptDoc;
  testId: string;
  testTitle: string;
  topicLabel: string;
  category: TestHistoryCategory;
  dateMs: number;
  dateLabel: string;
  score: number;
  maxScore: number;
  accuracy: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  totalQuestions: number;
  completionPercent: number;
  isComplete: boolean;
  totalTimeSec: number;
  questionIds: string[];
}

export function classifyAttemptCategory(
  attempt: Pick<TestAttemptDoc, 'testId' | 'testTitle' | 'subjectScope' | 'topicTag'>,
  matchedTest?: Pick<MockTestDoc, 'topicTag' | 'subjectScope'>
): TestHistoryCategory {
  if (
    attempt.topicTag ||
    matchedTest?.topicTag ||
    /\bsmart test\b/i.test(attempt.testTitle) ||
    attempt.testId.startsWith('prac_')
  ) {
    if (
      attempt.topicTag ||
      matchedTest?.topicTag ||
      /\bsmart test\b/i.test(attempt.testTitle)
    ) {
      return 'custom_topic';
    }
  }
  if (attempt.subjectScope === 'full') return 'full';
  return 'sectional';
}

export function deriveTopicLabelFromAttempt(
  attempt: Pick<TestAttemptDoc, 'testId' | 'testTitle' | 'subjectScope' | 'topicTag'>,
  matchedTest?: Pick<MockTestDoc, 'topicTag' | 'subjectScope'>
): string {
  const explicitTag = (attempt.topicTag || matchedTest?.topicTag || '').trim();
  if (explicitTag) return explicitTag;

  const smartMatch = attempt.testTitle.match(/^(.+?)\s+Smart Test\b/i);
  if (smartMatch && smartMatch[1].trim()) {
    return smartMatch[1].trim();
  }

  if (attempt.subjectScope === 'full') {
    if (/tier-i\s+full\s+mock/i.test(attempt.testTitle)) return 'Tier-I Full Mock';
    if (/daily\s+live\s+mock/i.test(attempt.testTitle)) return 'Daily Live Mock';
    return 'Full Syllabus (4 Sections)';
  }

  const subMeta = SUBJECT_LABELS[attempt.subjectScope as SubjectKey];
  if (subMeta) return subMeta.short;
  return attempt.subjectScope || 'Mixed';
}

export function buildTestHistoryEntries(
  attempts: TestAttemptDoc[],
  tests: MockTestDoc[]
): TestHistoryEntry[] {
  const testById = new Map(tests.map((t) => [t.id, t]));

  return attempts
    .map((attempt) => {
      const matchedTest = testById.get(attempt.testId);
      const dateMs = extractAttemptDateMs(attempt) ?? 0;
      const totalQuestions = Math.max(
        0,
        attempt.correctCount + attempt.wrongCount + attempt.skippedCount
      );
      return {
        attempt,
        testId: attempt.testId,
        testTitle: matchedTest?.title || attempt.testTitle,
        topicLabel: deriveTopicLabelFromAttempt(attempt, matchedTest),
        category: classifyAttemptCategory(attempt, matchedTest),
        dateMs,
        dateLabel: dateMs > 0 ? formatDateTimeShort(dateMs) : 'Just now',
        score: attempt.score,
        maxScore: attempt.maxScore,
        accuracy: attempt.accuracy,
        correctCount: attempt.correctCount,
        wrongCount: attempt.wrongCount,
        skippedCount: attempt.skippedCount,
        totalQuestions,
        completionPercent: getAttemptCompletionPercent(attempt),
        isComplete: isAttemptComplete(attempt),
        totalTimeSec: attempt.totalTimeSec,
        questionIds: matchedTest?.questionIds ?? [],
      };
    })
    .sort((a, b) => b.dateMs - a.dateMs);
}

export function filterTestHistoryEntries(
  entries: TestHistoryEntry[],
  options?: {
    category?: TestHistoryCategoryFilter;
    searchQuery?: string;
  }
): TestHistoryEntry[] {
  const category = options?.category ?? 'all';
  const needle = (options?.searchQuery ?? '').trim().toLowerCase();

  return entries.filter((entry) => {
    if (category !== 'all' && entry.category !== category) return false;
    if (!needle) return true;
    return (
      entry.testTitle.toLowerCase().includes(needle) ||
      entry.topicLabel.toLowerCase().includes(needle) ||
      entry.dateLabel.toLowerCase().includes(needle)
    );
  });
}

export type ReviewQuestionStatus = 'correct' | 'wrong' | 'unanswered';
export type ReviewFilterMode = 'all' | ReviewQuestionStatus;

export interface ReviewModeQuestionRow {
  question: QuestionDoc;
  questionNumber: number;
  selectedIndex: number;
  correctIndex: 0 | 1 | 2 | 3;
  status: ReviewQuestionStatus;
  timeSpentSec: number;
  markedForReview: boolean;
}

export function buildReviewModeRows(
  questions: QuestionDoc[],
  responsesByQuestionId: Record<
    string,
    { selectedIndex: number; timeSpentSec?: number; markedForReview?: boolean } | undefined
  >
): ReviewModeQuestionRow[] {
  return questions.map((question, idx) => {
    const resp = responsesByQuestionId[question.id];
    const rawSel = resp ? resp.selectedIndex : -1;
    const selectedIndex = Number.isInteger(rawSel) && rawSel >= 0 && rawSel <= 3 ? rawSel : -1;
    const status: ReviewQuestionStatus =
      selectedIndex === -1
        ? 'unanswered'
        : selectedIndex === question.correctIndex
          ? 'correct'
          : 'wrong';

    return {
      question,
      questionNumber: idx + 1,
      selectedIndex,
      correctIndex: question.correctIndex,
      status,
      timeSpentSec: Math.max(0, Math.round(resp?.timeSpentSec ?? 0)),
      markedForReview: Boolean(resp?.markedForReview),
    };
  });
}

export function filterReviewModeRows(
  rows: ReviewModeQuestionRow[],
  filter: ReviewFilterMode
): ReviewModeQuestionRow[] {
  if (filter === 'all') return rows;
  return rows.filter((r) => r.status === filter);
}

export function summarizeReviewCounts(rows: ReviewModeQuestionRow[]): {
  all: number;
  correct: number;
  wrong: number;
  unanswered: number;
} {
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;
  for (const r of rows) {
    if (r.status === 'correct') correct += 1;
    else if (r.status === 'wrong') wrong += 1;
    else unanswered += 1;
  }
  return {
    all: rows.length,
    correct,
    wrong,
    unanswered,
  };
}
