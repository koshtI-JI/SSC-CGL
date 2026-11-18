import {
  SUBJECT_LABELS,
  type DifficultyLevel,
  type LeaderboardEntry,
  type MockTestDoc,
  type QuestionDoc,
  type QuestionInput,
  type RevisionItemDoc,
  type StudentPresenceDoc,
  type StudentProfile,
  type StudentSessionLogDoc,
  type SubjectKey,
  type TestAttemptDoc,
  type VipInvite,
} from '../types/exam';
import { MICRO_SYLLABUS_CHAPTERS, resolveSyllabusChapter } from './dreamPostCatalog';
import { isAttemptComplete, isPresenceOnline } from './examEngine';
import {
  exportLocalCohortSnapshot,
  importLocalCohortSnapshot,
  readLocalDb,
  type LocalFallbackDatabase,
} from './localFallbackStore';
import { isSystemPlaceholderUid } from './sessionAndOverrides';
import { resolveMicroTopicLabel } from './studentAnalyticsEngine';

export function extractTimestampMs(raw: unknown): number {
  if (!raw) return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof raw === 'object') {
    const obj = raw as { toMillis?: () => number; seconds?: number };
    if (typeof obj.toMillis === 'function') return obj.toMillis();
    if (typeof obj.seconds === 'number' && Number.isFinite(obj.seconds)) {
      return obj.seconds * 1000;
    }
  }
  return 0;
}

export interface CanonicalAdminUserRow {
  uid: string;
  inviteId?: string;
  loginId: string;
  displayName: string;
  targetPost: string;
  slotNumber: number;
  active: boolean;
  hasInvite: boolean;
  hasStudentProfile: boolean;
  hasPasswordHash: boolean;
  legacyPlaintextDetected: boolean;
  totalXp: number;
  testsAttempted: number;
  bestScore: number;
  avgAccuracy: number;
  presenceStatus: 'online' | 'in_exam' | 'offline';
  lastSeenMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  slotConflictWith: string[];
  invite?: VipInvite;
}

export interface SlotConflictSummary {
  slotNumber: number;
  uids: string[];
  loginIds: string[];
}

