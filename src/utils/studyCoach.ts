import {
  SUBJECT_LABELS,
  type StudentSessionLogDoc,
  type SubjectKey,
  type TestAttemptDoc,
} from '../types/exam';
import { isAttemptComplete, toLocalDateKey } from './examEngine';

export type MistakeTagId = 'concept' | 'calculation' | 'silly' | 'time' | 'vocab';

export const MISTAKE_TAGS: Array<{
  id: MistakeTagId;
  label: string;
  hint: string;
}> = [
  { id: 'concept', label: 'Concept Gap', hint: 'Revise underlying rule or theorem' },
  { id: 'calculation', label: 'Calc Error', hint: 'Slow down last step & verify units' },
  { id: 'silly', label: 'Silly Mistake', hint: 'Re-read question stem carefully (NOT / EXCEPT)' },
  { id: 'time', label: 'Time Pressure', hint: 'Practice 25-sec timed drills on this topic' },
  { id: 'vocab', label: 'Vocab / Fact', hint: 'Add to daily pocket flashcard review' },
];

export const TIER1_SAFE_BENCHMARK = 145;

export interface StudyStreakSummary {
  currentStreakDays: number;
  bestStreakDays: number;
  activeToday: boolean;
  totalActiveDays: number;
}

export interface DailyGoalSummary {
  solvedToday: number;
  goal: number;
  percent: number;
  goalMet: boolean;
}

export interface SubjectReadinessItem {
  subject: SubjectKey;
  label: string;
  attempted: number;
  correct: number;
  accuracy: number;
}

export interface AspirantCoachSummary {
  streak: StudyStreakSummary;
  dailyGoal: DailyGoalSummary;
  subjectBreakdown: SubjectReadinessItem[];
  strongestSubject: SubjectReadinessItem | null;
  focusSubject: SubjectReadinessItem | null;
  accuracyTrendDelta: number | null;
  recentFullMockAvg200: number | null;
  headline: string;
  encouragement: string;
  actionTip: string;
}

function getAttemptTimestampMs(attempt: TestAttemptDoc): number | null {
  const c = attempt.createdAt as { toMillis?: () => number; seconds?: number } | number | null | undefined;
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  if (c && typeof c === 'object') {
    if (typeof c.toMillis === 'function') return c.toMillis();
    if (typeof c.seconds === 'number') return c.seconds * 1000;
  }
  return null;
}

function parseDateKeyToUtcDay(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}

function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + deltaDays);
  return toLocalDateKey(dt);
}

export function computeStudyStreak(
  attempts: TestAttemptDoc[],
  sessionLogs: StudentSessionLogDoc[],
  now: Date = new Date()
): StudyStreakSummary {
  const activeDayKeys = new Set<string>();

  for (const att of attempts) {
    const ms = getAttemptTimestampMs(att);
    if (ms && ms > 0) {
      activeDayKeys.add(toLocalDateKey(ms));
    }
  }

  for (const log of sessionLogs) {
    if ((log.activeDurationSec || 0) >= 120 || (log.testsCompleted || 0) > 0 || (log.questionsAttempted || 0) > 0) {
      const ms = log.lastActiveAtMs || log.loginAtMs;
      if (ms && ms > 0) {
        activeDayKeys.add(toLocalDateKey(ms));
      }
    }
  }

  if (activeDayKeys.size === 0) {
    return { currentStreakDays: 0, bestStreakDays: 0, activeToday: false, totalActiveDays: 0 };
  }

  const todayKey = toLocalDateKey(now);
  const yesterdayKey = addDaysToDateKey(todayKey, -1);
  const activeToday = activeDayKeys.has(todayKey);

  // Count current streak starting today if active today, else from yesterday if active yesterday
  let currentStreakDays = 0;
  let cursorKey = activeToday ? todayKey : activeDayKeys.has(yesterdayKey) ? yesterdayKey : '';
  while (cursorKey && activeDayKeys.has(cursorKey)) {
    currentStreakDays += 1;
    cursorKey = addDaysToDateKey(cursorKey, -1);
  }

  // Compute best streak across all active days
  const sortedUtcDays = Array.from(activeDayKeys)
    .map(parseDateKeyToUtcDay)
    .sort((a, b) => a - b);

  let bestStreakDays = 0;
  let run = 0;
  let prevDay: number | null = null;
  for (const dayNum of sortedUtcDays) {
    if (prevDay !== null && dayNum === prevDay + 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > bestStreakDays) bestStreakDays = run;
    prevDay = dayNum;
  }

  return {
    currentStreakDays,
    bestStreakDays,
    activeToday,
    totalActiveDays: activeDayKeys.size,
  };
}

