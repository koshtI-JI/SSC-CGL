import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { aiGenerateDailyPack, aiGenerateQuestions } from './aiClient';
import {
  CameraState,
  DEFAULT_SCORING_CONFIG,
  PresenceStatus,
  ProctorCandidateDoc,
  ProctorRoomDoc,
  type CohortTaskDoc,
  type CorrectedQuestionOverrideDoc,
  type DifficultyLevel,
  type LanguageMode,
  type LeaderboardEntry,
  type MockTestDoc,
  type PhysicalChecklistState,
  type ProgressBackupAttemptSummary,
  type ProgressBackupDoc,
  type QuestionDoc,
  type QuestionInput,
  type QuestionResponseState,
  type ReportedQueryDoc,
  type RevisionItemDoc,
  type ScoringConfig,
  type StudentPresenceDoc,
  type StudentProfile,
  type StudentSessionLogDoc,
  type SubjectKey,
  type SupportTicketDoc,
  type TestAttemptDoc,
  type TestDraftDoc,
  type TopicMasteryEntry,
  type VipInvite,
  type XpLedgerEntryDoc,
} from '../types/exam';
import {
  STARTER_QUESTIONS,
  STARTER_TASKS,
  STARTER_TESTS,
} from '../data/sscStarterBank';
import {
  applyActivityMultiplier,
  buildAdaptiveQuestionSelection,
  buildDailySectionalTestId,
  calculateTestOutcome,
  computeTaskProgress,
  computeUpdatedLeaderboardStats,
  DAILY_MOCK_PREFIX,
  formatDailyMockTitle,
  formatDailySectionalTitle,
  getLocalDateKey,
  isAttemptComplete,
  isTaskExpired,
  loginIdToKey,
  selectCustomMockQuestions,
} from '../utils/examEngine';
import {
  resolveDeterministicAttemptId,
  resolveDeterministicXpLedgerId,
} from '../utils/examTimer';
import { resolveSyllabusChapter } from '../utils/dreamPostCatalog';
import { findSyllabusChapterByValue } from '../utils/syllabusCatalog';
import {
  assembleTier1Questions,
  TIER1_NEGATIVE_MARKS,
  TIER1_POSITIVE_MARKS,
  TIER1_SECTION_DURATION_SEC,
  TIER1_SECTION_ORDER,
  TIER1_TOTAL_DURATION_MINUTES,
} from '../utils/tier1Engine';
import {
  assembleTier2Questions,
  TIER2_NEGATIVE_MARKS,
  TIER2_POSITIVE_MARKS,
  TIER2_SECTION_DURATION_SEC,
  TIER2_SECTION_ORDER,
  TIER2_TOTAL_DURATION_MINUTES,
} from '../utils/tier2Engine';
import { formatYearTagFromMetadata, normalizeQuestionDoc } from '../utils/questionSchema';
import {
  clearFirestoreQuotaExceeded,
  isFirestoreQuotaExceeded,
  isQuotaExceededError,
  markFirestoreQuotaExceeded,
  raceWithWriteTimeout,
} from '../utils/firestoreQuota';
import {
  addTombstone,
  mergeByIdWithTombstones,
  mutateLocalDb,
  queuePendingSyncOp,
  readLocalDb,
  removeTombstone,
  sanitizeVipInviteForStorage,
  shouldFallbackToLocalOnError,
  subscribeLocalDb,
  type FailedSyncOp,
  type PendingSyncOp,
} from '../utils/localFallbackStore';
import {
  classifySyncFailure,
  computeSyncHealthState,
  isPendingOpReadyForRetry,
  recordTransientOpRetry,
  requeueFailedOpsForRetry,
  toPermanentFailedOp,
  type SyncHealthState,
} from '../utils/cloudFirstSync';
import {
  DEFAULT_PLATFORM_CONFIG,
  normalizePlatformConfig,
  type PlatformConfig,
} from '../utils/platformConfig';
import {
  fetchStaticGKQuestionDocs,
  getAllStaticGkQuestionDocs,
  isGeneralAwarenessSubjectOrTopic,
} from '../utils/staticGkBank';
import {
  cacheMockCatalogForOffline,
  deleteOfflineExamDraft,
  getOfflineExamDraft,
  getOfflineMockPack,
  listOfflineMockPacks,
  saveOfflineExamDraft,
  saveOfflineMockPack,
  type OfflineMockPack,
} from '../utils/indexedDbStore';
import {
  ADMIN_PREVIEW_UID,
  db,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  applyCorrectedQuestionOverrides,
  isRealCohortStudentUid,
  isValidAvatarDataUrl,
} from '../utils/sessionAndOverrides';

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

class DomainValidationError extends Error {}

function extractCreatedOrUpdatedMs(raw: unknown): number {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  if (typeof (raw as { toMillis?: () => number }).toMillis === 'function') {
    return (raw as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function mapRemoteVipInvite(id: string, rawData: Record<string, unknown>): VipInvite {
  return sanitizeVipInviteForStorage({
    id,
    loginId: typeof rawData.loginId === 'string' ? rawData.loginId : id,
    displayName: typeof rawData.displayName === 'string' ? rawData.displayName : id,
    targetPost: typeof rawData.targetPost === 'string' ? rawData.targetPost : 'ASO in MEA',
    slotNumber: typeof rawData.slotNumber === 'number' ? rawData.slotNumber : 1,
    active: Boolean(rawData.active),
    passwordHash: typeof rawData.passwordHash === 'string' ? rawData.passwordHash : '',
    legacyPlaintextDetected:
      typeof rawData.currentPassword === 'string' && rawData.currentPassword.length > 0,
    createdAt: rawData.createdAt,
    updatedAt: rawData.updatedAt,
  });
}

function handleSubscriptionError(err: unknown, op: OperationType, path: string): void {
  if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
    if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    return;
  }
  console.warn(`Firestore subscription fallback (${op} ${path}):`, err);
}

async function executeWriteWithLocalFallback<T>(params: {
  tryRemote: () => Promise<T>;
  applyLocal: () => T;
  op?: Omit<PendingSyncOp, 'key' | 'queuedAtMs'>;
}): Promise<T> {
  if (isFirestoreQuotaExceeded()) {
    const res = params.applyLocal();
    if (params.op) {
      mutateLocalDb((draft) => {
        queuePendingSyncOp(draft, params.op!);
      });
    }
    return res;
  }
  try {
    return await raceWithWriteTimeout(params.tryRemote());
  } catch (err) {
    if (err instanceof DomainValidationError) throw err;
    if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      const res = params.applyLocal();
      if (params.op) {
        mutateLocalDb((draft) => {
          queuePendingSyncOp(draft, params.op!);
        });
      }
      return res;
    }
    throw err;
  }
}

export function getNormalizedStarterTests(): MockTestDoc[] {
  return STARTER_TESTS.map((t) => ({
    id: t.seedId,
    title: t.title,
    subjectScope: t.subjectScope,
    durationMinutes: t.durationMinutes,
    positiveMarks: t.positiveMarks,
    negativeMarks: t.negativeMarks,
    questionIds: t.questionSeedIds,
    questionCount: t.questionSeedIds.length,
    published: true,
    createdBy: 'starter_bank',
    updatedAt: 1,
  }));
}

export function getNormalizedStarterTasks(): CohortTaskDoc[] {
  return STARTER_TASKS.map((t) => ({
    id: t.seedId,
    title: t.title,
    description: t.description,
    targetTests: t.targetTests,
    targetSubject: t.targetSubject,
    bonusXp: t.bonusXp,
    dueDate: t.dueDate,
    active: t.active,
    updatedAt: 1,
  }));
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// --- Pure ID + Password Admin Credentials ---

export async function getAdminCredentialsStatus(): Promise<{
  initialized: boolean;
  adminId?: string;
}> {
  const localCreds = readLocalDb().adminCredentials;
  const canFetchRemote =
    !isFirestoreQuotaExceeded() &&
    (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (canFetchRemote) {
    try {
      const snap = await raceWithWriteTimeout(
        getDoc(doc(db, 'settings', 'adminCredentials')),
        1500
      );
      if (snap.exists()) {
        const data = snap.data() as { adminId?: string; passwordHash?: string; updatedAt?: unknown };
        if (data.adminId && data.passwordHash) {
          const remoteMs = extractCreatedOrUpdatedMs(data.updatedAt);
          if (localCreds && localCreds.updatedAtMs > remoteMs) {
            return { initialized: true, adminId: localCreds.adminId };
          }
          mutateLocalDb((draft) => {
            draft.adminCredentials = {
              adminId: data.adminId!,
              passwordHash: data.passwordHash!,
              updatedAtMs: remoteMs || Date.now(),
            };
          });
          return { initialized: true, adminId: data.adminId };
        }
      }
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    }
  }
  if (localCreds?.adminId && localCreds?.passwordHash) {
    return { initialized: true, adminId: localCreds.adminId };
  }
  return { initialized: false };
}

export async function saveAdminCredentials(adminId: string, password: string): Promise<string> {
  const cleanId = adminId.trim().toLowerCase().slice(0, 120);
  if (cleanId.length < 2) {
    throw new DomainValidationError('Admin ID must be at least 2 characters.');
  }
  if (password.length < 4) {
    throw new DomainValidationError('Master Password must be at least 4 characters.');
  }
  const passwordHash = await sha256Hex(`sankalp_admin_v1:${password}`);
  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.adminCredentials = {
        adminId: cleanId,
        passwordHash,
        updatedAtMs: Date.now(),
      };
    });
    return cleanId;
  };

  return executeWriteWithLocalFallback({
    tryRemote: async () => {
      await setDoc(doc(db, 'settings', 'adminCredentials'), {
        adminId: cleanId,
        passwordHash,
        updatedAt: serverTimestamp(),
      });
      return applyLocal();
    },
    applyLocal,
    op: { entity: 'adminCredentials', docId: 'adminCredentials' },
  });
}