export function buildAdminUserManagementRows(params: {
  invites: readonly VipInvite[];
  students: readonly StudentProfile[];
  leaderboard: readonly LeaderboardEntry[];
  attempts: readonly TestAttemptDoc[];
  presences: readonly StudentPresenceDoc[];
  sessionLogs?: readonly StudentSessionLogDoc[];
  nowMs?: number;
}): CanonicalAdminUserRow[] {
  const nowMs = params.nowMs ?? Date.now();
  const invByUid = new Map<string, VipInvite>();
  const stuByUid = new Map<string, StudentProfile>();
  const lbByUid = new Map<string, LeaderboardEntry>();
  const presByUid = new Map<string, StudentPresenceDoc>();
  const attemptsByUid = new Map<string, TestAttemptDoc[]>();

  for (const inv of params.invites) {
    if (!inv?.id || isSystemPlaceholderUid(inv.id)) continue;
    invByUid.set(inv.id, inv);
  }
  for (const stu of params.students) {
    if (!stu?.uid || isSystemPlaceholderUid(stu.uid)) continue;
    stuByUid.set(stu.uid, stu);
  }
  for (const lb of params.leaderboard) {
    if (!lb?.uid || isSystemPlaceholderUid(lb.uid)) continue;
    lbByUid.set(lb.uid, lb);
  }
  for (const pres of params.presences) {
    if (!pres?.uid || isSystemPlaceholderUid(pres.uid)) continue;
    presByUid.set(pres.uid, pres);
  }
  for (const att of params.attempts) {
    if (!att?.uid || isSystemPlaceholderUid(att.uid)) continue;
    const list = attemptsByUid.get(att.uid) ?? [];
    list.push(att);
    attemptsByUid.set(att.uid, list);
  }

  const allUids = new Set<string>([
    ...invByUid.keys(),
    ...stuByUid.keys(),
    ...lbByUid.keys(),
  ]);

  const rows: CanonicalAdminUserRow[] = [];

  for (const uid of allUids) {
    const inv = invByUid.get(uid);
    const stu = stuByUid.get(uid);
    const lb = lbByUid.get(uid);
    const pres = presByUid.get(uid);
    const uidAttempts = attemptsByUid.get(uid) ?? [];
    const qualifying = uidAttempts.filter((a) => isAttemptComplete(a));

    const invUpdatedMs = extractTimestampMs(inv?.updatedAt);
    const stuUpdatedMs = extractTimestampMs(stu?.updatedAt);
    const lbUpdatedMs = extractTimestampMs(lb?.updatedAt);

    // Source-of-truth precedence with timestamp comparison:
    // - Auth & slot fields (loginId, active, slotNumber) come authoritatively from VipInvite when present.
    // - Display profile fields (displayName, targetPost) pick the newer updatedAt between StudentProfile and VipInvite.
    const preferStudentProfile = Boolean(stu && (!inv || stuUpdatedMs > invUpdatedMs));
    const displayName =
      (preferStudentProfile ? stu?.displayName : inv?.displayName) ||
      inv?.displayName ||
      stu?.displayName ||
      lb?.displayName ||
      uid;
    const targetPost =
      (preferStudentProfile ? stu?.targetPost : inv?.targetPost) ||
      inv?.targetPost ||
      stu?.targetPost ||
      lb?.targetPost ||
      'ASO in MEA';
    const loginId = inv?.loginId || stu?.loginId || pres?.loginId || uid;
    const slotNumber = inv?.slotNumber ?? stu?.slotNumber ?? 1;
    const active = inv ? Boolean(inv.active) : true;

    // Never double-count or sum snapshots across aliases: take canonical UID stats directly.
    const totalXp = lb?.totalXp ?? 0;
    const testsAttempted = Math.max(lb?.testsAttempted ?? 0, qualifying.length);
    const bestScore =
      qualifying.length > 0
        ? Math.max(lb?.bestScore ?? -Infinity, ...qualifying.map((a) => a.score))
        : lb?.bestScore ?? 0;
    const avgAccuracy =
      qualifying.length > 0
        ? Math.round((qualifying.reduce((sum, a) => sum + (a.accuracy || 0), 0) / qualifying.length) * 10) / 10
        : lb?.avgAccuracy ?? 0;

    const online = isPresenceOnline(pres, nowMs);
    const presenceStatus: CanonicalAdminUserRow['presenceStatus'] = online
      ? pres?.status === 'in_exam'
        ? 'in_exam'
        : 'online'
      : 'offline';

    const createdAtMs = Math.min(
      ...[extractTimestampMs(inv?.createdAt), extractTimestampMs(stu?.createdAt)].filter((n) => n > 0),
      0
    );
    const createdCandidates = [
      extractTimestampMs(inv?.createdAt),
      extractTimestampMs(stu?.createdAt),
    ].filter((n) => n > 0);
    const resolvedCreatedAtMs = createdCandidates.length > 0 ? Math.min(...createdCandidates) : 0;
    const resolvedUpdatedAtMs = Math.max(invUpdatedMs, stuUpdatedMs, lbUpdatedMs, 0);

    rows.push({
      uid,
      inviteId: inv?.id,
      loginId,
      displayName,
      targetPost,
      slotNumber,
      active,
      hasInvite: Boolean(inv),
      hasStudentProfile: Boolean(stu),
      hasPasswordHash: Boolean(inv?.passwordHash && inv.passwordHash.length >= 16),
      legacyPlaintextDetected: Boolean(inv?.legacyPlaintextDetected),
      totalXp,
      testsAttempted,
      bestScore: Number.isFinite(bestScore) ? bestScore : 0,
      avgAccuracy,
      presenceStatus,
      lastSeenMs: pres?.lastSeenMs ?? 0,
      createdAtMs: resolvedCreatedAtMs || createdAtMs,
      updatedAtMs: resolvedUpdatedAtMs,
      slotConflictWith: [],
      invite: inv,
    });
  }

  // Detect duplicate slot assignments without silently overwriting slots
  const bySlot = new Map<number, CanonicalAdminUserRow[]>();
  for (const row of rows) {
    const list = bySlot.get(row.slotNumber) ?? [];
    list.push(row);
    bySlot.set(row.slotNumber, list);
  }
  for (const [, group] of bySlot.entries()) {
    if (group.length > 1) {
      for (const row of group) {
        row.slotConflictWith = group
          .filter((other) => other.uid !== row.uid)
          .map((other) => `${other.displayName} (${other.loginId})`);
      }
    }
  }

  return rows.sort((a, b) => {
    if (a.slotNumber !== b.slotNumber) return a.slotNumber - b.slotNumber;
    return a.uid.localeCompare(b.uid);
  });
}