export function computeDailyQuestionGoal(
  attempts: TestAttemptDoc[],
  dailyGoal: number = 50,
  now: Date = new Date()
): DailyGoalSummary {
  const safeGoal = Math.max(10, Math.min(300, Math.round(dailyGoal || 50)));
  const todayKey = toLocalDateKey(now);
  let solvedToday = 0;

  for (const att of attempts) {
    const ms = getAttemptTimestampMs(att);
    if (ms && toLocalDateKey(ms) === todayKey) {
      solvedToday += Math.max(0, (att.correctCount || 0) + (att.wrongCount || 0));
    }
  }

  const percent = Math.min(100, Math.round((solvedToday / safeGoal) * 100));
  return {
    solvedToday,
    goal: safeGoal,
    percent,
    goalMet: solvedToday >= safeGoal,
  };
}

export function computeAspirantCoachSummary(params: {
  targetPost?: string;
  displayName?: string;
  attempts: TestAttemptDoc[];
  sessionLogs: StudentSessionLogDoc[];
  pendingVaultCount: number;
  dailyGoal?: number;
  now?: Date;
}): AspirantCoachSummary {
  const {
    targetPost = 'SSC CGL Officer',
    displayName = 'Aspirant',
    attempts,
    sessionLogs,
    pendingVaultCount,
    dailyGoal = 50,
    now = new Date(),
  } = params;

  const streak = computeStudyStreak(attempts, sessionLogs, now);
  const dailyGoalSummary = computeDailyQuestionGoal(attempts, dailyGoal, now);

  const subjTotals: Record<SubjectKey, { attempted: number; correct: number }> = {
    quant: { attempted: 0, correct: 0 },
    reasoning: { attempted: 0, correct: 0 },
    english: { attempted: 0, correct: 0 },
    ga: { attempted: 0, correct: 0 },
  };

  for (const att of attempts) {
    if (!att.sectionStats) continue;
    (['quant', 'reasoning', 'english', 'ga'] as SubjectKey[]).forEach((sub) => {
      const st = att.sectionStats?.[sub];
      if (!st) return;
      const attCount = Math.max(0, (st.correct || 0) + (st.wrong || 0));
      subjTotals[sub].attempted += attCount;
      subjTotals[sub].correct += Math.max(0, st.correct || 0);
    });
  }

  const subjectBreakdown: SubjectReadinessItem[] = (['quant', 'reasoning', 'english', 'ga'] as SubjectKey[])
    .map((sub) => {
      const t = subjTotals[sub];
      const acc = t.attempted > 0 ? Math.round((t.correct / t.attempted) * 1000) / 10 : 0;
      return {
        subject: sub,
        label: SUBJECT_LABELS[sub].short,
        attempted: t.attempted,
        correct: t.correct,
        accuracy: acc,
      };
    })
    .filter((item) => item.attempted > 0);

  const sortedByAcc = [...subjectBreakdown].sort((a, b) => a.accuracy - b.accuracy);
  const focusSubject = sortedByAcc.length > 0 ? sortedByAcc[0] : null;
  const strongestSubject = sortedByAcc.length > 1 ? sortedByAcc[sortedByAcc.length - 1] : sortedByAcc[0] ?? null;

  // Sort qualifying attempts newest-first for trend and recent full mock score
  const sortedAttempts = [...attempts]
    .filter((a) => isAttemptComplete(a))
    .sort((a, b) => (getAttemptTimestampMs(b) ?? 0) - (getAttemptTimestampMs(a) ?? 0));

  let accuracyTrendDelta: number | null = null;
  if (sortedAttempts.length >= 4) {
    const recentSlice = sortedAttempts.slice(0, 3);
    const prevSlice = sortedAttempts.slice(3, 6);
    const recentAvg = recentSlice.reduce((s, a) => s + a.accuracy, 0) / recentSlice.length;
    const prevAvg = prevSlice.reduce((s, a) => s + a.accuracy, 0) / prevSlice.length;
    accuracyTrendDelta = Math.round((recentAvg - prevAvg) * 10) / 10;
  }

  const recentFullMocks = sortedAttempts
    .filter((a) => a.subjectScope === 'full' && a.maxScore > 0)
    .slice(0, 5);
  const recentFullMockAvg200 =
    recentFullMocks.length > 0
      ? Math.round(
          (recentFullMocks.reduce((s, a) => s + (a.score / a.maxScore) * 200, 0) / recentFullMocks.length) * 10
        ) / 10
      : null;

  const cleanPost = targetPost.trim() || 'SSC CGL Officer';
  const cleanName = displayName.trim() || 'Aspirant';

  let headline = `Stay locked in, ${cleanName} — every question brings ${cleanPost} closer.`;
  let encouragement =
    'Consistency beats intensity. Even one focused 15-minute sprint plus 10 Vault revisions keeps your edge sharp.';

  if (dailyGoalSummary.goalMet && streak.currentStreakDays >= 3) {
    headline = `${streak.currentStreakDays}-Day Streak & Daily Goal Smashed!`;
    encouragement = `Outstanding discipline, ${cleanName}. You hit ${dailyGoalSummary.solvedToday} questions today—that is exact ${cleanPost} selection-grade momentum.`;
  } else if (dailyGoalSummary.goalMet) {
    headline = `Today's ${dailyGoalSummary.goal}Q Target Complete!`;
    encouragement = `Great work hitting ${dailyGoalSummary.solvedToday} questions today. Review your Revision Vault mistakes to convert effort into permanent marks.`;
  } else if (accuracyTrendDelta !== null && accuracyTrendDelta >= 3) {
    headline = `Accuracy Up +${accuracyTrendDelta}% Across Recent Mocks!`;
    encouragement = `Your precision is visibly climbing. Keep avoiding blind guesses to protect negative marks in ${cleanPost} race.`;
  } else if (streak.currentStreakDays >= 2) {
    headline = `${streak.currentStreakDays}-Day Study Streak Active`;
    encouragement = `${
      dailyGoalSummary.goal - dailyGoalSummary.solvedToday
    } more questions today completes your ${dailyGoalSummary.goal}Q daily goal. Small daily wins compound fast.`;
  } else if (attempts.length === 0) {
    headline = `Your ${cleanPost} Journey Starts with One Mock`;
    encouragement = `Launch today's Daily Mock or a quick 10-question sprint to establish your baseline score and unlock personalized coach insights.`;
  }

  let actionTip = 'Attempt Today’s Daily Mock to keep your cohort rank climbing.';
  if (focusSubject && focusSubject.accuracy < 70) {
    actionTip = `Priority focus: ${focusSubject.label} is at ${focusSubject.accuracy}% accuracy—run a quick 15Q drill to lift it past 75%.`;
  } else if (pendingVaultCount >= 8) {
    actionTip = `You have ${pendingVaultCount} pending questions in Revision Vault—clearing 10 of them today prevents repeat negative marks.`;
  } else if (recentFullMockAvg200 !== null && recentFullMockAvg200 < TIER1_SAFE_BENCHMARK) {
    const gap = Math.round((TIER1_SAFE_BENCHMARK - recentFullMockAvg200) * 10) / 10;
    actionTip = `Current Tier-I pace is ${recentFullMockAvg200}/200 (${gap} marks from 145+ Safe Zone). Focus on accuracy over risky guesses.`;
  } else if (recentFullMockAvg200 !== null && recentFullMockAvg200 >= TIER1_SAFE_BENCHMARK) {
    actionTip = `Strong Tier-I pace (${recentFullMockAvg200}/200 — above 145 Safe Zone)! Push speed on Quant & Reasoning to target 165+.`;
  }

  return {
    streak,
    dailyGoal: dailyGoalSummary,
    subjectBreakdown,
    strongestSubject,
    focusSubject,
    accuracyTrendDelta,
    recentFullMockAvg200,
    headline,
    encouragement,
    actionTip,
  };
}

