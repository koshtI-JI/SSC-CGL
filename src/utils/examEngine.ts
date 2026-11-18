import type {
  CohortTaskDoc,
  LeaderboardEntry,
  MockTestDoc,
  PaletteStatus,
  QuestionDoc,
  QuestionResponseState,
  RevisionItemDoc,
  ScoringConfig,
  SectionStatsMap,
  StudentActivitySummary,
  StudentPresenceDoc,
  StudentSessionLogDoc,
  SubjectKey,
  SubjectStudySummary,
  SupportTicketDoc,
  TestAttemptDoc,
  TestDraftDoc,
} from '../types/exam';

export function loginIdToKey(loginId: string): string {
  const key = loginId.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
  return key.length > 0 ? key.slice(0, 128) : 'invalid_id';
}

export function emailToInviteKey(email: string): string {
  return loginIdToKey(email);
}

export function getPaletteStatus(state: QuestionResponseState | undefined): PaletteStatus {
  if (!state || !state.visited) return 'not_visited';
  const hasAnswer = state.selectedIndex >= 0 && state.selectedIndex <= 3;
  if (hasAnswer && state.markedForReview) return 'answered_marked';
  if (hasAnswer) return 'answered';
  if (state.markedForReview) return 'marked';
  return 'not_answered';
}

export const MIN_COMPLETE_ATTEMPT_RATIO = 0.8;

export function toLocalDateKey(input: Date | number = new Date()): string {
  const d = input instanceof Date ? input : new Date(input);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getMinQuestionsForXp(totalQuestions: number): number {
  if (totalQuestions <= 0) return 0;
  // Strictly > 80% of questions attempted (e.g., 9/10, 5/5, 21/25, 81/100)
  return Math.floor((totalQuestions * 8) / 10) + 1;
}

export function isAttemptComplete(
  attempt: Pick<TestAttemptDoc, 'correctCount' | 'wrongCount' | 'skippedCount'>
): boolean {
  const attempted = Math.max(0, attempt.correctCount + attempt.wrongCount);
  const total = attempted + Math.max(0, attempt.skippedCount);
  return total > 0 && attempted * 10 > total * 8;
}

export function getAttemptCompletionPercent(
  attempt: Pick<TestAttemptDoc, 'correctCount' | 'wrongCount' | 'skippedCount'>
): number {
  const attempted = Math.max(0, attempt.correctCount + attempt.wrongCount);
  const total = attempted + Math.max(0, attempt.skippedCount);
  return total > 0 ? Math.round((attempted / total) * 100) : 0;
}

export function getAttemptStatusLabel(
  attempt: Pick<TestAttemptDoc, 'correctCount' | 'wrongCount' | 'skippedCount'>
): 'Pending (<=80%)' | 'Completed · Partial' | '100% Complete' {
  if (!isAttemptComplete(attempt)) return 'Pending (<=80%)';
  if (Math.max(0, attempt.skippedCount) > 0) return 'Completed · Partial';
  return '100% Complete';
}

export function formatWelcomeTitle(
  targetPost: string | undefined,
  displayName: string | undefined
): string {
  const cleanPost = (targetPost || '').trim();
  const cleanName = (displayName || 'Aspirant').trim();
  return cleanPost ? `Welcome back, ${cleanPost} ${cleanName}` : `Welcome back, ${cleanName}`;
}

export function isTaskExpired(task: Pick<CohortTaskDoc, 'dueDate'>, now: Date = new Date()): boolean {
  if (!task.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)) return false;
  return toLocalDateKey(now) > task.dueDate;
}

export interface CalculatedTestOutcome {
  score: number;
  maxScore: number;
  accuracy: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  effectiveWrongCount: number;
  marksLostUnanswered: number;
  attemptedCount: number;
  totalQuestions: number;
  completionPercent: number;
  isComplete: boolean;
  isRepeatAttempt: boolean;
  totalTimeSec: number;
  baseXp: number;
  activityMultiplier: number;
  xpEarned: number;
  sectionStats: SectionStatsMap;
  wrongItems: Array<{
    questionId: string;
    subject: SubjectKey;
    lastSelectedIndex: number;
  }>;
  skippedItems: Array<{
    questionId: string;
    subject: SubjectKey;
    lastSelectedIndex: number;
  }>;
  perQuestionResults: Array<{
    questionId: string;
    selectedIndex: number;
    isCorrect: boolean;
    timeSpentSec: number;
    markedForReview: boolean;
  }>;
}

export function applyActivityMultiplier(baseXp: number, multiplier: number): number {
  if (baseXp <= 0) return 0;
  const safeMult = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.max(1, Math.round(baseXp * safeMult));
}

export function calculateTestOutcome(
  questions: QuestionDoc[],
  responsesById: Record<string, QuestionResponseState>,
  test: Pick<MockTestDoc, 'positiveMarks' | 'negativeMarks'>,
  scoring: ScoringConfig,
  activityMultiplier: number = 1,
  options?: { isRepeatAttempt?: boolean }
): CalculatedTestOutcome {
  const pos = Number.isFinite(test.positiveMarks) ? test.positiveMarks : scoring.pointsPerCorrect;
  const neg = Number.isFinite(test.negativeMarks) ? test.negativeMarks : scoring.negativeMarks;
  const isRepeatAttempt = Boolean(options?.isRepeatAttempt);

  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;
  let totalTimeSec = 0;
  const sectionStats: SectionStatsMap = {};
  const wrongItems: CalculatedTestOutcome['wrongItems'] = [];
  const skippedItems: CalculatedTestOutcome['skippedItems'] = [];
  const perQuestionResults: CalculatedTestOutcome['perQuestionResults'] = [];

  for (const q of questions) {
    const resp = responsesById[q.id];
    const visited = resp ? Boolean(resp.visited) : false;
    const selectedIndex = resp ? resp.selectedIndex : -1;
    const timeSpentSec = resp ? Math.max(0, Math.round(resp.timeSpentSec)) : 0;
    const markedForReview = resp ? Boolean(resp.markedForReview) : false;

    totalTimeSec += timeSpentSec;

    if (!sectionStats[q.subject]) {
      sectionStats[q.subject] = { correct: 0, wrong: 0, skipped: 0, timeSec: 0 };
    }
    const sec = sectionStats[q.subject]!;
    sec.timeSec += timeSpentSec;

    let isCorrect = false;
    if (selectedIndex < 0 || selectedIndex > 3) {
      skippedCount += 1;
      sec.skipped += 1;
      // Only file skipped questions the student actually opened/visited (avoid dumping unseen questions on early exit)
      if (visited) {
        skippedItems.push({
          questionId: q.id,
          subject: q.subject,
          lastSelectedIndex: -1,
        });
      }
    } else if (selectedIndex === q.correctIndex) {
      correctCount += 1;
      sec.correct += 1;
      isCorrect = true;
    } else {
      wrongCount += 1;
      sec.wrong += 1;
      wrongItems.push({
        questionId: q.id,
        subject: q.subject,
        lastSelectedIndex: selectedIndex,
      });
    }

    perQuestionResults.push({
      questionId: q.id,
      selectedIndex,
      isCorrect,
      timeSpentSec,
      markedForReview,
    });
  }

  const clampedSectionStats: SectionStatsMap = {};
  for (const [k, st] of Object.entries(sectionStats) as Array<[SubjectKey, { correct: number; wrong: number; skipped: number; timeSec: number }]>) {
    clampedSectionStats[k] = {
      correct: Math.min(100, st.correct),
      wrong: Math.min(100, st.wrong),
      skipped: Math.min(100, st.skipped),
      timeSec: Math.min(20000, st.timeSec),
    };
  }
  const safeTotalTimeSec = Math.max(0, Math.min(30000, totalTimeSec));

  // Unanswered questions receive 0 negative penalty (no -neg deduction), only missing out on +pos marks
  const rawScore = correctCount * pos - wrongCount * neg;
  const score = Math.max(-200, Math.min(1000, Math.round(rawScore * 100) / 100));
  const maxScore = Math.max(0, Math.min(1000, Math.round(questions.length * pos * 100) / 100));
  const attempted = correctCount + wrongCount;
  const totalQuestions = questions.length;
  const completionPercent = totalQuestions > 0 ? Math.round((attempted / totalQuestions) * 100) : 0;
  const isComplete = totalQuestions > 0 && attempted * 10 > totalQuestions * 8;
  const accuracy = attempted > 0 ? Math.round((correctCount / attempted) * 1000) / 10 : 0;
  const effectiveWrongCount = wrongCount + skippedCount;
  const marksLostUnanswered = Math.round(skippedCount * pos * 100) / 100;

  // When a student completes a valid test (>80%), ALL unanswered questions are also filed into Revision Vault
  // so missed concepts are practiced again; on <=80% early exits, keep visited-only guard.
  const finalSkippedItems: CalculatedTestOutcome['skippedItems'] = isComplete
    ? questions
        .filter((q) => {
          const resp = responsesById[q.id];
          const sel = resp ? resp.selectedIndex : -1;
          return sel < 0 || sel > 3;
        })
        .map((q) => ({
          questionId: q.id,
          subject: q.subject,
          lastSelectedIndex: -1,
        }))
    : skippedItems;

  let baseXp = 0;
  if (isComplete && !isRepeatAttempt) {
    baseXp = scoring.xpAttemptBase + correctCount * scoring.xpPerCorrect;
    if (attempted > 0 && accuracy >= scoring.xpAccuracyThreshold) {
      baseXp += scoring.xpAccuracyBonus;
    }
    baseXp = Math.max(0, Math.round(baseXp));
  }
  const safeMult = Number.isFinite(activityMultiplier) && activityMultiplier > 0 ? activityMultiplier : 1;
  const xpEarned = baseXp > 0 ? Math.min(5000, applyActivityMultiplier(baseXp, safeMult)) : 0;

  return {
    score,
    maxScore,
    accuracy,
    correctCount,
    wrongCount,
    skippedCount,
    effectiveWrongCount,
    marksLostUnanswered,
    attemptedCount: attempted,
    totalQuestions,
    completionPercent,
    isComplete,
    isRepeatAttempt,
    totalTimeSec: safeTotalTimeSec,
    baseXp,
    activityMultiplier: safeMult,
    xpEarned,
    sectionStats: clampedSectionStats,
    wrongItems,
    skippedItems: finalSkippedItems,
    perQuestionResults,
  };
}

