import {
  SUBJECT_LABELS,
  type QuestionDoc,
  type RevisionItemDoc,
  type StudentSessionLogDoc,
  type SubjectKey,
  type TestAttemptDoc,
} from '../types/exam';
import { resolveSyllabusChapter } from './dreamPostCatalog';
import { isAttemptComplete, toLocalDateKey } from './examEngine';
import { computeStudyStreak } from './studyCoach';

export interface StudyHeatmapDay {
  dateKey: string;
  label: string;
  studyMinutes: number;
  questionsSolved: number;
  testsCompleted: number;
  xpEarned: number;
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface StudyCalendarHeatmapResult {
  days: StudyHeatmapDay[];
  weeks: StudyHeatmapDay[][];
  currentStreakDays: number;
  bestStreakDays: number;
  totalActiveDays: number;
  totalStudyMinutes: number;
  totalQuestionsSolved: number;
}

function getAttemptTimestampMs(attempt: TestAttemptDoc): number | null {
  const c = attempt.createdAt as
    | { toMillis?: () => number; seconds?: number }
    | number
    | null
    | undefined;
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  if (c && typeof c === 'object') {
    if (typeof c.toMillis === 'function') return c.toMillis();
    if (typeof c.seconds === 'number') return c.seconds * 1000;
  }
  return null;
}

function addDaysLocal(base: Date, delta: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
}

export function buildStudyCalendarHeatmap(params: {
  attempts: TestAttemptDoc[];
  sessionLogs: StudentSessionLogDoc[];
  daysCount?: number;
  now?: Date;
}): StudyCalendarHeatmapResult {
  const now = params.now ?? new Date();
  const safeDaysCount = Math.max(28, Math.min(365, params.daysCount ?? 126)); // 18 weeks

  const dayMap = new Map<
    string,
    { studySec: number; questionsSolved: number; testsCompleted: number; xpEarned: number }
  >();

  const ensureBucket = (dateKey: string) => {
    const prev = dayMap.get(dateKey);
    if (prev) return prev;
    const next = { studySec: 0, questionsSolved: 0, testsCompleted: 0, xpEarned: 0 };
    dayMap.set(dateKey, next);
    return next;
  };

  for (const att of params.attempts) {
    const ms = getAttemptTimestampMs(att);
    if (!ms || ms <= 0) continue;
    const key = toLocalDateKey(ms);
    const b = ensureBucket(key);
    b.studySec += Math.max(0, att.totalTimeSec || 0);
    b.questionsSolved += Math.max(0, (att.correctCount || 0) + (att.wrongCount || 0));
    b.xpEarned += Math.max(0, att.xpEarned || 0);
    if (isAttemptComplete(att)) {
      b.testsCompleted += 1;
    }
  }

  for (const log of params.sessionLogs) {
    const ms = log.lastActiveAtMs || log.loginAtMs;
    if (!ms || ms <= 0) continue;
    const key = toLocalDateKey(ms);
    const b = ensureBucket(key);
    b.studySec = Math.max(b.studySec, Math.max(0, log.activeDurationSec || 0));
    b.questionsSolved = Math.max(b.questionsSolved, Math.max(0, log.questionsAttempted || 0));
  }

  const days: StudyHeatmapDay[] = [];
  let totalStudyMinutes = 0;
  let totalQuestionsSolved = 0;

  for (let i = safeDaysCount - 1; i >= 0; i -= 1) {
    const dt = addDaysLocal(now, -i);
    const key = toLocalDateKey(dt);
    const bucket = dayMap.get(key);
    const studyMinutes = bucket ? Math.round(bucket.studySec / 60) : 0;
    const questionsSolved = bucket ? bucket.questionsSolved : 0;
    const testsCompleted = bucket ? bucket.testsCompleted : 0;
    const xpEarned = bucket ? Math.round(bucket.xpEarned) : 0;

    totalStudyMinutes += studyMinutes;
    totalQuestionsSolved += questionsSolved;

    const activityScore = studyMinutes + questionsSolved * 0.8 + testsCompleted * 15;
    let intensity: 0 | 1 | 2 | 3 | 4 = 0;
    if (activityScore >= 85) intensity = 4;
    else if (activityScore >= 50) intensity = 3;
    else if (activityScore >= 20) intensity = 2;
    else if (activityScore > 0) intensity = 1;

    days.push({
      dateKey: key,
      label: dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      studyMinutes,
      questionsSolved,
      testsCompleted,
      xpEarned,
      intensity,
    });
  }

  const weeks: StudyHeatmapDay[][] = [];
  for (let idx = 0; idx < days.length; idx += 7) {
    weeks.push(days.slice(idx, idx + 7));
  }

  const streak = computeStudyStreak(params.attempts, params.sessionLogs, now);

  return {
    days,
    weeks,
    currentStreakDays: streak.currentStreakDays,
    bestStreakDays: streak.bestStreakDays,
    totalActiveDays: streak.totalActiveDays,
    totalStudyMinutes,
    totalQuestionsSolved,
  };
}

// --- Question-Wise Time-Spent Analytics ---

export const SUBJECT_TARGET_PACE_SEC: Record<SubjectKey, number> = {
  ga: 20,
  english: 25,
  reasoning: 40,
  quant: 50,
};

export interface QuestionTimePoint {
  index: number;
  questionNumber: number;
  questionId: string;
  subject: SubjectKey;
  topic: string;
  timeSpentSec: number;
  targetPaceSec: number;
  deltaSec: number;
  status: 'correct' | 'wrong' | 'skipped';
  paceBand: 'fast' | 'optimal' | 'slow' | 'time_sink';
}

export interface QuestionTimeSeriesSummary {
  points: QuestionTimePoint[];
  avgTimeSec: number;
  maxTimeSec: number;
  slowestQuestionNumber: number | null;
  timeSinksCount: number;
  wastedTimeOnWrongSec: number;
}

export function buildQuestionTimeSeries(
  items: Array<{
    questionId: string;
    subject: SubjectKey;
    topic?: string;
    timeSpentSec: number;
    selectedIndex: number;
    isCorrect: boolean;
  }>
): QuestionTimeSeriesSummary {
  const points: QuestionTimePoint[] = items.map((item, idx) => {
    const safeSec = Math.max(0, Math.round(item.timeSpentSec || 0));
    const targetPaceSec = SUBJECT_TARGET_PACE_SEC[item.subject] ?? 35;
    const status: QuestionTimePoint['status'] =
      item.selectedIndex < 0 || item.selectedIndex > 3
        ? 'skipped'
        : item.isCorrect
          ? 'correct'
          : 'wrong';

    let paceBand: QuestionTimePoint['paceBand'] = 'optimal';
    if (safeSec <= targetPaceSec * 0.65) paceBand = 'fast';
    else if (safeSec <= targetPaceSec * 1.15) paceBand = 'optimal';
    else if (safeSec <= targetPaceSec * 1.6) paceBand = 'slow';
    else paceBand = 'time_sink';

    return {
      index: idx,
      questionNumber: idx + 1,
      questionId: item.questionId,
      subject: item.subject,
      topic: item.topic || SUBJECT_LABELS[item.subject]?.short || 'General',
      timeSpentSec: safeSec,
      targetPaceSec,
      deltaSec: safeSec - targetPaceSec,
      status,
      paceBand,
    };
  });

  const totalSec = points.reduce((s, p) => s + p.timeSpentSec, 0);
  const avgTimeSec = points.length > 0 ? Math.round((totalSec / points.length) * 10) / 10 : 0;
  let maxTimeSec = 0;
  let slowestQuestionNumber: number | null = null;
  let timeSinksCount = 0;
  let wastedTimeOnWrongSec = 0;

  for (const p of points) {
    if (p.timeSpentSec > maxTimeSec) {
      maxTimeSec = p.timeSpentSec;
      slowestQuestionNumber = p.questionNumber;
    }
    if (p.paceBand === 'time_sink') {
      timeSinksCount += 1;
    }
    if (p.status === 'wrong') {
      wastedTimeOnWrongSec += p.timeSpentSec;
    }
  }

  return {
    points,
    avgTimeSec,
    maxTimeSec,
    slowestQuestionNumber,
    timeSinksCount,
    wastedTimeOnWrongSec,
  };
}

// --- Smart Revision Vault 2.0: Micro-Topic Clustering & Adaptive Mini-Mocks ---

const SUBTOPIC_RULES: Array<{ pattern: RegExp; buildLabel: (match: RegExpMatchArray) => string }> = [
  {
    pattern: /\barticle\s+(\d{1,3}[A-Z]?)\b/i,
    buildLabel: (m) => `Article ${m[1].toUpperCase()}`,
  },
  {
    pattern: /\b(\d{1,3})(?:st|nd|rd|th)\s+amendment\b/i,
    buildLabel: (m) => `${m[1]}th Amendment`,
  },
  { pattern: /\bfundamental rights?\b/i, buildLabel: () => 'Fundamental Rights' },
  { pattern: /\bdpsp|directive principles?\b/i, buildLabel: () => 'DPSP' },
  { pattern: /\btrigonometr|sin\b|cos\b|tan\b|cot\b|sec\b/i, buildLabel: () => 'Trigonometry Identities' },
  { pattern: /\bcircle|chord|tangent|cyclic\b/i, buildLabel: () => 'Circle & Tangents' },
  { pattern: /\btriangle|congruen|similar|incentre|circumcentre\b/i, buildLabel: () => 'Triangles & Centres' },
  { pattern: /\bprofit|loss|discount|marked price\b/i, buildLabel: () => 'Profit, Loss & Discount' },
  { pattern: /\bsimple interest|compound interest|\bsi\b|\bci\b/i, buildLabel: () => 'SI & CI' },
  { pattern: /\bsyllogism\b/i, buildLabel: () => 'Syllogism' },
  { pattern: /\bidioms?\s*(?:&|and)?\s*phrases?\b/i, buildLabel: () => 'Idioms & Phrases' },
  { pattern: /\bone[- ]word\b/i, buildLabel: () => 'One-Word Substitution' },
  { pattern: /\bactive|passive|voice\b/i, buildLabel: () => 'Active & Passive Voice' },
  { pattern: /\bnarration|direct|indirect\b/i, buildLabel: () => 'Narration' },
  { pattern: /\bvitamin/i, buildLabel: () => 'Vitamins & Deficiency' },
  { pattern: /\briver|tributary|ganga|brahmaputra|indus|godavari\b/i, buildLabel: () => 'Rivers & Drainage' },
  { pattern: /\bfive[- ]year plan|rbi|monetary policy|fiscal\b/i, buildLabel: () => 'Monetary & Fiscal Policy' },
];

export function resolveMicroTopicLabel(
  question?: Pick<QuestionDoc, 'subject' | 'topic' | 'questionEn'> | null,
  fallbackSubject: SubjectKey = 'quant'
): string {
  const subject = question?.subject ?? fallbackSubject;
  const rawTopic = (question?.topic || '').trim();
  const chapter = rawTopic ? resolveSyllabusChapter(rawTopic, subject) : null;
  const baseChapter = chapter?.title || rawTopic || SUBJECT_LABELS[subject]?.short || 'General';

  const searchText = `${rawTopic} ${question?.questionEn || ''}`;
  for (const rule of SUBTOPIC_RULES) {
    const match = searchText.match(rule.pattern);
    if (match) {
      const subLabel = rule.buildLabel(match);
      if (subLabel.toLowerCase() === baseChapter.toLowerCase()) {
        return `${SUBJECT_LABELS[subject].short} - ${baseChapter}`;
      }
      // Special high-clarity GA anchors like "Polity - Article 32"
      if (chapter?.title?.startsWith('Polity')) {
        return `Polity - ${subLabel}`;
      }
      if (chapter?.title?.startsWith('History')) {
        return `History - ${subLabel}`;
      }
      if (chapter?.title?.startsWith('Geography')) {
        return `Geography - ${subLabel}`;
      }
      if (chapter?.title?.startsWith('Biology')) {
        return `Biology - ${subLabel}`;
      }
      if (chapter?.title?.startsWith('Economy')) {
        return `Economy - ${subLabel}`;
      }
      return `${baseChapter} - ${subLabel}`;
    }
  }

  const subjectShort = SUBJECT_LABELS[subject]?.short || 'General';
  if (baseChapter.toLowerCase() === subjectShort.toLowerCase()) {
    return `${subjectShort} - General Practice`;
  }
  return `${subjectShort} - ${baseChapter}`;
}

export interface RevisionMicroTopicCluster {
  microTopic: string;
  subject: SubjectKey;
  totalCount: number;
  pendingCount: number;
  wrongCount: number;
  skippedCount: number;
  masteredCount: number;
  questionIds: string[];
  pendingQuestionIds: string[];
  urgencyScore: number;
}

export function buildRevisionMicroTopicClusters(params: {
  revisionItems: RevisionItemDoc[];
  questionsMap: Record<string, QuestionDoc>;
}): RevisionMicroTopicCluster[] {
  const map = new Map<string, RevisionMicroTopicCluster>();

  for (const item of params.revisionItems) {
    const q = params.questionsMap[item.questionId];
    const microTopic = resolveMicroTopicLabel(q, item.subject);
    const key = `${item.subject}::${microTopic.toLowerCase()}`;

    const existing = map.get(key) ?? {
      microTopic,
      subject: item.subject,
      totalCount: 0,
      pendingCount: 0,
      wrongCount: 0,
      skippedCount: 0,
      masteredCount: 0,
      questionIds: [],
      pendingQuestionIds: [],
      urgencyScore: 0,
    };

    existing.totalCount += 1;
    existing.questionIds.push(item.questionId);
    if (item.mastered) {
      existing.masteredCount += 1;
    } else {
      existing.pendingCount += 1;
      existing.pendingQuestionIds.push(item.questionId);
      if (item.lastSelectedIndex === -1) {
        existing.skippedCount += 1;
      } else {
        existing.wrongCount += 1;
      }
    }
    existing.urgencyScore = existing.wrongCount * 3 + existing.skippedCount * 1.5;
    map.set(key, existing);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
    return b.pendingCount - a.pendingCount;
  });
}