export interface PostTestEncouragement {
  badge: string;
  tone: 'emerald' | 'blue' | 'amber';
  title: string;
  message: string;
}

export function buildPostTestEncouragement(params: {
  score: number;
  maxScore: number;
  accuracy: number;
  isComplete: boolean;
  completionPercent: number;
  priorBestScore: number | null;
  targetPost?: string;
}): PostTestEncouragement {
  const { score, maxScore, accuracy, isComplete, completionPercent, priorBestScore, targetPost } = params;
  const cleanPost = (targetPost || 'SSC CGL Officer').trim();
  const scorePct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  if (!isComplete) {
    return {
      badge: 'Keep Going',
      tone: 'amber',
      title: `Good practice run (${completionPercent}% attempted) — finish >80% next time to unlock XP`,
      message: `Every question you saw is now saved in your Pending & Revision Vault. Revisit the solutions below, then solve more than 80% for full ${cleanPost} leaderboard credit.`,
    };
  }

  if (priorBestScore !== null && score > priorBestScore) {
    return {
      badge: 'New Personal Best',
      tone: 'emerald',
      title: `New High Score! You beat your previous best (${priorBestScore})`,
      message: `Strong execution with ${accuracy}% accuracy. Review the wrong/skipped items once so this jump becomes your new normal.`,
    };
  }

  if (accuracy >= 85 && scorePct >= 70) {
    return {
      badge: 'Selection Pace',
      tone: 'emerald',
      title: `Sharp ${accuracy}% Accuracy — ${cleanPost} Tier-I Form!`,
      message: `Excellent balance of speed and negative-mark control. Keep pushing your Revision Vault to lock in 100% mastery.`,
    };
  }

  if (accuracy >= 70) {
    return {
      badge: 'Solid Progress',
      tone: 'blue',
      title: `Solid attempt with ${accuracy}% accuracy`,
      message: `You stayed above the >80% completion gate and earned XP. Check the Weakness Analyzer below to turn 2–3 weak topics into easy marks next time.`,
    };
  }

  return {
    badge: 'Growth Mindset',
    tone: 'amber',
    title: `Attempt completed — every mistake reviewed today saves -0.5 in the real exam`,
    message: `Don't stress about a tough paper. Use the "Take Revision Test of Wrong Topics" button below—fixing weak areas right after a mock builds real ${cleanPost} confidence.`,
  };
}