export function rankLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.totalXp !== a.totalXp) return b.totalXp - a.totalXp;
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    if (b.avgAccuracy !== a.avgAccuracy) return b.avgAccuracy - a.avgAccuracy;
    return b.testsAttempted - a.testsAttempted;
  });
}

export function computeUpdatedLeaderboardStats(
  current: Pick<LeaderboardEntry, 'totalXp' | 'testsAttempted' | 'bestScore' | 'avgAccuracy' | 'totalTimeSec'>,
  outcome: Pick<CalculatedTestOutcome, 'score' | 'accuracy' | 'totalTimeSec' | 'xpEarned'>
): Pick<LeaderboardEntry, 'totalXp' | 'testsAttempted' | 'bestScore' | 'avgAccuracy' | 'totalTimeSec'> {
  const nextAttempted = current.testsAttempted + 1;
  const nextAvgAccuracy =
    Math.round(((current.avgAccuracy * current.testsAttempted + outcome.accuracy) / nextAttempted) * 10) / 10;
  const nextBestScore = current.testsAttempted === 0 ? outcome.score : Math.max(current.bestScore, outcome.score);

  return {
    totalXp: current.totalXp + outcome.xpEarned,
    testsAttempted: nextAttempted,
    bestScore: nextBestScore,
    avgAccuracy: nextAvgAccuracy,
    totalTimeSec: current.totalTimeSec + outcome.totalTimeSec,
  };
}

function extractTimestampMs(raw: unknown): number | null {
  if (!raw) return null;
  if (typeof (raw as { toMillis?: () => number }).toMillis === 'function') {
    return (raw as { toMillis: () => number }).toMillis();
  }
  if (typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    return (raw as { toDate: () => Date }).toDate().getTime();
  }
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'string' || typeof raw === 'number') {
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export function computeTaskProgress(
  task: CohortTaskDoc,
  attempts: TestAttemptDoc[],
  now: Date = new Date()
): { completedCount: number; targetCount: number; percent: number; isEligible: boolean; isExpired: boolean } {
  const taskCreatedMs = extractTimestampMs(task.createdAt);
  const hasDueDate = Boolean(task.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate));
  const expired = isTaskExpired(task, now);
  const uniqueTestIds = new Set<string>();

  for (const a of attempts) {
    // 1. Ignore incomplete / pending (<80% attempted) submissions
    if (!isAttemptComplete(a)) continue;
    // 2. Ignore ephemeral practice / Revision Vault drills (must be published/daily cohort mocks)
    if (a.testId.startsWith('prac_')) continue;

    // 3. Subject qualification check
    const matchesSubject =
      task.targetSubject === 'all' ||
      a.subjectScope === task.targetSubject ||
      Boolean(
        a.sectionStats?.[task.targetSubject] &&
          a.sectionStats[task.targetSubject]!.correct +
            a.sectionStats[task.targetSubject]!.wrong +
            a.sectionStats[task.targetSubject]!.skipped >
            0
      );
    if (!matchesSubject) continue;

    // 4. Time window: ignore attempts before task creation (if timestamp present) or after dueDate
    const attemptMs = extractTimestampMs(a.createdAt);
    if (taskCreatedMs && attemptMs && attemptMs < taskCreatedMs - 5 * 60_000) {
      continue;
    }
    if (hasDueDate && attemptMs && toLocalDateKey(attemptMs) > task.dueDate) {
      continue;
    }

    // 5. Deduplicate by testId so repeating the same mock 3 times counts only once
    uniqueTestIds.add(a.testId);
  }

  const completedCount = uniqueTestIds.size;
  const targetCount = Math.max(1, task.targetTests);
  const percent = Math.min(100, Math.round((completedCount / targetCount) * 100));
  return {
    completedCount,
    targetCount,
    percent,
    isEligible: !expired && completedCount >= targetCount,
    isExpired: expired,
  };
}

const SUBJECT_PREFIX_HINT: Record<SubjectKey, string> = {
  quant: '_quant_',
  reasoning: '_reas_',
  english: '_eng_',
  ga: '_ga_',
};

export function doesTestQualifyForTask(task: CohortTaskDoc, test: MockTestDoc): boolean {
  if (task.targetSubject === 'all') return true;
  if (test.subjectScope === task.targetSubject) return true;
  if (test.subjectScope !== 'full') return false;

  const hint = SUBJECT_PREFIX_HINT[task.targetSubject];
  const hasStarterPrefix = test.questionIds.some(
    (id) =>
      id.includes('_quant_') ||
      id.includes('_reas_') ||
      id.includes('_eng_') ||
      id.includes('_ga_')
  );
  if (hasStarterPrefix) {
    return test.questionIds.some((id) => id.includes(hint));
  }
  return true;
}

export function getQualifyingTestsForTask(
  task: CohortTaskDoc,
  tests: MockTestDoc[]
): MockTestDoc[] {
  const qualifying = tests.filter((t) => doesTestQualifyForTask(task, t));
  if (task.targetSubject === 'all') return qualifying;
  // Prioritize direct subject-specific drills first, then full/combined mocks
  return [...qualifying].sort((a, b) => {
    const aDirect = a.subjectScope === task.targetSubject ? 0 : 1;
    const bDirect = b.subjectScope === task.targetSubject ? 0 : 1;
    return aDirect - bDirect;
  });
}

export interface DailyProgressPoint {
  dateKey: string;
  label: string;
  attempts: number;
  avgAccuracy: number;
  avgScorePercent: number;
}

export function computeWeeklyProgressSeries(
  attempts: TestAttemptDoc[],
  now: Date = new Date()
): DailyProgressPoint[] {
  const days: DailyProgressPoint[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - offset);
    const key = toLocalDateKey(d);
    const label = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
    days.push({
      dateKey: key,
      label,
      attempts: 0,
      avgAccuracy: 0,
      avgScorePercent: 0,
    });
  }

  const buckets = new Map<string, TestAttemptDoc[]>();
  for (const a of attempts) {
    if (!isAttemptComplete(a)) continue;
    const ms = extractTimestampMs(a.createdAt);
    if (!ms) continue;
    const key = toLocalDateKey(ms);
    const list = buckets.get(key) ?? [];
    list.push(a);
    buckets.set(key, list);
  }

  return days.map((day) => {
    const list = buckets.get(day.dateKey);
    if (!list || list.length === 0) return day;
    const avgAcc = list.reduce((sum, x) => sum + x.accuracy, 0) / list.length;
    const avgScorePct =
      list.reduce((sum, x) => sum + (x.maxScore > 0 ? Math.max(0, (x.score / x.maxScore) * 100) : 0), 0) /
      list.length;
    return {
      ...day,
      attempts: list.length,
      avgAccuracy: Math.round(avgAcc * 10) / 10,
      avgScorePercent: Math.round(avgScorePct * 10) / 10,
    };
  });
}

export function formatSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function isPresenceOnline(
  presence: Pick<StudentPresenceDoc, 'status' | 'lastSeenMs'> | undefined,
  nowMs: number = Date.now(),
  staleThresholdMs: number = 35_000
): boolean {
  if (!presence) return false;
  if (presence.status === 'offline') return false;
  return nowMs - presence.lastSeenMs <= staleThresholdMs;
}