export function selectAdaptiveMicroTopicMockQuestions(params: {
  cluster: RevisionMicroTopicCluster;
  allQuestions: QuestionDoc[];
  targetCount?: number;
}): string[] {
  const limit = Math.max(3, Math.min(30, params.targetCount ?? 10));
  const validIds = new Set(params.allQuestions.map((q) => q.id));
  const chosen: string[] = [];
  const chosenSet = new Set<string>();

  for (const qid of params.cluster.pendingQuestionIds) {
    if (chosen.length >= limit) break;
    if (validIds.has(qid) && !chosenSet.has(qid)) {
      chosen.push(qid);
      chosenSet.add(qid);
    }
  }

  // Top up with unseen questions sharing the same micro-topic or subject
  const sameMicro = params.allQuestions.filter((q) => {
    if (chosenSet.has(q.id) || q.subject !== params.cluster.subject) return false;
    return resolveMicroTopicLabel(q, q.subject) === params.cluster.microTopic;
  });
  for (const q of sameMicro) {
    if (chosen.length >= limit) break;
    chosen.push(q.id);
    chosenSet.add(q.id);
  }

  const sameSubject = params.allQuestions.filter(
    (q) => !chosenSet.has(q.id) && q.subject === params.cluster.subject
  );
  for (const q of sameSubject) {
    if (chosen.length >= limit) break;
    chosen.push(q.id);
    chosenSet.add(q.id);
  }

  return chosen;
}