export async function verifyAdminLogin(
  adminId: string,
  password: string
): Promise<{ ok: boolean; adminId?: string; error?: string }> {
  const cleanId = adminId.trim().toLowerCase();
  const inputHash = await sha256Hex(`sankalp_admin_v1:${password}`);
  let creds = readLocalDb().adminCredentials;

  const canFetchRemote =
    !isFirestoreQuotaExceeded() &&
    (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (canFetchRemote) {
    try {
      const snap = await raceWithWriteTimeout(
        getDoc(doc(db, 'settings', 'adminCredentials')),
        1500
      );
      if (snap.exists()) {
        const data = snap.data() as { adminId?: string; passwordHash?: string; updatedAt?: unknown };
        if (data.adminId && data.passwordHash) {
          const remoteMs = extractCreatedOrUpdatedMs(data.updatedAt);
          if (!creds || remoteMs >= creds.updatedAtMs) {
            creds = {
              adminId: data.adminId,
              passwordHash: data.passwordHash,
              updatedAtMs: remoteMs || Date.now(),
            };
            mutateLocalDb((draft) => {
              draft.adminCredentials = creds;
            });
          }
        }
      }
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    }
  }

  if (!creds || !creds.adminId || !creds.passwordHash) {
    return { ok: false, error: 'Super Admin ID & Password have not been set up yet.' };
  }
  if (cleanId !== creds.adminId.toLowerCase() || inputHash !== creds.passwordHash) {
    return { ok: false, error: 'Invalid Admin ID or Master Password.' };
  }
  return { ok: true, adminId: creds.adminId };
}

export async function restoreAdminSession(adminId: string): Promise<boolean> {
  const target = adminId.trim().toLowerCase();
  const localCreds = readLocalDb().adminCredentials;
  if (localCreds?.adminId && localCreds.adminId.toLowerCase() === target) {
    return true;
  }
  if (isFirestoreQuotaExceeded() || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return false;
  }
  try {
    const snap = await raceWithWriteTimeout(
      getDoc(doc(db, 'settings', 'adminCredentials')),
      1500
    );
    if (!snap.exists()) return false;
    const data = snap.data() as { adminId?: string };
    return Boolean(data.adminId && data.adminId.toLowerCase() === target);
  } catch {
    return Boolean(localCreds?.adminId && localCreds.adminId.toLowerCase() === target);
  }
}

// --- Pure ID + Password VIP Student Login ---

export async function verifyStudentLogin(
  loginId: string,
  password: string
): Promise<{ ok: boolean; student?: StudentProfile; error?: string }> {
  const cleanLoginId = loginId.trim().toLowerCase();
  if (!cleanLoginId || !password) {
    return { ok: false, error: 'Please enter both Student ID and Password.' };
  }

  const key = loginIdToKey(cleanLoginId);
  const localDbBefore = readLocalDb();
  const deletedInvites = new Set(localDbBefore.deletedIds.vipInvites);
  let remoteInvites: VipInvite[] = [];

  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  let remoteLoginReachable = !isFirestoreQuotaExceeded() && !isOffline;
  if (remoteLoginReachable) {
    try {
      const inviteSnap = await raceWithWriteTimeout(getDoc(doc(db, 'vipInvites', key)), 1500);
      if (inviteSnap.exists()) {
        remoteInvites.push(mapRemoteVipInvite(inviteSnap.id, inviteSnap.data() as Record<string, unknown>));
      }
      const hasMatchInSingle = remoteInvites.some(
        (c) => c.loginId.trim().toLowerCase() === cleanLoginId
      );
      if (!hasMatchInSingle) {
        const allInvitesSnap = await raceWithWriteTimeout(
          getDocs(
            query(collection(db, 'vipInvites'), where('slotNumber', '>=', 1), where('slotNumber', '<=', 5))
          ),
          1500
        );
        const queried = allInvitesSnap.docs.map((d) =>
          mapRemoteVipInvite(d.id, d.data() as Record<string, unknown>)
        );
        const seen = new Set(queried.map((qInv) => qInv.id));
        for (const single of remoteInvites) {
          if (!seen.has(single.id)) queried.push(single);
        }
        remoteInvites = queried;
      }
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      if (shouldFallbackToLocalOnError(err)) remoteLoginReachable = false;
    }
  }

  const mergedInvites = mergeByIdWithTombstones({
    remoteItems: remoteInvites,
    localItems: Object.values(localDbBefore.vipInvites).map((i) => sanitizeVipInviteForStorage(i)),
    deletedIds: Array.from(deletedInvites),
    getId: (i) => i.id,
  });

  const invite =
    mergedInvites.find((inv) => inv.loginId.trim().toLowerCase() === cleanLoginId) ?? null;

  if (!invite) {
    return {
      ok: false,
      error: 'Student ID not found. Ask your Super Admin to create your ID & Password.',
    };
  }

  if (!invite.active) {
    return {
      ok: false,
      error: 'This Student ID is currently paused or revoked by Super Admin.',
    };
  }

  const inputHash = await sha256Hex(`sankalp_vip_v1:${password}`);
  if (inputHash !== invite.passwordHash) {
    return { ok: false, error: 'Incorrect password for this Student ID.' };
  }

  // Ensure student profile & leaderboard entry exist cleanly under immutable UID (invite.id)
  const uid = invite.id;
  let remoteStudent: StudentProfile | null = null;
  let remoteLb: LeaderboardEntry | null = null;

  if (remoteLoginReachable) {
    try {
      const studentSnap = await raceWithWriteTimeout(getDoc(doc(db, 'students', uid)), 1500);
      if (studentSnap.exists()) {
        remoteStudent = studentSnap.data() as StudentProfile;
      }
      const lbSnap = await raceWithWriteTimeout(getDoc(doc(db, 'leaderboard', uid)), 1500);
      if (lbSnap.exists()) {
        remoteLb = lbSnap.data() as LeaderboardEntry;
      }
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    }
  }

  const localStudent = localDbBefore.students[uid] ?? null;
  const effectiveProfileBase =
    localStudent && extractCreatedOrUpdatedMs(localStudent.updatedAt) >= extractCreatedOrUpdatedMs(remoteStudent?.updatedAt)
      ? localStudent
      : remoteStudent ?? localStudent;

  if (effectiveProfileBase) {
    const inviteUpdatedMs = extractCreatedOrUpdatedMs(invite.updatedAt);
    const profileUpdatedMs = extractCreatedOrUpdatedMs(effectiveProfileBase.updatedAt);
    const preferInviteDisplay = inviteUpdatedMs > profileUpdatedMs;
    const effectiveName = (
      preferInviteDisplay
        ? invite.displayName || effectiveProfileBase.displayName
        : effectiveProfileBase.displayName || invite.displayName
    ).slice(0, 80);
    const effectivePost = (
      preferInviteDisplay
        ? invite.targetPost || effectiveProfileBase.targetPost
        : effectiveProfileBase.targetPost || invite.targetPost
    ).slice(0, 80);
    const syncedStudent: StudentProfile = {
      ...effectiveProfileBase,
      uid,
      loginId: cleanLoginId,
      displayName: effectiveName,
      targetPost: effectivePost,
      slotNumber: invite.slotNumber,
      updatedAt: Date.now(),
    };

    const needsStudentSync =
      effectiveProfileBase.loginId !== cleanLoginId ||
      effectiveProfileBase.displayName !== effectiveName ||
      effectiveProfileBase.targetPost !== effectivePost ||
      effectiveProfileBase.slotNumber !== invite.slotNumber;

    if (needsStudentSync) {
      await executeWriteWithLocalFallback({
        tryRemote: async () => {
          await updateDoc(doc(db, 'students', uid), {
            loginId: cleanLoginId,
            displayName: effectiveName,
            targetPost: effectivePost,
            slotNumber: invite.slotNumber,
            updatedAt: serverTimestamp(),
          });
          if (remoteLb) {
            await updateDoc(doc(db, 'leaderboard', uid), {
              displayName: effectiveName,
              targetPost: effectivePost,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          } else {
            await setDoc(doc(db, 'leaderboard', uid), {
              uid,
              displayName: effectiveName,
              targetPost: effectivePost,
              cohortId: 'ssc_cgl_vip',
              totalXp: 0,
              testsAttempted: 0,
              bestScore: 0,
              avgAccuracy: 0,
              totalTimeSec: 0,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          }
        },
        applyLocal: () => {
          mutateLocalDb((draft) => {
            draft.students[uid] = syncedStudent;
            const prevLb = draft.leaderboard[uid] ?? remoteLb;
            draft.leaderboard[uid] = {
              uid,
              displayName: effectiveName,
              targetPost: effectivePost,
              cohortId: 'ssc_cgl_vip',
              totalXp: prevLb?.totalXp ?? 0,
              testsAttempted: prevLb?.testsAttempted ?? 0,
              bestScore: prevLb?.bestScore ?? 0,
              avgAccuracy: prevLb?.avgAccuracy ?? 0,
              totalTimeSec: prevLb?.totalTimeSec ?? 0,
              updatedAt: Date.now(),
            };
          });
        },
        op: { entity: 'student', docId: uid },
      });
    } else {
      mutateLocalDb((draft) => {
        draft.vipInvites[invite.id] = invite;
        draft.students[uid] = syncedStudent;
        if (remoteLb && !draft.leaderboard[uid]) {
          draft.leaderboard[uid] = remoteLb;
        }
      });
    }

    return { ok: true, student: syncedStudent };
  }

  const nowMs = Date.now();
  const profilePayloadLocal: StudentProfile = {
    uid,
    loginId: cleanLoginId,
    displayName: invite.displayName.slice(0, 80),
    targetPost: invite.targetPost.slice(0, 80),
    slotNumber: invite.slotNumber,
    cohortId: 'ssc_cgl_vip',
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  const lbPayloadLocal: LeaderboardEntry = {
    uid,
    displayName: invite.displayName.slice(0, 80),
    targetPost: invite.targetPost.slice(0, 80),
    cohortId: 'ssc_cgl_vip',
    totalXp: 0,
    testsAttempted: 0,
    bestScore: 0,
    avgAccuracy: 0,
    totalTimeSec: 0,
    updatedAt: nowMs,
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'students', uid), {
        ...profilePayloadLocal,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'leaderboard', uid), {
        ...lbPayloadLocal,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      mutateLocalDb((draft) => {
        draft.vipInvites[invite.id] = invite;
        draft.students[uid] = profilePayloadLocal;
        draft.leaderboard[uid] = lbPayloadLocal;
      });
    },
    applyLocal: () => {
      mutateLocalDb((draft) => {
        draft.vipInvites[invite.id] = invite;
        draft.students[uid] = profilePayloadLocal;
        draft.leaderboard[uid] = lbPayloadLocal;
      });
    },
    op: { entity: 'student', docId: uid },
  });

  return { ok: true, student: profilePayloadLocal };
}

export async function restoreStudentSession(
  uid: string
): Promise<{ ok: boolean; student?: StudentProfile }> {
  const localDb = readLocalDb();
  const localInvite = localDb.vipInvites[uid];
  const localStudent = localDb.students[uid];
  if (localDb.deletedIds.vipInvites.includes(uid)) {
    return { ok: false };
  }

  try {
    const inviteSnap = await getDoc(doc(db, 'vipInvites', uid));
    const invite = inviteSnap.exists()
      ? (inviteSnap.data() as Omit<VipInvite, 'id'>)
      : localInvite;
    if (!invite || !invite.active) {
      return { ok: false };
    }
    const studentSnap = await getDoc(doc(db, 'students', uid));
    if (studentSnap.exists()) {
      const remote = studentSnap.data() as StudentProfile;
      if (
        localStudent &&
        extractCreatedOrUpdatedMs(localStudent.updatedAt) > extractCreatedOrUpdatedMs(remote.updatedAt)
      ) {
        return { ok: true, student: localStudent };
      }
      return { ok: true, student: remote };
    }
    if (localStudent) return { ok: true, student: localStudent };
    return { ok: false };
  } catch {
    if (localInvite?.active && localStudent) {
      return { ok: true, student: localStudent };
    }
    return { ok: false };
  }
}

export async function updateStudentOwnProfile(
  uid: string,
  input: {
    displayName: string;
    targetPost: string;
    targetYear?: string;
    city?: string;
    bio?: string;
    avatarDataUrl?: string | null;
  }
): Promise<StudentProfile> {
  const cleanName = input.displayName.trim().slice(0, 80);
  const cleanPost = input.targetPost.trim().slice(0, 80);
  if (!cleanName) {
    throw new DomainValidationError('Name cannot be empty.');
  }
  if (!cleanPost) {
    throw new DomainValidationError('Target position cannot be empty.');
  }

  const cleanYear = (input.targetYear ?? '').trim().slice(0, 20);
  const cleanCity = (input.city ?? '').trim().slice(0, 60);
  const cleanBio = (input.bio ?? '').trim().slice(0, 240);
  const hasAvatarUpdate = input.avatarDataUrl !== undefined;
  const nextAvatar =
    input.avatarDataUrl === null
      ? ''
      : isValidAvatarDataUrl(input.avatarDataUrl)
        ? input.avatarDataUrl.trim()
        : undefined;

  let baseStudent: StudentProfile | null = readLocalDb().students[uid] ?? null;
  if (!baseStudent && !isFirestoreQuotaExceeded()) {
    try {
      const snap = await getDoc(doc(db, 'students', uid));
      if (snap.exists()) baseStudent = snap.data() as StudentProfile;
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    }
  }
  if (!baseStudent) {
    throw new DomainValidationError('Student profile record not found.');
  }

  const updatedLocal: StudentProfile = {
    ...baseStudent,
    displayName: cleanName,
    targetPost: cleanPost,
    ...(cleanYear || baseStudent.targetYear !== undefined ? { targetYear: cleanYear } : {}),
    ...(cleanCity || baseStudent.city !== undefined ? { city: cleanCity } : {}),
    ...(cleanBio || baseStudent.bio !== undefined ? { bio: cleanBio } : {}),
    ...(hasAvatarUpdate
      ? { avatarDataUrl: nextAvatar ?? '' }
      : baseStudent.avatarDataUrl
        ? { avatarDataUrl: baseStudent.avatarDataUrl }
        : {}),
    updatedAt: Date.now(),
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.students[uid] = updatedLocal;
      if (draft.leaderboard[uid]) {
        draft.leaderboard[uid] = {
          ...draft.leaderboard[uid],
          displayName: cleanName,
          targetPost: cleanPost,
          updatedAt: Date.now(),
        };
      }
      if (draft.vipInvites[uid]) {
        draft.vipInvites[uid] = {
          ...draft.vipInvites[uid],
          displayName: cleanName,
          targetPost: cleanPost,
          updatedAt: Date.now(),
        };
      }
    });
    return updatedLocal;
  };

  return executeWriteWithLocalFallback({
    tryRemote: async () => {
      const studentRef = doc(db, 'students', uid);
      const snap = await getDoc(studentRef);
      if (!snap.exists()) {
        return applyLocal();
      }
      const baseUpdate: Record<string, unknown> = {
        displayName: cleanName,
        targetPost: cleanPost,
        updatedAt: serverTimestamp(),
      };
      const existingData = snap.data() as StudentProfile;
      if (cleanYear || existingData.targetYear !== undefined) baseUpdate.targetYear = cleanYear;
      if (cleanCity || existingData.city !== undefined) baseUpdate.city = cleanCity;
      if (cleanBio || existingData.bio !== undefined) baseUpdate.bio = cleanBio;
      if (hasAvatarUpdate && nextAvatar !== undefined) {
        baseUpdate.avatarDataUrl = nextAvatar;
      }

      await updateDoc(studentRef, baseUpdate).catch(async () => {
        await updateDoc(studentRef, {
          displayName: cleanName,
          targetPost: cleanPost,
          updatedAt: serverTimestamp(),
        });
      });

      const lbSnap = await getDoc(doc(db, 'leaderboard', uid));
      if (lbSnap.exists()) {
        await updateDoc(doc(db, 'leaderboard', uid), {
          displayName: cleanName,
          targetPost: cleanPost,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      const invSnap = await getDoc(doc(db, 'vipInvites', uid));
      if (invSnap.exists()) {
        await updateDoc(doc(db, 'vipInvites', uid), {
          displayName: cleanName,
          targetPost: cleanPost,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      const refreshed = await getDoc(studentRef);
      const remoteDoc = refreshed.data() as StudentProfile;
      mutateLocalDb((draft) => {
        draft.students[uid] = remoteDoc;
      });
      return remoteDoc;
    },
    applyLocal,
    op: { entity: 'student', docId: uid },
  });
}

export async function updateStudentGamificationState(
  uid: string,
  patch: {
    targetPost?: string;
    physicalChecklist?: PhysicalChecklistState;
    syllabusMastery?: Record<string, TopicMasteryEntry>;
  }
): Promise<StudentProfile> {
  let baseStudent: StudentProfile | null = readLocalDb().students[uid] ?? null;
  if (!baseStudent && !isFirestoreQuotaExceeded()) {
    try {
      const snap = await getDoc(doc(db, 'students', uid));
      if (snap.exists()) baseStudent = snap.data() as StudentProfile;
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    }
  }
  if (!baseStudent) {
    throw new DomainValidationError('Student profile record not found.');
  }

  const cleanPost = patch.targetPost?.trim().slice(0, 80);
  const updatedLocal: StudentProfile = {
    ...baseStudent,
    ...(cleanPost ? { targetPost: cleanPost } : {}),
    ...(patch.physicalChecklist
      ? {
          physicalChecklist: {
            height: Boolean(patch.physicalChecklist.height),
            walking: Boolean(patch.physicalChecklist.walking),
            cycling: Boolean(patch.physicalChecklist.cycling),
          },
        }
      : {}),
    ...(patch.syllabusMastery ? { syllabusMastery: patch.syllabusMastery } : {}),
    updatedAt: Date.now(),
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.students[uid] = updatedLocal;
      if (cleanPost && draft.leaderboard[uid]) {
        draft.leaderboard[uid] = {
          ...draft.leaderboard[uid],
          targetPost: cleanPost,
          updatedAt: Date.now(),
        };
      }
      if (cleanPost && draft.vipInvites[uid]) {
        draft.vipInvites[uid] = {
          ...draft.vipInvites[uid],
          targetPost: cleanPost,
          updatedAt: Date.now(),
        };
      }
    });
    return updatedLocal;
  };

  return executeWriteWithLocalFallback({
    tryRemote: async () => {
      const studentRef = doc(db, 'students', uid);
      const snap = await getDoc(studentRef);
      if (!snap.exists()) return applyLocal();

      const updatePayload: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (cleanPost) updatePayload.targetPost = cleanPost;
      if (updatedLocal.physicalChecklist) {
        updatePayload.physicalChecklist = updatedLocal.physicalChecklist;
      }
      if (patch.syllabusMastery) updatePayload.syllabusMastery = patch.syllabusMastery;

      await updateDoc(studentRef, updatePayload);
      if (cleanPost) {
        const lbSnap = await getDoc(doc(db, 'leaderboard', uid));
        if (lbSnap.exists()) {
          await updateDoc(doc(db, 'leaderboard', uid), {
            targetPost: cleanPost,
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
        const invSnap = await getDoc(doc(db, 'vipInvites', uid));
        if (invSnap.exists()) {
          await updateDoc(doc(db, 'vipInvites', uid), {
            targetPost: cleanPost,
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      }
      const refreshed = await getDoc(studentRef);
      const remoteDoc = refreshed.data() as StudentProfile;
      mutateLocalDb((draft) => {
        draft.students[uid] = remoteDoc;
      });
      return remoteDoc;
    },
    applyLocal,
    op: { entity: 'student', docId: uid },
  });
}

export async function ensureAdminStudentPreviewProfile(
  uid: string,
  loginId: string
): Promise<StudentProfile> {
  const localExisting = readLocalDb().students[uid];
  const cleanLoginId = (loginId.trim().toLowerCase() || 'admin').slice(0, 120);
  const safeLoginId = cleanLoginId.length >= 2 ? cleanLoginId : 'admin_preview';
  const nowMs = Date.now();
  const profilePayloadLocal: StudentProfile = localExisting ?? {
    uid,
    loginId: safeLoginId,
    displayName: 'Admin Preview',
    targetPost: 'ASO in MEA',
    slotNumber: 1,
    cohortId: 'ssc_cgl_vip',
    createdAt: nowMs,
    updatedAt: nowMs,
  };

  // Never pollute remote Firestore or real cohort leaderboard with Admin preview profiles
  mutateLocalDb((draft) => {
    draft.students[uid] = profilePayloadLocal;
    delete draft.leaderboard[uid];
  });
  return profilePayloadLocal;
}

// --- Scoring Config ---

export function subscribeScoringConfig(onChange: (cfg: ScoringConfig) => void): Unsubscribe {
  const path = 'settings/scoring';
  let latestRemote: ScoringConfig | null = null;

  const emit = () => {
    const localCfg = readLocalDb().scoring;
    if (localCfg && latestRemote) {
      const localMs = extractCreatedOrUpdatedMs(localCfg.updatedAt);
      const remoteMs = extractCreatedOrUpdatedMs(latestRemote.updatedAt);
      onChange({
        ...DEFAULT_SCORING_CONFIG,
        ...(localMs >= remoteMs ? localCfg : latestRemote),
      });
      return;
    }
    onChange({
      ...DEFAULT_SCORING_CONFIG,
      ...(localCfg ?? latestRemote ?? {}),
    });
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const unsubRemote = onSnapshot(
    doc(db, 'settings', 'scoring'),
    (snap) => {
      latestRemote = snap.exists() ? (snap.data() as ScoringConfig) : null;
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.GET, path);
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

export async function saveScoringConfig(config: ScoringConfig): Promise<void> {
  const normalized: ScoringConfig = {
    pointsPerCorrect: Number(config.pointsPerCorrect),
    negativeMarks: Number(config.negativeMarks),
    xpAttemptBase: Number(config.xpAttemptBase),
    xpPerCorrect: Number(config.xpPerCorrect),
    xpAccuracyThreshold: Number(config.xpAccuracyThreshold),
    xpAccuracyBonus: Number(config.xpAccuracyBonus),
    updatedAt: Date.now(),
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.scoring = normalized;
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      await setDoc(doc(db, 'settings', 'scoring'), {
        pointsPerCorrect: normalized.pointsPerCorrect,
        negativeMarks: normalized.negativeMarks,
        xpAttemptBase: normalized.xpAttemptBase,
        xpPerCorrect: normalized.xpPerCorrect,
        xpAccuracyThreshold: normalized.xpAccuracyThreshold,
        xpAccuracyBonus: normalized.xpAccuracyBonus,
        updatedAt: serverTimestamp(),
      });
      applyLocal();
    },
    applyLocal,
    op: { entity: 'scoring', docId: 'scoring' },
  });
}

// --- Platform Config (Dynamic Settings Manager) ---

export function subscribePlatformConfig(onChange: (cfg: PlatformConfig) => void): Unsubscribe {
  let latestRemote: Partial<PlatformConfig> | null = null;

  const emit = () => {
    const localCfg = readLocalDb().platformConfig;
    if (localCfg && latestRemote) {
      const localMs = extractCreatedOrUpdatedMs(localCfg.updatedAtMs);
      const remoteMs = extractCreatedOrUpdatedMs(latestRemote.updatedAtMs);
      onChange(
        normalizePlatformConfig(localMs >= remoteMs ? localCfg : latestRemote)
      );
      return;
    }
    onChange(normalizePlatformConfig(localCfg ?? latestRemote ?? DEFAULT_PLATFORM_CONFIG));
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const unsubRemote = onSnapshot(
    doc(db, 'settings', 'platformConfig'),
    (snap) => {
      latestRemote = snap.exists() ? (snap.data() as Partial<PlatformConfig>) : null;
      emit();
    },
    () => {
      // Prod rules before DRAFT_firestore.rules deploy restrict settings/platformConfig; local/IDB store remains active.
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

export async function savePlatformConfig(
  config: Partial<PlatformConfig>
): Promise<{ savedLocally: boolean; remoteSynced: boolean }> {
  const normalized = normalizePlatformConfig({
    ...readLocalDb().platformConfig,
    ...config,
    updatedAtMs: Date.now(),
  });

  mutateLocalDb((draft) => {
    draft.platformConfig = normalized;
  });

  if (isFirestoreQuotaExceeded()) {
    mutateLocalDb((draft) => {
      queuePendingSyncOp(draft, { entity: 'platformConfig', docId: 'platformConfig' });
    });
    return { savedLocally: true, remoteSynced: false };
  }

  try {
    await raceWithWriteTimeout(
      setDoc(doc(db, 'settings', 'platformConfig'), {
        ...normalized,
        updatedAt: serverTimestamp(),
      })
    );
    return { savedLocally: true, remoteSynced: true };
  } catch (err) {
    const cls = classifySyncFailure(err);
    // If prod rules have not yet added settings/platformConfig, keep saved cleanly in local/IDB without poisoning sync queue.
    if (cls.code.toLowerCase().includes('permission-denied')) {
      return { savedLocally: true, remoteSynced: false };
    }
    if (cls.kind === 'transient') {
      if (cls.quotaBlocked) markFirestoreQuotaExceeded(err);
      mutateLocalDb((draft) => {
        queuePendingSyncOp(draft, { entity: 'platformConfig', docId: 'platformConfig' });
      });
      return { savedLocally: true, remoteSynced: false };
    }
    throw err;
  }
}

// --- VIP Invites (5 Fixed Slots) ---

export function subscribeVipInvites(onChange: (invites: VipInvite[]) => void): Unsubscribe {
  const path = 'vipInvites';
  let latestRemote: VipInvite[] = [];

  const emit = () => {
    const localDb = readLocalDb();
    const merged = mergeByIdWithTombstones({
      remoteItems: latestRemote,
      localItems: Object.values(localDb.vipInvites).map((i) => sanitizeVipInviteForStorage(i)),
      deletedIds: localDb.deletedIds.vipInvites,
      getId: (inv) => inv.id,
    }).sort((a, b) => a.slotNumber - b.slotNumber);
    onChange(merged);
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = query(
    collection(db, 'vipInvites'),
    where('slotNumber', '>=', 1),
    where('slotNumber', '<=', 5)
  );
  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      latestRemote = snap.docs.map((d) =>
        mapRemoteVipInvite(d.id, d.data() as Record<string, unknown>)
      );
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

async function listMergedVipInvites(): Promise<VipInvite[]> {
  let remoteItems: VipInvite[] = [];
  if (!isFirestoreQuotaExceeded()) {
    try {
      const allSnap = await getDocs(
        query(collection(db, 'vipInvites'), where('slotNumber', '>=', 1), where('slotNumber', '<=', 5))
      );
      remoteItems = allSnap.docs.map((d) =>
        mapRemoteVipInvite(d.id, d.data() as Record<string, unknown>)
      );
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    }
  }
  const localDb = readLocalDb();
  return mergeByIdWithTombstones({
    remoteItems,
    localItems: Object.values(localDb.vipInvites).map((i) => sanitizeVipInviteForStorage(i)),
    deletedIds: localDb.deletedIds.vipInvites,
    getId: (inv) => inv.id,
  });
}

export async function upsertVipInvite(input: {
  loginId: string;
  displayName: string;
  targetPost: string;
  slotNumber: number;
  active: boolean;
  password?: string;
}): Promise<void> {
  const cleanLoginId = input.loginId.trim().toLowerCase().slice(0, 120);
  if (cleanLoginId.length < 2) {
    throw new DomainValidationError('Student Login ID must be at least 2 characters.');
  }
  const key = loginIdToKey(cleanLoginId);
  const localExisting = readLocalDb().vipInvites[key] ?? null;
  let remoteExisting: VipInvite | null = null;
  if (!isFirestoreQuotaExceeded()) {
    try {
      const existing = await getDoc(doc(db, 'vipInvites', key));
      if (existing.exists()) {
        remoteExisting = mapRemoteVipInvite(existing.id, existing.data() as Record<string, unknown>);
      }
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    }
  }

  const existingData = localExisting ?? remoteExisting;
  const nowMs = Date.now();
  const safeSlot = Math.min(5, Math.max(1, Math.round(input.slotNumber)));
  const cleanName = input.displayName.trim().slice(0, 80);
  const cleanPost = input.targetPost.trim().slice(0, 80);

  let nextHash: string;
  const trimmedPwd = input.password?.trim().slice(0, 120) ?? '';
  if (existingData) {
    nextHash =
      trimmedPwd.length > 0
        ? await sha256Hex(`sankalp_vip_v1:${trimmedPwd}`)
        : existingData.passwordHash;
  } else {
    if (trimmedPwd.length < 4) {
      throw new DomainValidationError(
        'Please set a personal password (at least 4 characters) for this new Student ID.'
      );
    }
    nextHash = await sha256Hex(`sankalp_vip_v1:${trimmedPwd}`);
  }

  const inviteDoc: VipInvite = {
    id: key,
    loginId: cleanLoginId,
    displayName: cleanName,
    targetPost: cleanPost,
    slotNumber: safeSlot,
    active: Boolean(input.active),
    passwordHash: nextHash,
    createdAt: existingData?.createdAt ?? nowMs,
    updatedAt: nowMs,
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.deletedIds.vipInvites = removeTombstone(draft.deletedIds.vipInvites, key);
      draft.vipInvites[key] = inviteDoc;
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      if (remoteExisting) {
        await updateDoc(doc(db, 'vipInvites', key), {
          loginId: cleanLoginId,
          displayName: cleanName,
          targetPost: cleanPost,
          slotNumber: safeSlot,
          active: Boolean(input.active),
          passwordHash: nextHash,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'vipInvites', key), {
          loginId: cleanLoginId,
          displayName: cleanName,
          targetPost: cleanPost,
          slotNumber: safeSlot,
          active: Boolean(input.active),
          passwordHash: nextHash,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      applyLocal();
    },
    applyLocal,
    op: { entity: 'vipInvite', docId: key },
  });
}

export async function createNewVipUser(input: {
  loginId: string;
  displayName: string;
  targetPost: string;
  slotNumber: number;
  active: boolean;
  password: string;
}): Promise<{ id: string }> {
  const cleanLoginId = input.loginId.trim().toLowerCase().slice(0, 120);
  if (cleanLoginId.length < 2) {
    throw new DomainValidationError('Student Login ID must be at least 2 characters.');
  }
  const rawPassword = input.password.trim();
  if (rawPassword.length < 4) {
    throw new DomainValidationError('Personal password must be at least 4 characters for a new user.');
  }
  const cleanName = input.displayName.trim().slice(0, 80);
  if (!cleanName) {
    throw new DomainValidationError('Student full name is required.');
  }

  const key = loginIdToKey(cleanLoginId);
  const mergedInvites = await listMergedVipInvites();
  const conflict = mergedInvites.find(
    (inv) => inv.id === key || inv.loginId?.trim().toLowerCase() === cleanLoginId
  );
  if (conflict) {
    throw new DomainValidationError(
      `Login ID "${cleanLoginId}" already exists. Click "Edit" on that user row to update them.`
    );
  }
  if (mergedInvites.length >= 5) {
    throw new DomainValidationError('All 5 VIP cohort slots are full. Edit or remove an existing user.');
  }

  const passwordHash = await sha256Hex(`sankalp_vip_v1:${rawPassword}`);
  const cleanPost = (input.targetPost.trim() || 'ASO in MEA').slice(0, 80);
  const safeSlot = Math.min(5, Math.max(1, Math.round(input.slotNumber)));
  const nowMs = Date.now();
  const localInvite: VipInvite = {
    id: key,
    loginId: cleanLoginId,
    displayName: cleanName,
    targetPost: cleanPost,
    slotNumber: safeSlot,
    active: Boolean(input.active),
    passwordHash,
    createdAt: nowMs,
    updatedAt: nowMs,
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.deletedIds.vipInvites = removeTombstone(draft.deletedIds.vipInvites, key);
      draft.vipInvites[key] = localInvite;
    });
    return { id: key };
  };

  return executeWriteWithLocalFallback({
    tryRemote: async () => {
      await setDoc(doc(db, 'vipInvites', key), {
        loginId: cleanLoginId,
        displayName: cleanName,
        targetPost: cleanPost,
        slotNumber: safeSlot,
        active: Boolean(input.active),
        passwordHash,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return applyLocal();
    },
    applyLocal,
    op: { entity: 'vipInvite', docId: key },
  });
}

export async function updateVipUser(
  inviteId: string,
  input: {
    loginId: string;
    displayName: string;
    targetPost: string;
    slotNumber: number;
    active: boolean;
    password?: string;
  }
): Promise<void> {
  const cleanLoginId = input.loginId.trim().toLowerCase().slice(0, 120);
  if (cleanLoginId.length < 2) {
    throw new DomainValidationError('Student Login ID must be at least 2 characters.');
  }
  const cleanName = input.displayName.trim().slice(0, 80);
  if (!cleanName) {
    throw new DomainValidationError('Student full name is required.');
  }
  const cleanPost = (input.targetPost.trim() || 'ASO in MEA').slice(0, 80);
  const safeSlot = Math.min(5, Math.max(1, Math.round(input.slotNumber)));
  const rawPassword = input.password?.trim() ?? '';
  if (rawPassword.length > 0 && rawPassword.length < 4) {
    throw new DomainValidationError('New password must be at least 4 characters (or leave blank to keep existing).');
  }

  const mergedInvites = await listMergedVipInvites();
  const existingData =
    mergedInvites.find((inv) => inv.id === inviteId) ?? readLocalDb().vipInvites[inviteId];
  if (!existingData) {
    throw new DomainValidationError('Selected VIP user no longer exists.');
  }

  const conflict = mergedInvites.find(
    (inv) => inv.id !== inviteId && inv.loginId?.trim().toLowerCase() === cleanLoginId
  );
  if (conflict) {
    throw new DomainValidationError(`Another user already uses Login ID "${cleanLoginId}".`);
  }

  const nextHash =
    rawPassword.length >= 4
      ? await sha256Hex(`sankalp_vip_v1:${rawPassword}`)
      : existingData.passwordHash;
  const nowMs = Date.now();

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.deletedIds.vipInvites = removeTombstone(draft.deletedIds.vipInvites, inviteId);
      draft.vipInvites[inviteId] = {
        ...existingData,
        id: inviteId,
        loginId: cleanLoginId,
        displayName: cleanName,
        targetPost: cleanPost,
        slotNumber: safeSlot,
        active: Boolean(input.active),
        passwordHash: nextHash,
        updatedAt: nowMs,
      };
      if (draft.students[inviteId]) {
        draft.students[inviteId] = {
          ...draft.students[inviteId],
          uid: inviteId,
          loginId: cleanLoginId,
          displayName: cleanName,
          targetPost: cleanPost,
          slotNumber: safeSlot,
          updatedAt: nowMs,
        };
      }
      if (draft.leaderboard[inviteId]) {
        draft.leaderboard[inviteId] = {
          ...draft.leaderboard[inviteId],
          displayName: cleanName,
          targetPost: cleanPost,
          updatedAt: nowMs,
        };
      }
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      const invRef = doc(db, 'vipInvites', inviteId);
      await updateDoc(invRef, {
        loginId: cleanLoginId,
        displayName: cleanName,
        targetPost: cleanPost,
        slotNumber: safeSlot,
        active: Boolean(input.active),
        passwordHash: nextHash,
        updatedAt: serverTimestamp(),
      });

      const studentRef = doc(db, 'students', inviteId);
      const studentSnap = await getDoc(studentRef);
      if (studentSnap.exists()) {
        await updateDoc(studentRef, {
          loginId: cleanLoginId,
          displayName: cleanName,
          targetPost: cleanPost,
          slotNumber: safeSlot,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      const lbRef = doc(db, 'leaderboard', inviteId);
      const lbSnap = await getDoc(lbRef);
      if (lbSnap.exists()) {
        await updateDoc(lbRef, {
          displayName: cleanName,
          targetPost: cleanPost,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
      applyLocal();
    },
    applyLocal,
    op: { entity: 'vipInvite', docId: inviteId },
  });
}

export async function deleteVipInvite(inviteId: string): Promise<void> {
  const applyLocal = () => {
    mutateLocalDb((draft) => {
      delete draft.vipInvites[inviteId];
      draft.deletedIds.vipInvites = addTombstone(draft.deletedIds.vipInvites, inviteId);
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      await deleteDoc(doc(db, 'vipInvites', inviteId));
      applyLocal();
    },
    applyLocal,
    op: { entity: 'vipInviteDelete', docId: inviteId },
  });
}

// --- Leaderboard & Students ---

export function subscribeLeaderboard(onChange: (entries: LeaderboardEntry[]) => void): Unsubscribe {
  const path = 'leaderboard';
  let latestRemote: LeaderboardEntry[] = [];

  const emit = () => {
    const localDb = readLocalDb();
    const merged = mergeByIdWithTombstones({
      remoteItems: latestRemote,
      localItems: Object.values(localDb.leaderboard),
      getId: (entry) => entry.uid,
    }).filter((entry) => isRealCohortStudentUid(entry.uid));
    onChange(merged);
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = query(collection(db, 'leaderboard'), where('cohortId', '==', 'ssc_cgl_vip'));
  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      latestRemote = snap.docs.map((d) => d.data() as LeaderboardEntry);
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

export function subscribeStudentsAdmin(onChange: (students: StudentProfile[]) => void): Unsubscribe {
  const path = 'students';
  let latestRemote: StudentProfile[] = [];

  const emit = () => {
    const localDb = readLocalDb();
    const merged = mergeByIdWithTombstones({
      remoteItems: latestRemote,
      localItems: Object.values(localDb.students),
      getId: (s) => s.uid,
    }).filter((s) => isRealCohortStudentUid(s.uid));
    onChange(merged);
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = query(collection(db, 'students'), where('cohortId', '==', 'ssc_cgl_vip'));
  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      latestRemote = snap.docs.map((d) => d.data() as StudentProfile);
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

// --- Questions ---

function mapNormalizedQuestions(docs: Array<{ id: string; raw: Record<string, unknown> }>): QuestionDoc[] {
  const out: QuestionDoc[] = [];
  for (const item of docs) {
    const normalized = normalizeQuestionDoc(item.raw, item.id);
    if (normalized) out.push(normalized);
  }
  return out;
}

function buildQuestionWritePayload(
  item: QuestionInput,
  adminUid: string,
  includeExtendedMeta: boolean
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    subject: item.subject,
    topic: item.topic.slice(0, 80) || 'General',
    difficulty: item.difficulty,
    source: item.source.slice(0, 64) || 'Manual',
    questionEn: item.questionEn.slice(0, 2000),
    optionsEn: item.optionsEn.map((o) => o.slice(0, 500)),
    correctIndex: item.correctIndex,
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const resolvedYearTag =
    item.yearTag || (item.metadata ? formatYearTagFromMetadata(item.metadata) : undefined);
  if (resolvedYearTag) payload.yearTag = resolvedYearTag.slice(0, 40);
  if (includeExtendedMeta && item.metadata) {
    payload.metadata = {
      exam: (item.metadata.exam || 'SSC CGL').slice(0, 40),
      year: (item.metadata.year || '2023').slice(0, 16),
      tier: (item.metadata.tier || 'Tier-1').slice(0, 24),
      shift: (item.metadata.shift || 'Shift-1').slice(0, 24),
    };
  }
  if (item.questionHi) payload.questionHi = item.questionHi.slice(0, 2000);
  if (item.optionsHi && item.optionsHi.length === 4) {
    payload.optionsHi = item.optionsHi.map((o) => o.slice(0, 500));
  }
  if (item.explanationEn) payload.explanationEn = item.explanationEn.slice(0, 3000);
  if (item.explanationHi) payload.explanationHi = item.explanationHi.slice(0, 3000);
  if (includeExtendedMeta && item.shortTrick) {
    payload.shortTrick = item.shortTrick.slice(0, 1500);
  }
  return payload;
}

export function getNormalizedStarterQuestions(): QuestionDoc[] {
  return STARTER_QUESTIONS.map((s) =>
    normalizeQuestionDoc(s as unknown as Record<string, unknown>, s.seedId)
  ).filter((q): q is QuestionDoc => q !== null);
}

export function subscribeQuestions(onChange: (questions: QuestionDoc[]) => void): Unsubscribe {
  const path = 'questions';
  const starterQuestions = getNormalizedStarterQuestions();
  let latestRemote: QuestionDoc[] = [];
  let remoteOverrides: Record<string, CorrectedQuestionOverrideDoc> = {};

  const emit = () => {
    const localDb = readLocalDb();
    const remoteAndStarter = mergeByIdWithTombstones({
      remoteItems: starterQuestions,
      localItems: latestRemote,
      deletedIds: localDb.deletedIds.questions,
      getId: (q) => q.id,
    });
    const merged = mergeByIdWithTombstones({
      remoteItems: remoteAndStarter,
      localItems: Object.values(localDb.questions),
      deletedIds: localDb.deletedIds.questions,
      getId: (q) => q.id,
    });
    const combinedOverrides = {
      ...remoteOverrides,
      ...localDb.correctedQuestionsBank,
    };
    onChange(applyCorrectedQuestionOverrides(merged, combinedOverrides));
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = query(collection(db, 'questions'), where('subject', 'in', ['quant', 'reasoning', 'english', 'ga']));
  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      latestRemote = mapNormalizedQuestions(
        snap.docs.map((d) => ({ id: d.id, raw: d.data() as Record<string, unknown> }))
      );
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      emit();
    }
  );
  const overridesQ = query(
    collection(db, 'corrected_questions_bank'),
    where('subject', 'in', ['quant', 'reasoning', 'english', 'ga'])
  );
  const unsubOverrides = onSnapshot(
    overridesQ,
    (snap) => {
      const next: Record<string, CorrectedQuestionOverrideDoc> = {};
      for (const d of snap.docs) {
        const data = d.data() as CorrectedQuestionOverrideDoc;
        next[d.id] = { ...data, id: d.id, questionId: data.questionId || d.id };
      }
      remoteOverrides = next;
      emit();
    },
    () => {
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubOverrides();
    unsubLocal();
  };
}

export async function addQuestionsBatchWithIds(
  questions: QuestionInput[],
  adminUid: string
): Promise<{ added: number; ids: string[] }> {
  const ids = questions.map(() => makeId('q'));
  const nowMs = Date.now();
  const localDocs: QuestionDoc[] = questions.map((item, idx) => ({
    ...item,
    id: ids[idx],
    topic: item.topic.slice(0, 80) || 'General',
    source: item.source.slice(0, 64) || 'Manual',
    questionEn: item.questionEn.slice(0, 2000),
    optionsEn: item.optionsEn.map((o) => o.slice(0, 500)) as [string, string, string, string],
    createdBy: adminUid,
    createdAt: nowMs,
    updatedAt: nowMs,
  }));

  const saveLocalDocs = (queueSync: boolean) => {
    mutateLocalDb((draft) => {
      for (const qDoc of localDocs) {
        draft.deletedIds.questions = removeTombstone(draft.deletedIds.questions, qDoc.id);
        draft.questions[qDoc.id] = qDoc;
        if (queueSync) {
          queuePendingSyncOp(draft, { entity: 'question', docId: qDoc.id });
        }
      }
    });
    return { added: localDocs.length, ids };
  };

  if (isFirestoreQuotaExceeded()) {
    return saveLocalDocs(true);
  }

  try {
    for (let i = 0; i < questions.length; i += 400) {
      const slice = questions.slice(i, i + 400);
      const sliceIds = ids.slice(i, i + 400);
      const commitSlice = async (includeExtendedMeta: boolean) => {
        const batch = writeBatch(db);
        slice.forEach((item, idx) => {
          const payload = buildQuestionWritePayload(item, adminUid, includeExtendedMeta);
          batch.set(doc(db, 'questions', sliceIds[idx]), payload);
        });
        await batch.commit();
      };

      try {
        await raceWithWriteTimeout(commitSlice(true), 3000);
      } catch (firstErr) {
        const msg = firstErr instanceof Error ? firstErr.message.toLowerCase() : '';
        if (msg.includes('permission') || msg.includes('denied')) {
          await raceWithWriteTimeout(commitSlice(false), 3000);
        } else {
          throw firstErr;
        }
      }
    }
    return saveLocalDocs(false);
  } catch (err) {
    if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return saveLocalDocs(true);
    }
    throw err;
  }
}

export async function addQuestionsBatch(questions: QuestionInput[], adminUid: string): Promise<number> {
  const res = await addQuestionsBatchWithIds(questions, adminUid);
  return res.added;
}

export async function fetchAllQuestionsOnce(): Promise<QuestionDoc[]> {
  const starterFallback = [...getNormalizedStarterQuestions(), ...getAllStaticGkQuestionDocs()];
  const localDb = readLocalDb();
  let fromDb: QuestionDoc[] = [];

  let remoteOverrides: Record<string, CorrectedQuestionOverrideDoc> = {};
  if (!isFirestoreQuotaExceeded()) {
    try {
      const q = query(
        collection(db, 'questions'),
        where('subject', 'in', ['quant', 'reasoning', 'english', 'ga'])
      );
      const ovQ = query(
        collection(db, 'corrected_questions_bank'),
        where('subject', 'in', ['quant', 'reasoning', 'english', 'ga'])
      );
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 3500);
      });
      const [snap, ovSnap] = await Promise.all([
        Promise.race([getDocs(q), timeoutPromise]),
        Promise.race([getDocs(ovQ), timeoutPromise]).catch(() => null),
      ]);
      if (snap) {
        fromDb = mapNormalizedQuestions(
          snap.docs.map((d) => ({ id: d.id, raw: d.data() as Record<string, unknown> }))
        );
      }
      if (ovSnap) {
        for (const d of ovSnap.docs) {
          const data = d.data() as CorrectedQuestionOverrideDoc;
          remoteOverrides[d.id] = { ...data, id: d.id, questionId: data.questionId || d.id };
        }
      }
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    }
  }

  const starterAndRemote = mergeByIdWithTombstones({
    remoteItems: starterFallback,
    localItems: fromDb,
    deletedIds: localDb.deletedIds.questions,
    getId: (q) => q.id,
  });

  const merged = mergeByIdWithTombstones({
    remoteItems: starterAndRemote,
    localItems: Object.values(localDb.questions),
    deletedIds: localDb.deletedIds.questions,
    getId: (q) => q.id,
  });

  return applyCorrectedQuestionOverrides(merged, {
    ...remoteOverrides,
    ...localDb.correctedQuestionsBank,
  });
}

export async function deleteQuestion(questionId: string): Promise<void> {
  const applyLocal = () => {
    mutateLocalDb((draft) => {
      delete draft.questions[questionId];
      draft.deletedIds.questions = addTombstone(draft.deletedIds.questions, questionId);
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      await deleteDoc(doc(db, 'questions', questionId));
      applyLocal();
    },
    applyLocal,
    op: { entity: 'questionDelete', docId: questionId },
  });
}

export async function wipeAllQuestionsFromFirestore(): Promise<{ deleted: number }> {
  const starterIds = STARTER_QUESTIONS.map((s) => s.seedId);
  const localIds = Object.keys(readLocalDb().questions);
  let remoteCount = 0;

  if (!isFirestoreQuotaExceeded()) {
    try {
      const q = query(
        collection(db, 'questions'),
        where('subject', 'in', ['quant', 'reasoning', 'english', 'ga'])
      );
      const snap = await getDocs(q);
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const slice = docs.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const d of slice) {
          batch.delete(d.ref);
        }
        await batch.commit();
        remoteCount += slice.length;
      }
    } catch (err) {
      if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
        if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      } else {
        throw err;
      }
    }
  }

  const allWipedIds = Array.from(new Set([...localIds, ...starterIds]));
  mutateLocalDb((draft) => {
    draft.questions = {};
    for (const id of allWipedIds) {
      draft.deletedIds.questions = addTombstone(draft.deletedIds.questions, id);
    }
  });

  return { deleted: Math.max(remoteCount, localIds.length) };
}

export async function fetchQuestionsByIds(ids: string[]): Promise<QuestionDoc[]> {
  const localDb = readLocalDb();
  const starterById = new Map(STARTER_QUESTIONS.map((s) => [s.seedId, s]));
  const staticGkById = new Map(getAllStaticGkQuestionDocs().map((q) => [q.id, q]));
  const getStarterFallback = (id: string): QuestionDoc | null => {
    const staticGk = staticGkById.get(id);
    if (staticGk) return staticGk;
    const fallback = starterById.get(id);
    if (!fallback) return null;
    return normalizeQuestionDoc(fallback as unknown as Record<string, unknown>, fallback.seedId);
  };

  const resultsById = new Map<string, QuestionDoc>();
  const missingIds: string[] = [];

  for (const id of ids) {
    const localDoc = localDb.questions[id];
    if (localDoc) {
      resultsById.set(id, localDoc);
    } else if (staticGkById.has(id)) {
      resultsById.set(id, staticGkById.get(id)!);
    } else {
      missingIds.push(id);
    }
  }

  if (missingIds.length > 0 && !isFirestoreQuotaExceeded()) {
    try {
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000));
      const snapsPromise = Promise.all(
        missingIds.map((id) => getDoc(doc(db, 'questions', id)).catch(() => null))
      );
      const snaps = await Promise.race([snapsPromise, timeoutPromise]);
      if (snaps) {
        snaps.forEach((snap, idx) => {
          const id = missingIds[idx];
          if (snap && snap.exists()) {
            const normalized = normalizeQuestionDoc(snap.data() as Record<string, unknown>, snap.id);
            if (normalized) resultsById.set(id, normalized);
          }
        });
      }
    } catch {
      // Fall back cleanly below
    }
  }

  const stillMissing = ids.filter((id) => !resultsById.has(id) && !getStarterFallback(id));
  if (stillMissing.length > 0) {
    try {
      const packs = await listOfflineMockPacks();
      for (const pack of packs) {
        for (const q of pack.questions) {
          if (!resultsById.has(q.id)) {
            resultsById.set(q.id, q);
          }
        }
      }
    } catch {
      // Ignore IDB read failures cleanly
    }
  }

  const ordered: QuestionDoc[] = [];
  for (const id of ids) {
    const found = resultsById.get(id) ?? getStarterFallback(id);
    if (found) ordered.push(found);
  }
  const overrideMap: Record<string, CorrectedQuestionOverrideDoc> = {
    ...localDb.correctedQuestionsBank,
  };
  if (!isFirestoreQuotaExceeded() && ordered.length > 0) {
    try {
      const ovSnaps = await Promise.race([
        Promise.all(ordered.map((q) => getDoc(doc(db, 'corrected_questions_bank', q.id)).catch(() => null))),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]);
      if (ovSnaps) {
        ovSnaps.forEach((s) => {
          if (s && s.exists()) {
            const data = s.data() as CorrectedQuestionOverrideDoc;
            overrideMap[s.id] = { ...data, id: s.id, questionId: data.questionId || s.id };
          }
        });
      }
    } catch {
      // Fall back cleanly to local overrides
    }
  }
  return applyCorrectedQuestionOverrides(ordered, overrideMap);
}

// --- Mock Tests ---

export function subscribeMockTests(
  isAdmin: boolean,
  onChange: (tests: MockTestDoc[]) => void
): Unsubscribe {
  const path = 'tests';
  const starterTests = getNormalizedStarterTests();
  let latestRemote: MockTestDoc[] = [];

  const emit = () => {
    const localDb = readLocalDb();
    const starterAndRemote = mergeByIdWithTombstones({
      remoteItems: starterTests,
      localItems: latestRemote,
      deletedIds: localDb.deletedIds.tests,
      getId: (t) => t.id,
    });
    const merged = mergeByIdWithTombstones({
      remoteItems: starterAndRemote,
      localItems: Object.values(localDb.tests),
      deletedIds: localDb.deletedIds.tests,
      getId: (t) => t.id,
    }).filter((t) => (isAdmin ? true : Boolean(t.published)));
    onChange(merged);
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = isAdmin
    ? query(collection(db, 'tests'), where('published', 'in', [true, false]))
    : query(collection(db, 'tests'), where('published', '==', true));
  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      latestRemote = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MockTestDoc, 'id'>) }));
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

export async function fetchMockTestById(testId: string): Promise<MockTestDoc | null> {
  if (!testId) return null;
  const localDb = readLocalDb();
  if (localDb.deletedIds.tests.includes(testId)) return null;
  if (localDb.tests[testId]) return localDb.tests[testId];

  if (!isFirestoreQuotaExceeded()) {
    try {
      const snap = await getDoc(doc(db, 'tests', testId));
      if (snap.exists()) {
        return { id: snap.id, ...(snap.data() as Omit<MockTestDoc, 'id'>) };
      }
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    }
  }

  const starter = getNormalizedStarterTests().find((t) => t.id === testId);
  if (starter) return starter;

  try {
    const offlinePack = await getOfflineMockPack(testId);
    if (offlinePack?.test) return offlinePack.test;
  } catch {
    // Ignore IDB read failures
  }

  return null;
}

export async function createMockTest(
  input: Omit<MockTestDoc, 'id' | 'createdAt' | 'updatedAt' | 'questionCount'>
): Promise<string> {
  const id = makeId('test');
  const nowMs = Date.now();
  const cleanQuestionIds = input.questionIds.slice(0, 100);
  const localDoc: MockTestDoc = {
    id,
    title: input.title.trim().slice(0, 120),
    subjectScope: input.subjectScope,
    durationMinutes: Math.max(1, Math.min(240, Math.round(input.durationMinutes))),
    positiveMarks: Number(input.positiveMarks),
    negativeMarks: Number(input.negativeMarks),
    questionIds: cleanQuestionIds,
    questionCount: cleanQuestionIds.length,
    published: Boolean(input.published),
    ...(input.examMode ? { examMode: input.examMode } : {}),
    ...(input.topicTag ? { topicTag: input.topicTag.slice(0, 80) } : {}),
    ...(input.sectionOrder ? { sectionOrder: input.sectionOrder.slice(0, 4) } : {}),
    ...(typeof input.sectionDurationSec === 'number'
      ? { sectionDurationSec: Math.max(60, Math.min(7200, Math.round(input.sectionDurationSec))) }
      : {}),
    createdBy: input.createdBy,
    createdAt: nowMs,
    updatedAt: nowMs,
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.deletedIds.tests = removeTombstone(draft.deletedIds.tests, id);
      draft.tests[id] = localDoc;
    });
    return id;
  };

  return executeWriteWithLocalFallback({
    tryRemote: async () => {
      await setDoc(doc(db, 'tests', id), {
        title: localDoc.title,
        subjectScope: localDoc.subjectScope,
        durationMinutes: localDoc.durationMinutes,
        positiveMarks: localDoc.positiveMarks,
        negativeMarks: localDoc.negativeMarks,
        questionIds: localDoc.questionIds,
        questionCount: localDoc.questionCount,
        published: localDoc.published,
        ...(localDoc.examMode ? { examMode: localDoc.examMode } : {}),
        ...(localDoc.topicTag ? { topicTag: localDoc.topicTag } : {}),
        ...(localDoc.sectionOrder ? { sectionOrder: localDoc.sectionOrder } : {}),
        ...(typeof localDoc.sectionDurationSec === 'number'
          ? { sectionDurationSec: localDoc.sectionDurationSec }
          : {}),
        createdBy: localDoc.createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return applyLocal();
    },
    applyLocal,
    op: { entity: 'test', docId: id },
  });
}

export async function toggleMockTestPublish(testId: string, published: boolean): Promise<void> {
  const existing = await fetchMockTestById(testId);
  const nowMs = Date.now();
  const applyLocal = () => {
    mutateLocalDb((draft) => {
      const base = draft.tests[testId] ?? existing;
      if (base) {
        draft.tests[testId] = {
          ...base,
          published: Boolean(published),
          updatedAt: nowMs,
        };
      }
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      await updateDoc(doc(db, 'tests', testId), {
        published,
        updatedAt: serverTimestamp(),
      });
      applyLocal();
    },
    applyLocal,
    op: { entity: 'test', docId: testId },
  });
}

export async function deleteMockTest(testId: string): Promise<void> {
  const applyLocal = () => {
    mutateLocalDb((draft) => {
      delete draft.tests[testId];
      draft.deletedIds.tests = addTombstone(draft.deletedIds.tests, testId);
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      await deleteDoc(doc(db, 'tests', testId));
      applyLocal();
    },
    applyLocal,
    op: { entity: 'testDelete', docId: testId },
  });
}

// --- Attempts, Submission & Auto Revision Vault ---

export function subscribeAttempts(
  uid: string | null,
  onChange: (attempts: TestAttemptDoc[]) => void
): Unsubscribe {
  const path = 'attempts';
  let latestRemote: TestAttemptDoc[] = [];

  const emit = () => {
    const localDb = readLocalDb();
    const localList = Object.values(localDb.attempts).filter((a) => (uid ? a.uid === uid : true));
    const merged = mergeByIdWithTombstones({
      remoteItems: latestRemote,
      localItems: localList,
      getId: (a) => a.id,
    }).sort((a, b) => extractCreatedOrUpdatedMs(b.createdAt) - extractCreatedOrUpdatedMs(a.createdAt));
    onChange(merged);
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = uid
    ? query(collection(db, 'attempts'), where('uid', '==', uid))
    : query(
        collection(db, 'attempts'),
        where('subjectScope', 'in', ['full', 'quant', 'reasoning', 'english', 'ga'])
      );
  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      latestRemote = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TestAttemptDoc, 'id'>) }));
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

export async function submitTestAttempt(params: {
  uid: string;
  studentName: string;
  targetPost: string;
  test: MockTestDoc;
  questions: QuestionDoc[];
  responsesById: Record<string, QuestionResponseState>;
  scoringConfig: ScoringConfig;
  currentLeaderboard?: LeaderboardEntry | null;
  activityMultiplier?: number;
  activityTierLabel?: string;
  examSessionId?: string;
}) {
  const {
    uid,
    studentName,
    targetPost,
    test,
    questions,
    responsesById,
    scoringConfig,
    currentLeaderboard,
    activityMultiplier = 1,
    activityTierLabel,
    examSessionId,
  } = params;

  const attemptId = resolveDeterministicAttemptId(uid, examSessionId, () => makeId('att'));
  const localDb = readLocalDb();
  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  let remotePrior: TestAttemptDoc[] = [];
  let remoteReachable = !isFirestoreQuotaExceeded() && !isBrowserOffline;
  if (remoteReachable) {
    try {
      const priorSnap = await raceWithWriteTimeout(
        getDocs(query(collection(db, 'attempts'), where('uid', '==', uid))),
        1500
      );
      remotePrior = priorSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TestAttemptDoc, 'id'>) }));
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      if (shouldFallbackToLocalOnError(err)) remoteReachable = false;
    }
  }
  const mergedPrior = mergeByIdWithTombstones({
    remoteItems: remotePrior,
    localItems: Object.values(localDb.attempts).filter((a) => a.uid === uid),
    getId: (a) => a.id,
  });

  // Idempotency guard: if this exact examSessionId attempt was already recorded locally or remotely,
  // never double-credit XP or mutate leaderboard stats on retry.
  const existingDuplicate = mergedPrior.find((data) => data.id === attemptId);
  const hasPriorCompleteAttempt = mergedPrior.some(
    (data) => data.id !== attemptId && data.testId === test.id && isAttemptComplete(data)
  );

  const outcome = calculateTestOutcome(
    questions,
    responsesById,
    test,
    scoringConfig,
    activityMultiplier,
    { isRepeatAttempt: hasPriorCompleteAttempt }
  );

  if (existingDuplicate) {
    await deleteTestDraft(uid, test.id);
    return {
      attemptId,
      outcome: {
        ...outcome,
        xpEarned: existingDuplicate.xpEarned,
      },
      masteredVaultCount: 0,
    };
  }

  const nowMs = Date.now();
  const attemptRecord: TestAttemptDoc = {
    id: attemptId,
    uid,
    studentName: studentName.slice(0, 80),
    testId: test.id,
    testTitle: test.title.slice(0, 120),
    subjectScope: test.subjectScope,
    ...(test.topicTag ? { topicTag: test.topicTag.trim().slice(0, 80) } : {}),
    score: outcome.score,
    maxScore: outcome.maxScore,
    accuracy: outcome.accuracy,
    correctCount: outcome.correctCount,
    wrongCount: outcome.wrongCount,
    skippedCount: outcome.skippedCount,
    totalTimeSec: outcome.totalTimeSec,
    xpEarned: outcome.xpEarned,
    sectionStats: outcome.sectionStats,
    createdAt: nowMs,
  };

  const responseMap: Record<string, SavedAttemptResponseDoc> = {};
  for (const r of outcome.perQuestionResults) {
    responseMap[r.questionId] = {
      questionId: r.questionId,
      selectedIndex: r.selectedIndex,
      isCorrect: r.isCorrect,
      timeSpentSec: Math.max(0, Math.min(3600, r.timeSpentSec)),
      markedForReview: r.markedForReview,
    };
  }

  let nextLbEntry: LeaderboardEntry | null = null;
  let ledgerEntry: XpLedgerEntryDoc | null = null;
  if (outcome.isComplete && !outcome.isRepeatAttempt) {
    const baseLb =
      currentLeaderboard ??
      localDb.leaderboard[uid] ?? {
        uid,
        displayName: studentName,
        targetPost,
        cohortId: 'ssc_cgl_vip',
        totalXp: 0,
        testsAttempted: 0,
        bestScore: 0,
        avgAccuracy: 0,
        totalTimeSec: 0,
      };
    const nextStats = computeUpdatedLeaderboardStats(baseLb, outcome);
    nextLbEntry = {
      uid,
      displayName: studentName.slice(0, 80),
      targetPost: targetPost.slice(0, 80),
      cohortId: 'ssc_cgl_vip',
      ...nextStats,
      updatedAt: nowMs,
    };
    if (outcome.xpEarned > 0) {
      const multTag =
        outcome.activityMultiplier !== 1
          ? ` (${outcome.activityMultiplier}x ${activityTierLabel ?? 'Activity'})`
          : '';
      const ledgerId = resolveDeterministicXpLedgerId(attemptId, 'xp');
      ledgerEntry = {
        id: ledgerId,
        uid,
        studentName: studentName.slice(0, 80),
        deltaXp: outcome.xpEarned,
        reason: `Completed ${test.title}${multTag}`.slice(0, 200),
        sourceType: 'test',
        refId: attemptId,
        createdBy: uid,
        createdAt: nowMs,
      };
    }
  }

  const applyLocalVault = (existingMap: Map<string, RevisionItemDoc>, queueSync: boolean): number => {
    let masteredCount = 0;
    if (outcome.attemptedCount <= 0) return 0;

    mutateLocalDb((draft) => {
      if (!draft.revisionVault[uid]) draft.revisionVault[uid] = {};
      const vaultEntries = [...outcome.wrongItems, ...outcome.skippedItems];
      for (const item of vaultEntries) {
        const tombKey = `${uid}::${item.questionId}`;
        draft.deletedIds.revisionVault = removeTombstone(draft.deletedIds.revisionVault, tombKey);
        const prev = draft.revisionVault[uid][item.questionId] ?? existingMap.get(item.questionId);
        draft.revisionVault[uid][item.questionId] = {
          id: item.questionId,
          uid,
          questionId: item.questionId,
          testId: test.id,
          testTitle: test.title.slice(0, 120),
          subject: item.subject,
          lastSelectedIndex: item.lastSelectedIndex,
          mastered: false,
          ...(prev?.aiDeepNote ? { aiDeepNote: prev.aiDeepNote } : {}),
          createdAt: prev?.createdAt ?? nowMs,
          updatedAt: nowMs,
        };
        if (queueSync) {
          queuePendingSyncOp(draft, { entity: 'revisionItem', uid, docId: item.questionId });
        }
      }

      for (const r of outcome.perQuestionResults) {
        if (!r.isCorrect) continue;
        const prevVault = draft.revisionVault[uid][r.questionId] ?? existingMap.get(r.questionId);
        if (prevVault && !prevVault.mastered) {
          masteredCount += 1;
          draft.revisionVault[uid][r.questionId] = {
            ...prevVault,
            id: r.questionId,
            mastered: true,
            updatedAt: nowMs,
          };
          if (queueSync) {
            queuePendingSyncOp(draft, { entity: 'revisionItem', uid, docId: r.questionId });
          }
        }
      }
    });

    return masteredCount;
  };

  const applyLocalSubmission = async (queueSync: boolean) => {
    mutateLocalDb((draft) => {
      draft.attempts[attemptId] = attemptRecord;
      draft.attemptResponses[attemptId] = responseMap;
      if (nextLbEntry) {
        draft.leaderboard[uid] = nextLbEntry;
        if (queueSync) {
          queuePendingSyncOp(draft, { entity: 'leaderboard', docId: uid });
        }
      }
      if (ledgerEntry) {
        draft.xpLedger[ledgerEntry.id] = ledgerEntry;
        if (queueSync) {
          queuePendingSyncOp(draft, { entity: 'xpLedger', docId: ledgerEntry.id });
        }
      }
      if (queueSync) {
        queuePendingSyncOp(draft, { entity: 'attempt', uid, docId: attemptId });
      }
    });
    if (queueSync) {
      try {
        localStorage.removeItem(localDraftStorageKey(uid, test.id));
        localStorage.removeItem(legacyDraftStorageKey(uid, test.id));
      } catch {
        // Ignore
      }
      void deleteOfflineExamDraft(uid, test.id);
    } else {
      await deleteTestDraft(uid, test.id);
    }
    const localExistingMap = new Map(Object.entries(readLocalDb().revisionVault[uid] ?? {}));
    const masteredVaultCount = applyLocalVault(localExistingMap, queueSync);
    return { attemptId, outcome, masteredVaultCount };
  };

  if (!remoteReachable || isFirestoreQuotaExceeded()) {
    return applyLocalSubmission(true);
  }

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'attempts', attemptId), {
      uid,
      studentName: attemptRecord.studentName,
      testId: attemptRecord.testId,
      testTitle: attemptRecord.testTitle,
      subjectScope: attemptRecord.subjectScope,
      ...(attemptRecord.topicTag ? { topicTag: attemptRecord.topicTag } : {}),
      score: attemptRecord.score,
      maxScore: attemptRecord.maxScore,
      accuracy: attemptRecord.accuracy,
      correctCount: attemptRecord.correctCount,
      wrongCount: attemptRecord.wrongCount,
      skippedCount: attemptRecord.skippedCount,
      totalTimeSec: attemptRecord.totalTimeSec,
      xpEarned: attemptRecord.xpEarned,
      sectionStats: attemptRecord.sectionStats,
      createdAt: serverTimestamp(),
    });

    for (const r of outcome.perQuestionResults) {
      batch.set(doc(db, 'attempts', attemptId, 'responses', r.questionId), {
        uid,
        questionId: r.questionId,
        selectedIndex: r.selectedIndex,
        isCorrect: r.isCorrect,
        timeSpentSec: Math.max(0, Math.min(3600, r.timeSpentSec)),
        markedForReview: r.markedForReview,
        createdAt: serverTimestamp(),
      });
    }

    if (nextLbEntry) {
      batch.set(doc(db, 'leaderboard', uid), {
        uid: nextLbEntry.uid,
        displayName: nextLbEntry.displayName,
        targetPost: nextLbEntry.targetPost,
        cohortId: nextLbEntry.cohortId,
        totalXp: nextLbEntry.totalXp,
        testsAttempted: nextLbEntry.testsAttempted,
        bestScore: nextLbEntry.bestScore,
        avgAccuracy: nextLbEntry.avgAccuracy,
        totalTimeSec: nextLbEntry.totalTimeSec,
        updatedAt: serverTimestamp(),
      });
    }

    if (ledgerEntry) {
      batch.set(doc(db, 'xpLedger', ledgerEntry.id), {
        uid: ledgerEntry.uid,
        studentName: ledgerEntry.studentName,
        deltaXp: ledgerEntry.deltaXp,
        reason: ledgerEntry.reason,
        sourceType: ledgerEntry.sourceType,
        refId: ledgerEntry.refId,
        createdBy: ledgerEntry.createdBy,
        createdAt: serverTimestamp(),
      });
    }

    await raceWithWriteTimeout(batch.commit(), 2500);
    await deleteTestDraft(uid, test.id);

    let masteredVaultCount = 0;
    if (outcome.attemptedCount > 0) {
      const vaultSnap = await raceWithWriteTimeout(
        getDocs(query(collection(db, 'students', uid, 'revisionVault'), where('uid', '==', uid))),
        2000
      );
      const existingVaultMap = new Map(vaultSnap.docs.map((d) => [d.id, d.data() as RevisionItemDoc]));
      const vaultTasks: Promise<unknown>[] = [];

      const vaultEntries = [...outcome.wrongItems, ...outcome.skippedItems];
      for (const item of vaultEntries) {
        const revRef = doc(db, 'students', uid, 'revisionVault', item.questionId);
        if (existingVaultMap.has(item.questionId)) {
          vaultTasks.push(
            updateDoc(revRef, {
              testTitle: test.title.slice(0, 120),
              lastSelectedIndex: item.lastSelectedIndex,
              mastered: false,
              updatedAt: serverTimestamp(),
            })
          );
        } else {
          vaultTasks.push(
            setDoc(revRef, {
              uid,
              questionId: item.questionId,
              testId: test.id,
              testTitle: test.title.slice(0, 120),
              subject: item.subject,
              lastSelectedIndex: item.lastSelectedIndex,
              mastered: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          );
        }
      }

      for (const r of outcome.perQuestionResults) {
        if (!r.isCorrect) continue;
        const prevVault = existingVaultMap.get(r.questionId);
        if (prevVault && !prevVault.mastered) {
          masteredVaultCount += 1;
          vaultTasks.push(
            updateDoc(doc(db, 'students', uid, 'revisionVault', r.questionId), {
              mastered: true,
              updatedAt: serverTimestamp(),
            })
          );
        }
      }

      if (vaultTasks.length > 0) {
        await raceWithWriteTimeout(Promise.all(vaultTasks), 3000);
      }
      applyLocalVault(existingVaultMap, false);
    }

    mutateLocalDb((draft) => {
      draft.attempts[attemptId] = attemptRecord;
      draft.attemptResponses[attemptId] = responseMap;
      if (nextLbEntry) draft.leaderboard[uid] = nextLbEntry;
      if (ledgerEntry) draft.xpLedger[ledgerEntry.id] = ledgerEntry;
    });

    return { attemptId, outcome, masteredVaultCount };
  } catch (err) {
    if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return applyLocalSubmission(true);
    }
    throw err;
  }
}

// --- Revision Vault ---

export function subscribeRevisionVault(
  uid: string,
  onChange: (items: RevisionItemDoc[]) => void
): Unsubscribe {
  const path = `students/${uid}/revisionVault`;
  let latestRemote: RevisionItemDoc[] = [];

  const emit = () => {
    const localDb = readLocalDb();
    const prefix = `${uid}::`;
    const deletedQIds = localDb.deletedIds.revisionVault
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
    const merged = mergeByIdWithTombstones({
      remoteItems: latestRemote,
      localItems: Object.values(localDb.revisionVault[uid] ?? {}),
      deletedIds: deletedQIds,
      getId: (item) => item.questionId || item.id,
    });
    onChange(merged);
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = query(collection(db, 'students', uid, 'revisionVault'), where('uid', '==', uid));
  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      latestRemote = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RevisionItemDoc, 'id'>) }));
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

export async function updateRevisionItem(
  uid: string,
  questionId: string,
  patch: Partial<Pick<RevisionItemDoc, 'mastered' | 'aiDeepNote'>>
): Promise<void> {
  const nowMs = Date.now();
  const cleanNote = patch.aiDeepNote !== undefined ? patch.aiDeepNote.slice(0, 6000) : undefined;
  const applyLocal = () => {
    mutateLocalDb((draft) => {
      if (!draft.revisionVault[uid]) draft.revisionVault[uid] = {};
      const existing = draft.revisionVault[uid][questionId] ?? {
        id: questionId,
        uid,
        questionId,
        testId: 'vault',
        testTitle: 'Revision Vault',
        subject: 'quant' as SubjectKey,
        lastSelectedIndex: -1,
        mastered: false,
      };
      draft.revisionVault[uid][questionId] = {
        ...existing,
        ...(patch.mastered !== undefined ? { mastered: patch.mastered } : {}),
        ...(cleanNote !== undefined ? { aiDeepNote: cleanNote } : {}),
        updatedAt: nowMs,
      };
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      await updateDoc(doc(db, 'students', uid, 'revisionVault', questionId), {
        ...patch,
        ...(cleanNote !== undefined ? { aiDeepNote: cleanNote } : {}),
        updatedAt: serverTimestamp(),
      });
      applyLocal();
    },
    applyLocal,
    op: { entity: 'revisionItem', uid, docId: questionId },
  });
}

export async function deleteRevisionItem(uid: string, questionId: string): Promise<void> {
  const tombKey = `${uid}::${questionId}`;
  const applyLocal = () => {
    mutateLocalDb((draft) => {
      if (draft.revisionVault[uid]) {
        delete draft.revisionVault[uid][questionId];
      }
      draft.deletedIds.revisionVault = addTombstone(draft.deletedIds.revisionVault, tombKey);
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      await deleteDoc(doc(db, 'students', uid, 'revisionVault', questionId));
      applyLocal();
    },
    applyLocal,
    op: { entity: 'revisionItemDelete', uid, docId: questionId },
  });
}

// --- Tasks & XP Ledger ---

export function subscribeTasks(onChange: (tasks: CohortTaskDoc[]) => void): Unsubscribe {
  const path = 'tasks';
  const starterTasks = getNormalizedStarterTasks();
  let latestRemote: CohortTaskDoc[] = [];

  const emit = () => {
    const localDb = readLocalDb();
    const starterAndRemote = mergeByIdWithTombstones({
      remoteItems: starterTasks,
      localItems: latestRemote,
      deletedIds: localDb.deletedIds.tasks,
      getId: (t) => t.id,
    });
    const merged = mergeByIdWithTombstones({
      remoteItems: starterAndRemote,
      localItems: Object.values(localDb.tasks),
      deletedIds: localDb.deletedIds.tasks,
      getId: (t) => t.id,
    });
    onChange(merged);
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = query(collection(db, 'tasks'), where('active', 'in', [true, false]));
  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      latestRemote = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CohortTaskDoc, 'id'>) }));
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

export async function createCohortTask(
  input: Omit<CohortTaskDoc, 'id' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  const id = makeId('task');
  const nowMs = Date.now();
  const localTask: CohortTaskDoc = {
    id,
    title: input.title.trim().slice(0, 120),
    description: input.description.trim().slice(0, 500),
    targetTests: Math.max(1, Math.min(50, Math.round(input.targetTests))),
    targetSubject: input.targetSubject,
    bonusXp: Math.max(1, Math.min(2000, Number(input.bonusXp))),
    dueDate: input.dueDate.slice(0, 32),
    active: Boolean(input.active),
    createdAt: nowMs,
    updatedAt: nowMs,
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.deletedIds.tasks = removeTombstone(draft.deletedIds.tasks, id);
      draft.tasks[id] = localTask;
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      await setDoc(doc(db, 'tasks', id), {
        title: localTask.title,
        description: localTask.description,
        targetTests: localTask.targetTests,
        targetSubject: localTask.targetSubject,
        bonusXp: localTask.bonusXp,
        dueDate: localTask.dueDate,
        active: localTask.active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      applyLocal();
    },
    applyLocal,
    op: { entity: 'task', docId: id },
  });
}

export async function toggleCohortTask(taskId: string, active: boolean): Promise<void> {
  const starterMatch = getNormalizedStarterTasks().find((t) => t.id === taskId);
  const nowMs = Date.now();
  const applyLocal = () => {
    mutateLocalDb((draft) => {
      const base = draft.tasks[taskId] ?? starterMatch;
      if (base) {
        draft.tasks[taskId] = {
          ...base,
          active: Boolean(active),
          updatedAt: nowMs,
        };
      }
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      await updateDoc(doc(db, 'tasks', taskId), {
        active,
        updatedAt: serverTimestamp(),
      });
      applyLocal();
    },
    applyLocal,
    op: { entity: 'task', docId: taskId },
  });
}

export async function deleteCohortTask(taskId: string): Promise<void> {
  const applyLocal = () => {
    mutateLocalDb((draft) => {
      delete draft.tasks[taskId];
      draft.deletedIds.tasks = addTombstone(draft.deletedIds.tasks, taskId);
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      await deleteDoc(doc(db, 'tasks', taskId));
      applyLocal();
    },
    applyLocal,
    op: { entity: 'taskDelete', docId: taskId },
  });
}

export function subscribeXpLedger(
  uid: string | null,
  onChange: (entries: XpLedgerEntryDoc[]) => void
): Unsubscribe {
  const path = 'xpLedger';
  let latestRemote: XpLedgerEntryDoc[] = [];

  const emit = () => {
    const localDb = readLocalDb();
    const localList = Object.values(localDb.xpLedger).filter((entry) => (uid ? entry.uid === uid : true));
    const merged = mergeByIdWithTombstones({
      remoteItems: latestRemote,
      localItems: localList,
      getId: (e) => e.id,
    }).sort((a, b) => extractCreatedOrUpdatedMs(b.createdAt) - extractCreatedOrUpdatedMs(a.createdAt));
    onChange(merged);
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = uid
    ? query(collection(db, 'xpLedger'), where('uid', '==', uid))
    : query(collection(db, 'xpLedger'), where('sourceType', 'in', ['test', 'task', 'admin']));
  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      latestRemote = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<XpLedgerEntryDoc, 'id'>) }));
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

export async function claimTaskBonusXp(params: {
  uid: string;
  studentName: string;
  task: CohortTaskDoc;
  currentLeaderboard: LeaderboardEntry;
  activityMultiplier?: number;
  activityTierLabel?: string;
}): Promise<number> {
  const {
    uid,
    studentName,
    task,
    currentLeaderboard,
    activityMultiplier = 1,
    activityTierLabel,
  } = params;
  const finalBonusXp = applyActivityMultiplier(task.bonusXp, activityMultiplier);
  const ledgerId = `xp_task_${uid}_${task.id}`.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);

  const localExisting = readLocalDb().xpLedger[ledgerId];
  if (localExisting) {
    return localExisting.deltaXp ?? finalBonusXp;
  }

  if (!isFirestoreQuotaExceeded()) {
    try {
      const existingLedger = await getDoc(doc(db, 'xpLedger', ledgerId));
      if (existingLedger.exists()) {
        return (existingLedger.data() as XpLedgerEntryDoc).deltaXp ?? finalBonusXp;
      }
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    }
  }

  if (!task.active || isTaskExpired(task)) {
    throw new DomainValidationError(
      'This cohort mission has expired or been paused by Super Admin.'
    );
  }

  let remoteAttempts: TestAttemptDoc[] = [];
  if (!isFirestoreQuotaExceeded()) {
    try {
      const attemptsSnap = await getDocs(query(collection(db, 'attempts'), where('uid', '==', uid)));
      remoteAttempts = attemptsSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<TestAttemptDoc, 'id'>),
      }));
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    }
  }
  const studentAttempts = mergeByIdWithTombstones({
    remoteItems: remoteAttempts,
    localItems: Object.values(readLocalDb().attempts).filter((a) => a.uid === uid),
    getId: (a) => a.id,
  });
  const prog = computeTaskProgress(task, studentAttempts);
  if (!prog.isEligible) {
    throw new DomainValidationError(
      `Complete ${prog.targetCount} unique qualifying mock tests (>80% questions attempted) before claiming this reward.`
    );
  }

  const multTag =
    activityMultiplier !== 1
      ? ` (${activityMultiplier}x ${activityTierLabel ?? 'Activity'})`
      : '';
  const clampedBonus = Math.max(1, Math.min(5000, finalBonusXp));
  const nowMs = Date.now();
  const ledgerDoc: XpLedgerEntryDoc = {
    id: ledgerId,
    uid,
    studentName: studentName.slice(0, 80),
    deltaXp: clampedBonus,
    reason: `Task Completed: ${task.title}${multTag}`.slice(0, 200),
    sourceType: 'task',
    refId: task.id,
    createdBy: uid,
    createdAt: nowMs,
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.xpLedger[ledgerId] = ledgerDoc;
      const baseLb = draft.leaderboard[uid] ?? currentLeaderboard;
      draft.leaderboard[uid] = {
        uid,
        displayName: studentName.slice(0, 80),
        targetPost: baseLb.targetPost.slice(0, 80),
        cohortId: 'ssc_cgl_vip',
        totalXp: Math.min(1000000, (baseLb.totalXp ?? 0) + clampedBonus),
        testsAttempted: baseLb.testsAttempted ?? 0,
        bestScore: baseLb.bestScore ?? 0,
        avgAccuracy: baseLb.avgAccuracy ?? 0,
        totalTimeSec: baseLb.totalTimeSec ?? 0,
        updatedAt: nowMs,
      };
      queuePendingSyncOp(draft, { entity: 'leaderboard', docId: uid });
    });
    return clampedBonus;
  };

  return executeWriteWithLocalFallback({
    tryRemote: async () => {
      const lbRef = doc(db, 'leaderboard', uid);
      const lbSnap = await getDoc(lbRef);
      const batch = writeBatch(db);
      batch.set(doc(db, 'xpLedger', ledgerId), {
        uid: ledgerDoc.uid,
        studentName: ledgerDoc.studentName,
        deltaXp: ledgerDoc.deltaXp,
        reason: ledgerDoc.reason,
        sourceType: ledgerDoc.sourceType,
        refId: ledgerDoc.refId,
        createdBy: ledgerDoc.createdBy,
        createdAt: serverTimestamp(),
      });

      if (lbSnap.exists()) {
        const latestTotal = (lbSnap.data() as LeaderboardEntry).totalXp ?? currentLeaderboard.totalXp;
        batch.update(lbRef, {
          totalXp: Math.min(1000000, latestTotal + clampedBonus),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(lbRef, {
          uid,
          displayName: studentName.slice(0, 80),
          targetPost: currentLeaderboard.targetPost.slice(0, 80),
          cohortId: 'ssc_cgl_vip',
          totalXp: clampedBonus,
          testsAttempted: 0,
          bestScore: 0,
          avgAccuracy: 0,
          totalTimeSec: 0,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      mutateLocalDb((draft) => {
        draft.xpLedger[ledgerId] = ledgerDoc;
        const baseLb = draft.leaderboard[uid] ?? currentLeaderboard;
        draft.leaderboard[uid] = {
          ...baseLb,
          totalXp: Math.min(1000000, (baseLb.totalXp ?? 0) + clampedBonus),
          updatedAt: nowMs,
        };
      });
      return clampedBonus;
    },
    applyLocal,
    op: { entity: 'xpLedger', docId: ledgerId },
  });
}

export async function adminAdjustLeaderboardXp(params: {
  adminUid: string;
  targetEntry: LeaderboardEntry;
  deltaXp: number;
  reason: string;
}): Promise<void> {
  const { adminUid, targetEntry, deltaXp, reason } = params;
  const cleanReason = reason.trim().slice(0, 200);
  if (cleanReason.length < 2) {
    throw new DomainValidationError('Adjustment reason must be at least 2 characters.');
  }
  const safeDelta = Math.max(-5000, Math.min(5000, Math.round(deltaXp)));
  if (safeDelta === 0) {
    throw new DomainValidationError('XP adjustment delta must be non-zero (between -5000 and +5000).');
  }
  const nextTotalXp = Math.max(-10000, Math.min(1000000, targetEntry.totalXp + safeDelta));
  const ledgerId = makeId('xp_adj');
  const nowMs = Date.now();
  const ledgerDoc: XpLedgerEntryDoc = {
    id: ledgerId,
    uid: targetEntry.uid,
    studentName: targetEntry.displayName.slice(0, 80),
    deltaXp: safeDelta,
    reason: cleanReason,
    sourceType: 'admin',
    refId: `adj_${nowMs}`,
    createdBy: adminUid,
    createdAt: nowMs,
  };

  const applyLocal = (queueLbSync: boolean) => {
    mutateLocalDb((draft) => {
      draft.xpLedger[ledgerId] = ledgerDoc;
      draft.leaderboard[targetEntry.uid] = {
        ...targetEntry,
        totalXp: nextTotalXp,
        updatedAt: nowMs,
      };
      if (queueLbSync) {
        queuePendingSyncOp(draft, { entity: 'leaderboard', docId: targetEntry.uid });
      }
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      const batch = writeBatch(db);
      batch.update(doc(db, 'leaderboard', targetEntry.uid), {
        totalXp: nextTotalXp,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'xpLedger', ledgerId), {
        uid: ledgerDoc.uid,
        studentName: ledgerDoc.studentName,
        deltaXp: ledgerDoc.deltaXp,
        reason: ledgerDoc.reason,
        sourceType: ledgerDoc.sourceType,
        refId: ledgerDoc.refId,
        createdBy: ledgerDoc.createdBy,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      applyLocal(false);
    },
    applyLocal: () => applyLocal(true),
    op: { entity: 'xpLedger', docId: ledgerId },
  });
}

export async function fetchAllLeaderboardForExport(): Promise<LeaderboardEntry[]> {
  let remoteItems: LeaderboardEntry[] = [];
  if (!isFirestoreQuotaExceeded()) {
    try {
      const q = query(collection(db, 'leaderboard'), where('cohortId', '==', 'ssc_cgl_vip'));
      const snap = await getDocs(q);
      remoteItems = snap.docs.map((d) => d.data() as LeaderboardEntry);
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    }
  }
  return mergeByIdWithTombstones({
    remoteItems,
    localItems: Object.values(readLocalDb().leaderboard),
    getId: (entry) => entry.uid,
  });
}

export async function seedStarterPackToFirestore(adminUid: string): Promise<{
  questionsAdded: number;
  testsAdded: number;
  tasksAdded: number;
}> {
  mutateLocalDb((draft) => {
    for (const q of STARTER_QUESTIONS) {
      draft.deletedIds.questions = removeTombstone(draft.deletedIds.questions, q.seedId);
    }
    for (const t of STARTER_TESTS) {
      draft.deletedIds.tests = removeTombstone(draft.deletedIds.tests, t.seedId);
    }
    for (const task of STARTER_TASKS) {
      draft.deletedIds.tasks = removeTombstone(draft.deletedIds.tasks, task.seedId);
    }
  });

  if (isFirestoreQuotaExceeded()) {
    return { questionsAdded: 0, testsAdded: 0, tasksAdded: 0 };
  }
  let questionsAdded = 0;
  let testsAdded = 0;
  let tasksAdded = 0;

  try {
    // 1. Ensure default scoring config exists
    const scoringSnap = await getDoc(doc(db, 'settings', 'scoring'));
    if (!scoringSnap.exists()) {
      await setDoc(doc(db, 'settings', 'scoring'), {
        pointsPerCorrect: DEFAULT_SCORING_CONFIG.pointsPerCorrect,
        negativeMarks: DEFAULT_SCORING_CONFIG.negativeMarks,
        xpAttemptBase: DEFAULT_SCORING_CONFIG.xpAttemptBase,
        xpPerCorrect: DEFAULT_SCORING_CONFIG.xpPerCorrect,
        xpAccuracyThreshold: DEFAULT_SCORING_CONFIG.xpAccuracyThreshold,
        xpAccuracyBonus: DEFAULT_SCORING_CONFIG.xpAccuracyBonus,
        updatedAt: serverTimestamp(),
      });
    }

    // 2. Check existing questions, tests, and tasks in parallel
    const [qSnaps, tSnaps, taskSnaps] = await Promise.all([
      Promise.all(STARTER_QUESTIONS.map((item) => getDoc(doc(db, 'questions', item.seedId)))),
      Promise.all(STARTER_TESTS.map((t) => getDoc(doc(db, 'tests', t.seedId)))),
      Promise.all(STARTER_TASKS.map((task) => getDoc(doc(db, 'tasks', task.seedId)))),
    ]);

    const pendingWrites: Array<{ ref: ReturnType<typeof doc>; payload: Record<string, unknown> }> = [];

    STARTER_QUESTIONS.forEach((item, idx) => {
      if (!qSnaps[idx].exists()) {
        const payload: Record<string, unknown> = {
          subject: item.subject,
          topic: item.topic.slice(0, 80),
          difficulty: item.difficulty,
          source: item.source.slice(0, 64),
          questionEn: item.questionEn.slice(0, 2000),
          optionsEn: item.optionsEn.map((o) => o.slice(0, 500)),
          correctIndex: item.correctIndex,
          createdBy: adminUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (item.yearTag) payload.yearTag = item.yearTag.slice(0, 40);
        if (item.questionHi) payload.questionHi = item.questionHi.slice(0, 2000);
        if (item.optionsHi && item.optionsHi.length === 4) {
          payload.optionsHi = item.optionsHi.map((o) => o.slice(0, 500));
        }
        if (item.explanationEn) payload.explanationEn = item.explanationEn.slice(0, 3000);
        if (item.explanationHi) payload.explanationHi = item.explanationHi.slice(0, 3000);
        pendingWrites.push({ ref: doc(db, 'questions', item.seedId), payload });
        questionsAdded += 1;
      }
    });

    STARTER_TESTS.forEach((t, idx) => {
      if (!tSnaps[idx].exists()) {
        pendingWrites.push({
          ref: doc(db, 'tests', t.seedId),
          payload: {
            title: t.title.slice(0, 120),
            subjectScope: t.subjectScope,
            durationMinutes: t.durationMinutes,
            positiveMarks: t.positiveMarks,
            negativeMarks: t.negativeMarks,
            questionIds: t.questionSeedIds,
            questionCount: t.questionSeedIds.length,
            published: true,
            createdBy: adminUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
        });
        testsAdded += 1;
      }
    });

    STARTER_TASKS.forEach((task, idx) => {
      if (!taskSnaps[idx].exists()) {
        pendingWrites.push({
          ref: doc(db, 'tasks', task.seedId),
          payload: {
            title: task.title.slice(0, 120),
            description: task.description.slice(0, 500),
            targetTests: task.targetTests,
            targetSubject: task.targetSubject,
            bonusXp: task.bonusXp,
            dueDate: task.dueDate,
            active: task.active,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
        });
        tasksAdded += 1;
      }
    });

    for (let i = 0; i < pendingWrites.length; i += 350) {
      const batch = writeBatch(db);
      for (const w of pendingWrites.slice(i, i + 350)) {
        batch.set(w.ref, w.payload);
      }
      await batch.commit();
    }

    return { questionsAdded, testsAdded, tasksAdded };
  } catch (err) {
    if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return { questionsAdded: 0, testsAdded: 0, tasksAdded: 0 };
    }
    throw err;
  }
}

// --- Live Presence & Camera Proctoring (WebRTC + Snapshot Fallback) ---

export async function upsertStudentPresence(params: {
  uid: string;
  displayName: string;
  loginId: string;
  status: PresenceStatus;
  cameraState: CameraState;
  currentTestId?: string;
  currentTestTitle?: string;
  questionIndex: number;
  totalQuestions: number;
  tabSwitchCount: number;
  lastSeenMs: number;
  snapshotDataUrl?: string;
  snapshotAtMs?: number;
}): Promise<void> {
  if (
    params.uid === ADMIN_PREVIEW_UID ||
    !isRealCohortStudentUid(params.uid) ||
    isFirestoreQuotaExceeded()
  ) {
    return;
  }
  const path = `presence/${params.uid}`;
  try {
    const payload: Record<string, unknown> = {
      uid: params.uid,
      displayName: (params.displayName || 'Student').slice(0, 80),
      loginId: (params.loginId || params.uid).slice(0, 120),
      status: params.status,
      cameraState: params.cameraState,
      questionIndex: Math.max(0, Math.min(200, Math.round(params.questionIndex))),
      totalQuestions: Math.max(0, Math.min(200, Math.round(params.totalQuestions))),
      tabSwitchCount: Math.max(0, Math.min(1000, Math.round(params.tabSwitchCount))),
      lastSeenMs: Math.max(0, params.lastSeenMs),
      updatedAt: serverTimestamp(),
    };
    if (params.currentTestId) {
      payload.currentTestId = params.currentTestId.slice(0, 128);
    }
    if (params.currentTestTitle) {
      payload.currentTestTitle = params.currentTestTitle.slice(0, 120);
    }
    if (params.snapshotDataUrl && params.snapshotDataUrl.length <= 79_000) {
      payload.snapshotDataUrl = params.snapshotDataUrl;
      payload.snapshotAtMs = params.snapshotAtMs ?? Date.now();
    }
    await raceWithWriteTimeout(setDoc(doc(db, 'presence', params.uid), payload));
  } catch (err) {
    if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return;
    }
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeAllPresence(
  onChange: (presences: StudentPresenceDoc[]) => void
): Unsubscribe {
  const path = 'presence';
  const q = query(
    collection(db, 'presence'),
    where('status', 'in', ['online', 'in_exam', 'offline'])
  );
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        snap.docs
          .map((d) => d.data() as StudentPresenceDoc)
          .filter((p) => isRealCohortStudentUid(p.uid))
      );
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      onChange([]);
    }
  );
}

export function subscribeProctorRoom(
  uid: string,
  onChange: (room: ProctorRoomDoc | null) => void
): Unsubscribe {
  const path = `proctorRooms/${uid}`;
  return onSnapshot(
    doc(db, 'proctorRooms', uid),
    (snap) => {
      onChange(snap.exists() ? (snap.data() as ProctorRoomDoc) : null);
    },
    (err) => {
      handleSubscriptionError(err, OperationType.GET, path);
    }
  );
}

export async function requestProctorWatch(uid: string, adminId: string): Promise<string> {
  const sessionId = makeId('proctor');
  if (isFirestoreQuotaExceeded()) return sessionId;
  const path = `proctorRooms/${uid}`;
  try {
    await raceWithWriteTimeout(
      setDoc(doc(db, 'proctorRooms', uid), {
        uid,
        sessionId,
        status: 'requested',
        requestedBy: adminId.slice(0, 128),
        updatedAt: serverTimestamp(),
      })
    );
    return sessionId;
  } catch (err) {
    if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return sessionId;
    }
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function endProctorWatch(uid: string, sessionId: string): Promise<void> {
  if (isFirestoreQuotaExceeded()) return;
  const path = `proctorRooms/${uid}`;
  try {
    await raceWithWriteTimeout(
      setDoc(doc(db, 'proctorRooms', uid), {
        uid,
        sessionId: sessionId || makeId('end'),
        status: 'ended',
        updatedAt: serverTimestamp(),
      })
    );
  } catch (err) {
    if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return;
    }
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function publishProctorOffer(
  uid: string,
  sessionId: string,
  offerSdp: string
): Promise<void> {
  if (isFirestoreQuotaExceeded()) return;
  const path = `proctorRooms/${uid}`;
  try {
    await raceWithWriteTimeout(
      setDoc(doc(db, 'proctorRooms', uid), {
        uid,
        sessionId,
        status: 'offer_ready',
        offerSdp: offerSdp.slice(0, 20000),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (err) {
    if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return;
    }
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function publishProctorAnswer(
  uid: string,
  sessionId: string,
  offerSdp: string,
  answerSdp: string
): Promise<void> {
  if (isFirestoreQuotaExceeded()) return;
  const path = `proctorRooms/${uid}`;
  try {
    await raceWithWriteTimeout(
      setDoc(doc(db, 'proctorRooms', uid), {
        uid,
        sessionId,
        status: 'connected',
        offerSdp: offerSdp.slice(0, 20000),
        answerSdp: answerSdp.slice(0, 20000),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (err) {
    if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return;
    }
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function addProctorCandidate(
  uid: string,
  sessionId: string,
  sender: 'student' | 'admin',
  candidateJson: string
): Promise<void> {
  if (isFirestoreQuotaExceeded()) return;
  const candId = makeId(sender === 'student' ? 'cs' : 'ca');
  const path = `proctorRooms/${uid}/candidates/${candId}`;
  try {
    await raceWithWriteTimeout(
      setDoc(doc(db, 'proctorRooms', uid, 'candidates', candId), {
        sessionId,
        sender,
        candidateJson: candidateJson.slice(0, 4000),
        createdAt: serverTimestamp(),
      })
    );
  } catch (err) {
    if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return;
    }
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeProctorCandidates(
  uid: string,
  sessionId: string,
  senderFilter: 'student' | 'admin',
  onCandidate: (cand: ProctorCandidateDoc) => void
): Unsubscribe {
  const path = `proctorRooms/${uid}/candidates`;
  const seen = new Set<string>();
  const q = query(
    collection(db, 'proctorRooms', uid, 'candidates'),
    where('sender', '==', senderFilter)
  );
  return onSnapshot(
    q,
    (snap) => {
      for (const d of snap.docs) {
        if (seen.has(d.id)) continue;
        const data = d.data() as Omit<ProctorCandidateDoc, 'id'>;
        if (data.sessionId === sessionId) {
          seen.add(d.id);
          onCandidate({ id: d.id, ...data });
        }
      }
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

// --- Student Attendance & Study Session Logs ---

export async function startStudentSessionLog(params: {
  uid: string;
  displayName: string;
  loginId: string;
  lastActivityTitle?: string;
}): Promise<string> {
  if (params.uid === ADMIN_PREVIEW_UID || !isRealCohortStudentUid(params.uid)) {
    return 'preview_session';
  }
  const sessionId = makeId(`sess_${params.uid}`).slice(0, 128);
  const now = Date.now();
  const localDoc: StudentSessionLogDoc = {
    id: sessionId,
    uid: params.uid,
    displayName: (params.displayName || 'Student').slice(0, 80),
    loginId: (params.loginId || params.uid).slice(0, 120),
    status: 'active',
    loginAtMs: now,
    lastActiveAtMs: now,
    logoutAtMs: 0,
    activeDurationSec: 0,
    testsCompleted: 0,
    questionsAttempted: 0,
    subjectsStudied: [],
    lastActivityTitle: (params.lastActivityTitle || 'Student Dashboard').slice(0, 120),
    createdAt: now,
    updatedAt: now,
  };

  mutateLocalDb((draft) => {
    draft.sessionLogs[sessionId] = localDoc;
  });

  if (isFirestoreQuotaExceeded()) {
    return `local_${sessionId}`;
  }

  try {
    await raceWithWriteTimeout(
      setDoc(doc(db, 'sessionLogs', sessionId), {
        uid: localDoc.uid,
        displayName: localDoc.displayName,
        loginId: localDoc.loginId,
        status: localDoc.status,
        loginAtMs: localDoc.loginAtMs,
        lastActiveAtMs: localDoc.lastActiveAtMs,
        logoutAtMs: localDoc.logoutAtMs,
        activeDurationSec: localDoc.activeDurationSec,
        testsCompleted: localDoc.testsCompleted,
        questionsAttempted: localDoc.questionsAttempted,
        subjectsStudied: localDoc.subjectsStudied,
        lastActivityTitle: localDoc.lastActivityTitle,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    return sessionId;
  } catch (err) {
    if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return `local_${sessionId}`;
    }
    handleFirestoreError(err, OperationType.CREATE, `sessionLogs/${sessionId}`);
  }
}

export async function updateStudentSessionLog(params: {
  sessionId: string;
  status: 'active' | 'ended';
  activeDurationSec: number;
  testsCompleted: number;
  questionsAttempted: number;
  subjectsStudied: SubjectKey[];
  lastActivityTitle: string;
  logoutAtMs?: number;
}): Promise<void> {
  if (!params.sessionId || params.sessionId === 'preview_session') return;
  const cleanId = params.sessionId.startsWith('local_')
    ? params.sessionId.slice('local_'.length)
    : params.sessionId;
  const now = Date.now();
  const patch = {
    status: params.status,
    lastActiveAtMs: now,
    logoutAtMs: params.status === 'ended' ? (params.logoutAtMs ?? now) : 0,
    activeDurationSec: Math.max(0, Math.min(86400, Math.round(params.activeDurationSec))),
    testsCompleted: Math.max(0, Math.min(500, Math.round(params.testsCompleted))),
    questionsAttempted: Math.max(0, Math.min(5000, Math.round(params.questionsAttempted))),
    subjectsStudied: Array.from(new Set(params.subjectsStudied)).slice(0, 4),
    lastActivityTitle: (params.lastActivityTitle || 'Student Dashboard').slice(0, 120),
  };

  mutateLocalDb((draft) => {
    const prev = draft.sessionLogs[cleanId];
    if (prev) {
      draft.sessionLogs[cleanId] = {
        ...prev,
        ...patch,
        updatedAt: now,
      };
    }
  });

  if (params.sessionId.startsWith('local_') || isFirestoreQuotaExceeded()) {
    return;
  }

  try {
    await raceWithWriteTimeout(
      updateDoc(doc(db, 'sessionLogs', cleanId), {
        ...patch,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (err) {
    if (isQuotaExceededError(err) || shouldFallbackToLocalOnError(err)) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return;
    }
    handleFirestoreError(err, OperationType.UPDATE, `sessionLogs/${cleanId}`);
  }
}

export function subscribeSessionLogs(
  uid: string | null,
  onChange: (logs: StudentSessionLogDoc[]) => void
): Unsubscribe {
  const path = 'sessionLogs';
  let latestRemote: StudentSessionLogDoc[] = [];

  const emit = () => {
    const localDb = readLocalDb();
    const localLogs = Object.values(localDb.sessionLogs).filter((l) => (uid ? l.uid === uid : true));
    const merged = mergeByIdWithTombstones({
      remoteItems: latestRemote,
      localItems: localLogs,
      getId: (l) => l.id,
    })
      .filter((l) => isRealCohortStudentUid(l.uid))
      .sort((a, b) => (b.loginAtMs || 0) - (a.loginAtMs || 0));
    onChange(merged);
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = uid
    ? query(collection(db, 'sessionLogs'), where('uid', '==', uid))
    : query(collection(db, 'sessionLogs'), where('status', 'in', ['active', 'ended']));
  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      latestRemote = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<StudentSessionLogDoc, 'id'>),
      }));
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

// --- Zero-Effort Auto Daily Mock & Adaptive Smart Practice / Revision Re-Test ---

export async function createSmartPracticeTest(params: {
  uid: string;
  title: string;
  subjectScope: 'full' | SubjectKey;
  questionIds: string[];
  durationMinutes: number;
  scoringConfig: ScoringConfig;
  published?: boolean;
  examMode?: 'standard' | 'tier1_sectional';
  topicTag?: string;
  sectionOrder?: SubjectKey[];
  sectionDurationSec?: number;
  fixedId?: string;
}): Promise<MockTestDoc> {
  const testId = (params.fixedId || makeId(`prac_${params.uid}`)).slice(0, 128);
  const cleanQIds = Array.from(new Set(params.questionIds)).slice(0, 100);
  if (cleanQIds.length === 0) {
    throw new DomainValidationError('No qualifying questions found for this practice set.');
  }
  const durationMinutes = Math.max(1, Math.min(240, Math.round(params.durationMinutes)));
  const title = params.title.trim().slice(0, 120) || 'Adaptive Practice Set';
  const cleanTopicTag = params.topicTag?.trim().slice(0, 80);
  const nowMs = Date.now();

  const localTest: MockTestDoc = {
    id: testId,
    title,
    subjectScope: params.subjectScope,
    durationMinutes,
    positiveMarks: Number(params.scoringConfig.pointsPerCorrect),
    negativeMarks: Number(params.scoringConfig.negativeMarks),
    questionIds: cleanQIds,
    questionCount: cleanQIds.length,
    published: Boolean(params.published ?? false),
    ...(params.examMode ? { examMode: params.examMode } : {}),
    ...(cleanTopicTag ? { topicTag: cleanTopicTag } : {}),
    ...(params.sectionOrder ? { sectionOrder: params.sectionOrder.slice(0, 4) } : {}),
    ...(typeof params.sectionDurationSec === 'number'
      ? { sectionDurationSec: Math.max(60, Math.min(7200, Math.round(params.sectionDurationSec))) }
      : {}),
    createdBy: params.uid,
    createdAt: nowMs,
    updatedAt: nowMs,
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.deletedIds.tests = removeTombstone(draft.deletedIds.tests, testId);
      draft.tests[testId] = localTest;
    });
    return localTest;
  };

  return executeWriteWithLocalFallback({
    tryRemote: async () => {
      await setDoc(doc(db, 'tests', testId), {
        title: localTest.title,
        subjectScope: localTest.subjectScope,
        durationMinutes: localTest.durationMinutes,
        positiveMarks: localTest.positiveMarks,
        negativeMarks: localTest.negativeMarks,
        questionIds: localTest.questionIds,
        questionCount: localTest.questionCount,
        published: localTest.published,
        ...(localTest.examMode ? { examMode: localTest.examMode } : {}),
        ...(localTest.topicTag ? { topicTag: localTest.topicTag } : {}),
        ...(localTest.sectionOrder ? { sectionOrder: localTest.sectionOrder } : {}),
        ...(typeof localTest.sectionDurationSec === 'number'
          ? { sectionDurationSec: localTest.sectionDurationSec }
          : {}),
        createdBy: localTest.createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return applyLocal();
    },
    applyLocal,
    op: { entity: 'test', docId: testId },
  });
}

function inferSubjectForTopic(topic: string, matched: QuestionDoc[]): SubjectKey {
  const fromCatalog = resolveSyllabusChapter(topic);
  if (fromCatalog) return fromCatalog.subject;

  const lower = topic.toLowerCase();
  if (/history|polity|geo|econ|science|biology|physics|chem|static|art|award|current|article|constitution/.test(lower)) {
    return 'ga';
  }
  if (/vocab|synonym|antonym|idiom|grammar|tense|voice|narration|cloze|comprehension|error|spelling/.test(lower)) {
    return 'english';
  }
  if (/series|coding|analogy|syllogism|blood|dice|mirror|puzzle|venn|direction|non-verbal|reasoning/.test(lower)) {
    return 'reasoning';
  }
  if (/geom|trig|algebra|mensur|percent|profit|ratio|interest|time|speed|number|di|data|average|mixture|quant|math/.test(lower)) {
    return 'quant';
  }
  if (matched.length > 0) {
    return matched[0].subject;
  }
  return 'quant';
}

export async function createTier1FullMock(params: { uid: string }): Promise<MockTestDoc> {
  const allQuestions = await fetchAllQuestionsOnce();
  const assembled = assembleTier1Questions(allQuestions, `${params.uid}_${Date.now()}`);
  if (assembled.questionIds.length < 100) {
    throw new DomainValidationError(
      `Need at least 25 questions in each of the 4 subjects for Tier-I Full Mock (found ${assembled.questionIds.length}).`
    );
  }
  return createSmartPracticeTest({
    uid: params.uid,
    title: 'SSC CGL Tier-I Full Mock (100 Qs · 4x15m Sectional)',
    subjectScope: 'full',
    questionIds: assembled.questionIds,
    durationMinutes: TIER1_TOTAL_DURATION_MINUTES,
    scoringConfig: {
      ...DEFAULT_SCORING_CONFIG,
      pointsPerCorrect: TIER1_POSITIVE_MARKS,
      negativeMarks: TIER1_NEGATIVE_MARKS,
    },
    published: false,
    examMode: 'tier1_sectional',
    sectionOrder: [...TIER1_SECTION_ORDER],
    sectionDurationSec: TIER1_SECTION_DURATION_SEC,
  });
}

export async function createTier2FullMock(params: { uid: string }): Promise<MockTestDoc> {
  const allQuestions = await fetchAllQuestionsOnce();
  const assembled = assembleTier2Questions(allQuestions, `${params.uid}_${Date.now()}`);
  if (assembled.questionIds.length < 100) {
    throw new DomainValidationError(
      `Need weighted questions across all 4 subjects for Tier-II Paper-I Mock (found ${assembled.questionIds.length}).`
    );
  }
  return createSmartPracticeTest({
    uid: params.uid,
    title: 'SSC CGL Tier-II Paper-I Full Mock (100 Qs · 4x20m · +3/-1)',
    subjectScope: 'full',
    questionIds: assembled.questionIds,
    durationMinutes: TIER2_TOTAL_DURATION_MINUTES,
    scoringConfig: {
      ...DEFAULT_SCORING_CONFIG,
      pointsPerCorrect: TIER2_POSITIVE_MARKS,
      negativeMarks: TIER2_NEGATIVE_MARKS,
    },
    published: false,
    // Keep enum compatible with firestore.rules ('standard' | 'tier1_sectional')
    examMode: 'tier1_sectional',
    sectionOrder: [...TIER2_SECTION_ORDER],
    sectionDurationSec: TIER2_SECTION_DURATION_SEC,
  });
}

export async function createSmartTopicTest(params: {
  uid: string;
  topicInput: string;
  subjectFilter?: 'all' | SubjectKey;
  questionCount: number;
  timeLimitMinutes: number;
  scoringConfig: ScoringConfig;
}): Promise<{ test: MockTestDoc; pyqCount: number; aiCount: number }> {
  const rawTopic = params.topicInput.trim().slice(0, 80);
  if (!rawTopic) {
    throw new DomainValidationError('Please select a Syllabus Topic from the dropdown to start.');
  }
  const subFilter = params.subjectFilter ?? 'all';
  const catalogMatch = findSyllabusChapterByValue(
    rawTopic,
    subFilter !== 'all' ? subFilter : undefined
  );
  const cleanTopic = (catalogMatch?.title || rawTopic).slice(0, 80);
  const requestedCount = Math.max(1, Math.min(50, Math.round(params.questionCount || 15)));
  const safeDuration = Math.max(1, Math.min(180, Math.round(params.timeLimitMinutes || requestedCount)));
  const needle = cleanTopic.toLowerCase();

  const subjectAliases: Record<string, SubjectKey> = {
    quant: 'quant',
    maths: 'quant',
    math: 'quant',
    mathematics: 'quant',
    reasoning: 'reasoning',
    english: 'english',
    ga: 'ga',
    gs: 'ga',
    'general awareness': 'ga',
  };
  const directSubjectMatch = subjectAliases[needle];
  const targetSubject: SubjectKey =
    subFilter !== 'all'
      ? subFilter
      : catalogMatch?.subject ?? directSubjectMatch ?? inferSubjectForTopic(cleanTopic, []);

  // 1. Hybrid Router: General Awareness (GK/History/Polity/Geo/Science) NEVER calls Groq AI;
  // it fetches strictly from the verified local GK bank. Quant, Reasoning, and English use Groq AI.
  const aiIds: string[] = [];
  let staticGkIds: string[] = [];
  let lastAiError: string | null = null;
  const isGaRequest = isGeneralAwarenessSubjectOrTopic(targetSubject, cleanTopic);

  if (isGaRequest) {
    const staticDocs = fetchStaticGKQuestionDocs(cleanTopic, requestedCount);
    staticGkIds = staticDocs.map((q) => q.id);
  } else {
    let remainingToGen = requestedCount;
    while (remainingToGen > 0) {
      const batchSize = Math.min(15, remainingToGen);
      try {
        const data = await aiGenerateQuestions({
          subject: targetSubject,
          topic: cleanTopic,
          difficulty: 'medium',
          count: batchSize,
          timeoutMs: 60_000,
        });
        const generated = Array.isArray(data.questions) ? data.questions : [];
        if (generated.length === 0) {
          lastAiError = 'AI generator returned 0 questions for this topic.';
          break;
        }
        const saved = await addQuestionsBatchWithIds(generated, params.uid);
        aiIds.push(...saved.ids);
        remainingToGen -= generated.length;
      } catch (err) {
        lastAiError = err instanceof Error ? err.message : 'AI question generator request failed.';
        break;
      }
    }
  }

  // 2. Graceful shortfall fallback: pull matching verified PYQs & bank questions if needed
  let pyqIds: string[] = [];
  const seededIds = isGaRequest ? staticGkIds : aiIds;
  if (seededIds.length < requestedCount) {
    const shortfall = requestedCount - seededIds.length;
    const allQuestions = await fetchAllQuestionsOnce();
    const existingSet = new Set(seededIds);
    const matchingPyqs = allQuestions
      .filter((q) => {
        if (existingSet.has(q.id)) return false;
        if (subFilter !== 'all' && q.subject !== subFilter) return false;
        if (isGaRequest && q.subject === 'ga') return true;
        if (directSubjectMatch && q.subject === directSubjectMatch) return true;
        if (catalogMatch && q.subject === catalogMatch.subject) {
          const qTopic = q.topic.toLowerCase();
          const qText = q.questionEn.toLowerCase();
          if (
            qTopic.includes(needle) ||
            needle.includes(qTopic) ||
            catalogMatch.aliases.some((al) => qTopic.includes(al) || qText.includes(al))
          ) {
            return true;
          }
        }
        return (
          q.topic.toLowerCase().includes(needle) ||
          q.questionEn.toLowerCase().includes(needle) ||
          needle.includes(q.topic.toLowerCase())
        );
      })
      .sort(() => Math.random() - 0.5);
    pyqIds = matchingPyqs.slice(0, shortfall).map((q) => q.id);
  }

  const combinedIds = Array.from(new Set([...seededIds, ...pyqIds])).slice(0, requestedCount);
  if (combinedIds.length === 0) {
    throw new DomainValidationError(
      lastAiError ||
        `Could not generate "${cleanTopic}" questions and no matching bank questions were found.`
    );
  }

  const test = await createSmartPracticeTest({
    uid: params.uid,
    title: `${cleanTopic} Smart Test (${combinedIds.length} Qs)`.slice(0, 120),
    subjectScope: targetSubject,
    topicTag: cleanTopic,
    questionIds: combinedIds,
    durationMinutes: safeDuration,
    scoringConfig: params.scoringConfig,
    published: false,
  });

  return {
    test,
    pyqCount: pyqIds.length,
    aiCount: aiIds.length,
  };
}

export async function createCustomMockFromBank(params: {
  uid: string;
  filterValue: string;
  count: number;
  durationMinutes: number;
  scoringConfig: ScoringConfig;
}): Promise<MockTestDoc> {
  const allQuestions = await fetchAllQuestionsOnce();
  const selection = selectCustomMockQuestions({
    allQuestions,
    filterValue: params.filterValue,
    count: params.count,
    seedKey: `${params.uid}_${Date.now()}_${Math.random()}`,
  });
  if (selection.questionIds.length === 0) {
    throw new DomainValidationError('No matching questions found in the Question Bank for this selection.');
  }
  const safeDuration = Math.max(1, Math.min(240, Math.round(params.durationMinutes || 10)));
  return createSmartPracticeTest({
    uid: params.uid,
    title: `${selection.label} (${selection.questionIds.length} Qs)`,
    subjectScope: selection.subjectScope,
    questionIds: selection.questionIds,
    durationMinutes: safeDuration,
    scoringConfig: params.scoringConfig,
    published: false,
  });
}

export async function createWrongTopicsRevisionTest(params: {
  uid: string;
  topicNames: string[];
  wrongQuestionIds: string[];
  targetCount?: number;
  scoringConfig: ScoringConfig;
}): Promise<MockTestDoc> {
  const allQuestions = await fetchAllQuestionsOnce();
  const limit = Math.max(5, Math.min(50, params.targetCount ?? 15));
  const normTopics = new Set(params.topicNames.map((t) => t.trim().toLowerCase()).filter(Boolean));
  const byId = new Map(allQuestions.map((q) => [q.id, q]));

  const chosen: string[] = [];
  const chosenSet = new Set<string>();

  for (const qid of params.wrongQuestionIds) {
    if (chosen.length >= limit) break;
    if (byId.has(qid) && !chosenSet.has(qid)) {
      chosen.push(qid);
      chosenSet.add(qid);
    }
  }

  const matchingTopicPool = allQuestions
    .filter((q) => normTopics.has(q.topic.trim().toLowerCase()) && !chosenSet.has(q.id))
    .sort(() => Math.random() - 0.5);

  for (const q of matchingTopicPool) {
    if (chosen.length >= limit) break;
    chosen.push(q.id);
    chosenSet.add(q.id);
  }

  if (chosen.length === 0) {
    throw new DomainValidationError('No revision questions available for these weak topics right now.');
  }

  const chosenSubs = new Set(chosen.map((id) => byId.get(id)?.subject).filter(Boolean));
  const subjectScope: 'full' | SubjectKey =
    chosenSubs.size === 1 ? (Array.from(chosenSubs)[0] as SubjectKey) : 'full';
  const topicPreview = params.topicNames.slice(0, 2).join(', ');
  const titleSuffix = params.topicNames.length > 2 ? ` +${params.topicNames.length - 2} more` : '';
  const title = topicPreview
    ? `Weak Topic Revision: ${topicPreview}${titleSuffix}`
    : `Weak Topics Revision (${chosen.length} Qs)`;

  return createSmartPracticeTest({
    uid: params.uid,
    title: title.slice(0, 120),
    subjectScope,
    questionIds: chosen,
    durationMinutes: Math.max(5, Math.min(45, chosen.length)),
    scoringConfig: params.scoringConfig,
    published: false,
  });
}

const dailyAutoGenerationLocks = new Map<string, Promise<boolean>>();

export async function ensureDailyAutoMock(params: {
  scoringConfig: ScoringConfig;
  revisionItems?: RevisionItemDoc[];
  recentQuestionIds?: string[];
  forceDateKey?: string;
}): Promise<boolean> {
  const dateKey = params.forceDateKey || getLocalDateKey();
  const dailyTestId = `${DAILY_MOCK_PREFIX}${dateKey}`;

  const existingLocal = readLocalDb().tests[dailyTestId];
  if (existingLocal || readLocalDb().deletedIds.tests.includes(dailyTestId)) {
    return false;
  }

  const existingLock = dailyAutoGenerationLocks.get(dailyTestId);
  if (existingLock) return existingLock;

  const task = (async () => {
    try {
      if (!isFirestoreQuotaExceeded()) {
        try {
          const existingSnap = await getDoc(doc(db, 'tests', dailyTestId));
          if (existingSnap.exists()) {
            return false;
          }
        } catch (err) {
          if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
        }
      }

      const bankQuestions = await fetchAllQuestionsOnce();
      const recentTopics = Array.from(new Set(bankQuestions.slice(0, 12).map((q) => q.topic)));

      let freshAiIds: string[] = [];
      try {
        const data = await aiGenerateDailyPack({
          dateKey,
          avoidTopics: recentTopics,
          perSubject: 3,
          timeoutMs: 12_000,
        });
        if (Array.isArray(data.questions) && data.questions.length > 0) {
          const saved = await addQuestionsBatchWithIds(data.questions, 'auto_daily_engine');
          freshAiIds = saved.ids;
        }
      } catch {
        // Fallback smoothly to Question Bank + Revision Vault below
      }

      const remainingNeeded = Math.max(0, 20 - freshAiIds.length);
      const bankSelection =
        remainingNeeded > 0 && bankQuestions.length > 0
          ? buildAdaptiveQuestionSelection({
              allQuestions: bankQuestions,
              revisionItems: params.revisionItems ?? [],
              recentQuestionIds: params.recentQuestionIds ?? [],
              subjectScope: 'full',
              count: remainingNeeded,
              includeRevisionVault: true,
              includeMasteredVault: false,
              seedKey: dailyTestId,
            }).questionIds
          : [];

      const finalIds = Array.from(new Set([...freshAiIds, ...bankSelection])).slice(0, 100);
      if (finalIds.length === 0) {
        return false;
      }

      await createSmartPracticeTest({
        fixedId: dailyTestId,
        uid: 'auto_daily_engine',
        title: formatDailyMockTitle(dateKey),
        subjectScope: 'full',
        questionIds: finalIds,
        durationMinutes: Math.max(15, Math.min(60, finalIds.length)),
        scoringConfig: params.scoringConfig,
        published: true,
      });

      return true;
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return false;
    } finally {
      dailyAutoGenerationLocks.delete(dailyTestId);
    }
  })();

  dailyAutoGenerationLocks.set(dailyTestId, task);
  return task;
}

export interface SavedAttemptResponseDoc {
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
  timeSpentSec: number;
  markedForReview: boolean;
}

export async function fetchAttemptResponses(
  uid: string,
  attemptId: string
): Promise<Record<string, SavedAttemptResponseDoc>> {
  const localMap = readLocalDb().attemptResponses[attemptId];
  if (localMap && Object.keys(localMap).length > 0) {
    return localMap;
  }
  if (isFirestoreQuotaExceeded()) {
    return localMap ?? {};
  }
  try {
    const snap = await getDocs(
      query(collection(db, 'attempts', attemptId, 'responses'), where('uid', '==', uid))
    );
    const map: Record<string, SavedAttemptResponseDoc> = {};
    for (const d of snap.docs) {
      const data = d.data() as SavedAttemptResponseDoc;
      map[d.id] = {
        questionId: data.questionId || d.id,
        selectedIndex: typeof data.selectedIndex === 'number' ? data.selectedIndex : -1,
        isCorrect: Boolean(data.isCorrect),
        timeSpentSec: typeof data.timeSpentSec === 'number' ? data.timeSpentSec : 0,
        markedForReview: Boolean(data.markedForReview),
      };
    }
    if (Object.keys(map).length > 0) {
      mutateLocalDb((draft) => {
        draft.attemptResponses[attemptId] = map;
      });
    }
    return map;
  } catch (err) {
    if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    return localMap ?? {};
  }
}

export async function ensureDailySectionalAutoMocks(params: {
  scoringConfig: ScoringConfig;
  revisionItems?: RevisionItemDoc[];
  recentQuestionIds?: string[];
  forceDateKey?: string;
  subjects?: SubjectKey[];
}): Promise<number> {
  const dateKey = params.forceDateKey || getLocalDateKey();
  const subjects: SubjectKey[] = params.subjects ?? ['quant', 'reasoning', 'english', 'ga'];
  const lockKey = `sec_suite_${dateKey}`;

  if (dailyAutoGenerationLocks.has(lockKey)) {
    const ok = await dailyAutoGenerationLocks.get(lockKey);
    return ok ? 1 : 0;
  }

  let createdCount = 0;
  const runner = (async () => {
    try {
      let bankQuestions: QuestionDoc[] | null = null;
      const getBank = async () => {
        if (!bankQuestions) {
          bankQuestions = await fetchAllQuestionsOnce();
        }
        return bankQuestions;
      };

      for (const subject of subjects) {
        const secTestId = buildDailySectionalTestId(subject, dateKey);
        const localDb = readLocalDb();
        if (localDb.tests[secTestId] || localDb.deletedIds.tests.includes(secTestId)) {
          continue;
        }
        if (!isFirestoreQuotaExceeded()) {
          try {
            const existing = await getDoc(doc(db, 'tests', secTestId));
            if (existing.exists()) continue;
          } catch (err) {
            if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
          }
        }

        let allBank = await getBank();
        const subjectCount = allBank.filter((q) => q.subject === subject).length;
        let freshIds: string[] = [];

        if (subjectCount < 10 && subject !== 'ga') {
          try {
            const data = await aiGenerateQuestions({
              subject,
              topic: 'SSC CGL Daily Sectional Sprint',
              difficulty: 'medium',
              count: 5,
              timeoutMs: 12_000,
            });
            if (Array.isArray(data.questions) && data.questions.length > 0) {
              const saved = await addQuestionsBatchWithIds(data.questions, 'auto_daily_engine');
              freshIds = saved.ids;
              bankQuestions = await fetchAllQuestionsOnce();
              allBank = bankQuestions;
            }
          } catch {
            // Fall back smoothly to existing bank
          }
        }

        const targetQs = 15;
        const needed = Math.max(0, targetQs - freshIds.length);
        const selection =
          needed > 0 && allBank.length > 0
            ? buildAdaptiveQuestionSelection({
                allQuestions: allBank,
                revisionItems: params.revisionItems ?? [],
                recentQuestionIds: params.recentQuestionIds ?? [],
                subjectScope: subject,
                count: needed,
                includeRevisionVault: true,
                includeMasteredVault: false,
                seedKey: secTestId,
              }).questionIds
            : [];

        const finalIds = Array.from(new Set([...freshIds, ...selection])).slice(0, targetQs);
        if (finalIds.length === 0) continue;

        await createSmartPracticeTest({
          fixedId: secTestId,
          uid: 'auto_daily_engine',
          title: formatDailySectionalTitle(subject, dateKey),
          subjectScope: subject,
          questionIds: finalIds,
          durationMinutes: Math.max(10, Math.min(30, finalIds.length)),
          scoringConfig: params.scoringConfig,
          published: true,
        });
        createdCount += 1;
      }

      return createdCount > 0;
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return false;
    } finally {
      dailyAutoGenerationLocks.delete(lockKey);
    }
  })();

  dailyAutoGenerationLocks.set(lockKey, runner);
  await runner;
  return createdCount;
}

export async function ensureDailyCohortTask(params?: {
  forceDateKey?: string;
}): Promise<boolean> {
  const dateKey = params?.forceDateKey || getLocalDateKey();
  const taskId = `daily_task_${dateKey}`;
  const dueDate = dateKey.replace(/_/g, '-');

  const localDb = readLocalDb();
  if (localDb.tasks[taskId] || localDb.deletedIds.tasks.includes(taskId)) {
    return false;
  }

  const existingLock = dailyAutoGenerationLocks.get(taskId);
  if (existingLock) return existingLock;

  const taskRunner = (async () => {
    try {
      if (!isFirestoreQuotaExceeded()) {
        try {
          const snap = await getDoc(doc(db, 'tasks', taskId));
          if (snap.exists()) return false;
        } catch (err) {
          if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
        }
      }

      const parts = dateKey.split('_').map(Number);
      const label =
        parts.length === 3 && parts.every((n) => Number.isFinite(n))
          ? new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
            })
          : dueDate;

      const nowMs = Date.now();
      const localTask: CohortTaskDoc = {
        id: taskId,
        title: `Daily Consistency Sprint — ${label}`.slice(0, 120),
        description:
          'Complete at least 1 fresh mock or sectional sprint (>80% solved) today to claim Bonus XP.',
        targetTests: 1,
        targetSubject: 'all',
        bonusXp: 40,
        dueDate,
        active: true,
        createdAt: nowMs,
        updatedAt: nowMs,
      };

      const applyLocal = () => {
        mutateLocalDb((draft) => {
          draft.tasks[taskId] = localTask;
        });
        return true;
      };

      return executeWriteWithLocalFallback({
        tryRemote: async () => {
          await setDoc(doc(db, 'tasks', taskId), {
            title: localTask.title,
            description: localTask.description,
            targetTests: localTask.targetTests,
            targetSubject: localTask.targetSubject,
            bonusXp: localTask.bonusXp,
            dueDate: localTask.dueDate,
            active: localTask.active,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          return applyLocal();
        },
        applyLocal,
        op: { entity: 'task', docId: taskId },
      });
    } catch (err) {
      if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
      return false;
    } finally {
      dailyAutoGenerationLocks.delete(taskId);
    }
  })();

  dailyAutoGenerationLocks.set(taskId, taskRunner);
  return taskRunner;
}

export async function ensureDailyAutomationSuite(params: {
  scoringConfig: ScoringConfig;
  revisionItems?: RevisionItemDoc[];
  recentQuestionIds?: string[];
  forceDateKey?: string;
}): Promise<{ dailyMockCreated: boolean; sectionalsCreated: number; dailyTaskCreated: boolean }> {
  const dateKey = params.forceDateKey || getLocalDateKey();
  const dailyDoneKey = `getcgl_daily_suite_done_${dateKey}`;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(dailyDoneKey) === '1') {
      return { dailyMockCreated: false, sectionalsCreated: 0, dailyTaskCreated: false };
    }
  } catch {
    // Ignore storage read errors
  }

  const dailyMockCreated = await ensureDailyAutoMock(params);
  const sectionalsCreated = await ensureDailySectionalAutoMocks(params);
  const dailyTaskCreated = await ensureDailyCohortTask({ forceDateKey: params.forceDateKey });

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(dailyDoneKey, '1');
    }
  } catch {
    // Ignore storage write errors
  }

  return { dailyMockCreated, sectionalsCreated, dailyTaskCreated };
}

// --- Zero-Loss Exam Draft Persistence (Firestore + Local Storage Fallback) ---

function localDraftStorageKey(uid: string, testId: string): string {
  return `getcgl_exam_draft_${uid}_${testId}`;
}

function legacyDraftStorageKey(uid: string, testId: string): string {
  return `sankalp_exam_draft_${uid}_${testId}`;
}

function readAllLocalDrafts(uid: string): TestDraftDoc[] {
  const drafts: TestDraftDoc[] = [];
  const prefixNew = `getcgl_exam_draft_${uid}_`;
  const prefixOld = `sankalp_exam_draft_${uid}_`;
  const seen = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (!k.startsWith(prefixNew) && !k.startsWith(prefixOld)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<TestDraftDoc> & { testId?: string };
      const testId = k.startsWith(prefixNew) ? k.slice(prefixNew.length) : k.slice(prefixOld.length);
      if (!testId || seen.has(testId)) continue;
      seen.add(testId);
      const responses = parsed.responses ?? {};
      const answeredCount =
        typeof parsed.answeredCount === 'number'
          ? parsed.answeredCount
          : Object.values(responses).filter((r) => r && r.selectedIndex >= 0 && r.selectedIndex <= 3).length;
      drafts.push({
        id: testId,
        uid,
        testId,
        testTitle: parsed.testTitle || testId,
        subjectScope: parsed.subjectScope || 'full',
        currentIdx: Math.max(0, Number(parsed.currentIdx ?? 0)),
        secondsLeft: Math.max(0, Number(parsed.secondsLeft ?? 0)),
        lang: parsed.lang === 'hi' ? 'hi' : 'en',
        answeredCount,
        totalQuestions: Math.max(1, Number(parsed.totalQuestions ?? Object.keys(responses).length ?? 1)),
        responses,
        ...(parsed.sectionSecondsLeft ? { sectionSecondsLeft: parsed.sectionSecondsLeft } : {}),
        ...(typeof parsed.activeSectionIdx === 'number' ? { activeSectionIdx: parsed.activeSectionIdx } : {}),
        ...(typeof parsed.examSessionId === 'string' && parsed.examSessionId
          ? { examSessionId: parsed.examSessionId }
          : {}),
        ...(typeof parsed.deadlineAtMs === 'number' && Number.isFinite(parsed.deadlineAtMs)
          ? { deadlineAtMs: parsed.deadlineAtMs }
          : {}),
        ...(typeof parsed.sectionDeadlineAtMs === 'number' && Number.isFinite(parsed.sectionDeadlineAtMs)
          ? { sectionDeadlineAtMs: parsed.sectionDeadlineAtMs }
          : {}),
        updatedAtMs: Number(parsed.updatedAtMs ?? Date.now()),
      });
    }
  } catch {
    // Ignore storage read issues
  }
  return drafts.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export async function saveTestDraft(params: {
  uid: string;
  testId: string;
  testTitle: string;
  subjectScope: string;
  currentIdx: number;
  secondsLeft: number;
  lang: LanguageMode;
  totalQuestions: number;
  responses: Record<string, QuestionResponseState>;
  sectionSecondsLeft?: Partial<Record<SubjectKey, number>>;
  activeSectionIdx?: number;
  examSessionId?: string;
  deadlineAtMs?: number;
  sectionDeadlineAtMs?: number;
}): Promise<void> {
  const safeResponses: Record<string, QuestionResponseState> = {};
  let answeredCount = 0;
  let count = 0;
  for (const [qId, st] of Object.entries(params.responses)) {
    if (count >= 120) break;
    if (!st) continue;
    const sel = Number.isFinite(st.selectedIndex) ? st.selectedIndex : -1;
    if (sel >= 0 && sel <= 3) answeredCount += 1;
    safeResponses[qId] = {
      questionId: qId,
      visited: Boolean(st.visited),
      selectedIndex: sel,
      markedForReview: Boolean(st.markedForReview),
      timeSpentSec: Math.max(0, Math.round(st.timeSpentSec || 0)),
    };
    count += 1;
  }

  const nowMs = Date.now();
  // Remote Firestore testDrafts schema enforces strict hasOnly keys; keep wall-clock deadlines local-only.
  const remoteDraftDoc: TestDraftDoc = {
    id: params.testId,
    uid: params.uid,
    testId: params.testId,
    testTitle: params.testTitle.slice(0, 120) || 'Mock Test',
    subjectScope: params.subjectScope.slice(0, 40) || 'full',
    currentIdx: Math.max(0, Math.min(200, Math.round(params.currentIdx))),
    secondsLeft: Math.max(0, Math.min(20000, Math.round(params.secondsLeft))),
    lang: params.lang === 'hi' ? 'hi' : 'en',
    answeredCount,
    totalQuestions: Math.max(1, Math.min(200, Math.round(params.totalQuestions))),
    responses: safeResponses,
    ...(params.sectionSecondsLeft ? { sectionSecondsLeft: params.sectionSecondsLeft } : {}),
    ...(typeof params.activeSectionIdx === 'number'
      ? { activeSectionIdx: Math.max(0, Math.min(3, Math.round(params.activeSectionIdx))) }
      : {}),
    updatedAtMs: nowMs,
  };

  const localDraftDoc: TestDraftDoc = {
    ...remoteDraftDoc,
    ...(params.examSessionId ? { examSessionId: params.examSessionId } : {}),
    ...(typeof params.deadlineAtMs === 'number' && Number.isFinite(params.deadlineAtMs)
      ? { deadlineAtMs: params.deadlineAtMs }
      : {}),
    ...(typeof params.sectionDeadlineAtMs === 'number' && Number.isFinite(params.sectionDeadlineAtMs)
      ? { sectionDeadlineAtMs: params.sectionDeadlineAtMs }
      : {}),
  };

  try {
    localStorage.setItem(
      localDraftStorageKey(params.uid, params.testId),
      JSON.stringify(localDraftDoc)
    );
  } catch {
    // Ignore storage quota errors
  }

  void saveOfflineExamDraft(localDraftDoc);

  if (isFirestoreQuotaExceeded()) {
    return;
  }

  try {
    await raceWithWriteTimeout(
      setDoc(doc(db, 'students', params.uid, 'testDrafts', params.testId), {
        ...remoteDraftDoc,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (err) {
    if (isQuotaExceededError(err)) {
      markFirestoreQuotaExceeded(err);
    }
    // Local cache already written for instant resume; silently tolerate offline/quota/pending rules
  }
}

export async function fetchTestDraft(uid: string, testId: string): Promise<TestDraftDoc | null> {
  let localDraft: TestDraftDoc | null = null;
  try {
    const raw =
      localStorage.getItem(localDraftStorageKey(uid, testId)) ??
      localStorage.getItem(legacyDraftStorageKey(uid, testId));
    if (raw) {
      const parsed = JSON.parse(raw) as TestDraftDoc;
      if (parsed && parsed.responses) {
        localDraft = parsed;
      }
    }
  } catch {
    // Ignore
  }

  try {
    const idbDraft = await getOfflineExamDraft(uid, testId);
    if (idbDraft && (!localDraft || (idbDraft.updatedAtMs || 0) > (localDraft.updatedAtMs || 0))) {
      localDraft = idbDraft;
    }
  } catch {
    // Ignore IDB fallback errors
  }

  const canFetchRemote =
    !isFirestoreQuotaExceeded() &&
    (typeof navigator === 'undefined' || navigator.onLine !== false);
  if (!canFetchRemote) {
    return localDraft;
  }

  try {
    const remote = await Promise.race([
      getDoc(doc(db, 'students', uid, 'testDrafts', testId)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    if (remote && remote.exists()) {
      const remoteData = { id: remote.id, ...(remote.data() as Omit<TestDraftDoc, 'id'>) };
      if (!localDraft || (remoteData.updatedAtMs || 0) >= (localDraft.updatedAtMs || 0)) {
        return remoteData;
      }
    }
  } catch {
    // Fall back to local draft cleanly
  }
  return localDraft;
}

export function subscribeTestDrafts(
  uid: string,
  onChange: (drafts: TestDraftDoc[]) => void
): Unsubscribe {
  const localInitial = readAllLocalDrafts(uid);
  onChange(localInitial);

  const q = query(collection(db, 'students', uid, 'testDrafts'), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const byId = new Map<string, TestDraftDoc>();
      for (const l of readAllLocalDrafts(uid)) {
        byId.set(l.testId, l);
      }
      for (const d of snap.docs) {
        const remote = { id: d.id, ...(d.data() as Omit<TestDraftDoc, 'id'>) };
        const prev = byId.get(remote.testId);
        if (!prev || (remote.updatedAtMs || 0) >= (prev.updatedAtMs || 0)) {
          byId.set(remote.testId, remote);
        }
      }
      const merged = Array.from(byId.values()).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onChange(merged);
    },
    () => {
      onChange(readAllLocalDrafts(uid));
    }
  );
}

export async function deleteTestDraft(uid: string, testId: string): Promise<void> {
  try {
    localStorage.removeItem(localDraftStorageKey(uid, testId));
    localStorage.removeItem(legacyDraftStorageKey(uid, testId));
  } catch {
    // Ignore
  }
  void deleteOfflineExamDraft(uid, testId);
  if (isFirestoreQuotaExceeded()) return;
  try {
    await raceWithWriteTimeout(deleteDoc(doc(db, 'students', uid, 'testDrafts', testId)));
  } catch (err) {
    if (isQuotaExceededError(err)) markFirestoreQuotaExceeded(err);
    // Ignore if offline or rule missing
  }
}

// --- Indestructible Progress Backup (DB + Server Disk Snapshot, Deletion Prohibited) ---

function extractAnyMs(raw: unknown): number {
  if (!raw) return 0;
  if (typeof (raw as { toMillis?: () => number }).toMillis === 'function') {
    return (raw as { toMillis: () => number }).toMillis();
  }
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'string' || typeof raw === 'number') {
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

export async function saveProgressBackup(params: {
  student: StudentProfile;
  leaderboardEntry: LeaderboardEntry | null | undefined;
  attempts: TestAttemptDoc[];
  totalStudySec: number;
}): Promise<ProgressBackupDoc> {
  const { student, leaderboardEntry, attempts, totalStudySec } = params;
  const studentAttempts = attempts.filter((a) => a.uid === student.uid);
  const completedCount = studentAttempts.filter(isAttemptComplete).length;
  const nowMs = Date.now();
  const backupId = `backup_${student.uid}`.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);

  const attemptsHistory: ProgressBackupAttemptSummary[] = studentAttempts.slice(0, 100).map((a) => ({
    attemptId: a.id,
    testId: a.testId,
    testTitle: a.testTitle.slice(0, 120),
    subjectScope: a.subjectScope.slice(0, 40),
    score: Number(a.score || 0),
    maxScore: Number(a.maxScore || 0),
    accuracy: Number(a.accuracy || 0),
    correctCount: Math.max(0, Math.round(a.correctCount || 0)),
    wrongCount: Math.max(0, Math.round(a.wrongCount || 0)),
    skippedCount: Math.max(0, Math.round(a.skippedCount || 0)),
    xpEarned: Number(a.xpEarned || 0),
    totalTimeSec: Math.max(0, Math.round(a.totalTimeSec || 0)),
    isComplete: isAttemptComplete(a),
    recordedAtMs: extractAnyMs(a.createdAt) || nowMs,
  }));

  const payload: ProgressBackupDoc = {
    id: backupId,
    uid: student.uid,
    loginId: (student.loginId || student.uid).slice(0, 120),
    displayName: (student.displayName || 'Aspirant').slice(0, 80),
    targetPost: (student.targetPost || 'SSC CGL').slice(0, 80),
    slotNumber: Math.min(5, Math.max(1, Math.round(student.slotNumber || 1))),
    totalXp: Number(leaderboardEntry?.totalXp ?? 0),
    testsCompleted: Math.max(completedCount, leaderboardEntry?.testsAttempted ?? 0),
    totalSubmissions: studentAttempts.length,
    bestScore: Number(leaderboardEntry?.bestScore ?? 0),
    avgAccuracy: Number(leaderboardEntry?.avgAccuracy ?? 0),
    totalStudySec: Math.max(0, Math.round(totalStudySec || 0)),
    attemptsHistory,
    updatedAtMs: nowMs,
  };

  try {
    localStorage.setItem(`getcgl_progress_backup_${student.uid}`, JSON.stringify(payload));
  } catch {
    // Ignore local storage quota
  }

  // Persist permanent Firestore backup (non-deletable) unless quota circuit-breaker is tripped
  if (!isFirestoreQuotaExceeded()) {
    void setDoc(doc(db, 'progressBackups', backupId), {
      uid: payload.uid,
      loginId: payload.loginId,
      displayName: payload.displayName,
      targetPost: payload.targetPost,
      slotNumber: payload.slotNumber,
      totalXp: payload.totalXp,
      testsCompleted: payload.testsCompleted,
      totalSubmissions: payload.totalSubmissions,
      bestScore: payload.bestScore,
      avgAccuracy: payload.avgAccuracy,
      totalStudySec: payload.totalStudySec,
      attemptsHistory: payload.attemptsHistory,
      updatedAtMs: payload.updatedAtMs,
      updatedAt: serverTimestamp(),
    }).catch((err) => {
      if (isQuotaExceededError(err)) {
        markFirestoreQuotaExceeded(err);
      }
    });
  }

  return payload;
}

// --- Admin Support Tickets & Resolution Notifications ---

export async function createSupportTicket(params: {
  uid: string;
  loginId: string;
  studentName: string;
  targetPost: string;
  subject: string;
  message: string;
}): Promise<string> {
  const cleanMessage = params.message.trim().slice(0, 2000);
  if (!cleanMessage) {
    throw new DomainValidationError('Please describe the issue before submitting.');
  }
  const cleanSubject = (params.subject.trim() || 'Platform Issue / Bug Report').slice(0, 120);
  const ticketId = makeId(`tkt_${params.uid}`).slice(0, 128);
  const nowMs = Date.now();
  const baseTicket: SupportTicketDoc = {
    id: ticketId,
    uid: params.uid,
    loginId: (params.loginId || params.uid).slice(0, 120),
    studentName: (params.studentName || 'Aspirant').slice(0, 80),
    targetPost: (params.targetPost || 'SSC CGL').slice(0, 80),
    subject: cleanSubject,
    message: cleanMessage,
    status: 'open',
    resolutionNotified: false,
    resolutionAcked: false,
    createdAtMs: nowMs,
    resolvedAtMs: 0,
    updatedAt: nowMs,
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.supportTickets[ticketId] = baseTicket;
    });
    return ticketId;
  };

  return executeWriteWithLocalFallback({
    tryRemote: async () => {
      await setDoc(doc(db, 'supportTickets', ticketId), {
        uid: baseTicket.uid,
        loginId: baseTicket.loginId,
        studentName: baseTicket.studentName,
        targetPost: baseTicket.targetPost,
        subject: baseTicket.subject,
        message: baseTicket.message,
        status: baseTicket.status,
        resolutionNotified: baseTicket.resolutionNotified,
        resolutionAcked: baseTicket.resolutionAcked,
        createdAtMs: baseTicket.createdAtMs,
        resolvedAtMs: baseTicket.resolvedAtMs,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return applyLocal();
    },
    applyLocal,
    op: { entity: 'supportTicket', docId: ticketId },
  });
}

export function subscribeSupportTickets(
  uid: string | null,
  onChange: (tickets: SupportTicketDoc[]) => void
): Unsubscribe {
  const path = 'supportTickets';
  let latestRemote: SupportTicketDoc[] = [];

  const emit = () => {
    const localDb = readLocalDb();
    const localTickets = Object.values(localDb.supportTickets).filter((t) =>
      uid ? t.uid === uid : true
    );
    const merged = mergeByIdWithTombstones({
      remoteItems: latestRemote,
      localItems: localTickets,
      getId: (t) => t.id,
    }).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    onChange(merged);
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = uid
    ? query(collection(db, 'supportTickets'), where('uid', '==', uid))
    : query(collection(db, 'supportTickets'), where('status', 'in', ['open', 'resolved']));

  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      latestRemote = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SupportTicketDoc, 'id'>),
      }));
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

export async function resolveSupportTicket(
  ticketId: string,
  adminReply?: string
): Promise<void> {
  const cleanReply = (adminReply ?? '').trim().slice(0, 1000);
  const nowMs = Date.now();

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      const existing = draft.supportTickets[ticketId];
      if (existing) {
        draft.supportTickets[ticketId] = {
          ...existing,
          status: 'resolved',
          resolutionNotified: true,
          resolutionAcked: false,
          resolvedAtMs: nowMs,
          ...(cleanReply ? { adminReply: cleanReply } : {}),
          updatedAt: nowMs,
        };
      }
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      const patch: Record<string, unknown> = {
        status: 'resolved',
        resolutionNotified: true,
        resolutionAcked: false,
        resolvedAtMs: nowMs,
        updatedAt: serverTimestamp(),
      };
      if (cleanReply) patch.adminReply = cleanReply;
      await updateDoc(doc(db, 'supportTickets', ticketId), patch);
      applyLocal();
    },
    applyLocal,
    op: { entity: 'supportTicket', docId: ticketId },
  });
}

export async function acknowledgeResolvedTicket(ticketId: string): Promise<void> {
  const nowMs = Date.now();
  const applyLocal = () => {
    mutateLocalDb((draft) => {
      const existing = draft.supportTickets[ticketId];
      if (existing) {
        draft.supportTickets[ticketId] = {
          ...existing,
          resolutionAcked: true,
          updatedAt: nowMs,
        };
      }
    });
  };

  try {
    await executeWriteWithLocalFallback({
      tryRemote: async () => {
        await updateDoc(doc(db, 'supportTickets', ticketId), {
          resolutionAcked: true,
          updatedAt: serverTimestamp(),
        });
        applyLocal();
      },
      applyLocal,
      op: { entity: 'supportTicket', docId: ticketId },
    });
  } catch {
    applyLocal();
  }
}

// --- Pending Cloud Sync Engine ---

let syncInProgress = false;
let lastCloudSyncAtMs: number | null = null;
let lastSyncErrorMessage: string | null = null;
const syncHealthListeners = new Set<() => void>();

function notifySyncHealthListeners(): void {
  for (const listener of syncHealthListeners) {
    try {
      listener();
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function getSyncHealthState(): SyncHealthState {
  const dbState = readLocalDb();
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  return computeSyncHealthState({
    isOnline,
    isSyncing: syncInProgress,
    quotaExceeded: isFirestoreQuotaExceeded(),
    pendingCount: dbState.pendingSyncOps.length,
    failedOps: dbState.failedSyncOps ?? [],
    lastSyncAtMs: lastCloudSyncAtMs,
    lastError: lastSyncErrorMessage,
  });
}

export function subscribeSyncHealthState(onChange: (state: SyncHealthState) => void): () => void {
  const emit = () => onChange(getSyncHealthState());
  emit();
  syncHealthListeners.add(emit);
  const unsubDb = subscribeLocalDb(emit);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', emit);
    window.addEventListener('offline', emit);
  }
  return () => {
    syncHealthListeners.delete(emit);
    unsubDb();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', emit);
      window.removeEventListener('offline', emit);
    }
  };
}

export function getFailedSyncOps(): FailedSyncOp[] {
  return [...(readLocalDb().failedSyncOps ?? [])];
}

export async function retryFailedSyncOps(targetKey?: string): Promise<{
  requeued: number;
  synced: number;
  remaining: number;
  failedCount: number;
  quotaBlocked: boolean;
}> {
  let requeued = 0;
  mutateLocalDb((draft) => {
    const res = requeueFailedOpsForRetry(
      draft.failedSyncOps ?? [],
      draft.pendingSyncOps,
      targetKey
    );
    draft.pendingSyncOps = res.nextPendingOps;
    draft.failedSyncOps = res.nextFailedOps;
    requeued = res.requeuedCount;
  });
  lastSyncErrorMessage = null;
  notifySyncHealthListeners();
  const syncRes = await syncPendingLocalOpsToCloud({ force: true });
  return {
    requeued,
    ...syncRes,
    failedCount: (readLocalDb().failedSyncOps ?? []).length,
  };
}

export function dismissFailedSyncOp(key: string): void {
  mutateLocalDb((draft) => {
    draft.failedSyncOps = (draft.failedSyncOps ?? []).filter((f) => f.key !== key);
  });
  notifySyncHealthListeners();
}

export function getPendingLocalSyncCount(): number {
  return readLocalDb().pendingSyncOps.length;
}

export function subscribePendingLocalSyncCount(onChange: (count: number) => void): () => void {
  onChange(getPendingLocalSyncCount());
  return subscribeLocalDb(() => {
    onChange(getPendingLocalSyncCount());
  });
}

export async function syncPendingLocalOpsToCloud(options?: { force?: boolean }): Promise<{
  synced: number;
  remaining: number;
  quotaBlocked: boolean;
  failedCount: number;
}> {
  if (syncInProgress) {
    return {
      synced: 0,
      remaining: readLocalDb().pendingSyncOps.length,
      quotaBlocked: isFirestoreQuotaExceeded(),
      failedCount: (readLocalDb().failedSyncOps ?? []).length,
    };
  }
  const force = Boolean(options?.force);
  clearFirestoreQuotaExceeded();
  const initialOps = [...readLocalDb().pendingSyncOps];
  if (initialOps.length === 0) {
    lastCloudSyncAtMs = Date.now();
    notifySyncHealthListeners();
    return {
      synced: 0,
      remaining: 0,
      quotaBlocked: false,
      failedCount: (readLocalDb().failedSyncOps ?? []).length,
    };
  }

  syncInProgress = true;
  notifySyncHealthListeners();
  let synced = 0;

  try {
    for (const op of initialOps) {
      const nowMs = Date.now();
      if (!isPendingOpReadyForRetry(op, nowMs, force)) {
        continue;
      }
      const dbState = readLocalDb();
      try {
        const runSingleSyncOp = async () => {
          switch (op.entity) {
          case 'adminCredentials': {
            if (dbState.adminCredentials) {
              await setDoc(doc(db, 'settings', 'adminCredentials'), {
                adminId: dbState.adminCredentials.adminId,
                passwordHash: dbState.adminCredentials.passwordHash,
                updatedAt: serverTimestamp(),
              });
            }
            break;
          }
          case 'scoring': {
            if (dbState.scoring) {
              await setDoc(doc(db, 'settings', 'scoring'), {
                pointsPerCorrect: Number(dbState.scoring.pointsPerCorrect),
                negativeMarks: Number(dbState.scoring.negativeMarks),
                xpAttemptBase: Number(dbState.scoring.xpAttemptBase),
                xpPerCorrect: Number(dbState.scoring.xpPerCorrect),
                xpAccuracyThreshold: Number(dbState.scoring.xpAccuracyThreshold),
                xpAccuracyBonus: Number(dbState.scoring.xpAccuracyBonus),
                updatedAt: serverTimestamp(),
              });
            }
            break;
          }
          case 'platformConfig': {
            if (dbState.platformConfig) {
              await setDoc(doc(db, 'settings', 'platformConfig'), {
                ...normalizePlatformConfig(dbState.platformConfig),
                updatedAt: serverTimestamp(),
              });
            }
            break;
          }
        case 'vipInvite': {
          const inv = dbState.vipInvites[op.docId];
          if (inv) {
            await setDoc(doc(db, 'vipInvites', op.docId), {
              loginId: inv.loginId,
              displayName: inv.displayName,
              targetPost: inv.targetPost,
              slotNumber: inv.slotNumber,
              active: Boolean(inv.active),
              passwordHash: inv.passwordHash,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          break;
        }
        case 'vipInviteDelete': {
          await deleteDoc(doc(db, 'vipInvites', op.docId));
          break;
        }
        case 'student': {
          const st = dbState.students[op.docId];
          if (st) {
            await setDoc(doc(db, 'students', op.docId), {
              uid: st.uid,
              loginId: st.loginId,
              displayName: st.displayName,
              targetPost: st.targetPost,
              slotNumber: st.slotNumber,
              cohortId: st.cohortId || 'ssc_cgl_vip',
              ...(st.targetYear ? { targetYear: st.targetYear } : {}),
              ...(st.city ? { city: st.city } : {}),
              ...(st.bio ? { bio: st.bio } : {}),
              ...(st.physicalChecklist ? { physicalChecklist: st.physicalChecklist } : {}),
              ...(st.syllabusMastery ? { syllabusMastery: st.syllabusMastery } : {}),
              ...(st.avatarDataUrl ? { avatarDataUrl: st.avatarDataUrl } : {}),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          break;
        }
        case 'leaderboard': {
          const lb = dbState.leaderboard[op.docId];
          if (lb) {
            await setDoc(doc(db, 'leaderboard', op.docId), {
              uid: lb.uid,
              displayName: lb.displayName,
              targetPost: lb.targetPost,
              cohortId: lb.cohortId || 'ssc_cgl_vip',
              totalXp: lb.totalXp,
              testsAttempted: lb.testsAttempted,
              bestScore: lb.bestScore,
              avgAccuracy: lb.avgAccuracy,
              totalTimeSec: lb.totalTimeSec,
              updatedAt: serverTimestamp(),
            });
          }
          break;
        }
        case 'question': {
          const qDoc = dbState.questions[op.docId];
          if (qDoc) {
            await setDoc(
              doc(db, 'questions', op.docId),
              buildQuestionWritePayload(qDoc, qDoc.createdBy || 'local_sync', true)
            );
          }
          break;
        }
        case 'questionDelete': {
          await deleteDoc(doc(db, 'questions', op.docId));
          break;
        }
        case 'test': {
          const tDoc = dbState.tests[op.docId];
          if (tDoc) {
            await setDoc(doc(db, 'tests', op.docId), {
              title: tDoc.title,
              subjectScope: tDoc.subjectScope,
              durationMinutes: tDoc.durationMinutes,
              positiveMarks: tDoc.positiveMarks,
              negativeMarks: tDoc.negativeMarks,
              questionIds: tDoc.questionIds.slice(0, 100),
              questionCount: Math.min(100, tDoc.questionIds.length),
              published: Boolean(tDoc.published),
              ...(tDoc.examMode ? { examMode: tDoc.examMode } : {}),
              ...(tDoc.topicTag ? { topicTag: tDoc.topicTag } : {}),
              ...(tDoc.sectionOrder ? { sectionOrder: tDoc.sectionOrder.slice(0, 4) } : {}),
              ...(typeof tDoc.sectionDurationSec === 'number'
                ? { sectionDurationSec: tDoc.sectionDurationSec }
                : {}),
              createdBy: tDoc.createdBy,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          break;
        }
        case 'testDelete': {
          await deleteDoc(doc(db, 'tests', op.docId));
          break;
        }
        case 'attempt': {
          const att = dbState.attempts[op.docId];
          if (att) {
            const batch = writeBatch(db);
            batch.set(doc(db, 'attempts', op.docId), {
              uid: att.uid,
              studentName: att.studentName,
              testId: att.testId,
              testTitle: att.testTitle,
              subjectScope: att.subjectScope,
              ...(att.topicTag ? { topicTag: att.topicTag } : {}),
              score: att.score,
              maxScore: att.maxScore,
              accuracy: att.accuracy,
              correctCount: att.correctCount,
              wrongCount: att.wrongCount,
              skippedCount: att.skippedCount,
              totalTimeSec: att.totalTimeSec,
              xpEarned: att.xpEarned,
              sectionStats: att.sectionStats,
              createdAt: serverTimestamp(),
            });
            const responses = Object.values(dbState.attemptResponses[op.docId] ?? {});
            for (const r of responses) {
              batch.set(doc(db, 'attempts', op.docId, 'responses', r.questionId), {
                uid: att.uid,
                questionId: r.questionId,
                selectedIndex: r.selectedIndex,
                isCorrect: r.isCorrect,
                timeSpentSec: r.timeSpentSec,
                markedForReview: r.markedForReview,
                createdAt: serverTimestamp(),
              });
            }
            await batch.commit();
          }
          break;
        }
        case 'revisionItem': {
          const itemUid = op.uid;
          const item = itemUid ? dbState.revisionVault[itemUid]?.[op.docId] : undefined;
          if (item && itemUid) {
            await setDoc(doc(db, 'students', itemUid, 'revisionVault', op.docId), {
              uid: itemUid,
              questionId: item.questionId || op.docId,
              testId: item.testId,
              testTitle: item.testTitle,
              subject: item.subject,
              lastSelectedIndex: item.lastSelectedIndex,
              mastered: Boolean(item.mastered),
              ...(item.aiDeepNote ? { aiDeepNote: item.aiDeepNote } : {}),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          break;
        }
        case 'revisionItemDelete': {
          if (op.uid) {
            await deleteDoc(doc(db, 'students', op.uid, 'revisionVault', op.docId));
          }
          break;
        }
        case 'task': {
          const taskDoc = dbState.tasks[op.docId];
          if (taskDoc) {
            await setDoc(doc(db, 'tasks', op.docId), {
              title: taskDoc.title,
              description: taskDoc.description,
              targetTests: taskDoc.targetTests,
              targetSubject: taskDoc.targetSubject,
              bonusXp: taskDoc.bonusXp,
              dueDate: taskDoc.dueDate,
              active: Boolean(taskDoc.active),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          break;
        }
        case 'taskDelete': {
          await deleteDoc(doc(db, 'tasks', op.docId));
          break;
        }
        case 'xpLedger': {
          const ledgerDoc = dbState.xpLedger[op.docId];
          if (ledgerDoc) {
            await setDoc(doc(db, 'xpLedger', op.docId), {
              uid: ledgerDoc.uid,
              studentName: ledgerDoc.studentName,
              deltaXp: ledgerDoc.deltaXp,
              reason: ledgerDoc.reason,
              sourceType: ledgerDoc.sourceType,
              refId: ledgerDoc.refId,
              createdBy: ledgerDoc.createdBy,
              createdAt: serverTimestamp(),
            });
          }
          break;
        }
        case 'supportTicket': {
          const tkt = dbState.supportTickets[op.docId];
          if (tkt) {
            await setDoc(doc(db, 'supportTickets', op.docId), {
              uid: tkt.uid,
              loginId: tkt.loginId,
              studentName: tkt.studentName,
              targetPost: tkt.targetPost,
              subject: tkt.subject,
              message: tkt.message,
              status: tkt.status,
              resolutionNotified: Boolean(tkt.resolutionNotified),
              resolutionAcked: Boolean(tkt.resolutionAcked),
              createdAtMs: tkt.createdAtMs,
              resolvedAtMs: tkt.resolvedAtMs,
              ...(tkt.adminReply ? { adminReply: tkt.adminReply } : {}),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          break;
        }
        case 'reportedQuery': {
          const rq = dbState.reportedQueries[op.docId];
          if (rq) {
            await setDoc(doc(db, 'reportedQueries', op.docId), {
              uid: rq.uid,
              loginId: rq.loginId,
              studentName: rq.studentName,
              questionId: rq.questionId,
              sourceContext: rq.sourceContext,
              reason: rq.reason,
              ...(rq.aiExplanationSnapshot ? { aiExplanationSnapshot: rq.aiExplanationSnapshot } : {}),
              questionSnapshot: rq.questionSnapshot,
              status: rq.status,
              ...(rq.adminNotes ? { adminNotes: rq.adminNotes } : {}),
              createdAtMs: rq.createdAtMs,
              resolvedAtMs: rq.resolvedAtMs,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          break;
        }
        case 'correctedQuestionOverride': {
          const ov = dbState.correctedQuestionsBank[op.docId];
          if (ov) {
            await setDoc(doc(db, 'corrected_questions_bank', op.docId), {
              questionId: ov.questionId,
              subject: ov.subject,
              topic: ov.topic,
              difficulty: ov.difficulty,
              questionEn: ov.questionEn,
              ...(ov.questionHi ? { questionHi: ov.questionHi } : {}),
              optionsEn: ov.optionsEn,
              ...(ov.optionsHi ? { optionsHi: ov.optionsHi } : {}),
              correctIndex: ov.correctIndex,
              ...(ov.explanationEn ? { explanationEn: ov.explanationEn } : {}),
              ...(ov.explanationHi ? { explanationHi: ov.explanationHi } : {}),
              ...(ov.shortTrick ? { shortTrick: ov.shortTrick } : {}),
              updatedBy: ov.updatedBy,
              updatedAtMs: ov.updatedAtMs,
              updatedAt: serverTimestamp(),
            });
          }
          break;
        }
      }
      };

        await raceWithWriteTimeout(runSingleSyncOp(), 3000);

        mutateLocalDb((draft) => {
          draft.pendingSyncOps = draft.pendingSyncOps.filter((item) => item.key !== op.key);
        });
        synced += 1;
        lastCloudSyncAtMs = Date.now();
        lastSyncErrorMessage = null;
      } catch (err) {
        const cls = classifySyncFailure(err);
        lastSyncErrorMessage = cls.message;
        if (cls.quotaBlocked) {
          markFirestoreQuotaExceeded(err);
          return {
            synced,
            remaining: readLocalDb().pendingSyncOps.length,
            quotaBlocked: true,
            failedCount: (readLocalDb().failedSyncOps ?? []).length,
          };
        }
        if (cls.kind === 'transient') {
          const retryOutcome = recordTransientOpRetry(op, cls.message, Date.now());
          mutateLocalDb((draft) => {
            if (retryOutcome.quarantinedOp) {
              draft.pendingSyncOps = draft.pendingSyncOps.filter((item) => item.key !== op.key);
              const existingFailed = (draft.failedSyncOps ?? []).filter((f) => f.key !== op.key);
              draft.failedSyncOps = [...existingFailed, retryOutcome.quarantinedOp];
            } else if (retryOutcome.updatedOp) {
              draft.pendingSyncOps = draft.pendingSyncOps.map((item) =>
                item.key === op.key ? retryOutcome.updatedOp! : item
              );
            }
          });
          // Stop draining on offline/network loss so subsequent ops stay untouched until online
          if (cls.code.toLowerCase().includes('unavailable') || cls.message.toLowerCase().includes('offline')) {
            return {
              synced,
              remaining: readLocalDb().pendingSyncOps.length,
              quotaBlocked: false,
              failedCount: (readLocalDb().failedSyncOps ?? []).length,
            };
          }
        } else {
          // Permanent error (validation/permission/malformed): quarantine to failedSyncOps instead of silent drop
          const quarantined = toPermanentFailedOp(op, cls.code, cls.message, Date.now());
          mutateLocalDb((draft) => {
            draft.pendingSyncOps = draft.pendingSyncOps.filter((item) => item.key !== op.key);
            const existingFailed = (draft.failedSyncOps ?? []).filter((f) => f.key !== op.key);
            draft.failedSyncOps = [...existingFailed, quarantined];
          });
        }
      }
    }
  } finally {
    syncInProgress = false;
    notifySyncHealthListeners();
  }

  return {
    synced,
    remaining: readLocalDb().pendingSyncOps.length,
    quotaBlocked: false,
    failedCount: (readLocalDb().failedSyncOps ?? []).length,
  };
}

// --- Offline Pack Caching & Admin Cohort Analytics Helpers ---

export async function cacheTestForOfflineLaunch(test: MockTestDoc): Promise<OfflineMockPack> {
  const qs = await fetchQuestionsByIds(test.questionIds);
  return saveOfflineMockPack(test, qs);
}

export async function cacheAllPublishedMocksForOffline(
  tests: MockTestDoc[]
): Promise<{ cachedTests: number; totalQuestions: number }> {
  const allNeededIds = Array.from(new Set(tests.flatMap((t) => t.questionIds)));
  const resolved = await fetchQuestionsByIds(allNeededIds);
  const res = await cacheMockCatalogForOffline({ tests, questions: resolved });
  return {
    cachedTests: res.cachedPacks,
    totalQuestions: res.cachedQuestions,
  };
}

export async function fetchAllStudentsRevisionVaultsAdmin(
  uids: string[]
): Promise<Record<string, RevisionItemDoc[]>> {
  const localDb = readLocalDb();
  const out: Record<string, RevisionItemDoc[]> = {};

  for (const uid of uids) {
    const prefix = `${uid}::`;
    const deletedQIds = localDb.deletedIds.revisionVault
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
    let remoteItems: RevisionItemDoc[] = [];

    if (!isFirestoreQuotaExceeded()) {
      try {
        const snap = await getDocs(
          query(collection(db, 'students', uid, 'revisionVault'), where('uid', '==', uid))
        );
        remoteItems = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<RevisionItemDoc, 'id'>),
        }));
      } catch {
        // Fall back cleanly to local vault snapshot
      }
    }

    out[uid] = mergeByIdWithTombstones({
      remoteItems,
      localItems: Object.values(localDb.revisionVault[uid] ?? {}),
      deletedIds: deletedQIds,
      getId: (item) => item.questionId || item.id,
    });
  }

  return out;
}

export async function createCustomMockFromBlueprintPaper(params: {
  uid: string;
  title: string;
  subjectScope: 'full' | SubjectKey;
  durationMinutes: number;
  positiveMarks: number;
  negativeMarks: number;
  questionIds: string[];
  published: boolean;
}): Promise<MockTestDoc> {
  const id = await createMockTest({
    title: params.title.trim().slice(0, 120) || 'Blueprint Custom Mock',
    subjectScope: params.subjectScope,
    durationMinutes: Math.max(1, Math.min(240, Math.round(params.durationMinutes))),
    positiveMarks: Number(params.positiveMarks),
    negativeMarks: Number(params.negativeMarks),
    questionIds: params.questionIds.slice(0, 100),
    published: params.published,
    createdBy: params.uid,
  });

  const created = await fetchMockTestById(id);
  if (created) {
    return created;
  }
  return {
    id,
    title: params.title.trim().slice(0, 120),
    subjectScope: params.subjectScope,
    durationMinutes: Math.max(1, Math.min(240, Math.round(params.durationMinutes))),
    positiveMarks: Number(params.positiveMarks),
    negativeMarks: Number(params.negativeMarks),
    questionIds: params.questionIds.slice(0, 100),
    questionCount: Math.min(100, params.questionIds.length),
    published: params.published,
    createdBy: params.uid,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// --- Reported Queries, Question Overrides & Pop-up Reward XP ---

export function subscribeCorrectedQuestionsBank(
  onChange: (overrides: Record<string, CorrectedQuestionOverrideDoc>) => void
): Unsubscribe {
  let latestRemote: Record<string, CorrectedQuestionOverrideDoc> = {};

  const emit = () => {
    const localDb = readLocalDb();
    onChange({
      ...latestRemote,
      ...localDb.correctedQuestionsBank,
    });
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = query(
    collection(db, 'corrected_questions_bank'),
    where('subject', 'in', ['quant', 'reasoning', 'english', 'ga'])
  );
  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      const next: Record<string, CorrectedQuestionOverrideDoc> = {};
      for (const d of snap.docs) {
        const data = d.data() as CorrectedQuestionOverrideDoc;
        next[d.id] = { ...data, id: d.id, questionId: data.questionId || d.id };
      }
      latestRemote = next;
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, 'corrected_questions_bank');
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

export async function submitReportedQuery(params: {
  uid: string;
  loginId: string;
  studentName: string;
  question: QuestionDoc;
  sourceContext: string;
  reason: string;
  aiExplanationSnapshot?: string;
}): Promise<ReportedQueryDoc> {
  const cleanReason = params.reason.trim().slice(0, 1000);
  if (!cleanReason) {
    throw new DomainValidationError('Please describe the issue with this question or explanation.');
  }
  const id = makeId('rq');
  const nowMs = Date.now();
  const snap: ReportedQueryDoc['questionSnapshot'] = {
    subject: params.question.subject,
    topic: (params.question.topic || 'General').slice(0, 80),
    difficulty: params.question.difficulty || 'medium',
    questionEn: (params.question.questionEn || '').slice(0, 2000),
    ...(params.question.questionHi ? { questionHi: params.question.questionHi.slice(0, 2000) } : {}),
    optionsEn: [
      (params.question.optionsEn[0] ?? '').slice(0, 500),
      (params.question.optionsEn[1] ?? '').slice(0, 500),
      (params.question.optionsEn[2] ?? '').slice(0, 500),
      (params.question.optionsEn[3] ?? '').slice(0, 500),
    ],
    ...(params.question.optionsHi && params.question.optionsHi.length === 4
      ? {
          optionsHi: [
            (params.question.optionsHi[0] ?? '').slice(0, 500),
            (params.question.optionsHi[1] ?? '').slice(0, 500),
            (params.question.optionsHi[2] ?? '').slice(0, 500),
            (params.question.optionsHi[3] ?? '').slice(0, 500),
          ] as [string, string, string, string],
        }
      : {}),
    correctIndex: params.question.correctIndex,
    ...(params.question.explanationEn
      ? { explanationEn: params.question.explanationEn.slice(0, 3000) }
      : {}),
    ...(params.question.explanationHi
      ? { explanationHi: params.question.explanationHi.slice(0, 3000) }
      : {}),
    ...(params.question.shortTrick
      ? { shortTrick: params.question.shortTrick.slice(0, 1500) }
      : {}),
  };

  const docData: ReportedQueryDoc = {
    id,
    uid: params.uid,
    loginId: (params.loginId || params.uid).slice(0, 120),
    studentName: (params.studentName || 'Aspirant').slice(0, 80),
    questionId: params.question.id,
    sourceContext: (params.sourceContext || 'Review').slice(0, 160),
    reason: cleanReason,
    ...(params.aiExplanationSnapshot
      ? { aiExplanationSnapshot: params.aiExplanationSnapshot.slice(0, 6000) }
      : {}),
    questionSnapshot: snap,
    status: 'open',
    createdAtMs: nowMs,
    resolvedAtMs: 0,
    createdAt: nowMs,
    updatedAt: nowMs,
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.reportedQueries[id] = docData;
    });
    return docData;
  };

  return executeWriteWithLocalFallback({
    tryRemote: async () => {
      await setDoc(doc(db, 'reportedQueries', id), {
        uid: docData.uid,
        loginId: docData.loginId,
        studentName: docData.studentName,
        questionId: docData.questionId,
        sourceContext: docData.sourceContext,
        reason: docData.reason,
        ...(docData.aiExplanationSnapshot
          ? { aiExplanationSnapshot: docData.aiExplanationSnapshot }
          : {}),
        questionSnapshot: docData.questionSnapshot,
        status: 'open',
        createdAtMs: docData.createdAtMs,
        resolvedAtMs: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return applyLocal();
    },
    applyLocal,
    op: { entity: 'reportedQuery', docId: id },
  });
}

export function subscribeReportedQueries(
  onChange: (reports: ReportedQueryDoc[]) => void
): Unsubscribe {
  const path = 'reportedQueries';
  let latestRemote: ReportedQueryDoc[] = [];

  const emit = () => {
    const localDb = readLocalDb();
    const merged = mergeByIdWithTombstones({
      remoteItems: latestRemote,
      localItems: Object.values(localDb.reportedQueries),
      getId: (r) => r.id,
    }).sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      return (b.createdAtMs || 0) - (a.createdAtMs || 0);
    });
    onChange(merged);
  };

  emit();
  const unsubLocal = subscribeLocalDb(emit);
  const q = query(collection(db, 'reportedQueries'), where('status', 'in', ['open', 'resolved']));
  const unsubRemote = onSnapshot(
    q,
    (snap) => {
      latestRemote = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ReportedQueryDoc, 'id'>),
      }));
      emit();
    },
    (err) => {
      handleSubscriptionError(err, OperationType.LIST, path);
      emit();
    }
  );

  return () => {
    unsubRemote();
    unsubLocal();
  };
}

export async function resolveReportedQueryWithOverride(params: {
  reportId?: string;
  questionId: string;
  updatedBy: string;
  override: {
    subject: SubjectKey;
    topic: string;
    difficulty: DifficultyLevel;
    questionEn: string;
    questionHi?: string;
    optionsEn: [string, string, string, string];
    optionsHi?: [string, string, string, string];
    correctIndex: 0 | 1 | 2 | 3;
    explanationEn?: string;
    explanationHi?: string;
    shortTrick?: string;
  };
  adminNotes?: string;
}): Promise<void> {
  const qId = params.questionId.trim();
  if (!qId) {
    throw new DomainValidationError('Missing question ID for override.');
  }
  const cleanQEn = params.override.questionEn.trim().slice(0, 2000);
  if (!cleanQEn) {
    throw new DomainValidationError('Question text (English) cannot be empty.');
  }
  const cleanOptsEn = params.override.optionsEn.map((o) => o.trim().slice(0, 500)) as [
    string,
    string,
    string,
    string,
  ];
  if (cleanOptsEn.some((o) => !o)) {
    throw new DomainValidationError('All 4 English options are required.');
  }

  const nowMs = Date.now();
  const cleanNotes = (params.adminNotes ?? '').trim().slice(0, 1000);
  const cleanQHi = params.override.questionHi?.trim().slice(0, 2000) || undefined;
  const cleanOptsHi =
    params.override.optionsHi && params.override.optionsHi.every((o) => o.trim().length > 0)
      ? (params.override.optionsHi.map((o) => o.trim().slice(0, 500)) as [
          string,
          string,
          string,
          string,
        ])
      : undefined;
  const cleanExpEn = params.override.explanationEn?.trim().slice(0, 3000) || undefined;
  const cleanExpHi = params.override.explanationHi?.trim().slice(0, 3000) || undefined;
  const cleanTrick = params.override.shortTrick?.trim().slice(0, 1500) || undefined;

  const overrideDoc: CorrectedQuestionOverrideDoc = {
    id: qId,
    questionId: qId,
    subject: params.override.subject,
    topic: params.override.topic.trim().slice(0, 80) || 'General',
    difficulty: params.override.difficulty,
    questionEn: cleanQEn,
    ...(cleanQHi ? { questionHi: cleanQHi } : {}),
    optionsEn: cleanOptsEn,
    ...(cleanOptsHi ? { optionsHi: cleanOptsHi } : {}),
    correctIndex: params.override.correctIndex,
    ...(cleanExpEn ? { explanationEn: cleanExpEn } : {}),
    ...(cleanExpHi ? { explanationHi: cleanExpHi } : {}),
    ...(cleanTrick ? { shortTrick: cleanTrick } : {}),
    updatedBy: (params.updatedBy || 'admin').slice(0, 128),
    updatedAtMs: nowMs,
    updatedAt: nowMs,
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.correctedQuestionsBank[qId] = overrideDoc;
      if (draft.questions[qId]) {
        draft.questions[qId] = {
          ...draft.questions[qId],
          subject: overrideDoc.subject,
          topic: overrideDoc.topic,
          difficulty: overrideDoc.difficulty,
          questionEn: overrideDoc.questionEn,
          ...(cleanQHi !== undefined ? { questionHi: cleanQHi } : {}),
          optionsEn: overrideDoc.optionsEn,
          ...(cleanOptsHi !== undefined ? { optionsHi: cleanOptsHi } : {}),
          correctIndex: overrideDoc.correctIndex,
          ...(cleanExpEn !== undefined ? { explanationEn: cleanExpEn } : {}),
          ...(cleanExpHi !== undefined ? { explanationHi: cleanExpHi } : {}),
          ...(cleanTrick !== undefined ? { shortTrick: cleanTrick } : {}),
          updatedAt: nowMs,
        };
      }
      for (const [rId, rep] of Object.entries(draft.reportedQueries)) {
        if (rId === params.reportId || (rep.questionId === qId && rep.status === 'open')) {
          draft.reportedQueries[rId] = {
            ...rep,
            status: 'resolved',
            resolvedAtMs: nowMs,
            updatedAt: nowMs,
            ...(cleanNotes ? { adminNotes: cleanNotes } : {}),
          };
        }
      }
    });
  };

  await executeWriteWithLocalFallback({
    tryRemote: async () => {
      await setDoc(doc(db, 'corrected_questions_bank', qId), {
        questionId: overrideDoc.questionId,
        subject: overrideDoc.subject,
        topic: overrideDoc.topic,
        difficulty: overrideDoc.difficulty,
        questionEn: overrideDoc.questionEn,
        ...(cleanQHi ? { questionHi: cleanQHi } : {}),
        optionsEn: overrideDoc.optionsEn,
        ...(cleanOptsHi ? { optionsHi: cleanOptsHi } : {}),
        correctIndex: overrideDoc.correctIndex,
        ...(cleanExpEn ? { explanationEn: cleanExpEn } : {}),
        ...(cleanExpHi ? { explanationHi: cleanExpHi } : {}),
        ...(cleanTrick ? { shortTrick: cleanTrick } : {}),
        updatedBy: overrideDoc.updatedBy,
        updatedAtMs: overrideDoc.updatedAtMs,
        updatedAt: serverTimestamp(),
      });

      const qRef = doc(db, 'questions', qId);
      const qSnap = await getDoc(qRef).catch(() => null);
      if (qSnap && qSnap.exists()) {
        await updateDoc(qRef, {
          subject: overrideDoc.subject,
          topic: overrideDoc.topic,
          difficulty: overrideDoc.difficulty,
          questionEn: overrideDoc.questionEn,
          ...(cleanQHi ? { questionHi: cleanQHi } : {}),
          optionsEn: overrideDoc.optionsEn,
          ...(cleanOptsHi ? { optionsHi: cleanOptsHi } : {}),
          correctIndex: overrideDoc.correctIndex,
          ...(cleanExpEn ? { explanationEn: cleanExpEn } : {}),
          ...(cleanExpHi ? { explanationHi: cleanExpHi } : {}),
          ...(cleanTrick ? { shortTrick: cleanTrick } : {}),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      const matchingReports = Object.values(readLocalDb().reportedQueries).filter(
        (rep) => rep.id === params.reportId || (rep.questionId === qId && rep.status === 'open')
      );
      for (const rep of matchingReports) {
        await updateDoc(doc(db, 'reportedQueries', rep.id), {
          status: 'resolved',
          resolvedAtMs: nowMs,
          ...(cleanNotes ? { adminNotes: cleanNotes } : {}),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      applyLocal();
    },
    applyLocal,
    op: { entity: 'correctedQuestionOverride', docId: qId },
  });
}

export async function creditPopupQuizRewardXp(params: {
  uid: string;
  studentName: string;
  targetPost: string;
  correctCount: number;
  totalCount: number;
  bonusXp: number;
  currentLeaderboard?: LeaderboardEntry;
}): Promise<number> {
  const { uid, studentName, targetPost, correctCount, totalCount, bonusXp, currentLeaderboard } =
    params;
  if (!uid || !isRealCohortStudentUid(uid)) return 0;
  const clampedXp = Math.max(0, Math.min(500, Math.round(bonusXp)));
  if (clampedXp <= 0) return 0;

  const entryId = makeId(`xp_quiz_${uid}`).slice(0, 128);
  const nowMs = Date.now();
  const ledgerDoc: XpLedgerEntryDoc = {
    id: entryId,
    uid,
    studentName: studentName.slice(0, 80) || 'Aspirant',
    deltaXp: clampedXp,
    reason: `Session Boost Quiz: ${correctCount}/${totalCount} correct (+${clampedXp} XP)`.slice(
      0,
      200
    ),
    sourceType: 'quiz_reward',
    refId: entryId,
    createdBy: uid,
    createdAt: nowMs,
  };

  const applyLocal = () => {
    mutateLocalDb((draft) => {
      draft.xpLedger[entryId] = ledgerDoc;
      const baseLb = draft.leaderboard[uid] ?? currentLeaderboard;
      draft.leaderboard[uid] = {
        uid,
        displayName: studentName.slice(0, 80) || baseLb?.displayName || 'Aspirant',
        targetPost: targetPost.slice(0, 80) || baseLb?.targetPost || 'ASO in MEA',
        cohortId: 'ssc_cgl_vip',
        totalXp: Math.min(1000000, (baseLb?.totalXp ?? 0) + clampedXp),
        testsAttempted: baseLb?.testsAttempted ?? 0,
        bestScore: baseLb?.bestScore ?? 0,
        avgAccuracy: baseLb?.avgAccuracy ?? 0,
        totalTimeSec: baseLb?.totalTimeSec ?? 0,
        updatedAt: nowMs,
      };
    });
    return clampedXp;
  };

  return executeWriteWithLocalFallback({
    tryRemote: async () => {
      const baseLb = readLocalDb().leaderboard[uid] ?? currentLeaderboard;
      const batch = writeBatch(db);
      batch.set(doc(db, 'xpLedger', entryId), {
        uid: ledgerDoc.uid,
        studentName: ledgerDoc.studentName,
        deltaXp: ledgerDoc.deltaXp,
        reason: ledgerDoc.reason,
        sourceType: 'quiz_reward',
        refId: ledgerDoc.refId,
        createdBy: ledgerDoc.createdBy,
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, 'leaderboard', uid), {
        uid,
        displayName: studentName.slice(0, 80) || baseLb?.displayName || 'Aspirant',
        targetPost: targetPost.slice(0, 80) || baseLb?.targetPost || 'ASO in MEA',
        cohortId: 'ssc_cgl_vip',
        totalXp: Math.min(1000000, (baseLb?.totalXp ?? 0) + clampedXp),
        testsAttempted: baseLb?.testsAttempted ?? 0,
        bestScore: baseLb?.bestScore ?? 0,
        avgAccuracy: baseLb?.avgAccuracy ?? 0,
        totalTimeSec: baseLb?.totalTimeSec ?? 0,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return applyLocal();
    },
    applyLocal,
    op: { entity: 'xpLedger', docId: entryId },
  });
}
