import type {
  CorrectedQuestionOverrideDoc,
  MockTestDoc,
  QuestionDoc,
  RevisionItemDoc,
  SubjectKey,
} from '../types/exam';
import { MICRO_SYLLABUS_CHAPTERS } from './dreamPostCatalog';

/** Strict continuous offline duration (1 minute) required before auto-logout. */
export const OFFLINE_AUTO_LOGOUT_MS = 60_000;

/** Active-session threshold between random pop-up reward quizzes (2 hours). */
export const POPUP_QUIZ_ACTIVE_INTERVAL_MS = 2 * 60 * 60 * 1000;

/** Max compressed data-URL length permitted for student profile pictures. */
export const MAX_AVATAR_DATA_URL_LENGTH = 70_000;

export const SYSTEM_PLACEHOLDER_UIDS = new Set([
  'admin_preview',
  'dummy_student',
  'test_dummy',
]);

export function isSystemPlaceholderUid(uid: string | undefined | null): boolean {
  const clean = typeof uid === 'string' ? uid.trim().toLowerCase() : '';
  return !clean || SYSTEM_PLACEHOLDER_UIDS.has(clean);
}

/**
 * Evaluates whether a student session has remained continuously offline for >= 60s.
 * Tab switching / focus loss NEVER triggers auto-logout.
 */
export function shouldTriggerOfflineAutoLogout(params: {
  isOnline: boolean;
  offlineSinceMs: number | null;
  nowMs: number;
  thresholdMs?: number;
}): boolean {
  if (params.isOnline) return false;
  if (params.offlineSinceMs === null || !Number.isFinite(params.offlineSinceMs)) return false;
  const limit = params.thresholdMs ?? OFFLINE_AUTO_LOGOUT_MS;
  return params.nowMs - params.offlineSinceMs >= limit;
}

/**
 * Ensures Admin telemetry, proctoring, and leaderboard never display preview/system
 * placeholder users, while always allowing real cohort students (including damini_01 and demo_123).
 * When `allowedCohortUids` (from live VIP invites) is supplied, records outside real VIP accounts are excluded.
 */
export function isRealCohortStudentUid(
  uid: string | undefined | null,
  allowedCohortUids?: ReadonlySet<string> | readonly string[]
): boolean {
  const clean = typeof uid === 'string' ? uid.trim() : '';
  if (!clean) return false;
  if (SYSTEM_PLACEHOLDER_UIDS.has(clean.toLowerCase())) return false;
  if (allowedCohortUids) {
    const set =
      allowedCohortUids instanceof Set ? allowedCohortUids : new Set(allowedCohortUids);
    if (set.size > 0 && !set.has(clean)) return false;
  }
  return true;
}

export function filterRealCohortRecords<T>(
  records: readonly T[],
  getUid: (item: T) => string | undefined | null,
  allowedCohortUids?: ReadonlySet<string> | readonly string[]
): T[] {
  return records.filter((item) => isRealCohortStudentUid(getUid(item), allowedCohortUids));
}

export function applyOverrideToQuestion(
  q: QuestionDoc,
  override?: CorrectedQuestionOverrideDoc | null
): QuestionDoc {
  if (!override) return q;
  return {
    ...q,
    subject: override.subject ?? q.subject,
    topic: override.topic || q.topic,
    difficulty: override.difficulty ?? q.difficulty,
    questionEn: override.questionEn || q.questionEn,
    questionHi: override.questionHi ?? q.questionHi,
    optionsEn:
      Array.isArray(override.optionsEn) && override.optionsEn.length === 4
        ? ([...override.optionsEn] as [string, string, string, string])
        : q.optionsEn,
    optionsHi:
      Array.isArray(override.optionsHi) && override.optionsHi.length === 4
        ? ([...override.optionsHi] as [string, string, string, string])
        : q.optionsHi,
    correctIndex: override.correctIndex ?? q.correctIndex,
    explanationEn: override.explanationEn ?? q.explanationEn,
    explanationHi: override.explanationHi ?? q.explanationHi,
    shortTrick: override.shortTrick ?? q.shortTrick,
  };
}

export function applyCorrectedQuestionOverrides(
  questions: readonly QuestionDoc[],
  correctedById:
    | Readonly<Record<string, CorrectedQuestionOverrideDoc>>
    | ReadonlyMap<string, CorrectedQuestionOverrideDoc>
): QuestionDoc[] {
  return questions.map((q) => {
    const ov =
      correctedById instanceof Map
        ? correctedById.get(q.id)
        : (correctedById as Readonly<Record<string, CorrectedQuestionOverrideDoc>>)[q.id];
    return applyOverrideToQuestion(q, ov);
  });
}