// --- Gamification 2.0: Achievement Badges & Speed × Accuracy Dynamic Rank ---

export interface AchievementBadge {
  id: string;
  title: string;
  description: string;
  category: 'mastery' | 'speed' | 'discipline' | 'milestone';
  unlocked: boolean;
  progressLabel: string;
  progressPercent: number;
}

export interface DynamicEfficiencyRank {
  efficiencyScore: number; // 0 to 100
  rankTitle: string;
  tierCode: string;
  quadrant: 'Sniper' | 'Turbo Scorer' | 'Steady Builder' | 'Calibrating';
  estimatedPercentile: number;
  avgAccuracy: number;
  avgSecPerQuestion: number;
  xpMomentum: number;
}

export function computeAchievementBadges(params: {
  attempts: TestAttemptDoc[];
  revisionItems: RevisionItemDoc[];
  sessionLogs: StudentSessionLogDoc[];
  now?: Date;
}): AchievementBadge[] {
  const qualifying = params.attempts.filter((a) => isAttemptComplete(a));
  const streak = computeStudyStreak(params.attempts, params.sessionLogs, params.now ?? new Date());

  const subjStats: Record<SubjectKey, { correct: number; attempted: number }> = {
    quant: { correct: 0, attempted: 0 },
    reasoning: { correct: 0, attempted: 0 },
    english: { correct: 0, attempted: 0 },
    ga: { correct: 0, attempted: 0 },
  };

  let bestSpeedMockOk = false;
  let zeroNegativeUnlocked = false;
  let bestFullMock200 = 0;

  for (const att of qualifying) {
    const solved = (att.correctCount || 0) + (att.wrongCount || 0);
    const secPerQ = solved > 0 ? att.totalTimeSec / solved : 999;
    if (solved >= 10 && secPerQ <= 30 && att.accuracy >= 75) {
      bestSpeedMockOk = true;
    }
    if (solved >= 8 && att.wrongCount === 0) {
      zeroNegativeUnlocked = true;
    }
    if (att.subjectScope === 'full' && att.maxScore > 0) {
      const scaled = (att.score / att.maxScore) * 200;
      if (scaled > bestFullMock200) bestFullMock200 = scaled;
    }

    if (att.sectionStats) {
      (['quant', 'reasoning', 'english', 'ga'] as SubjectKey[]).forEach((sub) => {
        const st = att.sectionStats?.[sub];
        if (!st) return;
        subjStats[sub].correct += Math.max(0, st.correct || 0);
        subjStats[sub].attempted += Math.max(0, (st.correct || 0) + (st.wrong || 0));
      });
    }
  }

  const masteredVaultCount = params.revisionItems.filter((r) => r.mastered).length;

  const subjectBadge = (
    id: string,
    title: string,
    sub: SubjectKey,
    targetAcc: number,
    minQ: number
  ): AchievementBadge => {
    const st = subjStats[sub];
    const acc = st.attempted > 0 ? Math.round((st.correct / st.attempted) * 100) : 0;
    const unlocked = st.attempted >= minQ && acc >= targetAcc;
    const volPct = Math.min(100, Math.round((st.attempted / minQ) * 100));
    const accPct = Math.min(100, Math.round((acc / targetAcc) * 100));
    return {
      id,
      title,
      description: `Maintain >=${targetAcc}% accuracy across ${minQ}+ ${SUBJECT_LABELS[sub].short} questions`,
      category: 'mastery',
      unlocked,
      progressLabel: `${acc}% acc · ${st.attempted}/${minQ} Qs`,
      progressPercent: unlocked ? 100 : Math.round((volPct + accPct) / 2),
    };
  };

  return [
    {
      id: 'first_blood',
      title: 'Arena Debut',
      description: 'Complete at least 1 qualifying test (>80% attempted)',
      category: 'milestone',
      unlocked: qualifying.length >= 1,
      progressLabel: `${Math.min(1, qualifying.length)}/1 mock`,
      progressPercent: qualifying.length >= 1 ? 100 : 0,
    },
    subjectBadge('quant_master', 'Quant Master', 'quant', 85, 15),
    subjectBadge('reasoning_ace', 'Reasoning Ace', 'reasoning', 88, 15),
    subjectBadge('english_scholar', 'English Virtuoso', 'english', 85, 15),
    subjectBadge('gk_sentinel', 'GK Sentinel', 'ga', 80, 15),
    {
      id: 'speed_demon',
      title: 'Speed Demon',
      description: 'Solve a >=10Q test at <=30s/Q with >=75% accuracy',
      category: 'speed',
      unlocked: bestSpeedMockOk,
      progressLabel: bestSpeedMockOk ? 'Unlocked' : 'Target <=30s/Q & >=75%',
      progressPercent: bestSpeedMockOk ? 100 : 25,
    },
    {
      id: 'zero_negative_hero',
      title: 'Zero Negative Hero',
      description: 'Finish an >=8Q qualifying test with 0 negative marks',
      category: 'discipline',
      unlocked: zeroNegativeUnlocked,
      progressLabel: zeroNegativeUnlocked ? 'Zero Errors!' : '0 wrong needed',
      progressPercent: zeroNegativeUnlocked ? 100 : 20,
    },
    {
      id: 'streak_warrior',
      title: '7-Day Streak Warrior',
      description: 'Maintain an active study streak for 7 consecutive days',
      category: 'discipline',
      unlocked: streak.bestStreakDays >= 7,
      progressLabel: `${Math.min(7, streak.bestStreakDays)}/7 best days`,
      progressPercent: Math.min(100, Math.round((streak.bestStreakDays / 7) * 100)),
    },
    {
      id: 'vault_cleaner',
      title: 'Vault Alchemist',
      description: 'Resolve & master 10 Revision Vault mistake items',
      category: 'mastery',
      unlocked: masteredVaultCount >= 10,
      progressLabel: `${Math.min(10, masteredVaultCount)}/10 mastered`,
      progressPercent: Math.min(100, Math.round((masteredVaultCount / 10) * 100)),
    },
    {
      id: 'tier1_inspector',
      title: 'Inspector Cut-Off Breaker',
      description: 'Score >=150/200 scaled marks in any Full SSC CGL Mock',
      category: 'milestone',
      unlocked: bestFullMock200 >= 150,
      progressLabel: `${Math.round(bestFullMock200)}/150 marks`,
      progressPercent: Math.min(100, Math.round((bestFullMock200 / 150) * 100)),
    },
  ];
}