export function isSessionLogLive(
  sess: Pick<StudentSessionLogDoc, 'status' | 'lastActiveAtMs'> | undefined,
  nowMs: number = Date.now(),
  staleThresholdMs: number = 65_000
): boolean {
  if (!sess) return false;
  if (sess.status !== 'active') return false;
  return nowMs - (sess.lastActiveAtMs || 0) <= staleThresholdMs;
}

export function formatLastSeen(lastSeenMs: number | undefined, nowMs: number = Date.now()): string {
  if (!lastSeenMs) return 'Never';
  const diffSec = Math.max(0, Math.floor((nowMs - lastSeenMs) / 1000));
  if (diffSec < 12) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function formatDateTimeShort(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '—';
  return new Date(ms).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function extractAttemptDateMs(a: TestAttemptDoc): number | null {
  if (a.createdAt && typeof (a.createdAt as { toMillis?: () => number }).toMillis === 'function') {
    return (a.createdAt as { toMillis: () => number }).toMillis();
  }
  if (a.createdAt && typeof (a.createdAt as { toDate?: () => Date }).toDate === 'function') {
    return (a.createdAt as { toDate: () => Date }).toDate().getTime();
  }
  if (a.createdAt instanceof Date) return a.createdAt.getTime();
  if (typeof a.createdAt === 'string' || typeof a.createdAt === 'number') {
    const t = new Date(a.createdAt).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export interface DailyActivityPoint extends DailyProgressPoint {
  studyMinutes: number;
  questionsSolved: number;
}

export interface LiveSessionOverride {
  sessionId?: string | null;
  activeDurationSec?: number;
}

function mergeSessionLogsWithLive(
  uid: string,
  sessionLogs: StudentSessionLogDoc[],
  nowMs: number,
  liveOverride?: LiveSessionOverride
): StudentSessionLogDoc[] {
  const stSessions = sessionLogs.filter((s) => s.uid === uid);
  const liveSec = Math.max(0, Math.round(liveOverride?.activeDurationSec ?? 0));
  if (!liveOverride || liveSec <= 0) return stSessions;

  const sid = liveOverride.sessionId;
  if (sid) {
    let found = false;
    const merged = stSessions.map((s) => {
      if (s.id !== sid) return s;
      found = true;
      return {
        ...s,
        activeDurationSec: Math.max(s.activeDurationSec, liveSec),
        lastActiveAtMs: Math.max(s.lastActiveAtMs, nowMs),
      };
    });
    if (found) return merged;
  }

  return [
    {
      id: sid || 'live_active_session',
      uid,
      displayName: '',
      loginId: '',
      status: 'active',
      loginAtMs: nowMs - liveSec * 1000,
      lastActiveAtMs: nowMs,
      logoutAtMs: 0,
      activeDurationSec: liveSec,
      testsCompleted: 0,
      questionsAttempted: 0,
      subjectsStudied: [],
      lastActivityTitle: 'Studying',
    },
    ...stSessions,
  ];
}

export function computeWeeklyActivitySeries(
  attempts: TestAttemptDoc[],
  sessionLogs: StudentSessionLogDoc[],
  now: Date = new Date(),
  liveOverride?: LiveSessionOverride
): DailyActivityPoint[] {
  const base = computeWeeklyProgressSeries(attempts, now);
  const attemptsByDate = new Map<string, TestAttemptDoc[]>();
  const studySecByDate = new Map<string, number>();

  for (const a of attempts) {
    const ms = extractAttemptDateMs(a);
    if (!ms) continue;
    const key = toLocalDateKey(ms);
    const list = attemptsByDate.get(key) ?? [];
    list.push(a);
    attemptsByDate.set(key, list);
  }

  const nowMs = now.getTime();
  const effectiveUid = sessionLogs[0]?.uid ?? attempts[0]?.uid ?? 'live_uid';
  const mergedSessions = liveOverride
    ? mergeSessionLogsWithLive(effectiveUid, sessionLogs, nowMs, liveOverride)
    : sessionLogs;

  for (const s of mergedSessions) {
    if (!s.loginAtMs) continue;
    const key = toLocalDateKey(s.loginAtMs);
    studySecByDate.set(key, (studySecByDate.get(key) ?? 0) + Math.max(0, s.activeDurationSec));
  }

  return base.map((day) => {
    const dayAttempts = attemptsByDate.get(day.dateKey) ?? [];
    const attemptStudySec = dayAttempts.reduce((acc, x) => acc + Math.max(0, x.totalTimeSec), 0);
    const sessionStudySec = studySecByDate.get(day.dateKey) ?? 0;
    const combinedSec = Math.max(attemptStudySec, sessionStudySec);
    const questionsSolved = dayAttempts.reduce(
      (acc, x) => acc + Math.max(0, x.correctCount + x.wrongCount),
      0
    );
    return {
      ...day,
      studyMinutes: Math.round((combinedSec / 60) * 10) / 10,
      questionsSolved,
    };
  });
}

export function computeStudentActivitySummary(
  uid: string,
  attempts: TestAttemptDoc[],
  sessionLogs: StudentSessionLogDoc[],
  nowMs: number = Date.now(),
  liveOverride?: LiveSessionOverride
): StudentActivitySummary {
  const studentAttempts = attempts.filter((a) => a.uid === uid);
  const studentSessions = mergeSessionLogsWithLive(uid, sessionLogs, nowMs, liveOverride);

  const sessionStudySec = studentSessions.reduce(
    (sum, s) => sum + Math.max(0, s.activeDurationSec),
    0
  );
  const earliestSessionMs = studentSessions.reduce(
    (min, s) => (s.loginAtMs > 0 ? Math.min(min, s.loginAtMs) : min),
    Number.POSITIVE_INFINITY
  );
  let legacyAttemptSec = 0;
  let trackedAttemptSec = 0;
  for (const a of studentAttempts) {
    const tSec = Math.max(0, a.totalTimeSec);
    const aMs = extractAttemptDateMs(a);
    if (Number.isFinite(earliestSessionMs) && aMs && aMs < earliestSessionMs - 60_000) {
      legacyAttemptSec += tSec;
    } else {
      trackedAttemptSec += tSec;
    }
  }
  const totalStudySec = legacyAttemptSec + Math.max(sessionStudySec, trackedAttemptSec);
  const totalStudyMinutes = Math.round((totalStudySec / 60) * 10) / 10;

  const attemptQuestions = studentAttempts.reduce(
    (sum, a) => sum + Math.max(0, a.correctCount + a.wrongCount),
    0
  );
  const sessionQuestions = studentSessions.reduce(
    (sum, s) => sum + Math.max(0, s.questionsAttempted),
    0
  );
  const totalQuestionsAttempted = Math.max(attemptQuestions, sessionQuestions);

  const subjects: SubjectKey[] = ['quant', 'reasoning', 'english', 'ga'];
  const subjectBreakdown = {} as Record<SubjectKey, SubjectStudySummary>;
  const coveredSubjects = new Set<SubjectKey>();

  for (const sub of subjects) {
    subjectBreakdown[sub] = {
      subject: sub,
      attemptedQuestions: 0,
      correctCount: 0,
      wrongCount: 0,
      skippedCount: 0,
      accuracy: 0,
      timeSec: 0,
    };
  }

  for (const att of studentAttempts) {
    for (const sub of subjects) {
      const st = att.sectionStats?.[sub];
      if (!st) continue;
      const b = subjectBreakdown[sub];
      b.correctCount += st.correct;
      b.wrongCount += st.wrong;
      b.skippedCount += st.skipped;
      b.timeSec += st.timeSec;
      if (st.correct + st.wrong + st.skipped > 0) {
        coveredSubjects.add(sub);
      }
    }
  }

  for (const sess of studentSessions) {
    for (const sub of sess.subjectsStudied ?? []) {
      if (subjects.includes(sub)) {
        coveredSubjects.add(sub);
      }
    }
  }

  for (const sub of subjects) {
    const b = subjectBreakdown[sub];
    b.attemptedQuestions = b.correctCount + b.wrongCount;
    b.accuracy =
      b.attemptedQuestions > 0
        ? Math.round((b.correctCount / b.attemptedQuestions) * 1000) / 10
        : 0;
  }

  const cutoffDateObj = new Date(nowMs);
  cutoffDateObj.setHours(0, 0, 0, 0);
  cutoffDateObj.setDate(cutoffDateObj.getDate() - 6);
  const cutoffDateKey = toLocalDateKey(cutoffDateObj);
  const activeDaysSet = new Set<string>();
  for (const s of studentSessions) {
    if (s.loginAtMs > 0) {
      const k = toLocalDateKey(s.loginAtMs);
      if (k >= cutoffDateKey) activeDaysSet.add(k);
    }
  }
  for (const a of studentAttempts) {
    const ms = extractAttemptDateMs(a);
    if (ms) {
      const k = toLocalDateKey(ms);
      if (k >= cutoffDateKey) activeDaysSet.add(k);
    }
  }

  const activeDays7d = activeDaysSet.size;
  const subjectsCoveredCount = coveredSubjects.size;

  let rewardMultiplier = 1.0;
  let tierLabel: StudentActivitySummary['tierLabel'] = 'Regular';
  let tierReason = 'Standard study activity baseline (1.0x XP)';
  let nextMilestoneHint = 'Study 20+ min & cover 2+ subjects to unlock 1.15x Active Bonus.';

  if (totalStudyMinutes >= 90 && subjectsCoveredCount >= 4 && activeDays7d >= 2 && totalQuestionsAttempted >= 60) {
    rewardMultiplier = 1.4;
    tierLabel = 'Top Hustler';
    tierReason = `${totalStudyMinutes}m active · All 4 subjects studied · ${activeDays7d}d streak`;
    nextMilestoneHint = 'Maximum 1.40x activity multiplier unlocked!';
  } else if (totalStudyMinutes >= 45 && subjectsCoveredCount >= 3 && totalQuestionsAttempted >= 30) {
    rewardMultiplier = 1.25;
    tierLabel = 'Dedicated';
    tierReason = `${totalStudyMinutes}m study · ${subjectsCoveredCount} subjects · ${totalQuestionsAttempted} Qs solved`;
    nextMilestoneHint = 'Reach 90m, 60 Qs & all 4 subjects over 2+ days for 1.40x.';
  } else if (totalStudyMinutes >= 20 && (subjectsCoveredCount >= 2 || totalQuestionsAttempted >= 20)) {
    rewardMultiplier = 1.15;
    tierLabel = 'Active Learner';
    tierReason = `${totalStudyMinutes}m active study · ${subjectsCoveredCount} subjects`;
    nextMilestoneHint = 'Study 45+ min across 3 subjects with 30+ Qs for 1.25x.';
  } else if (totalStudyMinutes < 10 && totalQuestionsAttempted < 15 && subjectsCoveredCount <= 1) {
    rewardMultiplier = 0.85;
    tierLabel = 'Low Activity';
    tierReason = 'Low active study time (<10m) & limited subject coverage';
    nextMilestoneHint = 'Study 10+ min or solve 15+ questions to reach 1.0x Regular XP.';
  }

  return {
    uid,
    totalStudySec,
    totalStudyMinutes,
    sessionsCount: studentSessions.length,
    activeDays7d,
    totalQuestionsAttempted,
    subjectsCoveredCount,
    subjectBreakdown,
    rewardMultiplier,
    tierLabel,
    tierReason,
    nextMilestoneHint,
  };
}

export const DAILY_MOCK_PREFIX = 'daily_mock_';

export function getLocalDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}_${m}_${d}`;
}

export function isDailyMockTest(testId: string | undefined | null): boolean {
  return Boolean(testId && testId.startsWith(DAILY_MOCK_PREFIX));
}

export function formatDailyMockTitle(dateKey: string): string {
  const parts = dateKey.split('_').map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    const label = dt.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    return `Daily Live Mock — ${label}`;
  }
  return `Daily Live Mock — ${dateKey}`;
}

function deterministicShuffle<T>(arr: T[], seedStr: string): T[] {
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

export interface AdaptiveSelectionInput {
  allQuestions: QuestionDoc[];
  revisionItems: RevisionItemDoc[];
  recentQuestionIds?: Iterable<string>;
  subjectScope: 'full' | SubjectKey;
  count: number;
  includeRevisionVault?: boolean;
  onlyRevisionVault?: boolean;
  includeMasteredVault?: boolean;
  seedKey?: string;
}

export interface AdaptiveSelectionResult {
  questionIds: string[];
  revisionCount: number;
  freshCount: number;
}

export function buildAdaptiveQuestionSelection(
  input: AdaptiveSelectionInput
): AdaptiveSelectionResult {
  const {
    allQuestions,
    revisionItems,
    recentQuestionIds,
    subjectScope,
    count,
    includeRevisionVault = true,
    onlyRevisionVault = false,
    includeMasteredVault = false,
    seedKey = String(Date.now()),
  } = input;

  const targetCount = Math.max(1, Math.min(100, count));
  const byId = new Map(allQuestions.map((q) => [q.id, q]));
  const recentSet = new Set(recentQuestionIds ?? []);

  const matchesScope = (sub: SubjectKey) => subjectScope === 'full' || sub === subjectScope;

  const pendingVaultIds = deterministicShuffle(
    revisionItems
      .filter((it) => !it.mastered && matchesScope(it.subject) && byId.has(it.questionId))
      .map((it) => it.questionId),
    seedKey + '_pend'
  );

  const masteredVaultIds = deterministicShuffle(
    revisionItems
      .filter((it) => it.mastered && matchesScope(it.subject) && byId.has(it.questionId))
      .map((it) => it.questionId),
    seedKey + '_mast'
  );

  const chosen: string[] = [];
  const chosenSet = new Set<string>();
  let revisionCount = 0;

  const addId = (id: string, isVault: boolean) => {
    if (chosen.length >= targetCount || chosenSet.has(id) || !byId.has(id)) return;
    chosen.push(id);
    chosenSet.add(id);
    if (isVault) revisionCount += 1;
  };

  if (onlyRevisionVault) {
    for (const id of pendingVaultIds) addId(id, true);
    if (includeMasteredVault) {
      for (const id of masteredVaultIds) addId(id, true);
    }
    return {
      questionIds: chosen,
      revisionCount,
      freshCount: 0,
    };
  }

  // 1. Include up to 40% Pending Revision Vault mistakes so weak questions return baar-baar
  if (includeRevisionVault && pendingVaultIds.length > 0) {
    const vaultCap = Math.max(1, Math.ceil(targetCount * 0.4));
    for (const id of pendingVaultIds.slice(0, vaultCap)) {
      addId(id, true);
    }
  }

  // 2. Prioritize unseen questions (not recently solved), balanced across subjects for 'full'
  const scopedQuestions = allQuestions.filter((q) => matchesScope(q.subject));
  const unseenPool = deterministicShuffle(
    scopedQuestions.filter((q) => !recentSet.has(q.id) && !chosenSet.has(q.id)),
    seedKey + '_unseen'
  );
  const seenPool = deterministicShuffle(
    scopedQuestions.filter((q) => recentSet.has(q.id) && !chosenSet.has(q.id)),
    seedKey + '_seen'
  );

  const pickBalanced = (pool: QuestionDoc[]) => {
    if (subjectScope !== 'full') {
      for (const q of pool) addId(q.id, false);
      return;
    }
    const order: SubjectKey[] = ['quant', 'reasoning', 'english', 'ga'];
    const queues: Record<SubjectKey, QuestionDoc[]> = {
      quant: pool.filter((q) => q.subject === 'quant'),
      reasoning: pool.filter((q) => q.subject === 'reasoning'),
      english: pool.filter((q) => q.subject === 'english'),
      ga: pool.filter((q) => q.subject === 'ga'),
    };
    let progressed = true;
    while (chosen.length < targetCount && progressed) {
      progressed = false;
      for (const sub of order) {
        const next = queues[sub].shift();
        if (next) {
          addId(next.id, false);
          progressed = true;
          if (chosen.length >= targetCount) break;
        }
      }
    }
  };

  pickBalanced(unseenPool);

  // 3. Top up with remaining pending vault, mastered vault (spaced review), then seen pool
  if (chosen.length < targetCount && includeRevisionVault) {
    for (const id of pendingVaultIds) addId(id, true);
    if (includeMasteredVault) {
      for (const id of masteredVaultIds) addId(id, true);
    }
  }
  if (chosen.length < targetCount) {
    pickBalanced(seenPool);
  }

  return {
    questionIds: chosen,
    revisionCount,
    freshCount: Math.max(0, chosen.length - revisionCount),
  };
}

export const DAILY_SECTIONAL_PREFIX = 'daily_sec_';

export function buildDailySectionalTestId(subject: SubjectKey, dateKey: string): string {
  return `${DAILY_SECTIONAL_PREFIX}${subject}_${dateKey}`;
}

export function isDailySectionalTest(testId: string | undefined | null): boolean {
  return Boolean(testId && testId.startsWith(DAILY_SECTIONAL_PREFIX));
}

export function formatDailySectionalTitle(subject: SubjectKey, dateKey: string): string {
  const shortLabels: Record<SubjectKey, string> = {
    quant: 'Quant Sectional',
    reasoning: 'Reasoning Sectional',
    english: 'English Sectional',
    ga: 'GA / GS Sectional',
  };
  const parts = dateKey.split('_').map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    const label = dt.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
    });
    return `Daily ${shortLabels[subject]} — ${label}`;
  }
  return `Daily ${shortLabels[subject]} — ${dateKey}`;
}

export interface CompletedTestGroup {
  testId: string;
  testTitle: string;
  subjectScope: string;
  attemptCount: number;
  completeCount: number;
  latestAttempt: TestAttemptDoc;
  bestScore: number;
  maxScore: number;
  bestAccuracy: number;
  questionIds: string[];
}

export function summarizeCompletedTests(
  attempts: TestAttemptDoc[],
  tests: MockTestDoc[]
): CompletedTestGroup[] {
  const testById = new Map(tests.map((t) => [t.id, t]));
  const grouped = new Map<string, TestAttemptDoc[]>();

  for (const att of attempts) {
    if (!isAttemptComplete(att)) continue;
    const list = grouped.get(att.testId) ?? [];
    list.push(att);
    grouped.set(att.testId, list);
  }

  const results: CompletedTestGroup[] = [];
  for (const [testId, list] of grouped.entries()) {
    const sorted = [...list].sort(
      (a, b) => (extractAttemptDateMs(b) ?? 0) - (extractAttemptDateMs(a) ?? 0)
    );
    const latest = sorted[0];
    if (!latest) continue;
    const matchedTest = testById.get(testId);
    const bestScore = sorted.reduce((m, x) => Math.max(m, x.score), sorted[0].score);
    const bestAccuracy = sorted.reduce((m, x) => Math.max(m, x.accuracy), sorted[0].accuracy);

    results.push({
      testId,
      testTitle: matchedTest?.title || latest.testTitle,
      subjectScope: matchedTest?.subjectScope || latest.subjectScope,
      attemptCount: sorted.length,
      completeCount: sorted.length,
      latestAttempt: latest,
      bestScore,
      maxScore: latest.maxScore,
      bestAccuracy,
      questionIds: matchedTest?.questionIds ?? [],
    });
  }

  return results.sort(
    (a, b) =>
      (extractAttemptDateMs(b.latestAttempt) ?? 0) -
      (extractAttemptDateMs(a.latestAttempt) ?? 0)
  );
}

export interface PendingTestSummary {
  testId: string;
  testTitle: string;
  subjectScope: string;
  source: 'draft' | 'incomplete_attempt';
  currentIdx: number;
  secondsLeft: number | null;
  answeredCount: number;
  totalQuestions: number;
  skippedCount: number;
  completionPercent: number;
  latestAttemptId?: string;
  updatedAtMs: number;
  test?: MockTestDoc;
}

export function summarizePendingTests(params: {
  tests: MockTestDoc[];
  attempts: TestAttemptDoc[];
  drafts: TestDraftDoc[];
}): PendingTestSummary[] {
  const testById = new Map(params.tests.map((t) => [t.id, t]));
  const completedTestIds = new Set(
    params.attempts.filter(isAttemptComplete).map((a) => a.testId)
  );
  const byTestId = new Map<string, PendingTestSummary>();

  for (const draft of params.drafts) {
    const matchedTest = testById.get(draft.testId);
    const total = Math.max(1, draft.totalQuestions || matchedTest?.questionCount || 1);
    const answered = Math.max(0, draft.answeredCount);
    byTestId.set(draft.testId, {
      testId: draft.testId,
      testTitle: matchedTest?.title || draft.testTitle,
      subjectScope: matchedTest?.subjectScope || draft.subjectScope,
      source: 'draft',
      currentIdx: Math.max(0, draft.currentIdx),
      secondsLeft: Math.max(0, draft.secondsLeft),
      answeredCount: answered,
      totalQuestions: total,
      skippedCount: Math.max(0, total - answered),
      completionPercent: Math.round((answered / total) * 100),
      updatedAtMs: draft.updatedAtMs || 0,
      test: matchedTest,
    });
  }

  const incompleteGrouped = new Map<string, TestAttemptDoc[]>();
  for (const att of params.attempts) {
    if (isAttemptComplete(att)) continue;
    if (completedTestIds.has(att.testId)) continue;
    if (byTestId.has(att.testId)) continue;
    const list = incompleteGrouped.get(att.testId) ?? [];
    list.push(att);
    incompleteGrouped.set(att.testId, list);
  }

  for (const [testId, list] of incompleteGrouped.entries()) {
    const sorted = [...list].sort(
      (a, b) => (extractAttemptDateMs(b) ?? 0) - (extractAttemptDateMs(a) ?? 0)
    );
    const latest = sorted[0];
    if (!latest) continue;
    const matchedTest = testById.get(testId);
    const attempted = Math.max(0, latest.correctCount + latest.wrongCount);
    const total = Math.max(1, attempted + Math.max(0, latest.skippedCount));
    byTestId.set(testId, {
      testId,
      testTitle: matchedTest?.title || latest.testTitle,
      subjectScope: matchedTest?.subjectScope || latest.subjectScope,
      source: 'incomplete_attempt',
      currentIdx: Math.min(total - 1, attempted),
      secondsLeft: null,
      answeredCount: attempted,
      totalQuestions: total,
      skippedCount: Math.max(0, latest.skippedCount),
      completionPercent: Math.round((attempted / total) * 100),
      latestAttemptId: latest.id,
      updatedAtMs: extractAttemptDateMs(latest) ?? 0,
      test: matchedTest,
    });
  }

  return Array.from(byTestId.values()).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export interface CompletedRevisionSelectionInput {
  selectedTestIds: string[];
  tests: MockTestDoc[];
  revisionItems: RevisionItemDoc[];
  allQuestions: QuestionDoc[];
  maxQuestions: number;
  prioritizeWeak?: boolean;
  seedKey?: string;
}

export function buildCompletedRevisionQuestionIds(
  input: CompletedRevisionSelectionInput
): { questionIds: string[]; weakIncludedCount: number } {
  const {
    selectedTestIds,
    tests,
    revisionItems,
    allQuestions,
    maxQuestions,
    prioritizeWeak = true,
    seedKey = String(Date.now()),
  } = input;

  const limit = Math.max(1, Math.min(100, maxQuestions));
  const bankSet = new Set(allQuestions.map((q) => q.id));
  const selectedSet = new Set(selectedTestIds);

  const poolSet = new Set<string>();
  for (const t of tests) {
    if (!selectedSet.has(t.id)) continue;
    for (const qid of t.questionIds) {
      if (bankSet.has(qid)) poolSet.add(qid);
    }
  }

  const weakIdsInPool = new Set(
    revisionItems
      .filter((r) => !r.mastered && poolSet.has(r.questionId))
      .map((r) => r.questionId)
  );

  const weakList = deterministicShuffle(Array.from(weakIdsInPool), seedKey + '_weak');
  const remainingList = deterministicShuffle(
    Array.from(poolSet).filter((id) => !weakIdsInPool.has(id)),
    seedKey + '_rest'
  );

  if (!prioritizeWeak) {
    const allShuffled = deterministicShuffle(Array.from(poolSet), seedKey + '_all').slice(0, limit);
    return {
      questionIds: allShuffled,
      weakIncludedCount: allShuffled.filter((id) => weakIdsInPool.has(id)).length,
    };
  }

  const combined = [...weakList, ...remainingList].slice(0, limit);
  return {
    questionIds: combined,
    weakIncludedCount: combined.filter((id) => weakIdsInPool.has(id)).length,
  };
}

export interface StudentGitReportPayload {
  loginId: string;
  uid: string;
  displayName: string;
  slotNumber: number;
  targetPost: string;
  rank: number | null;
  totalCohortSize: number;
  totalXp: number;
  testsAttempted: number;
  bestScore: number;
  avgAccuracy: number;
  studyTimeSec: number;
  studyTimeFormatted: string;
  activeDays7d: number;
  rewardMultiplier: number;
  tierLabel: string;
  pendingVaultCount: number;
  subjectBreakdown: StudentActivitySummary['subjectBreakdown'];
  recentAttempts: Array<{
    testTitle: string;
    subjectScope: string;
    score: number;
    maxScore: number;
    accuracy: number;
    correctCount: number;
    wrongCount: number;
    skippedCount: number;
    xpEarned: number;
    timeSec: number;
    complete: boolean;
    submittedAtIso: string;
  }>;
  recentSessions: Array<{
    loginAtIso: string;
    exitAtIso: string;
    status: string;
    activeDurationSec: number;
    lastActivityTitle: string;
    subjectsStudied: string[];
  }>;
  generatedAtIso: string;
}

export function buildStudentGitReportPayloads(params: {
  invites: Array<{ id: string; loginId: string; displayName: string; targetPost: string; slotNumber: number }>;
  students: Array<{ uid: string; loginId: string; displayName: string; targetPost: string; slotNumber: number }>;
  leaderboard: LeaderboardEntry[];
  attempts: TestAttemptDoc[];
  sessionLogs: StudentSessionLogDoc[];
  nowMs?: number;
}): StudentGitReportPayload[] {
  const nowMs = params.nowMs ?? Date.now();
  const generatedAtIso = new Date(nowMs).toISOString();
  const roster = new Map<
    string,
    { uid: string; loginId: string; displayName: string; targetPost: string; slotNumber: number }
  >();

  for (const inv of params.invites) {
    roster.set(inv.id, {
      uid: inv.id,
      loginId: inv.loginId,
      displayName: inv.displayName,
      targetPost: inv.targetPost,
      slotNumber: inv.slotNumber,
    });
  }
  for (const st of params.students) {
    roster.set(st.uid, {
      uid: st.uid,
      loginId: st.loginId,
      displayName: st.displayName,
      targetPost: st.targetPost,
      slotNumber: st.slotNumber,
    });
  }

  const ranked = rankLeaderboard(params.leaderboard);
  const candidates = Array.from(roster.values()).sort((a, b) => a.slotNumber - b.slotNumber);

  return candidates.map((cand) => {
    const rankIdx = ranked.findIndex((r) => r.uid === cand.uid);
    const lb = rankIdx >= 0 ? ranked[rankIdx] : null;
    const stAttempts = params.attempts.filter((a) => a.uid === cand.uid);
    const stSessions = params.sessionLogs.filter((s) => s.uid === cand.uid);
    const summary = computeStudentActivitySummary(cand.uid, params.attempts, params.sessionLogs, nowMs);

    return {
      loginId: cand.loginId,
      uid: cand.uid,
      displayName: cand.displayName,
      slotNumber: cand.slotNumber,
      targetPost: cand.targetPost,
      rank: rankIdx >= 0 ? rankIdx + 1 : null,
      totalCohortSize: ranked.length,
      totalXp: lb?.totalXp ?? 0,
      testsAttempted: lb?.testsAttempted ?? stAttempts.filter(isAttemptComplete).length,
      bestScore: lb?.bestScore ?? 0,
      avgAccuracy: lb?.avgAccuracy ?? 0,
      studyTimeSec: summary.totalStudySec,
      studyTimeFormatted: formatSeconds(summary.totalStudySec),
      activeDays7d: summary.activeDays7d,
      rewardMultiplier: summary.rewardMultiplier,
      tierLabel: summary.tierLabel,
      pendingVaultCount: 0,
      subjectBreakdown: summary.subjectBreakdown,
      recentAttempts: stAttempts.slice(0, 30).map((a) => {
        const ms = extractAttemptDateMs(a);
        return {
          testTitle: a.testTitle,
          subjectScope: a.subjectScope,
          score: a.score,
          maxScore: a.maxScore,
          accuracy: a.accuracy,
          correctCount: a.correctCount,
          wrongCount: a.wrongCount,
          skippedCount: a.skippedCount,
          xpEarned: a.xpEarned,
          timeSec: a.totalTimeSec,
          complete: isAttemptComplete(a),
          submittedAtIso: ms ? new Date(ms).toISOString() : '',
        };
      }),
      recentSessions: stSessions.slice(0, 25).map((s) => ({
        loginAtIso: s.loginAtMs > 0 ? new Date(s.loginAtMs).toISOString() : '',
        exitAtIso:
          s.logoutAtMs > 0
            ? new Date(s.logoutAtMs).toISOString()
            : s.lastActiveAtMs > 0
              ? new Date(s.lastActiveAtMs).toISOString()
              : '',
        status: isSessionLogLive(s, nowMs) ? 'active' : 'ended',
        activeDurationSec: s.activeDurationSec,
        lastActivityTitle: s.lastActivityTitle,
        subjectsStudied: s.subjectsStudied ?? [],
      })),
      generatedAtIso,
    };
  });
}

export interface LifetimeStudentStats {
  mocksCompleted: number;
  totalSubmissions: number;
  questionsAttempted: number;
  questionsFaced: number;
  correctCount: number;
  wrongAttemptedCount: number;
  missedCount: number;
  wrongIncludingMissedCount: number;
}

export function computeLifetimeStudentStats(
  attempts: TestAttemptDoc[]
): LifetimeStudentStats {
  let mocksCompleted = 0;
  let correctCount = 0;
  let wrongAttemptedCount = 0;
  let missedCount = 0;

  for (const a of attempts) {
    if (isAttemptComplete(a)) {
      mocksCompleted += 1;
    }
    correctCount += Math.max(0, a.correctCount);
    wrongAttemptedCount += Math.max(0, a.wrongCount);
    missedCount += Math.max(0, a.skippedCount);
  }

  const questionsAttempted = correctCount + wrongAttemptedCount;
  const questionsFaced = questionsAttempted + missedCount;
  const wrongIncludingMissedCount = wrongAttemptedCount + missedCount;

  return {
    mocksCompleted,
    totalSubmissions: attempts.length,
    questionsAttempted,
    questionsFaced,
    correctCount,
    wrongAttemptedCount,
    missedCount,
    wrongIncludingMissedCount,
  };
}

export type RankDivision = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';

export interface RankTierInfo {
  division: RankDivision;
  level: 1 | 2 | 3 | 4 | 5;
  step: number; // 1..25
  label: string; // e.g., "Silver Lv.2"
  tierScore: number;
  nextStepScore: number | null;
  progressPercent: number;
  nextLabel: string | null;
}

const RANK_DIVISIONS: RankDivision[] = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];

// 25 monotonic thresholds spanning Bronze Lv.1..Diamond Lv.5
const RANK_STEP_THRESHOLDS: number[] = [
  0, 50, 120, 210, 320,         // Bronze Lv.1..5
  460, 630, 830, 1060, 1320,    // Silver Lv.1..5
  1620, 1960, 2340, 2760, 3220, // Gold Lv.1..5
  3740, 4320, 4960, 5660, 6420, // Platinum Lv.1..5
  7260, 8180, 9180, 10260, 11420, // Diamond Lv.1..5
];

export function computeRankTierFromStep(step: number): RankTierInfo {
  const clampedStep = Math.max(1, Math.min(25, Math.round(step)));
  const idx = clampedStep - 1;
  const divisionIdx = Math.floor(idx / 5);
  const level = ((idx % 5) + 1) as 1 | 2 | 3 | 4 | 5;
  const division = RANK_DIVISIONS[divisionIdx];
  const label = `${division} Lv.${level}`;
  const threshold = RANK_STEP_THRESHOLDS[idx];
  const nextThreshold = clampedStep < 25 ? RANK_STEP_THRESHOLDS[clampedStep] : null;
  const nextLabel =
    clampedStep < 25
      ? `${RANK_DIVISIONS[Math.floor(clampedStep / 5)]} Lv.${(clampedStep % 5) + 1}`
      : null;

  return {
    division,
    level,
    step: clampedStep,
    label,
    tierScore: threshold,
    nextStepScore: nextThreshold,
    progressPercent: clampedStep === 25 ? 100 : 0,
    nextLabel,
  };
}

export function computeStudentRankTier(params: {
  totalXp: number;
  testsCompleted: number;
  activeDays: number;
  questionsAttempted?: number;
}): RankTierInfo {
  const safeXp = Math.max(0, Math.round(params.totalXp || 0));
  const safeTests = Math.max(0, Math.round(params.testsCompleted || 0));
  const safeDays = Math.max(0, Math.round(params.activeDays || 0));
  const safeQs = Math.max(0, Math.round(params.questionsAttempted || 0));

  // Weighted progression score combining earned XP, daily consistency, completed tests & Q volume
  const tierScore = safeXp + safeTests * 25 + safeDays * 30 + Math.floor(safeQs * 0.5);

  let step = 1;
  for (let i = 0; i < RANK_STEP_THRESHOLDS.length; i += 1) {
    if (tierScore >= RANK_STEP_THRESHOLDS[i]) {
      step = i + 1;
    }
  }

  const base = computeRankTierFromStep(step);
  if (step === 25 || base.nextStepScore === null) {
    return {
      ...base,
      tierScore,
      progressPercent: 100,
    };
  }

  const currentFloor = RANK_STEP_THRESHOLDS[step - 1];
  const span = Math.max(1, base.nextStepScore - currentFloor);
  const progressPercent = Math.max(
    0,
    Math.min(100, Math.round(((tierScore - currentFloor) / span) * 100))
  );

  return {
    ...base,
    tierScore,
    progressPercent,
  };
}

export interface DateGroupedAttendanceRow {
  groupKey: string;
  dateKey: string;
  dateLabel: string;
  uid?: string;
  displayName?: string;
  loginId?: string;
  totalActiveSec: number;
  sessionCount: number;
  totalTestsCompleted: number;
  totalQuestionsAttempted: number;
  hasLiveSession: boolean;
  sessions: StudentSessionLogDoc[];
}

export function groupSessionLogsByDate(
  sessionLogs: StudentSessionLogDoc[],
  options?: {
    groupByStudent?: boolean;
    liveOverride?: LiveSessionOverride;
    nowMs?: number;
  }
): DateGroupedAttendanceRow[] {
  const groupByStudent = Boolean(options?.groupByStudent);
  const liveOverride = options?.liveOverride;
  const nowMs = options?.nowMs ?? Date.now();

  const buckets = new Map<
    string,
    {
      dateKey: string;
      uid: string;
      displayName: string;
      loginId: string;
      sessions: StudentSessionLogDoc[];
      totalActiveSec: number;
      totalTestsCompleted: number;
      totalQuestionsAttempted: number;
      hasLiveSession: boolean;
      latestMs: number;
    }
  >();

  for (const rawSess of sessionLogs) {
    const anchorMs = rawSess.loginAtMs || rawSess.lastActiveAtMs || 0;
    const dateKey = anchorMs > 0 ? toLocalDateKey(anchorMs) : 'unknown';
    const effectiveSec =
      liveOverride?.sessionId === rawSess.id &&
      typeof liveOverride.activeDurationSec === 'number'
        ? Math.max(rawSess.activeDurationSec, liveOverride.activeDurationSec)
        : Math.max(0, rawSess.activeDurationSec);

    const sess: StudentSessionLogDoc = {
      ...rawSess,
      activeDurationSec: effectiveSec,
    };

    const groupKey = groupByStudent ? `${dateKey}__${sess.uid}` : dateKey;
    let bucket = buckets.get(groupKey);
    if (!bucket) {
      bucket = {
        dateKey,
        uid: sess.uid,
        displayName: sess.displayName,
        loginId: sess.loginId,
        sessions: [],
        totalActiveSec: 0,
        totalTestsCompleted: 0,
        totalQuestionsAttempted: 0,
        hasLiveSession: false,
        latestMs: 0,
      };
      buckets.set(groupKey, bucket);
    }

    bucket.sessions.push(sess);
    bucket.totalActiveSec += effectiveSec;
    bucket.totalTestsCompleted += Math.max(0, sess.testsCompleted);
    bucket.totalQuestionsAttempted += Math.max(0, sess.questionsAttempted);
    if (isSessionLogLive(sess, nowMs)) {
      bucket.hasLiveSession = true;
    }
    bucket.latestMs = Math.max(bucket.latestMs, anchorMs);
  }

  return Array.from(buckets.entries())
    .sort(([, a], [, b]) => {
      if (b.dateKey !== a.dateKey) return b.dateKey.localeCompare(a.dateKey);
      return b.latestMs - a.latestMs;
    })
    .map(([groupKey, b]) => {
      let dateLabel = b.dateKey;
      if (/^\d{4}-\d{2}-\d{2}$/.test(b.dateKey)) {
        const [y, m, d] = b.dateKey.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        dateLabel = dt.toLocaleDateString('en-IN', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
      }
      const sortedSessions = [...b.sessions].sort(
        (s1, s2) => (s2.loginAtMs || 0) - (s1.loginAtMs || 0)
      );
      return {
        groupKey,
        dateKey: b.dateKey,
        dateLabel,
        uid: groupByStudent ? b.uid : undefined,
        displayName: groupByStudent ? b.displayName : undefined,
        loginId: groupByStudent ? b.loginId : undefined,
        totalActiveSec: b.totalActiveSec,
        sessionCount: sortedSessions.length,
        totalTestsCompleted: b.totalTestsCompleted,
        totalQuestionsAttempted: b.totalQuestionsAttempted,
        hasLiveSession: b.hasLiveSession,
        sessions: sortedSessions,
      };
    });
}

// --- Custom Mock Test Builder Helpers ---

export interface CustomMockTopicOption {
  value: string;
  subject: SubjectKey;
  topic: string;
  count: number;
}

export interface CustomMockFilterCatalog {
  totalCount: number;
  subjectCounts: Record<SubjectKey, number>;
  topics: CustomMockTopicOption[];
}

export function extractCustomMockFilterCatalog(
  questions: QuestionDoc[]
): CustomMockFilterCatalog {
  const subjectCounts: Record<SubjectKey, number> = {
    quant: 0,
    reasoning: 0,
    english: 0,
    ga: 0,
  };
  const topicMap = new Map<string, CustomMockTopicOption>();

  for (const q of questions) {
    if (q.subject in subjectCounts) {
      subjectCounts[q.subject] += 1;
    }
    const cleanTopic = (q.topic || 'General').trim();
    const key = `topic:${q.subject}::${cleanTopic}`;
    const existing = topicMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      topicMap.set(key, {
        value: key,
        subject: q.subject,
        topic: cleanTopic,
        count: 1,
      });
    }
  }

  const subjectOrder: Record<SubjectKey, number> = {
    quant: 0,
    reasoning: 1,
    english: 2,
    ga: 3,
  };

  const topics = Array.from(topicMap.values()).sort((a, b) => {
    const sDiff = subjectOrder[a.subject] - subjectOrder[b.subject];
    if (sDiff !== 0) return sDiff;
    if (b.count !== a.count) return b.count - a.count;
    return a.topic.localeCompare(b.topic);
  });

  return {
    totalCount: questions.length,
    subjectCounts,
    topics,
  };
}

export interface CustomMockSelectionResult {
  questionIds: string[];
  subjectScope: 'full' | SubjectKey;
  exactMatchCount: number;
  label: string;
}

export function selectCustomMockQuestions(params: {
  allQuestions: QuestionDoc[];
  filterValue: string;
  count: number;
  seedKey?: string;
}): CustomMockSelectionResult {
  const targetCount = Math.max(1, Math.min(100, Math.round(params.count || 10)));
  const seed = params.seedKey ?? `${Date.now()}_${Math.random()}`;
  const rawFilter = (params.filterValue || 'all').trim();

  let matched: QuestionDoc[] = [];
  let fallbackPool: QuestionDoc[] = [];
  let subjectScope: 'full' | SubjectKey = 'full';
  let label = 'All Subjects Custom Mock';

  if (rawFilter === 'all') {
    matched = params.allQuestions;
    subjectScope = 'full';
    label = 'All Subjects Custom Mock';
  } else if (rawFilter.startsWith('subject:')) {
    const sub = rawFilter.slice('subject:'.length) as SubjectKey;
    subjectScope = sub;
    matched = params.allQuestions.filter((q) => q.subject === sub);
    const shortNames: Record<SubjectKey, string> = {
      quant: 'Maths',
      reasoning: 'Reasoning',
      english: 'English',
      ga: 'GS / GA',
    };
    label = `${shortNames[sub] ?? sub} Custom Mock`;
  } else if (rawFilter.startsWith('topic:')) {
    const rest = rawFilter.slice('topic:'.length);
    const sepIdx = rest.indexOf('::');
    const sub = (sepIdx >= 0 ? rest.slice(0, sepIdx) : 'ga') as SubjectKey;
    const topicName = sepIdx >= 0 ? rest.slice(sepIdx + 2) : rest;
    const normTopic = topicName.toLowerCase();
    matched = params.allQuestions.filter(
      (q) => q.subject === sub && q.topic.trim().toLowerCase() === normTopic
    );
    fallbackPool = params.allQuestions.filter(
      (q) => q.subject === sub && q.topic.trim().toLowerCase() !== normTopic
    );
    subjectScope = sub;
    label = `${topicName} Custom Mock`;
  } else {
    // Support bare topic or subject name (e.g., "History" or "Maths")
    const lower = rawFilter.toLowerCase();
    if (lower === 'maths' || lower === 'mathematics' || lower === 'quant') {
      subjectScope = 'quant';
      matched = params.allQuestions.filter((q) => q.subject === 'quant');
      label = 'Maths Custom Mock';
    } else if (lower === 'reasoning') {
      subjectScope = 'reasoning';
      matched = params.allQuestions.filter((q) => q.subject === 'reasoning');
      label = 'Reasoning Custom Mock';
    } else if (lower === 'english') {
      subjectScope = 'english';
      matched = params.allQuestions.filter((q) => q.subject === 'english');
      label = 'English Custom Mock';
    } else if (lower === 'ga' || lower === 'gs' || lower === 'gk') {
      subjectScope = 'ga';
      matched = params.allQuestions.filter((q) => q.subject === 'ga');
      label = 'GS / GA Custom Mock';
    } else {
      matched = params.allQuestions.filter((q) =>
        q.topic.trim().toLowerCase().includes(lower)
      );
      if (matched.length > 0) {
        const dominantSub = matched[0].subject;
        const singleSub = matched.every((q) => q.subject === dominantSub);
        subjectScope = singleSub ? dominantSub : 'full';
        fallbackPool = singleSub
          ? params.allQuestions.filter(
              (q) => q.subject === dominantSub && !matched.some((m) => m.id === q.id)
            )
          : [];
      }
      label = `${rawFilter} Custom Mock`;
    }
  }

  const shuffledPrimary = deterministicShuffle(matched, `${seed}_primary`);
  const exactMatchCount = Math.min(targetCount, shuffledPrimary.length);
  const picked: QuestionDoc[] = shuffledPrimary.slice(0, targetCount);

  if (picked.length < targetCount && fallbackPool.length > 0) {
    const shuffledFallback = deterministicShuffle(fallbackPool, `${seed}_fallback`);
    for (const q of shuffledFallback) {
      if (picked.length >= targetCount) break;
      picked.push(q);
    }
  }

  return {
    questionIds: picked.map((q) => q.id),
    subjectScope,
    exactMatchCount,
    label,
  };
}

// --- Result Screen Time Analytics & Weakness Analyzer ---

export interface SubjectPaceMetric {
  subject: SubjectKey;
  labelShort: string;
  questionCount: number;
  totalTimeSec: number;
  avgTimeSec: number;
  avgTimeText: string;
}

export interface WeakTopicMetric {
  topic: string;
  subject: SubjectKey;
  wrongCount: number;
  skippedCount: number;
  questionIds: string[];
}

export interface TestResultAnalytics {
  subjectPaces: SubjectPaceMetric[];
  timeInsightEn: string;
  timeInsightHi: string;
  weakTopics: WeakTopicMetric[];
  wrongTopicsOnly: WeakTopicMetric[];
  weaknessInsightEn: string;
  weaknessInsightHi: string;
  revisionQuestionIds: string[];
  revisionTopicNames: string[];
}

export function formatHumanAvgSeconds(avgSec: number): string {
  const safe = Math.max(0, Math.round(avgSec));
  if (safe >= 60) {
    const mins = Math.floor(safe / 60);
    const rem = safe % 60;
    if (rem === 0) return mins === 1 ? '1 minute' : `${mins} minutes`;
    return `${mins}m ${rem}s`;
  }
  return safe === 1 ? '1 second' : `${safe} seconds`;
}

function joinNaturalList(items: string[], conj: 'and' | 'और'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`;
}

export function analyzeTestResultAnalytics(
  questions: QuestionDoc[],
  outcome: CalculatedTestOutcome
): TestResultAnalytics {
  const shortNames: Record<SubjectKey, string> = {
    quant: 'Maths',
    reasoning: 'Reasoning',
    english: 'English',
    ga: 'GS',
  };

  const secMap = new Map<SubjectKey, { count: number; totalSec: number }>();
  const topicMap = new Map<string, WeakTopicMetric>();
  const wrongQIdsSet = new Set<string>();
  const weakQIdsSet = new Set<string>();

  questions.forEach((q, idx) => {
    const res = outcome.perQuestionResults[idx];
    const timeSpent = res ? Math.max(0, res.timeSpentSec) : 0;

    const curSec = secMap.get(q.subject) ?? { count: 0, totalSec: 0 };
    curSec.count += 1;
    curSec.totalSec += timeSpent;
    secMap.set(q.subject, curSec);

    const isSkipped = !res || res.selectedIndex < 0 || res.selectedIndex > 3;
    const isWrong = Boolean(res && !isSkipped && !res.isCorrect);

    if (isWrong || isSkipped) {
      weakQIdsSet.add(q.id);
      if (isWrong) wrongQIdsSet.add(q.id);
      const cleanTopic = (q.topic || 'General').trim();
      const tKey = `${q.subject}::${cleanTopic.toLowerCase()}`;
      const existing = topicMap.get(tKey) ?? {
        topic: cleanTopic,
        subject: q.subject,
        wrongCount: 0,
        skippedCount: 0,
        questionIds: [],
      };
      if (isWrong) existing.wrongCount += 1;
      else existing.skippedCount += 1;
      existing.questionIds.push(q.id);
      topicMap.set(tKey, existing);
    }
  });

  const subjectOrder: SubjectKey[] = ['quant', 'reasoning', 'english', 'ga'];
  const subjectPaces: SubjectPaceMetric[] = [];
  for (const sub of subjectOrder) {
    const entry = secMap.get(sub);
    if (!entry || entry.count === 0) continue;
    const avg = Math.round(entry.totalSec / entry.count);
    subjectPaces.push({
      subject: sub,
      labelShort: shortNames[sub],
      questionCount: entry.count,
      totalTimeSec: entry.totalSec,
      avgTimeSec: avg,
      avgTimeText: formatHumanAvgSeconds(avg),
    });
  }

  let timeInsightEn = 'Time pace recorded across attempted questions.';
  let timeInsightHi = 'प्रत्येक प्रश्न पर बिताया गया समय सफलतापूर्वक रिकॉर्ड हुआ।';
  if (subjectPaces.length > 0) {
    const enParts = subjectPaces.map(
      (p) => `${p.labelShort} me per question average ${p.avgTimeText}`
    );
    const enCleanParts = subjectPaces.map(
      (p) => `averaged ${p.avgTimeText}/question in ${p.labelShort}`
    );
    timeInsightEn = `You ${joinNaturalList(enCleanParts, 'and')}.`;
    timeInsightHi = `आपने ${joinNaturalList(enParts, 'और')} लिए।`;
  }

  const weakTopics = Array.from(topicMap.values()).sort((a, b) => {
    if (b.wrongCount !== a.wrongCount) return b.wrongCount - a.wrongCount;
    return b.skippedCount - a.skippedCount;
  });

  const wrongTopicsOnly = weakTopics.filter((t) => t.wrongCount > 0);
  const targetTopicsForCopy = wrongTopicsOnly.length > 0 ? wrongTopicsOnly : weakTopics;
  const topicNamesList = targetTopicsForCopy.map((t) => t.topic);

  let weaknessInsightEn = 'Zero weak topics detected — 100% concept mastery on this test!';
  let weaknessInsightHi = 'इस टेस्ट में कोई भी टॉपिक गलत नहीं हुआ — शानदार पकड़!';

  if (wrongTopicsOnly.length > 0) {
    const joinedEn = joinNaturalList(topicNamesList, 'and');
    const joinedHi = joinNaturalList(topicNamesList, 'और');
    weaknessInsightEn = `Questions from ${joinedEn} were answered incorrectly and need focused revision.`;
    weaknessInsightHi = `आपके ${joinedHi} के प्रश्न गलत हुए हैं — नीचे से इनका तुरंत रिवीजन टेस्ट लें।`;
  } else if (weakTopics.length > 0) {
    const joinedEn = joinNaturalList(topicNamesList, 'and');
    const joinedHi = joinNaturalList(topicNamesList, 'और');
    weaknessInsightEn = `Zero wrong answers, though questions from ${joinedEn} were skipped.`;
    weaknessInsightHi = `कोई गलत उत्तर नहीं, लेकिन ${joinedHi} के प्रश्न स्किप किए गए हैं।`;
  }

  return {
    subjectPaces,
    timeInsightEn,
    timeInsightHi,
    weakTopics,
    wrongTopicsOnly,
    weaknessInsightEn,
    weaknessInsightHi,
    revisionQuestionIds:
      wrongQIdsSet.size > 0 ? Array.from(wrongQIdsSet) : Array.from(weakQIdsSet),
    revisionTopicNames: topicNamesList,
  };
}

export const TICKET_RESOLVED_PUSH_MESSAGE =
  'Problem solved. Thank you for making our website good and bug-free!';

export function getPendingResolutionNotifications(
  tickets: SupportTicketDoc[],
  uid: string
): SupportTicketDoc[] {
  return tickets
    .filter(
      (t) =>
        t.uid === uid &&
        t.status === 'resolved' &&
        t.resolutionNotified &&
        !t.resolutionAcked
    )
    .sort((a, b) => (b.resolvedAtMs || 0) - (a.resolvedAtMs || 0));
}

export {
  fetchStaticGKQuestionDocs,
  fetchStaticGKQuestions,
  getAllStaticGkQuestionDocs,
  isGeneralAwarenessSubjectOrTopic,
} from './staticGkBank';