export function findDuplicateSlotConflicts(
  rows: readonly CanonicalAdminUserRow[]
): SlotConflictSummary[] {
  const bySlot = new Map<number, CanonicalAdminUserRow[]>();
  for (const row of rows) {
    const list = bySlot.get(row.slotNumber) ?? [];
    list.push(row);
    bySlot.set(row.slotNumber, list);
  }
  const conflicts: SlotConflictSummary[] = [];
  for (const [slotNumber, group] of bySlot.entries()) {
    if (group.length > 1) {
      conflicts.push({
        slotNumber,
        uids: group.map((g) => g.uid),
        loginIds: group.map((g) => g.loginId),
      });
    }
  }
  return conflicts.sort((a, b) => a.slotNumber - b.slotNumber);
}

export function findNextAvailableSlot(rows: readonly CanonicalAdminUserRow[]): number {
  const used = new Set(rows.map((r) => r.slotNumber));
  for (let slot = 1; slot <= 5; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return Math.min(5, Math.max(1, rows.length + 1));
}

export function filterAdminUserRows(
  rows: readonly CanonicalAdminUserRow[],
  searchQuery: string,
  statusFilter: 'all' | 'active' | 'revoked' = 'all'
): CanonicalAdminUserRow[] {
  const needle = searchQuery.trim().toLowerCase();
  return rows.filter((row) => {
    if (statusFilter === 'active' && !row.active) return false;
    if (statusFilter === 'revoked' && row.active) return false;
    if (!needle) return true;
    const hay = `${row.uid} ${row.loginId} ${row.displayName} ${row.targetPost} slot ${row.slotNumber} #${row.slotNumber}`.toLowerCase();
    return hay.includes(needle);
  });
}

export function inspectLegacyPlaintextInvites(invites: readonly VipInvite[]): {
  totalInvites: number;
  affectedCount: number;
  affectedUids: string[];
} {
  const realInvites = invites.filter((i) => i?.id && !isSystemPlaceholderUid(i.id));
  const affectedUids = realInvites
    .filter((i) => Boolean(i.legacyPlaintextDetected))
    .map((i) => i.id);
  return {
    totalInvites: realInvites.length,
    affectedCount: affectedUids.length,
    affectedUids,
  };
}

export interface PlatformWeakTopicStat {
  microTopic: string;
  subject: SubjectKey;
  totalMisses: number;
  affectedStudentsCount: number;
  affectedStudentNames: string[];
  avgScorePct: number | null;
  weaknessScore: number;
}

export interface CohortStudentMatrixRow {
  uid: string;
  displayName: string;
  targetPost: string;
  totalXp: number;
  qualifyingAttempts: number;
  avgScorePct: number;
  avgAccuracy: number;
  studyHours: number;
  pendingVaultCount: number;
  weakestSubject: string;
}

export interface CohortCommandCenterStats {
  totalCohortAttempts: number;
  qualifyingAttemptsCount: number;
  cohortAvgScorePct: number;
  cohortAvgMock200: number;
  cohortAvgAccuracy: number;
  totalStudyHours: number;
  totalQuestionsSolved: number;
  totalVaultPending: number;
  topWeakTopics: PlatformWeakTopicStat[];
  studentMatrix: CohortStudentMatrixRow[];
}

export function computeCohortCommandCenterStats(params: {
  students: StudentProfile[];
  attempts: TestAttemptDoc[];
  leaderboard: LeaderboardEntry[];
  questions: QuestionDoc[];
  sessionLogs: StudentSessionLogDoc[];
  revisionVaultByUid?: Record<string, Record<string, RevisionItemDoc>>;
}): CohortCommandCenterStats {
  const qMap = new Map(params.questions.map((q) => [q.id, q]));
  const lbMap = new Map(params.leaderboard.map((l) => [l.uid, l]));
  const studentNameMap = new Map(params.students.map((s) => [s.uid, s.displayName]));

  const vaultByUid =
    params.revisionVaultByUid ??
    (typeof localStorage !== 'undefined' ? readLocalDb().revisionVault : {});

  const qualifyingAttempts = params.attempts.filter((a) => isAttemptComplete(a));
  let sumScorePct = 0;
  let scorePctCount = 0;
  let sumAcc = 0;
  let totalQuestionsSolved = 0;

  for (const att of qualifyingAttempts) {
    sumAcc += att.accuracy || 0;
    totalQuestionsSolved += Math.max(0, (att.correctCount || 0) + (att.wrongCount || 0));
    if (att.maxScore > 0) {
      sumScorePct += (att.score / att.maxScore) * 100;
      scorePctCount += 1;
    }
  }

  const cohortAvgScorePct =
    scorePctCount > 0 ? Math.round((sumScorePct / scorePctCount) * 10) / 10 : 0;
  const cohortAvgMock200 = Math.round((cohortAvgScorePct * 2) * 10) / 10;
  const cohortAvgAccuracy =
    qualifyingAttempts.length > 0
      ? Math.round((sumAcc / qualifyingAttempts.length) * 10) / 10
      : 0;

  const totalStudySec = params.sessionLogs.reduce(
    (sum, log) => sum + Math.max(0, log.activeDurationSec || 0),
    0
  );
  const totalStudyHours = Math.round((totalStudySec / 3600) * 10) / 10;

  // Aggregate Top Weak Topics across all students (Revision Vault + low-accuracy topic attempts)
  const weakTopicMap = new Map<
    string,
    {
      microTopic: string;
      subject: SubjectKey;
      misses: number;
      studentIds: Set<string>;
      scorePcts: number[];
    }
  >();

  let totalVaultPending = 0;
  for (const [uid, itemsObj] of Object.entries(vaultByUid)) {
    if (!itemsObj || typeof itemsObj !== 'object') continue;
    for (const item of Object.values(itemsObj)) {
      if (!item || item.mastered) continue;
      totalVaultPending += 1;
      const q = qMap.get(item.questionId);
      const microTopic = resolveMicroTopicLabel(q, item.subject);
      const key = `${item.subject}::${microTopic.toLowerCase()}`;
      const bucket = weakTopicMap.get(key) ?? {
        microTopic,
        subject: item.subject,
        misses: 0,
        studentIds: new Set<string>(),
        scorePcts: [],
      };
      bucket.misses += item.lastSelectedIndex === -1 ? 1 : 2;
      bucket.studentIds.add(uid);
      weakTopicMap.set(key, bucket);
    }
  }

  // Also factor low-accuracy topic-tagged attempts (< 72% accuracy)
  for (const att of params.attempts) {
    if (!att.topicTag || att.accuracy >= 72) continue;
    const subHint: SubjectKey =
      att.subjectScope === 'quant' ||
      att.subjectScope === 'reasoning' ||
      att.subjectScope === 'english' ||
      att.subjectScope === 'ga'
        ? att.subjectScope
        : 'quant';
    const ch = resolveSyllabusChapter(att.topicTag, subHint);
    const subject: SubjectKey = ch?.subject ?? subHint;
    const microTopic = `${SUBJECT_LABELS[subject].short} - ${ch?.title || att.topicTag}`;
    const key = `${subject}::${microTopic.toLowerCase()}`;
    const bucket = weakTopicMap.get(key) ?? {
      microTopic,
      subject,
      misses: 0,
      studentIds: new Set<string>(),
      scorePcts: [],
    };
    bucket.misses += Math.max(1, att.wrongCount || 1);
    bucket.studentIds.add(att.uid);
    if (att.maxScore > 0) {
      bucket.scorePcts.push(Math.round((att.score / att.maxScore) * 1000) / 10);
    }
    weakTopicMap.set(key, bucket);
  }

  const topWeakTopics: PlatformWeakTopicStat[] = Array.from(weakTopicMap.values())
    .map((b) => {
      const avgScorePct =
        b.scorePcts.length > 0
          ? Math.round((b.scorePcts.reduce((s, v) => s + v, 0) / b.scorePcts.length) * 10) / 10
          : null;
      const affectedStudentNames = Array.from(b.studentIds).map(
        (id) => studentNameMap.get(id) || id
      );
      return {
        microTopic: b.microTopic,
        subject: b.subject,
        totalMisses: b.misses,
        affectedStudentsCount: b.studentIds.size,
        affectedStudentNames,
        avgScorePct,
        weaknessScore: b.misses + b.studentIds.size * 2,
      };
    })
    .sort((a, b) => b.weaknessScore - a.weaknessScore)
    .slice(0, 12);

  // Per-student cohort comparison matrix
  const uidSet = new Set<string>([
    ...params.students.map((s) => s.uid),
    ...params.leaderboard.map((l) => l.uid),
  ]);

  const studentMatrix: CohortStudentMatrixRow[] = Array.from(uidSet)
    .map((uid) => {
      const stu = params.students.find((s) => s.uid === uid);
      const lb = lbMap.get(uid);
      const stuAttempts = params.attempts.filter((a) => a.uid === uid && isAttemptComplete(a));
      const stuLogs = params.sessionLogs.filter((l) => l.uid === uid);
      const studySec = stuLogs.reduce((s, l) => s + Math.max(0, l.activeDurationSec || 0), 0);

      let sScore = 0;
      let sCnt = 0;
      let sAcc = 0;
      const subTotals: Record<SubjectKey, { correct: number; attempted: number }> = {
        quant: { correct: 0, attempted: 0 },
        reasoning: { correct: 0, attempted: 0 },
        english: { correct: 0, attempted: 0 },
        ga: { correct: 0, attempted: 0 },
      };

      for (const a of stuAttempts) {
        sAcc += a.accuracy || 0;
        if (a.maxScore > 0) {
          sScore += (a.score / a.maxScore) * 100;
          sCnt += 1;
        }
        if (a.sectionStats) {
          (['quant', 'reasoning', 'english', 'ga'] as SubjectKey[]).forEach((sub) => {
            const st = a.sectionStats?.[sub];
            if (!st) return;
            subTotals[sub].correct += st.correct || 0;
            subTotals[sub].attempted += (st.correct || 0) + (st.wrong || 0);
          });
        }
      }

      let weakestSubject = '—';
      let lowestAcc = 101;
      (['quant', 'reasoning', 'english', 'ga'] as SubjectKey[]).forEach((sub) => {
        if (subTotals[sub].attempted === 0) return;
        const acc = (subTotals[sub].correct / subTotals[sub].attempted) * 100;
        if (acc < lowestAcc) {
          lowestAcc = acc;
          weakestSubject = `${SUBJECT_LABELS[sub].short} (${Math.round(acc)}%)`;
        }
      });

      const pendingVaultCount = Object.values(vaultByUid[uid] ?? {}).filter(
        (v) => v && !v.mastered
      ).length;

      return {
        uid,
        displayName: stu?.displayName || lb?.displayName || uid,
        targetPost: stu?.targetPost || lb?.targetPost || 'SSC CGL Officer',
        totalXp: lb?.totalXp ?? 0,
        qualifyingAttempts: stuAttempts.length,
        avgScorePct: sCnt > 0 ? Math.round((sScore / sCnt) * 10) / 10 : 0,
        avgAccuracy:
          stuAttempts.length > 0
            ? Math.round((sAcc / stuAttempts.length) * 10) / 10
            : lb?.avgAccuracy ?? 0,
        studyHours: Math.round((studySec / 3600) * 10) / 10,
        pendingVaultCount,
        weakestSubject,
      };
    })
    .sort((a, b) => b.totalXp - a.totalXp);

  return {
    totalCohortAttempts: params.attempts.length,
    qualifyingAttemptsCount: qualifyingAttempts.length,
    cohortAvgScorePct,
    cohortAvgMock200,
    cohortAvgAccuracy,
    totalStudyHours,
    totalQuestionsSolved,
    totalVaultPending,
    topWeakTopics,
    studentMatrix,
  };
}

// --- Chapter / Topic Blueprint Custom Mock JSON Builder ---

export interface CustomMockBlueprintSlot {
  subject: SubjectKey;
  chapterSlugOrTopic: string;
  count: number;
  difficulty?: DifficultyLevel | 'any';
}

export interface AssembledBlueprintResult {
  questionIds: string[];
  questions: QuestionDoc[];
  subjectScope: 'full' | SubjectKey;
  shortfalls: Array<{ label: string; requested: number; matched: number }>;
  slotBreakdown: Array<{ label: string; subject: SubjectKey; count: number }>;
}

export function assembleBlueprintCustomMock(params: {
  allQuestions: QuestionDoc[];
  slots: CustomMockBlueprintSlot[];
  seedKey?: string;
}): AssembledBlueprintResult {
  const MAX_QUESTIONS_PER_MOCK = 100;
  const chosen: QuestionDoc[] = [];
  const chosenSet = new Set<string>();
  const shortfalls: Array<{ label: string; requested: number; matched: number }> = [];
  const slotBreakdown: Array<{ label: string; subject: SubjectKey; count: number }> = [];
  const seed = params.seedKey ?? String(Date.now());

  const deterministicRank = (id: string, salt: string): number => {
    let h = 2166136261;
    const raw = `${salt}_${id}`;
    for (let i = 0; i < raw.length; i += 1) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  };

  for (const slot of params.slots) {
    if (chosen.length >= MAX_QUESTIONS_PER_MOCK) break;
    const requested = Math.max(1, Math.min(100, Math.round(slot.count || 0)));
    const remainingCapacity = MAX_QUESTIONS_PER_MOCK - chosen.length;
    const target = Math.min(requested, remainingCapacity);

    const chapterObj =
      MICRO_SYLLABUS_CHAPTERS.find(
        (c) =>
          c.slug === slot.chapterSlugOrTopic ||
          c.title.toLowerCase() === slot.chapterSlugOrTopic.trim().toLowerCase()
      ) ?? resolveSyllabusChapter(slot.chapterSlugOrTopic, slot.subject);

    const cleanNeedles = chapterObj
      ? [chapterObj.title.toLowerCase(), chapterObj.slug.toLowerCase(), ...chapterObj.aliases]
      : [slot.chapterSlugOrTopic.trim().toLowerCase()];

    const pool = params.allQuestions
      .filter((q) => {
        if (chosenSet.has(q.id) || q.subject !== slot.subject) return false;
        if (slot.difficulty && slot.difficulty !== 'any' && q.difficulty !== slot.difficulty) {
          return false;
        }
        if (cleanNeedles.length === 0 || !cleanNeedles[0] || cleanNeedles[0] === 'all') {
          return true;
        }
        const hay = `${q.topic} ${q.questionEn}`.toLowerCase();
        return cleanNeedles.some((needle) => hay.includes(needle));
      })
      .sort(
        (a, b) =>
          deterministicRank(a.id, `${seed}_${slot.chapterSlugOrTopic}`) -
          deterministicRank(b.id, `${seed}_${slot.chapterSlugOrTopic}`)
      );

    const picked = pool.slice(0, target);
    for (const q of picked) {
      chosen.push(q);
      chosenSet.add(q.id);
    }

    const label = chapterObj?.title || slot.chapterSlugOrTopic || SUBJECT_LABELS[slot.subject].short;
    if (picked.length < target) {
      shortfalls.push({ label, requested: target, matched: picked.length });
    }
    if (picked.length > 0) {
      slotBreakdown.push({ label, subject: slot.subject, count: picked.length });
    }
  }

  const subjects = new Set(chosen.map((q) => q.subject));
  const subjectScope: 'full' | SubjectKey =
    subjects.size === 1 ? (Array.from(subjects)[0] as SubjectKey) : 'full';

  return {
    questionIds: chosen.map((q) => q.id),
    questions: chosen,
    subjectScope,
    shortfalls,
    slotBreakdown,
  };
}

export interface PortableCustomMockPayload {
  app: 'Path to CGL';
  type: 'custom_mock_paper';
  schemaVersion: 1;
  exportedAtIso: string;
  paper: {
    title: string;
    subjectScope: 'full' | SubjectKey;
    durationMinutes: number;
    positiveMarks: number;
    negativeMarks: number;
    published: boolean;
    topicTag?: string;
    questionIds: string[];
    questions: Array<QuestionInput & { originalId?: string }>;
  };
}

export function buildPortableCustomMockJson(params: {
  title: string;
  durationMinutes: number;
  positiveMarks: number;
  negativeMarks: number;
  published: boolean;
  topicTag?: string;
  assembled: AssembledBlueprintResult;
}): PortableCustomMockPayload {
  return {
    app: 'Path to CGL',
    type: 'custom_mock_paper',
    schemaVersion: 1,
    exportedAtIso: new Date().toISOString(),
    paper: {
      title: params.title.trim().slice(0, 120),
      subjectScope: params.assembled.subjectScope,
      durationMinutes: Math.max(1, Math.min(240, Math.round(params.durationMinutes))),
      positiveMarks: Math.max(0, Math.min(20, params.positiveMarks)),
      negativeMarks: Math.max(0, Math.min(10, params.negativeMarks)),
      published: params.published,
      ...(params.topicTag ? { topicTag: params.topicTag.slice(0, 80) } : {}),
      questionIds: params.assembled.questionIds,
      questions: params.assembled.questions.map((q) => ({
        originalId: q.id,
        subject: q.subject,
        topic: q.topic,
        difficulty: q.difficulty,
        yearTag: q.yearTag,
        source: q.source,
        questionEn: q.questionEn,
        ...(q.questionHi ? { questionHi: q.questionHi } : {}),
        optionsEn: q.optionsEn,
        ...(q.optionsHi ? { optionsHi: q.optionsHi } : {}),
        correctIndex: q.correctIndex,
        ...(q.explanationEn ? { explanationEn: q.explanationEn } : {}),
        ...(q.explanationHi ? { explanationHi: q.explanationHi } : {}),
        ...(q.shortTrick ? { shortTrick: q.shortTrick } : {}),
      })),
    },
  };
}

export function parsePortableCustomMockJson(rawJson: string): PortableCustomMockPayload {
  const parsed = JSON.parse(rawJson) as Partial<PortableCustomMockPayload>;
  if (!parsed || typeof parsed !== 'object' || !parsed.paper || typeof parsed.paper !== 'object') {
    throw new Error('Invalid Custom Mock JSON: missing "paper" payload.');
  }
  const paper = parsed.paper;
  if (!paper.title || !Array.isArray(paper.questions) || paper.questions.length === 0) {
    throw new Error('Custom Mock JSON must contain a title and at least 1 valid question.');
  }
  return {
    app: 'Path to CGL',
    type: 'custom_mock_paper',
    schemaVersion: 1,
    exportedAtIso: typeof parsed.exportedAtIso === 'string' ? parsed.exportedAtIso : new Date().toISOString(),
    paper: {
      title: String(paper.title).slice(0, 120),
      subjectScope: (['full', 'quant', 'reasoning', 'english', 'ga'].includes(
        String(paper.subjectScope)
      )
        ? paper.subjectScope
        : 'full') as MockTestDoc['subjectScope'],
      durationMinutes: Math.max(1, Math.min(240, Number(paper.durationMinutes) || 20)),
      positiveMarks: Math.max(0, Math.min(20, Number(paper.positiveMarks ?? 2))),
      negativeMarks: Math.max(0, Math.min(10, Number(paper.negativeMarks ?? 0.5))),
      published: Boolean(paper.published ?? true),
      ...(paper.topicTag ? { topicTag: String(paper.topicTag).slice(0, 80) } : {}),
      questionIds: Array.isArray(paper.questionIds) ? paper.questionIds.slice(0, 100) : [],
      questions: paper.questions.slice(0, 100),
    },
  };
}

// --- Scoped 1-Click Data Portability ---

export type DataPortabilityScope = 'full_cohort' | 'students_attempts' | 'questions_mocks';

export interface ScopedExportPayload {
  app: 'Path to CGL';
  formatVersion: 1;
  scope: DataPortabilityScope;
  exportedAtIso: string;
  counts: Record<string, number>;
  database: Partial<LocalFallbackDatabase>;
}

export function buildScopedDataExport(scope: DataPortabilityScope): ScopedExportPayload {
  const full = exportLocalCohortSnapshot().database;

  if (scope === 'students_attempts') {
    const partial: Partial<LocalFallbackDatabase> = {
      version: 1,
      vipInvites: full.vipInvites,
      students: full.students,
      leaderboard: full.leaderboard,
      attempts: full.attempts,
      attemptResponses: full.attemptResponses,
      revisionVault: full.revisionVault,
      xpLedger: full.xpLedger,
      sessionLogs: full.sessionLogs,
    };
    return {
      app: 'Path to CGL',
      formatVersion: 1,
      scope,
      exportedAtIso: new Date().toISOString(),
      counts: {
        students: Object.keys(full.students).length,
        attempts: Object.keys(full.attempts).length,
        leaderboard: Object.keys(full.leaderboard).length,
      },
      database: partial,
    };
  }

  if (scope === 'questions_mocks') {
    const partial: Partial<LocalFallbackDatabase> = {
      version: 1,
      questions: full.questions,
      tests: full.tests,
      tasks: full.tasks,
      scoring: full.scoring,
    };
    return {
      app: 'Path to CGL',
      formatVersion: 1,
      scope,
      exportedAtIso: new Date().toISOString(),
      counts: {
        questions: Object.keys(full.questions).length,
        tests: Object.keys(full.tests).length,
        tasks: Object.keys(full.tasks).length,
      },
      database: partial,
    };
  }

  return {
    app: 'Path to CGL',
    formatVersion: 1,
    scope: 'full_cohort',
    exportedAtIso: new Date().toISOString(),
    counts: {
      students: Object.keys(full.students).length,
      attempts: Object.keys(full.attempts).length,
      questions: Object.keys(full.questions).length,
      tests: Object.keys(full.tests).length,
    },
    database: full,
  };
}

export function parseAndValidateScopedImport(rawJson: string): { importedRecords: number } {
  return importLocalCohortSnapshot(rawJson);
}