export function computeDynamicEfficiencyRank(params: {
  attempts: TestAttemptDoc[];
  totalXp: number;
}): DynamicEfficiencyRank {
  const qualifying = params.attempts.filter((a) => isAttemptComplete(a));
  if (qualifying.length === 0) {
    return {
      efficiencyScore: 0,
      rankTitle: 'Cadet Aspirant',
      tierCode: 'C-0',
      quadrant: 'Calibrating',
      estimatedPercentile: 0,
      avgAccuracy: 0,
      avgSecPerQuestion: 0,
      xpMomentum: Math.max(0, Math.round(params.totalXp)),
    };
  }

  let totalSolved = 0;
  let totalCorrect = 0;
  let totalTime = 0;

  for (const att of qualifying) {
    const solved = Math.max(0, (att.correctCount || 0) + (att.wrongCount || 0));
    totalSolved += solved;
    totalCorrect += Math.max(0, att.correctCount || 0);
    totalTime += Math.max(0, att.totalTimeSec || 0);
  }

  const avgAccuracy =
    totalSolved > 0 ? Math.round((totalCorrect / totalSolved) * 1000) / 10 : 0;
  const avgSecPerQuestion =
    totalSolved > 0 ? Math.round((totalTime / totalSolved) * 10) / 10 : 60;

  // Accuracy contribution: up to 45 pts
  const accuracyFactor = Math.min(45, (avgAccuracy / 100) * 45);
  // Speed contribution: optimal <= 25s gives full 30 pts, 90s+ gives ~4 pts
  const clampedSec = Math.max(15, Math.min(100, avgSecPerQuestion));
  const speedFactor = Math.max(3, Math.min(30, ((100 - clampedSec) / 75) * 30));
  // Momentum / consistency contribution: up to 25 pts
  const momentumFactor = Math.min(
    25,
    (Math.min(20, qualifying.length) / 20) * 15 + (Math.min(1000, params.totalXp) / 1000) * 10
  );

  const efficiencyScore = Math.round(Math.min(100, accuracyFactor + speedFactor + momentumFactor));
  const estimatedPercentile = Math.min(
    99.9,
    Math.round((Math.pow(efficiencyScore / 100, 0.85) * 99) * 10) / 10
  );

  let quadrant: DynamicEfficiencyRank['quadrant'] = 'Steady Builder';
  if (avgAccuracy >= 82 && avgSecPerQuestion <= 38) quadrant = 'Sniper';
  else if (avgAccuracy >= 72 && avgSecPerQuestion <= 34) quadrant = 'Turbo Scorer';
  else if (qualifying.length < 2) quadrant = 'Calibrating';

  let rankTitle = 'Probationer';
  let tierCode = 'T-1';
  if (efficiencyScore >= 86) {
    rankTitle = 'MEA / CSS Top 100';
    tierCode = 'S-TIER';
  } else if (efficiencyScore >= 74) {
    rankTitle = 'Inspector Grade';
    tierCode = 'A-TIER';
  } else if (efficiencyScore >= 60) {
    rankTitle = 'ASO Contender';
    tierCode = 'B-TIER';
  } else if (efficiencyScore >= 42) {
    rankTitle = 'Tax Assistant Pace';
    tierCode = 'C-TIER';
  }

  return {
    efficiencyScore,
    rankTitle,
    tierCode,
    quadrant,
    estimatedPercentile,
    avgAccuracy,
    avgSecPerQuestion,
    xpMomentum: Math.max(0, Math.round(params.totalXp)),
  };
}
