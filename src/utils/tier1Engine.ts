import type { QuestionDoc, SubjectKey } from '../types/exam';

export const TIER1_SECTION_ORDER: SubjectKey[] = ['reasoning', 'ga', 'quant', 'english'];
export const TIER1_QUESTIONS_PER_SECTION = 25;
export const TIER1_TOTAL_QUESTIONS = 100;
export const TIER1_TOTAL_DURATION_MINUTES = 60;
export const TIER1_SECTION_DURATION_SEC = 15 * 60; // 15 minutes per section
export const TIER1_POSITIVE_MARKS = 2;
export const TIER1_NEGATIVE_MARKS = 0.5;

function seededShuffle<T>(arr: T[], seedStr: string): T[] {
  const copy = [...arr];
  let seed = 0;
  for (let i = 0; i < seedStr.length; i += 1) {
    seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  }
  for (let i = copy.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

export interface Tier1AssemblyResult {
  questionIds: string[];
  countsBySubject: Record<SubjectKey, number>;
  shortfalls: SubjectKey[];
  isComplete100: boolean;
}

export function assembleTier1Questions(
  allQuestions: QuestionDoc[],
  seedKey: string = String(Date.now())
): Tier1AssemblyResult {
  const countsBySubject: Record<SubjectKey, number> = {
    reasoning: 0,
    ga: 0,
    quant: 0,
    english: 0,
  };
  const shortfalls: SubjectKey[] = [];
  const questionIds: string[] = [];

  for (const subject of TIER1_SECTION_ORDER) {
    const pool = seededShuffle(
      allQuestions.filter((q) => q.subject === subject),
      `${seedKey}_${subject}`
    );
    const chosen = pool.slice(0, TIER1_QUESTIONS_PER_SECTION);
    countsBySubject[subject] = chosen.length;
    if (chosen.length < TIER1_QUESTIONS_PER_SECTION) {
      shortfalls.push(subject);
    }
    for (const q of chosen) {
      questionIds.push(q.id);
    }
  }

  return {
    questionIds,
    countsBySubject,
    shortfalls,
    isComplete100: questionIds.length === TIER1_TOTAL_QUESTIONS && shortfalls.length === 0,
  };
}

export interface ExamSectionRange {
  subject: SubjectKey;
  startIdx: number;
  endIdx: number;
  count: number;
}

export function computeExamSectionRanges(
  questions: QuestionDoc[],
  preferredOrder: SubjectKey[] = TIER1_SECTION_ORDER
): ExamSectionRange[] {
  const seen = new Set<SubjectKey>();
  const ranges: ExamSectionRange[] = [];

  const orderToScan: SubjectKey[] = [
    ...preferredOrder,
    ...(['quant', 'reasoning', 'english', 'ga'] as SubjectKey[]).filter(
      (s) => !preferredOrder.includes(s)
    ),
  ];

  for (const sub of orderToScan) {
    if (seen.has(sub)) continue;
    const indices: number[] = [];
    questions.forEach((q, idx) => {
      if (q.subject === sub) indices.push(idx);
    });
    if (indices.length > 0) {
      seen.add(sub);
      ranges.push({
        subject: sub,
        startIdx: indices[0],
        endIdx: indices[indices.length - 1],
        count: indices.length,
      });
    }
  }

  return ranges;
}

export function buildInitialSectionTimers(
  ranges: ExamSectionRange[],
  sectionDurationSec: number = TIER1_SECTION_DURATION_SEC
): Partial<Record<SubjectKey, number>> {
  const map: Partial<Record<SubjectKey, number>> = {};
  for (const r of ranges) {
    map[r.subject] = sectionDurationSec;
  }
  return map;
}
