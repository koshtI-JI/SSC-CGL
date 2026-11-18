import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { AuthGateway } from './components/AuthGateway';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PwaUpdateBanner } from './components/PwaUpdateBanner';
import { ConfigProvider, useConfig } from './context/ConfigContext';
import { LiveDataProvider, useLiveData } from './context/LiveDataContext';
import { useStudentActivityTracker } from './hooks/useStudentActivityTracker';
import {
  getCameraConsentGranted,
  useStudentProctorPublisher,
} from './hooks/useStudentProctorPublisher';
import { bootstrapLocalDbFromIndexedDb } from './utils/localFallbackStore';

const AdminControlCenter = lazy(() =>
  import('./components/AdminControlCenter').then((m) => ({ default: m.AdminControlCenter }))
);
const AiKeySettingsModal = lazy(() =>
  import('./components/AiKeySettingsModal').then((m) => ({ default: m.AiKeySettingsModal }))
);
const CameraRulesModal = lazy(() =>
  import('./components/CameraRulesModal').then((m) => ({ default: m.CameraRulesModal }))
);
const DestComputerSimulator = lazy(() =>
  import('./components/DestComputerSimulator').then((m) => ({ default: m.DestComputerSimulator }))
);
const FloatingSupportChatWidget = lazy(() =>
  import('./components/FloatingSupportChatWidget').then((m) => ({
    default: m.FloatingSupportChatWidget,
  }))
);
const RulesGuideModal = lazy(() =>
  import('./components/RulesGuideModal').then((m) => ({ default: m.RulesGuideModal }))
);
const StudentDashboard = lazy(() =>
  import('./components/StudentDashboard').then((m) => ({ default: m.StudentDashboard }))
);
const TcsIonTestEngine = lazy(() =>
  import('./components/TcsIonTestEngine').then((m) => ({ default: m.TcsIonTestEngine }))
);
import { ADMIN_PREVIEW_UID } from './lib/firebase';
import {
  acknowledgeResolvedTicket,
  ensureAdminStudentPreviewProfile,
  ensureDailyAutomationSuite,
  restoreAdminSession,
  restoreStudentSession,
  saveProgressBackup,
  syncPendingLocalOpsToCloud,
  updateStudentGamificationState,
  upsertStudentPresence,
} from './lib/firestoreService';
import type {
  MockTestDoc,
  ProgressBackupDoc,
  StudentProfile,
} from './types/exam';
import {
  buildNavigationUrl,
  isDestRoutePath,
  isOmRoutePath,
  resolveAppRoute,
  type AppRoutePath,
} from './utils/appRoutes';
import { normalizeTopicSlug, resolveSyllabusChapter } from './utils/dreamPostCatalog';
import {
  computeStudentActivitySummary,
  getLocalDateKey,
  getPendingResolutionNotifications,
  TICKET_RESOLVED_PUSH_MESSAGE,
} from './utils/examEngine';
import {
  isFirestoreQuotaExceeded,
  shouldSyncProgressBackupRemote,
  subscribeFirestoreQuotaExceeded,
  type ProgressBackupSyncGateState,
} from './utils/firestoreQuota';
import {
  OFFLINE_AUTO_LOGOUT_MS,
  shouldTriggerOfflineAutoLogout,
} from './utils/sessionAndOverrides';

type SessionPhase = 'loading' | 'signed_out' | 'admin_ready' | 'student_ready';

const SESSION_STORAGE_KEY = 'getcgl_session_v1';
const LEGACY_SESSION_STORAGE_KEY = 'sankalp_cgl_session_v1';

interface StoredSession {
  role: 'admin' | 'student';
  adminId?: string;
  uid?: string;
}

function readCurrentRoute(): AppRoutePath {
  return resolveAppRoute({
    pathname: window.location.pathname,
    hash: window.location.hash,
    search: window.location.search,
    baseUrl: import.meta.env.BASE_URL || '/',
  });
}

export default function App() {
  return (
    <ConfigProvider>
      <AppSessionHost />
    </ConfigProvider>
  );
}