export interface FormulaCardItem {
  id: string;
  subject: SubjectKey;
  topic: string;
  title: string;
  content: string;
  examTip: string;
  example?: string;
  isAi?: boolean;
}

export function normalizeAiFormulaCards(
  rawCards: unknown,
  fallbackSubject: 'all' | SubjectKey = 'all'
): FormulaCardItem[] {
  if (!Array.isArray(rawCards)) return [];
  const validSubjects = new Set<SubjectKey>(['quant', 'reasoning', 'english', 'ga']);
  const out: FormulaCardItem[] = [];

  for (let i = 0; i < rawCards.length && out.length < 6; i += 1) {
    const row = rawCards[i] as Record<string, unknown> | null;
    if (!row || typeof row !== 'object') continue;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    if (!title || !content) continue;
    const rawSubj = String(row.subject ?? '').toLowerCase() as SubjectKey;
    const subject: SubjectKey = validSubjects.has(rawSubj)
      ? rawSubj
      : fallbackSubject !== 'all'
        ? fallbackSubject
        : 'quant';
    const topic = typeof row.topic === 'string' && row.topic.trim() ? row.topic.trim().slice(0, 60) : 'AI Lookup';
    const examTip = typeof row.examTip === 'string' ? row.examTip.trim().slice(0, 400) : '';
    const example = typeof row.example === 'string' ? row.example.trim().slice(0, 320) : '';
    out.push({
      id: `ai_${subject}_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}_${i}`,
      subject,
      topic,
      title: title.slice(0, 120),
      content: content.slice(0, 800),
      examTip,
      ...(example ? { example } : {}),
      isAi: true,
    });
  }
  return out;
}

