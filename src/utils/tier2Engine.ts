import type { QuestionDoc, SubjectKey } from '../types/exam';

export const TIER2_SECTION_ORDER: SubjectKey[] = ['quant', 'reasoning', 'english', 'ga'];

export const TIER2_SECTION_QUOTAS: Record<SubjectKey, number> = {
  quant: 25,
  reasoning: 25,
  english: 30,
  ga: 20,
};

export const TIER2_TOTAL_QUESTIONS = 100;
export const TIER2_TOTAL_DURATION_MINUTES = 80;
export const TIER2_SECTION_DURATION_SEC = 20 * 60; // 20 minutes per section
export const TIER2_POSITIVE_MARKS = 3;
export const TIER2_NEGATIVE_MARKS = 1;

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

export interface Tier2AssemblyResult {
  questionIds: string[];
  countsBySubject: Record<SubjectKey, number>;
  shortfalls: SubjectKey[];
  isComplete100: boolean;
}

/**
 * Assembles an SSC CGL Tier-II Paper-I simulation (100 Qs: Quant 25, Reasoning 25, English 30, GA 20)
 * using +3 / -1 marking and sectional timers, staying within the 100-question MockTestDoc limit.
 */
export function assembleTier2Questions(
  allQuestions: QuestionDoc[],
  seedKey: string = String(Date.now())
): Tier2AssemblyResult {
  const countsBySubject: Record<SubjectKey, number> = {
    quant: 0,
    reasoning: 0,
    english: 0,
    ga: 0,
  };
  const shortfalls: SubjectKey[] = [];
  const questionIds: string[] = [];
  const chosenSet = new Set<string>();

  for (const subject of TIER2_SECTION_ORDER) {
    const quota = TIER2_SECTION_QUOTAS[subject];
    const pool = seededShuffle(
      allQuestions.filter((q) => q.subject === subject),
      `${seedKey}_tier2_${subject}`
    );
    // Prioritize medium & hard questions first for authentic Tier-II rigor
    const difficultyRank = { hard: 0, medium: 1, easy: 2 };
    pool.sort((a, b) => difficultyRank[a.difficulty] - difficultyRank[b.difficulty]);

    const chosen = pool.slice(0, quota);
    countsBySubject[subject] = chosen.length;
    if (chosen.length < quota) {
      shortfalls.push(subject);
    }
    for (const q of chosen) {
      if (!chosenSet.has(q.id)) {
        chosenSet.add(q.id);
        questionIds.push(q.id);
      }
    }
  }

  return {
    questionIds,
    countsBySubject,
    shortfalls,
    isComplete100: questionIds.length === TIER2_TOTAL_QUESTIONS && shortfalls.length === 0,
  };
}