function AppSessionHost() {
  const [phase, setPhase] = useState<SessionPhase>('loading');
  const [routePath, setRoutePath] = useState<AppRoutePath>(() => readCurrentRoute());
  const [adminId, setAdminId] = useState<string>('');
  const [studentProfile, setStudentProfile] = useState<StudentProfile | null>(null);
  const [adminPreviewStudent, setAdminPreviewStudent] = useState<StudentProfile | null>(null);

  useEffect(() => {
    void bootstrapLocalDbFromIndexedDb();
  }, []);

  const navigateToRoute = useCallback((targetPath: AppRoutePath) => {
    const nextUrl = buildNavigationUrl(targetPath, import.meta.env.BASE_URL || '/');
    try {
      window.history.pushState({}, '', nextUrl);
    } catch {
      try {
        window.location.hash = `#${targetPath}`;
      } catch {
        // Ignore navigation errors
      }
    }
    setRoutePath(targetPath);
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      setRoutePath(readCurrentRoute());
    };
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function restore() {
      try {
        localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
        localStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // Ignore storage errors
      }

      try {
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) {
          if (mounted) setPhase('signed_out');
          return;
        }
        const parsed = JSON.parse(raw) as StoredSession;
        const currentIsOm = isOmRoutePath(readCurrentRoute());
        if (parsed.role === 'admin' && parsed.adminId && currentIsOm) {
          const ok = await restoreAdminSession(parsed.adminId);
          if (mounted && ok) {
            setAdminId(parsed.adminId);
            setPhase('admin_ready');
            return;
          }
        } else if (parsed.role === 'student' && parsed.uid && !currentIsOm) {
          const res = await restoreStudentSession(parsed.uid);
          if (mounted && res.ok && res.student) {
            setStudentProfile(res.student);
            setPhase('student_ready');
            return;
          }
        }
      } catch {
        // Ignore corrupted session
      }
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // Ignore
      }
      if (mounted) setPhase('signed_out');
    }
    void restore();
    return () => {
      mounted = false;
    };
  }, []);

  const activeUid =
    phase === 'admin_ready'
      ? ADMIN_PREVIEW_UID
      : phase === 'student_ready' && studentProfile
        ? studentProfile.uid
        : null;

  return (
    <LiveDataProvider
      activeUid={activeUid}
      isAdmin={phase === 'admin_ready'}
      isAdminPreview={Boolean(adminPreviewStudent)}
      isSignedIn={phase === 'admin_ready' || phase === 'student_ready'}
    >
      <AppWorkspace
        phase={phase}
        setPhase={setPhase}
        routePath={routePath}
        navigateToRoute={navigateToRoute}
        adminId={adminId}
        setAdminId={setAdminId}
        studentProfile={studentProfile}
        setStudentProfile={setStudentProfile}
        adminPreviewStudent={adminPreviewStudent}
        setAdminPreviewStudent={setAdminPreviewStudent}
      />
    </LiveDataProvider>
  );
}