export interface TranslatedQuestionPayload {
  questionHi: string;
  optionsHi: [string, string, string, string];
  explanationHi?: string;
}

export function normalizeTranslationBatchResponse(
  rawTranslations: unknown,
  fallbackOptionsList: Array<[string, string, string, string]>
): Map<number, TranslatedQuestionPayload> {
  const out = new Map<number, TranslatedQuestionPayload>();
  if (!Array.isArray(rawTranslations)) return out;

  for (const row of rawTranslations) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const idx = typeof r.index === 'number' && Number.isInteger(r.index) ? r.index : -1;
    if (idx < 0 || idx >= fallbackOptionsList.length) continue;
    const questionHi = typeof r.questionHi === 'string' ? r.questionHi.trim() : '';
    if (!questionHi) continue;

    const fallbackOpts = fallbackOptionsList[idx];
    const rawOpts = Array.isArray(r.optionsHi) ? r.optionsHi : [];
    const optionsHi = [0, 1, 2, 3].map((optIdx) => {
      const candidate = typeof rawOpts[optIdx] === 'string' ? rawOpts[optIdx].trim() : '';
      return candidate || fallbackOpts[optIdx];
    }) as [string, string, string, string];

    const explanationHi =
      typeof r.explanationHi === 'string' && r.explanationHi.trim()
        ? r.explanationHi.trim()
        : undefined;

    out.set(idx, {
      questionHi,
      optionsHi,
      ...(explanationHi ? { explanationHi } : {}),
    });
  }

  return out;
}

export function hasNativeHindiTranslation(q: {
  questionEn?: string;
  questionHi?: string;
  optionsHi?: [string, string, string, string];
}): boolean {
  return Boolean(
    q.questionHi &&
      q.questionHi.trim() &&
      Array.isArray(q.optionsHi) &&
      q.optionsHi.length === 4 &&
      q.optionsHi.every((opt) => typeof opt === 'string' && opt.trim().length > 0)
  );
}

export function resolveBilingualQuestionView(
  q: {
    questionEn: string;
    questionHi?: string;
    optionsEn: [string, string, string, string];
    optionsHi?: [string, string, string, string];
    explanationEn?: string;
    explanationHi?: string;
  },
  targetLang: 'en' | 'hi',
  liveTranslation?: TranslatedQuestionPayload | null
): {
  stem: string;
  options: [string, string, string, string];
  explanation?: string;
  isTranslated: boolean;
} {
  if (targetLang === 'en') {
    return {
      stem: q.questionEn,
      options: q.optionsEn,
      explanation: q.explanationEn,
      isTranslated: false,
    };
  }

  if (hasNativeHindiTranslation(q)) {
    return {
      stem: q.questionHi as string,
      options: q.optionsHi as [string, string, string, string],
      explanation: q.explanationHi || q.explanationEn,
      isTranslated: true,
    };
  }

  if (liveTranslation && liveTranslation.questionHi.trim()) {
    return {
      stem: liveTranslation.questionHi,
      options: liveTranslation.optionsHi,
      explanation: liveTranslation.explanationHi || q.explanationHi || q.explanationEn,
      isTranslated: true,
    };
  }

  return {
    stem: q.questionHi?.trim() || q.questionEn,
    options:
      Array.isArray(q.optionsHi) && q.optionsHi.length === 4 ? q.optionsHi : q.optionsEn,
    explanation: q.explanationHi || q.explanationEn,
    isTranslated: false,
  };
}