export function isValidAvatarDataUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > MAX_AVATAR_DATA_URL_LENGTH) return false;
  return /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed);
}

export type GlobalSearchMatch =
  | {
      kind: 'mock';
      id: string;
      title: string;
      subtitle: string;
      test: MockTestDoc;
    }
  | {
      kind: 'syllabus';
      id: string;
      title: string;
      subtitle: string;
      subject: SubjectKey;
      slug: string;
    }
  | {
      kind: 'vault';
      id: string;
      title: string;
      subtitle: string;
      questionId: string;
      subject: SubjectKey;
    };

export function searchGlobalStudyItems(params: {
  query: string;
  tests: readonly MockTestDoc[];
  revisionItems: readonly RevisionItemDoc[];
  questionsMap?: Readonly<Record<string, QuestionDoc>>;
  limitPerKind?: number;
}): GlobalSearchMatch[] {
  const needle = params.query.trim().toLowerCase();
  const limit = Math.max(1, params.limitPerKind ?? 6);
  if (!needle) {
    return params.tests.slice(0, 4).map((t) => ({
      kind: 'mock' as const,
      id: `mock_${t.id}`,
      title: t.title,
      subtitle: `${t.questionCount} Qs · ${t.durationMinutes} min${t.topicTag ? ` · ${t.topicTag}` : ''}`,
      test: t,
    }));
  }

  const results: GlobalSearchMatch[] = [];

  let mockHits = 0;
  for (const t of params.tests) {
    const hay = `${t.title} ${t.topicTag ?? ''} ${t.subjectScope}`.toLowerCase();
    if (hay.includes(needle)) {
      results.push({
        kind: 'mock',
        id: `mock_${t.id}`,
        title: t.title,
        subtitle: `${t.questionCount} Qs · ${t.durationMinutes} min`,
        test: t,
      });
      mockHits += 1;
      if (mockHits >= limit) break;
    }
  }

  let sylHits = 0;
  for (const ch of MICRO_SYLLABUS_CHAPTERS) {
    const hay = `${ch.title} ${ch.subject} ${ch.slug} ${(ch.aliases ?? []).join(' ')}`.toLowerCase();
    if (hay.includes(needle)) {
      results.push({
        kind: 'syllabus',
        id: `syl_${ch.slug}`,
        title: ch.title,
        subtitle: `Micro-Syllabus · ${ch.subject.toUpperCase()}`,
        subject: ch.subject,
        slug: ch.slug,
      });
      sylHits += 1;
      if (sylHits >= limit) break;
    }
  }

  let vaultHits = 0;
  for (const item of params.revisionItems) {
    const q = params.questionsMap?.[item.questionId];
    const hay = `${item.testTitle} ${item.subject} ${q?.topic ?? ''} ${q?.questionEn ?? ''}`.toLowerCase();
    if (hay.includes(needle)) {
      results.push({
        kind: 'vault',
        id: `vault_${item.id}`,
        title: q?.questionEn ? q.questionEn.slice(0, 90) : `${item.testTitle} (${item.subject})`,
        subtitle: `Revision Vault · ${q?.topic ?? item.subject.toUpperCase()}`,
        questionId: item.questionId,
        subject: item.subject,
      });
      vaultHits += 1;
      if (vaultHits >= limit) break;
    }
  }

  return results;
}

export function shouldTriggerPopupQuiz(params: {
  accumulatedActiveMs: number;
  lastTriggeredAtActiveMs: number;
  intervalMs?: number;
  isDisabledInExam?: boolean;
}): boolean {
  if (params.isDisabledInExam) return false;
  const interval = Math.max(60_000, params.intervalMs ?? POPUP_QUIZ_ACTIVE_INTERVAL_MS);
  return params.accumulatedActiveMs - params.lastTriggeredAtActiveMs >= interval;
}

export function pickPopupRewardQuestions(
  pool: readonly QuestionDoc[],
  seedStr: string,
  count = 2
): QuestionDoc[] {
  if (pool.length === 0 || count <= 0) return [];
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const j = h % (i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, Math.min(count, copy.length));
}

export function scorePopupRewardQuiz(
  questions: readonly QuestionDoc[],
  selectedIndices: Readonly<Record<string, number>>
): { correctCount: number; totalCount: number; xpAwarded: number } {
  if (questions.length === 0) {
    return { correctCount: 0, totalCount: 0, xpAwarded: 0 };
  }
  let correctCount = 0;
  for (const q of questions) {
    if (selectedIndices[q.id] === q.correctIndex) {
      correctCount += 1;
    }
  }
  const baseXp = correctCount * 10;
  const bonus = correctCount === questions.length ? 5 : 0;
  return {
    correctCount,
    totalCount: questions.length,
    xpAwarded: baseXp + bonus,
  };
}