function AppWorkspace(props: {
  phase: SessionPhase;
  setPhase: React.Dispatch<React.SetStateAction<SessionPhase>>;
  routePath: AppRoutePath;
  navigateToRoute: (targetPath: AppRoutePath) => void;
  adminId: string;
  setAdminId: React.Dispatch<React.SetStateAction<string>>;
  studentProfile: StudentProfile | null;
  setStudentProfile: React.Dispatch<React.SetStateAction<StudentProfile | null>>;
  adminPreviewStudent: StudentProfile | null;
  setAdminPreviewStudent: React.Dispatch<React.SetStateAction<StudentProfile | null>>;
}) {
  const {
    phase,
    setPhase,
    routePath,
    navigateToRoute,
    adminId,
    setAdminId,
    studentProfile,
    setStudentProfile,
    adminPreviewStudent,
    setAdminPreviewStudent,
  } = props;

  const { scoringConfig, platformConfig } = useConfig();
  const {
    invites,
    invitesLoaded,
    students,
    leaderboard,
    questions,
    tests,
    attempts,
    tasks,
    revisionItems,
    xpLedger,
    presences,
    sessionLogs,
    testDrafts,
    supportTickets,
    reportedQueries,
    syncHealth,
    failedOps,
    retrySyncNow,
    retryFailedNow,
    dismissFailedOpByKey,
    resetSessionCollections,
  } = useLiveData();

  const [backupDoc, setBackupDoc] = useState<ProgressBackupDoc | null>(null);
  const [activeExamTest, setActiveExamTest] = useState<MockTestDoc | null>(null);
  const [activeIncompleteAttemptId, setActiveIncompleteAttemptId] = useState<string | null>(null);
  const [activeExamQuestionIdx, setActiveExamQuestionIdx] = useState(0);
  const [dailySyncing, setDailySyncing] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [pendingCameraGate, setPendingCameraGate] = useState<{
    test: MockTestDoc;
    attemptId?: string | null;
  } | null>(null);
  const [cameraGateBusy, setCameraGateBusy] = useState(false);
  const [cameraGateError, setCameraGateError] = useState<string | null>(null);
  const [examCameraNotice, setExamCameraNotice] = useState<string | null>(null);
  const dailyCheckedRef = useRef<string>('');
  const backupGateRef = useRef<ProgressBackupSyncGateState | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(() => isFirestoreQuotaExceeded());
  const [quotaBannerDismissed, setQuotaBannerDismissed] = useState(false);
  const [syncRetryBusy, setSyncRetryBusy] = useState(false);
  const [syncRetryMsg, setSyncRetryMsg] = useState<string | null>(null);
  const flushExamDraftRef = useRef<(() => void) | null>(null);
  const offlineSinceRef = useRef<number | null>(
    typeof navigator !== 'undefined' && navigator.onLine === false ? Date.now() : null
  );

  useEffect(() => {
    return subscribeFirestoreQuotaExceeded((exceeded) => {
      setQuotaExceeded(exceeded);
      if (exceeded) setQuotaBannerDismissed(false);
    });
  }, []);

  const isOmRoute = isOmRoutePath(routePath);
  const isDestRoute = isDestRoutePath(routePath);

  const activeProctorStudent =
    phase === 'student_ready'
      ? studentProfile
      : phase === 'admin_ready'
        ? adminPreviewStudent
        : null;

  const proctor = useStudentProctorPublisher({
    student: activeProctorStudent,
    status: activeExamTest ? 'in_exam' : 'online',
    currentTestId: activeExamTest?.id,
    currentTestTitle: activeExamTest?.title,
    questionIndex: activeExamQuestionIdx,
    totalQuestions: activeExamTest?.questionCount ?? 0,
  });

  const activityTracker = useStudentActivityTracker({
    student: activeProctorStudent,
  });

  const liveSessionOverride = useMemo(
    () => ({
      sessionId: activityTracker.liveSessionId,
      activeDurationSec: activityTracker.liveActiveSec,
    }),
    [activityTracker.liveSessionId, activityTracker.liveActiveSec]
  );

  const activeStudentSummary = useMemo(() => {
    if (!activeProctorStudent) return null;
    return computeStudentActivitySummary(
      activeProctorStudent.uid,
      attempts,
      sessionLogs,
      Date.now(),
      liveSessionOverride
    );
  }, [activeProctorStudent, attempts, sessionLogs, liveSessionOverride]);

  // Zero-Effort Daily Live Mock: automatically create today's fresh bilingual mock once per calendar day
  useEffect(() => {
    if (phase !== 'admin_ready' && phase !== 'student_ready') return;
    if (!platformConfig.dailyAutoMockEnabled) return;
    const todayKey = getLocalDateKey();
    if (dailyCheckedRef.current === todayKey) return;
    dailyCheckedRef.current = todayKey;

    const recentQIds = Array.from(
      new Set(
        attempts.slice(0, 12).flatMap((att) => {
          const matched = tests.find((t) => t.id === att.testId);
          return matched?.questionIds ?? [];
        })
      )
    );

    let alive = true;
    setDailySyncing(true);
    ensureDailyAutomationSuite({
      scoringConfig,
      revisionItems,
      recentQuestionIds: recentQIds,
      forceDateKey: todayKey,
    })
      .catch(() => {})
      .finally(() => {
        if (alive) setDailySyncing(false);
      });

    return () => {
      alive = false;
    };
  }, [phase, scoringConfig, platformConfig.dailyAutoMockEnabled, revisionItems, attempts, tests]);

  // Permanent non-deletable Progress Backup sync for signed-in student
  useEffect(() => {
    if (phase !== 'student_ready' || !studentProfile) return;
    const myLb = leaderboard.find((l) => l.uid === studentProfile.uid) ?? null;
    const totalStudySec = activeStudentSummary?.totalStudySec ?? 0;
    const gate = shouldSyncProgressBackupRemote(
      backupGateRef.current,
      {
        uid: studentProfile.uid,
        attemptCount: attempts.length,
        totalXp: myLb?.totalXp ?? 0,
        testsAttempted: myLb?.testsAttempted ?? 0,
        bestScore: myLb?.bestScore ?? 0,
        displayName: studentProfile.displayName,
        targetPost: studentProfile.targetPost,
        totalStudySec,
      },
      Date.now()
    );
    if (!gate.shouldSync) return;
    backupGateRef.current = gate.nextState;

    let cancelled = false;
    saveProgressBackup({
      student: studentProfile,
      leaderboardEntry: myLb,
      attempts,
      totalStudySec,
    })
      .then((docPayload) => {
        if (!cancelled) setBackupDoc(docPayload);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase, studentProfile, attempts, leaderboard, activeStudentSummary?.totalStudySec]);

  const handleStudentLogin = (student: StudentProfile) => {
    try {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ role: 'student', uid: student.uid } satisfies StoredSession)
      );
    } catch {
      // Ignore storage errors
    }
    setStudentProfile(student);
    setActiveExamTest(null);
    setActiveIncompleteAttemptId(null);
    setAdminPreviewStudent(null);
    if (isOmRoute) navigateToRoute('/');
    setPhase('student_ready');
  };

  const handleAdminLogin = (loggedAdminId: string) => {
    try {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ role: 'admin', adminId: loggedAdminId } satisfies StoredSession)
      );
    } catch {
      // Ignore storage errors
    }
    setAdminId(loggedAdminId);
    setStudentProfile(null);
    setActiveExamTest(null);
    setActiveIncompleteAttemptId(null);
    setAdminPreviewStudent(null);
    setPhase('admin_ready');
  };

  const markProctorOffline = useCallback((target: StudentProfile | null) => {
    if (!target) return;
    void upsertStudentPresence({
      uid: target.uid,
      displayName: target.displayName,
      loginId: target.loginId,
      status: 'offline',
      cameraState: 'off',
      questionIndex: 0,
      totalQuestions: 0,
      tabSwitchCount: 0,
      lastSeenMs: Date.now(),
    }).catch(() => {});
  }, []);

  const clearActiveExamCache = useCallback((uid?: string) => {
    if (!uid) return;
    try {
      localStorage.removeItem(`sankalp_active_exam_v1_${uid}`);
      localStorage.removeItem(`getcgl_active_exam_v1_${uid}`);
    } catch {
      // Ignore
    }
  }, []);

  const handleSignOut = useCallback(() => {
    flushExamDraftRef.current?.();
    markProctorOffline(activeProctorStudent);
    clearActiveExamCache(activeProctorStudent?.uid);
    activityTracker.endSessionNow();
    proctor.disableCamera();
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore
    }
    setAdminId('');
    setStudentProfile(null);
    setActiveExamTest(null);
    setActiveIncompleteAttemptId(null);
    setActiveExamQuestionIdx(0);
    setAdminPreviewStudent(null);
    setPendingCameraGate(null);
    setBackupDoc(null);
    backupGateRef.current = null;
    resetSessionCollections();
    setPhase('signed_out');
  }, [
    activeProctorStudent,
    activityTracker,
    clearActiveExamCache,
    markProctorOffline,
    proctor,
    resetSessionCollections,
    setAdminId,
    setAdminPreviewStudent,
    setPhase,
    setStudentProfile,
  ]);

  const handleTopicMasteryEvaluated = useCallback(
    async (targetProfile: StudentProfile, topicTag: string, scorePercent: number, isAdminPreview: boolean) => {
      const matched = resolveSyllabusChapter(topicTag);
      const slug = matched?.slug ?? normalizeTopicSlug(topicTag);
      const title = matched?.title ?? topicTag.slice(0, 60);
      const subject = matched?.subject ?? 'quant';
      const prevEntry = targetProfile.syllabusMastery?.[slug];
      const nextMastery = {
        ...(targetProfile.syllabusMastery ?? {}),
        [slug]: {
          topic: prevEntry?.topic || title,
          subject,
          bestAccuracy: Math.max(prevEntry?.bestAccuracy ?? 0, scorePercent),
          attempts: (prevEntry?.attempts ?? 0) + 1,
          mastered: Boolean(prevEntry?.mastered) || scorePercent > 80,
          updatedAtMs: Date.now(),
        },
      };
      const optimisticProfile: StudentProfile = {
        ...targetProfile,
        syllabusMastery: nextMastery,
      };
      if (isAdminPreview) {
        setAdminPreviewStudent(optimisticProfile);
      } else {
        setStudentProfile(optimisticProfile);
      }
      try {
        const updated = await updateStudentGamificationState(targetProfile.uid, {
          syllabusMastery: nextMastery,
        });
        if (isAdminPreview) {
          setAdminPreviewStudent(updated);
        } else {
          setStudentProfile(updated);
        }
      } catch {
        // Optimistic update already reflected
      }
    },
    [setAdminPreviewStudent, setStudentProfile]
  );

  const startApprovedTest = useCallback(
    (test: MockTestDoc, attemptId?: string | null) => {
      if (test.subjectScope === 'full') {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
      activityTracker.setActivityContext(
        attemptId ? `Resuming Mock Test: ${test.title}` : `Mock Test: ${test.title}`,
        test.subjectScope === 'full' ? ['quant', 'reasoning', 'english', 'ga'] : [test.subjectScope]
      );
      setActiveIncompleteAttemptId(attemptId ?? null);
      setActiveExamQuestionIdx(0);
      setActiveExamTest(test);
    },
    [activityTracker]
  );

  const launchTestWithCameraGate = useCallback(
    async (test: MockTestDoc, attemptId?: string | null) => {
      const uidForGate = activeProctorStudent?.uid;
      if (!uidForGate) {
        startApprovedTest(test, attemptId);
        return;
      }
      const alreadyConsented = getCameraConsentGranted(uidForGate);
      if (alreadyConsented && proctor.localStream?.active) {
        startApprovedTest(test, attemptId);
        return;
      }
      if (alreadyConsented && navigator.permissions?.query) {
        try {
          const ps = await navigator.permissions.query({ name: 'camera' as PermissionName });
          if (ps.state === 'granted') {
            const ok = await proctor.enableCamera();
            if (ok) {
              startApprovedTest(test, attemptId);
              return;
            }
          }
        } catch {
          // Fall through to show Rules & Camera Consent modal
        }
      }
      setCameraGateError(null);
      setPendingCameraGate({ test, attemptId });
    },
    [activeProctorStudent?.uid, proctor, startApprovedTest]
  );

  const handleGrantCameraAndStart = async (strictCameraRequired: boolean) => {
    if (!pendingCameraGate || cameraGateBusy) return;
    setCameraGateBusy(true);
    setCameraGateError(null);
    try {
      const ok = await proctor.enableCamera();
      if (!ok) {
        const msg =
          proctor.cameraError ||
          'Camera permission was denied or no webcam device was detected.';
        if (strictCameraRequired) {
          setCameraGateError(`${msg} Strict Camera Lock is enabled — allow camera access to start.`);
          return;
        }
        setExamCameraNotice(`${msg} Running in non-camera proctoring mode.`);
        const next = pendingCameraGate;
        setPendingCameraGate(null);
        startApprovedTest(next.test, next.attemptId);
        return;
      }
      setExamCameraNotice(null);
      const next = pendingCameraGate;
      setPendingCameraGate(null);
      startApprovedTest(next.test, next.attemptId);
    } finally {
      setCameraGateBusy(false);
    }
  };

  const handleContinueWithoutCamera = () => {
    if (!pendingCameraGate || cameraGateBusy) return;
    setCameraGateError(null);
    setExamCameraNotice('Started without webcam — proctoring running in no-camera standby mode.');
    const next = pendingCameraGate;
    setPendingCameraGate(null);
    startApprovedTest(next.test, next.attemptId);
  };

  const effectiveOfflineLogoutMs = Math.max(
    30_000,
    (platformConfig.offlineAutoLogoutSec || 60) * 1000 || OFFLINE_AUTO_LOGOUT_MS
  );

  // Session Management: NEVER auto-logout on tab switch; only auto-logout if offline continuously >= threshold
  useEffect(() => {
    if (phase !== 'student_ready' || !studentProfile) {
      offlineSinceRef.current = null;
      return;
    }

    offlineSinceRef.current = navigator.onLine ? null : Date.now();

    const triggerAutoLogout = () => {
      flushExamDraftRef.current?.();
      markProctorOffline(studentProfile);
      clearActiveExamCache(studentProfile.uid);
      activityTracker.endSessionNow();
      proctor.disableCamera();
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // Ignore
      }
      setStudentProfile(null);
      setActiveExamTest(null);
      setActiveIncompleteAttemptId(null);
      setActiveExamQuestionIdx(0);
      setBackupDoc(null);
      resetSessionCollections();
      setPhase('signed_out');
      if (isOmRoutePath(readCurrentRoute())) {
        navigateToRoute('/');
      }
    };

    const onOnline = () => {
      offlineSinceRef.current = null;
    };
    const onOffline = () => {
      if (offlineSinceRef.current === null) {
        offlineSinceRef.current = Date.now();
      }
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const checkTimer = window.setInterval(() => {
      if (!navigator.onLine && offlineSinceRef.current === null) {
        offlineSinceRef.current = Date.now();
      } else if (navigator.onLine) {
        offlineSinceRef.current = null;
      }
      if (
        shouldTriggerOfflineAutoLogout({
          isOnline: navigator.onLine,
          offlineSinceMs: offlineSinceRef.current,
          nowMs: Date.now(),
          thresholdMs: effectiveOfflineLogoutMs,
        })
      ) {
        triggerAutoLogout();
      }
    }, 5_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(checkTimer);
    };
  }, [
    phase,
    studentProfile,
    activityTracker,
    proctor,
    markProctorOffline,
    clearActiveExamCache,
    navigateToRoute,
    effectiveOfflineLogoutMs,
    resetSessionCollections,
    setPhase,
    setStudentProfile,
  ]);

  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] dark:bg-[#0b0f17] text-sm font-medium text-slate-600 dark:text-slate-300">
        Initializing Path to CGL Workspace...
      </div>
    );
  }

  const handleRetryCloudSync = async () => {
    setSyncRetryBusy(true);
    setSyncRetryMsg(null);
    try {
      const res = await syncPendingLocalOpsToCloud({ force: true });
      if (res.quotaBlocked) {
        setSyncRetryMsg(`Cloud quota active · ${res.remaining} saved locally`);
      } else if (res.remaining === 0 && res.failedCount === 0) {
        setSyncRetryMsg(`Synced ${res.synced} local items to Firestore`);
      } else {
        setSyncRetryMsg(
          `Synced ${res.synced} · ${res.remaining} pending${res.failedCount > 0 ? ` · ${res.failedCount} failed` : ''}`
        );
      }
    } finally {
      setSyncRetryBusy(false);
    }
  };

  const pendingSyncCount = syncHealth.pendingCount;

  const quotaNoticeBanner =
    quotaExceeded && !quotaBannerDismissed && !activeExamTest ? (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 max-w-md rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-[#231c10] px-4 py-3 text-xs text-amber-950 dark:text-amber-100 shadow-xl no-print"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="font-bold">
              Local-First Hybrid Active {pendingSyncCount > 0 ? `(${pendingSyncCount} queued)` : ''}
            </div>
            <p className="leading-relaxed opacity-90">
              All VIP accounts, mocks, tests, and XP continue working smoothly in your browser without limits. Queued changes auto-sync to Firestore whenever cloud quota is available.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {pendingSyncCount > 0 && (
                <button
                  type="button"
                  disabled={syncRetryBusy}
                  onClick={() => void handleRetryCloudSync()}
                  className="rounded-md bg-amber-900 dark:bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-800 dark:hover:bg-amber-500 disabled:opacity-50 cursor-pointer"
                >
                  {syncRetryBusy ? 'Syncing...' : 'Retry Cloud Sync'}
                </button>
              )}
              {syncRetryMsg && (
                <span className="font-mono text-[11px] font-semibold opacity-90">
                  {syncRetryMsg}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setQuotaBannerDismissed(true)}
            aria-label="Dismiss quota notice"
            className="rounded p-1 hover:bg-amber-200/60 dark:hover:bg-amber-800/60 cursor-pointer shrink-0"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    ) : null;

  const sectionFallback = (label: string) => (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] dark:bg-[#0b0f17] text-sm font-medium text-slate-600 dark:text-slate-300">
      Loading {label}...
    </div>
  );

  const globalChrome = (
    <>
      {showAiSettings && (
        <Suspense fallback={null}>
          <AiKeySettingsModal onClose={() => setShowAiSettings(false)} />
        </Suspense>
      )}
      {quotaNoticeBanner}
      <PwaUpdateBanner
        activeExamOpen={Boolean(activeExamTest)}
        isDestActive={isDestRoute}
      />
      <OfflineIndicator
        pendingSyncCount={pendingSyncCount}
        syncHealth={syncHealth}
        failedOps={failedOps}
        onRetrySync={() => void retrySyncNow()}
        onRetryFailed={(key) => void retryFailedNow(key)}
        onDismissFailed={dismissFailedOpByKey}
      />
    </>
  );

  const canRenderAdminWorkspace = isOmRoute || (Boolean(adminPreviewStudent) && isDestRoute);

  // Hidden /om route strictly controls Admin UI; "/" NEVER displays Admin Login or Control Center
  if (phase === 'signed_out' || (phase === 'admin_ready' && !canRenderAdminWorkspace)) {
    return (
      <>
        <AuthGateway
          routeMode={isOmRoute ? 'admin_om' : 'student'}
          scoringConfig={scoringConfig}
          onStudentLogin={handleStudentLogin}
          onAdminLogin={handleAdminLogin}
          onBackToStudentHome={isOmRoute ? () => navigateToRoute('/') : undefined}
        />
        {globalChrome}
      </>
    );
  }

  if (phase === 'admin_ready' && canRenderAdminWorkspace) {
    if (adminPreviewStudent) {
      const summary =
        activeStudentSummary ??
        computeStudentActivitySummary(ADMIN_PREVIEW_UID, attempts, sessionLogs);

      if (activeExamTest) {
        const myLb = leaderboard.find((l) => l.uid === ADMIN_PREVIEW_UID) ?? null;
        return (
          <>
            <AppErrorBoundary
              sectionName="Exam Engine"
              onReset={() => {
                setActiveExamTest(null);
                setActiveIncompleteAttemptId(null);
                setActiveExamQuestionIdx(0);
              }}
            >
              <Suspense fallback={sectionFallback('TCS iON Test Engine')}>
                <TcsIonTestEngine
                  key={activeExamTest.id}
                  uid={ADMIN_PREVIEW_UID}
                  loginId={adminPreviewStudent.loginId}
                  studentName={adminPreviewStudent.displayName}
                  targetPost={adminPreviewStudent.targetPost}
                  test={activeExamTest}
                  scoringConfig={scoringConfig}
                  defaultLang={platformConfig.defaultLanguage}
                  currentLeaderboard={myLb}
                  activityMultiplier={summary.rewardMultiplier}
                  activityTierLabel={summary.tierLabel}
                  priorIncompleteAttemptId={activeIncompleteAttemptId}
                  flushDraftRef={flushExamDraftRef}
                  proctorStream={proctor.localStream}
                  cameraState={proctor.cameraState}
                  cameraWarning={examCameraNotice}
                  onTestCompleted={(qs, subs, isComplete) =>
                    activityTracker.recordTestCompleted(qs, subs, isComplete)
                  }
                  onTopicMasteryEvaluated={(topicTag, scorePct) =>
                    void handleTopicMasteryEvaluated(adminPreviewStudent, topicTag, scorePct, true)
                  }
                  onActiveQuestionChange={setActiveExamQuestionIdx}
                  onLaunchRevisionTest={(revTest) => {
                    activityTracker.setActivityContext(
                      `Weak Topic Revision: ${revTest.title}`,
                      revTest.subjectScope === 'full' ? ['quant', 'reasoning', 'english', 'ga'] : [revTest.subjectScope]
                    );
                    setActiveIncompleteAttemptId(null);
                    setActiveExamQuestionIdx(0);
                    setActiveExamTest(revTest);
                  }}
                  onExit={() => {
                    activityTracker.setActivityContext('Student Dashboard');
                    setActiveExamTest(null);
                    setActiveIncompleteAttemptId(null);
                    setActiveExamQuestionIdx(0);
                  }}
                />
              </Suspense>
            </AppErrorBoundary>
            {globalChrome}
          </>
        );
      }
      if (isDestRoute) {
        return (
          <>
            <AppErrorBoundary sectionName="DEST Simulator" onReset={() => navigateToRoute('/om')}>
              <Suspense fallback={sectionFallback('DEST Typing Simulator')}>
                <DestComputerSimulator
                  student={adminPreviewStudent}
                  onBack={() => navigateToRoute('/om')}
                />
              </Suspense>
            </AppErrorBoundary>
            {globalChrome}
          </>
        );
      }
      const previewResolutions = getPendingResolutionNotifications(
        supportTickets,
        adminPreviewStudent.uid
      );
      return (
        <>
          {previewResolutions.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="fixed top-4 right-4 z-50 w-[min(92vw,400px)] space-y-2 no-print"
            >
              {previewResolutions.slice(0, 2).map((tk) => (
                <div
                  key={tk.id}
                  className="flex items-start gap-3 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-[#13251e] p-3.5 shadow-xl text-emerald-950 dark:text-emerald-100"
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                  <div className="min-w-0 flex-1 text-xs space-y-0.5">
                    <div className="font-bold">{TICKET_RESOLVED_PUSH_MESSAGE}</div>
                    <div className="text-[11px] opacity-85 truncate">
                      Ticket: {tk.subject}
                      {tk.adminReply ? ` · ${tk.adminReply}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void acknowledgeResolvedTicket(tk.id)}
                    aria-label="Dismiss resolved notification"
                    className="rounded p-1 hover:bg-emerald-200/60 dark:hover:bg-emerald-800/60 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <AppErrorBoundary
            sectionName="Student Dashboard"
            onReset={() => setAdminPreviewStudent(null)}
          >
            <Suspense fallback={sectionFallback('Student Dashboard')}>
              <StudentDashboard
                student={adminPreviewStudent}
                tests={tests.filter((t) => t.published)}
                leaderboard={leaderboard}
                attempts={attempts.filter((a) => a.uid === ADMIN_PREVIEW_UID)}
                testDrafts={testDrafts}
                backupDoc={backupDoc}
                tasks={tasks}
                revisionItems={revisionItems}
                xpLedger={xpLedger.filter((x) => x.uid === ADMIN_PREVIEW_UID)}
                sessionLogs={sessionLogs.filter((s) => s.uid === ADMIN_PREVIEW_UID)}
                activitySummary={summary}
                liveSessionOverride={liveSessionOverride}
                scoringConfig={scoringConfig}
                platformConfig={platformConfig}
                supportTickets={supportTickets}
                dailySyncing={dailySyncing}
                onActivityContext={activityTracker.setActivityContext}
                onStartTest={(test) => void launchTestWithCameraGate(test)}
                onResumeIncompleteAttempt={(test, attemptId) =>
                  void launchTestWithCameraGate(test, attemptId)
                }
                onProfileUpdated={(updated) => setAdminPreviewStudent(updated)}
                onAckSupportTicket={(ticketId) => void acknowledgeResolvedTicket(ticketId)}
                onOpenRules={() => setShowRulesModal(true)}
                onOpenDestSimulator={() => navigateToRoute('/dest-simulator')}
                onReturnToAdmin={() => {
                  markProctorOffline(adminPreviewStudent);
                  activityTracker.endSessionNow();
                  proctor.disableCamera();
                  setPendingCameraGate(null);
                  setActiveExamTest(null);
                  setActiveIncompleteAttemptId(null);
                  setActiveExamQuestionIdx(0);
                  setAdminPreviewStudent(null);
                }}
                onSignOut={handleSignOut}
              />
            </Suspense>
          </AppErrorBoundary>
          <Suspense fallback={null}>
            <FloatingSupportChatWidget
              student={adminPreviewStudent}
              tickets={supportTickets.filter((t) => t.uid === adminPreviewStudent.uid)}
              aiTutorEnabled={platformConfig.aiTutorEnabled}
            />
          </Suspense>
          {pendingCameraGate && (
            <Suspense fallback={null}>
              <CameraRulesModal
                test={pendingCameraGate.test}
                busy={cameraGateBusy}
                errorMsg={cameraGateError}
                onGrantAndStart={handleGrantCameraAndStart}
                onContinueWithoutCamera={handleContinueWithoutCamera}
                onCancel={() => {
                  setPendingCameraGate(null);
                  setCameraGateError(null);
                }}
              />
            </Suspense>
          )}
          {showRulesModal && (
            <Suspense fallback={null}>
              <RulesGuideModal
                onClose={() => setShowRulesModal(false)}
                scoringConfig={scoringConfig}
              />
            </Suspense>
          )}
          {globalChrome}
        </>
      );
    }

    return (
      <>
        <AppErrorBoundary sectionName="Admin Control Center">
          <Suspense fallback={sectionFallback('Admin Command Center')}>
            <AdminControlCenter
              adminUid={ADMIN_PREVIEW_UID}
              adminEmail={adminId}
              invites={invites}
              invitesLoaded={invitesLoaded}
              students={students}
              presences={presences}
              sessionLogs={sessionLogs}
              leaderboard={leaderboard}
              questions={questions}
              tests={tests}
              attempts={attempts}
              tasks={tasks}
              xpLedger={xpLedger}
              scoringConfig={scoringConfig}
              githubReportsEnabled={platformConfig.githubReportsEnabled}
              supportTickets={supportTickets}
              reportedQueries={reportedQueries}
              onPreviewAsStudent={async () => {
                const prof = await ensureAdminStudentPreviewProfile(ADMIN_PREVIEW_UID, adminId);
                setAdminPreviewStudent(prof);
              }}
              onAdminIdUpdated={(nextAdminId) => {
                setAdminId(nextAdminId);
                try {
                  sessionStorage.setItem(
                    SESSION_STORAGE_KEY,
                    JSON.stringify({ role: 'admin', adminId: nextAdminId } satisfies StoredSession)
                  );
                } catch {
                  // Ignore
                }
              }}
              onOpenAiSettings={() => setShowAiSettings(true)}
              onSignOut={handleSignOut}
            />
          </Suspense>
        </AppErrorBoundary>
        {globalChrome}
      </>
    );
  }

  if (phase === 'student_ready' && studentProfile) {
    const summary =
      activeStudentSummary ??
      computeStudentActivitySummary(studentProfile.uid, attempts, sessionLogs);
    const pendingResolutions = getPendingResolutionNotifications(supportTickets, studentProfile.uid);

    if (activeExamTest) {
      const myLb = leaderboard.find((l) => l.uid === studentProfile.uid) ?? null;
      return (
        <>
          <AppErrorBoundary
            sectionName="Exam Engine"
            onReset={() => {
              setActiveExamTest(null);
              setActiveIncompleteAttemptId(null);
              setActiveExamQuestionIdx(0);
            }}
          >
            <Suspense fallback={sectionFallback('TCS iON Test Engine')}>
              <TcsIonTestEngine
                key={activeExamTest.id}
                uid={studentProfile.uid}
                loginId={studentProfile.loginId}
                studentName={studentProfile.displayName}
                targetPost={studentProfile.targetPost}
                test={activeExamTest}
                scoringConfig={scoringConfig}
                defaultLang={platformConfig.defaultLanguage}
                currentLeaderboard={myLb}
                activityMultiplier={summary.rewardMultiplier}
                activityTierLabel={summary.tierLabel}
                priorIncompleteAttemptId={activeIncompleteAttemptId}
                flushDraftRef={flushExamDraftRef}
                proctorStream={proctor.localStream}
                cameraState={proctor.cameraState}
                cameraWarning={examCameraNotice}
                onTestCompleted={(qs, subs, isComplete) => {
                  clearActiveExamCache(studentProfile.uid);
                  activityTracker.recordTestCompleted(qs, subs, isComplete);
                }}
                onTopicMasteryEvaluated={(topicTag, scorePct) =>
                  void handleTopicMasteryEvaluated(studentProfile, topicTag, scorePct, false)
                }
                onActiveQuestionChange={setActiveExamQuestionIdx}
                onLaunchRevisionTest={(revTest) => {
                  clearActiveExamCache(studentProfile.uid);
                  activityTracker.setActivityContext(
                    `Weak Topic Revision: ${revTest.title}`,
                    revTest.subjectScope === 'full' ? ['quant', 'reasoning', 'english', 'ga'] : [revTest.subjectScope]
                  );
                  setActiveIncompleteAttemptId(null);
                  setActiveExamQuestionIdx(0);
                  setActiveExamTest(revTest);
                }}
                onExit={() => {
                  clearActiveExamCache(studentProfile.uid);
                  activityTracker.setActivityContext('Student Dashboard');
                  setActiveExamTest(null);
                  setActiveIncompleteAttemptId(null);
                  setActiveExamQuestionIdx(0);
                }}
              />
            </Suspense>
          </AppErrorBoundary>
          {globalChrome}
        </>
      );
    }

    if (isDestRoute) {
      return (
        <>
          <AppErrorBoundary sectionName="DEST Simulator" onReset={() => navigateToRoute('/')}>
            <Suspense fallback={sectionFallback('DEST Typing Simulator')}>
              <DestComputerSimulator
                student={studentProfile}
                onBack={() => navigateToRoute('/')}
              />
            </Suspense>
          </AppErrorBoundary>
          {globalChrome}
        </>
      );
    }

    return (
      <>
        {/* In-App Push Notification Toast for Admin-Resolved Support Tickets */}
        {pendingResolutions.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            className="fixed top-4 right-4 z-50 w-[min(92vw,400px)] space-y-2 no-print"
          >
            {pendingResolutions.slice(0, 2).map((tk) => (
              <div
                key={tk.id}
                className="flex items-start gap-3 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-[#13251e] p-3.5 shadow-xl text-emerald-950 dark:text-emerald-100"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <div className="min-w-0 flex-1 text-xs space-y-0.5">
                  <div className="font-bold">{TICKET_RESOLVED_PUSH_MESSAGE}</div>
                  <div className="text-[11px] opacity-85 truncate">
                    Ticket: {tk.subject}
                    {tk.adminReply ? ` · ${tk.adminReply}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void acknowledgeResolvedTicket(tk.id)}
                  aria-label="Dismiss resolved notification"
                  className="rounded p-1 hover:bg-emerald-200/60 dark:hover:bg-emerald-800/60 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        <AppErrorBoundary sectionName="Student Dashboard">
          <Suspense fallback={sectionFallback('Student Dashboard')}>
            <StudentDashboard
              student={studentProfile}
              tests={tests}
              leaderboard={leaderboard}
              attempts={attempts}
              testDrafts={testDrafts}
              backupDoc={backupDoc}
              tasks={tasks}
              revisionItems={revisionItems}
              xpLedger={xpLedger}
              sessionLogs={sessionLogs}
              activitySummary={summary}
              liveSessionOverride={liveSessionOverride}
              scoringConfig={scoringConfig}
              platformConfig={platformConfig}
              supportTickets={supportTickets}
              dailySyncing={dailySyncing}
              onActivityContext={activityTracker.setActivityContext}
              onStartTest={(test) => void launchTestWithCameraGate(test)}
              onResumeIncompleteAttempt={(test, attemptId) =>
                void launchTestWithCameraGate(test, attemptId)
              }
              onProfileUpdated={(updated) => setStudentProfile(updated)}
              onAckSupportTicket={(ticketId) => void acknowledgeResolvedTicket(ticketId)}
              onOpenRules={() => setShowRulesModal(true)}
              onOpenDestSimulator={() => navigateToRoute('/dest-simulator')}
              onSignOut={handleSignOut}
            />
          </Suspense>
        </AppErrorBoundary>

        <Suspense fallback={null}>
          <FloatingSupportChatWidget
            student={studentProfile}
            tickets={supportTickets}
            aiTutorEnabled={platformConfig.aiTutorEnabled}
          />
        </Suspense>

        {pendingCameraGate && (
          <Suspense fallback={null}>
            <CameraRulesModal
              test={pendingCameraGate.test}
              busy={cameraGateBusy}
              errorMsg={cameraGateError}
              onGrantAndStart={handleGrantCameraAndStart}
              onContinueWithoutCamera={handleContinueWithoutCamera}
              onCancel={() => {
                setPendingCameraGate(null);
                setCameraGateError(null);
              }}
            />
          </Suspense>
        )}

        {showRulesModal && (
          <Suspense fallback={null}>
            <RulesGuideModal
              onClose={() => setShowRulesModal(false)}
              scoringConfig={scoringConfig}
            />
          </Suspense>
        )}
        {globalChrome}
      </>
    );
  }

  return globalChrome;
}
