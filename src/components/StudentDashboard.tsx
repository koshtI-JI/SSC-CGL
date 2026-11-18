import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Award,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  HardDriveDownload,
  Keyboard,
  Lock,
  MapPin,
  Megaphone,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  UserCog,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { aiGenerateDailyPack, aiGenerateQuestions } from '../lib/aiClient';
import {
  addQuestionsBatchWithIds,
  cacheAllPublishedMocksForOffline,
  claimTaskBonusXp,
  createSmartPracticeTest,
  createSmartTopicTest,
  createTier1FullMock,
  createTier2FullMock,
  creditPopupQuizRewardXp,
  ensureDailyAutomationSuite,
  fetchAllQuestionsOnce,
  updateStudentGamificationState,
} from '../lib/firestoreService';
import {
  SUBJECT_LABELS,
  type CohortTaskDoc,
  type LeaderboardEntry,
  type MockTestDoc,
  type PhysicalChecklistState,
  type ProgressBackupDoc,
  type QuestionDoc,
  type QuestionInput,
  type RevisionItemDoc,
  type ScoringConfig,
  type StudentActivitySummary,
  type StudentProfile,
  type StudentSessionLogDoc,
  type SubjectKey,
  type SupportTicketDoc,
  type TestAttemptDoc,
  type TestDraftDoc,
  type XpLedgerEntryDoc,
} from '../types/exam';
import {
  computeTargetCutoffBenchmark,
  DEFAULT_PHYSICAL_CHECKLIST,
  DREAM_POST_CATALOG,
  MICRO_SYLLABUS_CHAPTERS,
  resolveDreamPost,
} from '../utils/dreamPostCatalog';
import {
  applyActivityMultiplier,
  buildAdaptiveQuestionSelection,
  buildDailySectionalTestId,
  computeLifetimeStudentStats,
  computeRankTierFromStep,
  computeStudentRankTier,
  computeTaskProgress,
  DAILY_MOCK_PREFIX,
  formatSeconds,
  formatWelcomeTitle,
  getAttemptCompletionPercent,
  getAttemptStatusLabel,
  getLocalDateKey,
  getQualifyingTestsForTask,
  isAttemptComplete,
  isDailyMockTest,
  isDailySectionalTest,
  isTaskExpired,
  rankLeaderboard,
  summarizeCompletedTests,
  summarizePendingTests,
  type LiveSessionOverride,
  type RankTierInfo,
} from '../utils/examEngine';
import {
  computeOfflineReadinessSummary,
  listOfflineMockPacks,
  type OfflineReadinessSummary,
} from '../utils/indexedDbStore';
import {
  POPUP_QUIZ_ACTIVE_INTERVAL_MS,
  pickPopupRewardQuestions,
  shouldTriggerPopupQuiz,
} from '../utils/sessionAndOverrides';
import {
  DEFAULT_PLATFORM_CONFIG,
  type PlatformConfig,
} from '../utils/platformConfig';
import { computeAspirantCoachSummary } from '../utils/studyCoach';
import { AspirantCoachCard } from './AspirantCoachCard';
import { CompletedTestsPanel } from './CompletedTestsPanel';
import { CustomMockBuilderModal } from './CustomMockBuilderModal';
import { EditProfileModal } from './EditProfileModal';
import { GlobalSearchModal } from './GlobalSearchModal';
import { LeaderboardPanel } from './LeaderboardPanel';
import { NotificationBell } from './NotificationBell';
import { PendingTestsPanel } from './PendingTestsPanel';
import { PopupRewardQuizModal } from './PopupRewardQuizModal';
import { PrintableReportModal } from './PrintableReportModal';
import { ProgressChartPanel } from './ProgressChartPanel';
import { RankBadge, RankLevelUpOverlay } from './RankBadge';
import { RevisionVault } from './RevisionVault';
import { ScratchRewardModal } from './ScratchRewardModal';
import { StudentProfilePanel } from './StudentProfilePanel';
import { StudyFormulaBoosterModal } from './StudyFormulaBoosterModal';
import { SyllabusTopicDropdown, type SelectedSyllabusTopic } from './SyllabusTopicDropdown';
import { TopNav } from './TopNav';

export type StudentTabId =
  | 'overview'
  | 'pending'
  | 'completed'
  | 'progress'
  | 'leaderboard'
  | 'vault'
  | 'profile';

interface StudentDashboardProps {
  student: StudentProfile;
  tests: MockTestDoc[];
  leaderboard: LeaderboardEntry[];
  attempts: TestAttemptDoc[];
  testDrafts?: TestDraftDoc[];
  backupDoc?: ProgressBackupDoc | null;
  tasks: CohortTaskDoc[];
  revisionItems: RevisionItemDoc[];
  xpLedger: XpLedgerEntryDoc[];
  sessionLogs: StudentSessionLogDoc[];
  activitySummary: StudentActivitySummary;
  liveSessionOverride?: LiveSessionOverride;
  scoringConfig: ScoringConfig;
  platformConfig?: PlatformConfig;
  supportTickets?: SupportTicketDoc[];
  dailySyncing?: boolean;
  onActivityContext?: (title: string, subjects?: SubjectKey[]) => void;
  onStartTest: (test: MockTestDoc) => void;
  onResumeIncompleteAttempt?: (test: MockTestDoc, attemptId: string) => void;
  onProfileUpdated?: (updated: StudentProfile) => void;
  onAckSupportTicket?: (ticketId: string) => void;
  onOpenRules?: () => void;
  onOpenDestSimulator?: () => void;
  onReturnToAdmin?: () => void;
  onSignOut: () => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  student,
  tests,
  leaderboard,
  attempts,
  testDrafts = [],
  backupDoc = null,
  tasks,
  revisionItems,
  xpLedger,
  sessionLogs,
  activitySummary,
  liveSessionOverride,
  scoringConfig,
  platformConfig = DEFAULT_PLATFORM_CONFIG,
  supportTickets = [],
  dailySyncing = false,
  onActivityContext,
  onStartTest,
  onResumeIncompleteAttempt,
  onProfileUpdated,
  onAckSupportTicket,
  onOpenRules,
  onOpenDestSimulator,
  onReturnToAdmin,
  onSignOut,
}) => {
  const [activeTab, setActiveTab] = useState<StudentTabId>('overview');
  const [tabHistory, setTabHistory] = useState<StudentTabId[]>([]);
  const [testScopeFilter, setTestScopeFilter] = useState<'all' | 'full' | 'quant' | 'reasoning' | 'english' | 'ga'>('all');
  const [selectedMissionTaskId, setSelectedMissionTaskId] = useState<string | null>(null);
  const [scratchTask, setScratchTask] = useState<CohortTaskDoc | null>(null);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [showPrintReport, setShowPrintReport] = useState(false);
  const [showPastTasks, setShowPastTasks] = useState(false);
  const [showCustomMockBuilder, setShowCustomMockBuilder] = useState(false);
  const [showFormulaBooster, setShowFormulaBooster] = useState(false);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [popupQuizOpen, setPopupQuizOpen] = useState(false);
  const [popupQuizQuestions, setPopupQuizQuestions] = useState<QuestionDoc[]>([]);
  const [dailyGoal, setDailyGoal] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(`getcgl_daily_goal_${student.uid}`));
      return saved === 25 || saved === 50 || saved === 100 ? saved : 50;
    } catch {
      return 50;
    }
  });
  const [rankPromotion, setRankPromotion] = useState<{ from: RankTierInfo; to: RankTierInfo } | null>(
    null
  );

  // Smart Adaptive Practice & Revision Vault Re-Test State
  const [pracScope, setPracScope] = useState<'full' | SubjectKey>('full');
  const [pracCount, setPracCount] = useState<number>(15);
  const [includeVaultInPrac, setIncludeVaultInPrac] = useState(true);
  const [includeAiFresh, setIncludeAiFresh] = useState(false);
  const [pracBusy, setPracBusy] = useState(false);
  const [pracError, setPracError] = useState<string | null>(null);

  // Feature 2: Tier-I / Tier-II Exam Engine Toggle State
  const [selectedTier, setSelectedTier] = useState<'tier1' | 'tier2'>('tier1');
  const [tier1Busy, setTier1Busy] = useState(false);
  const [tier1Error, setTier1Error] = useState<string | null>(null);

  // Feature 3: Compact Smart Topic Filter State
  const [smartTopicSelection, setSmartTopicSelection] = useState<SelectedSyllabusTopic>({
    slug: 'quant_geometry',
    title: 'Geometry',
    subject: 'quant',
  });
  const [smartTopicCount, setSmartTopicCount] = useState(15);
  const [smartTopicTime, setSmartTopicTime] = useState(15);
  const [smartTopicBusy, setSmartTopicBusy] = useState(false);
  const [smartTopicError, setSmartTopicError] = useState<string | null>(null);

  // Feature 4: Dream Post & Inspector Checklist Saving State
  const [gamificationSaving, setGamificationSaving] = useState(false);

  // Offline IndexedDB Mock Cache State
  const [offlineSummary, setOfflineSummary] = useState<OfflineReadinessSummary>({
    totalPublishedTests: 0,
    offlineReadyTests: 0,
    cachedPacksCount: 0,
    cachedQuestionCount: 0,
    indexedDbSupported: true,
    lastCachedAtMs: null,
  });
  const [offlineCacheBusy, setOfflineCacheBusy] = useState(false);
  const [offlineCacheMsg, setOfflineCacheMsg] = useState<string | null>(null);

  // Pop-up XP Flash Quiz Scheduler (triggers every ~2 hours of active study session)
  useEffect(() => {
    const storageKey = `getcgl_popup_quiz_state_v1_${student.uid}`;
    let lastTickMs = Date.now();
    const loadState = (): { accumulatedActiveMs: number; lastTriggeredAtActiveMs: number } => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<{
            accumulatedActiveMs: number;
            lastTriggeredAtActiveMs: number;
          }>;
          if (
            typeof parsed.accumulatedActiveMs === 'number' &&
            typeof parsed.lastTriggeredAtActiveMs === 'number'
          ) {
            return {
              accumulatedActiveMs: parsed.accumulatedActiveMs,
              lastTriggeredAtActiveMs: parsed.lastTriggeredAtActiveMs,
            };
          }
        }
      } catch {
        // Ignore storage read errors
      }
      return { accumulatedActiveMs: 0, lastTriggeredAtActiveMs: 0 };
    };

    const saveState = (st: { accumulatedActiveMs: number; lastTriggeredAtActiveMs: number }) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(st));
      } catch {
        // Ignore storage write errors
      }
    };

    let triggering = false;
    const timer = window.setInterval(async () => {
      const now = Date.now();
      const delta = Math.max(0, Math.min(60_000, now - lastTickMs));
      lastTickMs = now;
      if (document.visibilityState !== 'visible' || popupQuizOpen || triggering) return;

      const cur = loadState();
      const nextAccumulated = cur.accumulatedActiveMs + delta;
      if (
        shouldTriggerPopupQuiz({
          accumulatedActiveMs: nextAccumulated,
          lastTriggeredAtActiveMs: cur.lastTriggeredAtActiveMs,
          intervalMs: POPUP_QUIZ_ACTIVE_INTERVAL_MS,
          isDisabledInExam: false,
        })
      ) {
        triggering = true;
        saveState({
          accumulatedActiveMs: nextAccumulated,
          lastTriggeredAtActiveMs: nextAccumulated,
        });
        try {
          const pool = await fetchAllQuestionsOnce();
          const picked = pickPopupRewardQuestions(pool, `${student.uid}_${now}`, 2);
          if (picked.length > 0) {
            setPopupQuizQuestions(picked);
            setPopupQuizOpen(true);
          }
        } catch {
          // Non-fatal
        } finally {
          triggering = false;
        }
      } else {
        saveState({
          accumulatedActiveMs: nextAccumulated,
          lastTriggeredAtActiveMs: cur.lastTriggeredAtActiveMs,
        });
      }
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [student.uid, popupQuizOpen]);

  useEffect(() => {
    let alive = true;
    listOfflineMockPacks()
      .then((packs) => {
        if (!alive) return;
        const cachedQs = packs.flatMap((p) => p.questions);
        setOfflineSummary(
          computeOfflineReadinessSummary({
            tests,
            questions: cachedQs,
            cachedPacks: packs,
          })
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tests]);

  const handleCacheAllOffline = async () => {
    setOfflineCacheBusy(true);
    setOfflineCacheMsg(null);
    try {
      const targetTests = tests.slice(0, 20);
      const res = await cacheAllPublishedMocksForOffline(targetTests);
      const packs = await listOfflineMockPacks();
      const cachedQs = packs.flatMap((p) => p.questions);
      setOfflineSummary(
        computeOfflineReadinessSummary({
          tests,
          questions: cachedQs,
          cachedPacks: packs,
        })
      );
      setOfflineCacheMsg(
        `Cached ${res.cachedTests} mock packs (${res.totalQuestions} questions) into IndexedDB for instant offline testing.`
      );
    } catch {
      setOfflineCacheMsg('Could not cache all packs right now; starter & saved mocks remain available offline.');
    } finally {
      setOfflineCacheBusy(false);
    }
  };

  const smartTopicSectionRef = useRef<HTMLDivElement | null>(null);
  const missionPanelRef = useRef<HTMLElement | null>(null);

  const navigateTab = (next: StudentTabId) => {
    if (next !== activeTab) {
      setTabHistory((prev) => [...prev.slice(-8), activeTab]);
      setActiveTab(next);
    }
    if (next === 'progress') onActivityContext?.('Progress & Activity Chart');
    else if (next === 'pending') onActivityContext?.('Pending Tests & Drafts');
    else if (next === 'completed') onActivityContext?.('Completed Tests & Revision');
    else if (next === 'vault') onActivityContext?.('Revision Vault');
    else if (next === 'leaderboard') onActivityContext?.('Live Leaderboard');
    else if (next === 'profile') onActivityContext?.('Candidate Profile & Backups');
    else onActivityContext?.('Student Dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackFromSubView = () => {
    const prevTab = tabHistory[tabHistory.length - 1] ?? 'overview';
    setTabHistory((prev) => prev.slice(0, -1));
    const target = prevTab === activeTab ? 'overview' : prevTab;
    setActiveTab(target);
    if (target === 'progress') onActivityContext?.('Progress & Activity Chart');
    else if (target === 'pending') onActivityContext?.('Pending Tests & Drafts');
    else if (target === 'completed') onActivityContext?.('Completed Tests & Revision');
    else if (target === 'vault') onActivityContext?.('Revision Vault');
    else if (target === 'leaderboard') onActivityContext?.('Live Leaderboard');
    else if (target === 'profile') onActivityContext?.('Candidate Profile & Backups');
    else onActivityContext?.('Student Dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selectedMissionTask =
    tasks.find((t) => t.id === selectedMissionTaskId && t.active) ?? null;

  const todayDateKey = getLocalDateKey();
  const todayDailyTestId = `${DAILY_MOCK_PREFIX}${todayDateKey}`;
  const completedTestIdsSet = useMemo(
    () => new Set(attempts.filter(isAttemptComplete).map((a) => a.testId)),
    [attempts]
  );

  const draftByTestId = useMemo(
    () => new Map(testDrafts.map((d) => [d.testId, d])),
    [testDrafts]
  );

  const pendingSummaryList = useMemo(
    () => summarizePendingTests({ tests, attempts, drafts: testDrafts }),
    [tests, attempts, testDrafts]
  );

  const incompleteAttemptByTestId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of pendingSummaryList) {
      if (p.source === 'incomplete_attempt' && p.latestAttemptId) {
        map.set(p.testId, p.latestAttemptId);
      }
    }
    return map;
  }, [pendingSummaryList]);

  const pendingTestsCount = pendingSummaryList.length;

  const todayDailyTestRaw = tests.find((t) => t.id === todayDailyTestId) ?? null;
  const todayDailyTest =
    todayDailyTestRaw && !completedTestIdsSet.has(todayDailyTestRaw.id) ? todayDailyTestRaw : null;
  const todayDailyTestCompleted = Boolean(
    todayDailyTestRaw && completedTestIdsSet.has(todayDailyTestRaw.id)
  );
  const todayDailySectionals = (['quant', 'reasoning', 'english', 'ga'] as const)
    .map((sub) => tests.find((t) => t.id === buildDailySectionalTestId(sub, todayDateKey)))
    .filter((t): t is MockTestDoc => Boolean(t && !completedTestIdsSet.has(t.id)));

  const completedGroupsCount = summarizeCompletedTests(attempts, tests).length;
  const activeAvailableTests = useMemo(
    () => tests.filter((t) => !completedTestIdsSet.has(t.id)),
    [tests, completedTestIdsSet]
  );

  const filteredTests = (
    selectedMissionTask
      ? getQualifyingTestsForTask(selectedMissionTask, activeAvailableTests)
      : activeAvailableTests.filter((t) =>
          testScopeFilter === 'all' ? true : t.subjectScope === testScopeFilter
        )
  ).sort((a, b) => {
    if (a.id === todayDailyTestId) return -1;
    if (b.id === todayDailyTestId) return 1;
    if (isDailySectionalTest(a.id) && !isDailySectionalTest(b.id)) return -1;
    if (!isDailySectionalTest(a.id) && isDailySectionalTest(b.id)) return 1;
    return 0;
  });

  const handleOpenMission = (task: CohortTaskDoc) => {
    setSelectedMissionTaskId(task.id);
    if (activeTab !== 'overview') {
      navigateTab('overview');
    }
    window.requestAnimationFrame(() => {
      missionPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const ranked = rankLeaderboard(leaderboard);
  const myRankIndex = ranked.findIndex((e) => e.uid === student.uid);
  const myLb = myRankIndex >= 0 ? ranked[myRankIndex] : null;
  const pendingVaultCount = revisionItems.filter((r) => !r.mastered).length;

  const lifetimeStats = useMemo(() => computeLifetimeStudentStats(attempts), [attempts]);
  const rankTier = useMemo(
    () =>
      computeStudentRankTier({
        totalXp: myLb?.totalXp ?? 0,
        testsCompleted: lifetimeStats.mocksCompleted,
        activeDays: activitySummary.activeDays7d,
        questionsAttempted: lifetimeStats.questionsAttempted,
      }),
    [myLb?.totalXp, lifetimeStats.mocksCompleted, lifetimeStats.questionsAttempted, activitySummary.activeDays7d]
  );

  useEffect(() => {
    const storageKey = `getcgl_rank_step_v1_${student.uid}`;
    const legacyKey = `sankalp_rank_step_v1_${student.uid}`;
    try {
      const raw = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyKey);
      if (!raw) {
        localStorage.setItem(storageKey, String(rankTier.step));
        return;
      }
      const prevStep = Number(raw);
      if (Number.isFinite(prevStep) && prevStep >= 1 && rankTier.step > prevStep) {
        setRankPromotion({
          from: computeRankTierFromStep(prevStep),
          to: rankTier,
        });
        localStorage.setItem(storageKey, String(rankTier.step));
      } else if (!Number.isFinite(prevStep) || rankTier.step !== prevStep) {
        localStorage.setItem(storageKey, String(rankTier.step));
      }
    } catch {
      // Ignore storage access errors
    }
  }, [student.uid, rankTier]);

  const claimedTaskIds = new Set(
    xpLedger.filter((x) => x.sourceType === 'task' && x.uid === student.uid).map((x) => x.refId)
  );
  const allActiveConfigTasks = tasks.filter((t) => t.active);
  const openActiveTasks = allActiveConfigTasks.filter(
    (t) => !claimedTaskIds.has(t.id) && !isTaskExpired(t)
  );
  const pastTasks = allActiveConfigTasks.filter(
    (t) => claimedTaskIds.has(t.id) || isTaskExpired(t)
  );

  const fallbackLeaderboardEntry: LeaderboardEntry = myLb ?? {
    uid: student.uid,
    displayName: student.displayName,
    targetPost: student.targetPost,
    cohortId: 'ssc_cgl_vip',
    totalXp: 0,
    testsAttempted: 0,
    bestScore: 0,
    avgAccuracy: 0,
    totalTimeSec: 0,
  };

  const handleCommitScratchReward = async (task: CohortTaskDoc) => {
    const creditedXp = await claimTaskBonusXp({
      uid: student.uid,
      studentName: student.displayName,
      task,
      currentLeaderboard: fallbackLeaderboardEntry,
      activityMultiplier: activitySummary.rewardMultiplier,
      activityTierLabel: activitySummary.tierLabel,
    });
    setClaimMsg(
      `Reward Claimed: +${creditedXp} Bonus XP (${activitySummary.rewardMultiplier.toFixed(2)}x ${activitySummary.tierLabel}) added for "${task.title}"!`
    );
  };

  const handleLaunchAdaptivePractice = async () => {
    setPracError(null);
    setPracBusy(true);
    try {
      const bankQuestions = await fetchAllQuestionsOnce();
      let freshAiIds: string[] = [];

      if (platformConfig.aiTutorEnabled && includeAiFresh && pracScope !== 'ga') {
        try {
          const data =
            pracScope === 'full'
              ? await aiGenerateDailyPack({
                  dateKey: `prac_${Date.now()}`,
                  perSubject: Math.max(1, Math.min(3, Math.ceil(pracCount / 8))),
                  timeoutMs: 12_000,
                })
              : await aiGenerateQuestions({
                  subject: pracScope,
                  topic: 'SSC CGL High-Yield Practice',
                  difficulty: 'medium',
                  count: Math.min(8, pracCount),
                  timeoutMs: 12_000,
                });
          if (Array.isArray(data.questions) && data.questions.length > 0) {
            const saved = await addQuestionsBatchWithIds(data.questions as QuestionInput[], student.uid);
            freshAiIds = saved.ids;
          }
        } catch {
          // Continue cleanly with Bank + Vault questions if AI call times out or fails
        }
      }

      const recentAttemptedTestQIds = new Set<string>();
      for (const att of attempts.slice(0, 5)) {
        const matched = tests.find((t) => t.id === att.testId);
        matched?.questionIds.forEach((qid) => recentAttemptedTestQIds.add(qid));
      }

      const neededFromBank = Math.max(0, pracCount - freshAiIds.length);
      const selected =
        neededFromBank > 0
          ? buildAdaptiveQuestionSelection({
              allQuestions: bankQuestions,
              revisionItems,
              recentQuestionIds: recentAttemptedTestQIds,
              subjectScope: pracScope,
              count: neededFromBank,
              includeRevisionVault: includeVaultInPrac,
              includeMasteredVault: true,
              seedKey: `${student.uid}_${Date.now()}`,
            })
          : { questionIds: [], revisionCount: 0, freshCount: 0 };

      const combinedIds = Array.from(new Set([...freshAiIds, ...selected.questionIds])).slice(0, pracCount);
      if (combinedIds.length === 0) {
        throw new Error('No matching questions found in the Question Bank yet.');
      }

      const scopeTitle =
        pracScope === 'full' ? 'Smart Mixed Practice' : `${SUBJECT_LABELS[pracScope].short} Adaptive Drill`;
      const createdTest = await createSmartPracticeTest({
        uid: student.uid,
        title: `${scopeTitle} (${combinedIds.length} Qs)`,
        subjectScope: pracScope,
        questionIds: combinedIds,
        durationMinutes: Math.max(10, Math.min(60, combinedIds.length)),
        scoringConfig,
        published: false,
      });
      onStartTest(createdTest);
    } catch (err) {
      setPracError(err instanceof Error ? err.message : 'Could not build adaptive practice test.');
    } finally {
      setPracBusy(false);
    }
  };

  const handleLaunchVaultTest = async (opts: {
    subjectScope: 'full' | SubjectKey;
    includeMastered: boolean;
  }) => {
    setPracError(null);
    setPracBusy(true);
    try {
      const bankQuestions = await fetchAllQuestionsOnce();
      const selection = buildAdaptiveQuestionSelection({
        allQuestions: bankQuestions,
        revisionItems,
        subjectScope: opts.subjectScope,
        count: 50,
        onlyRevisionVault: true,
        includeMasteredVault: opts.includeMastered,
        seedKey: `vault_${student.uid}_${Date.now()}`,
      });
      if (selection.questionIds.length === 0) {
        throw new Error('No Revision Vault questions available for this filter right now.');
      }
      const label =
        opts.subjectScope === 'full'
          ? 'Revision Vault Re-Test'
          : `${SUBJECT_LABELS[opts.subjectScope].short} Vault Re-Test`;
      const createdTest = await createSmartPracticeTest({
        uid: student.uid,
        title: `${label} (${selection.questionIds.length} Qs)`,
        subjectScope: opts.subjectScope,
        questionIds: selection.questionIds,
        durationMinutes: Math.max(8, Math.min(60, selection.questionIds.length)),
        scoringConfig,
        published: false,
      });
      onStartTest(createdTest);
    } catch (err) {
      setPracError(err instanceof Error ? err.message : 'Could not start Revision Vault test.');
    } finally {
      setPracBusy(false);
    }
  };

  const handleChangeDailyGoal = (nextGoal: number) => {
    setDailyGoal(nextGoal);
    try {
      localStorage.setItem(`getcgl_daily_goal_${student.uid}`, String(nextGoal));
    } catch {
      // Ignore storage access errors
    }
  };

  const handleQuickFocusDrill = async (subject: SubjectKey) => {
    setPracScope(subject);
    setPracCount(15);
    setPracError(null);
    setPracBusy(true);
    try {
      const bankQuestions = await fetchAllQuestionsOnce();
      const recentAttemptedTestQIds = new Set<string>();
      for (const att of attempts.slice(0, 5)) {
        const matched = tests.find((t) => t.id === att.testId);
        matched?.questionIds.forEach((qid) => recentAttemptedTestQIds.add(qid));
      }
      const selected = buildAdaptiveQuestionSelection({
        allQuestions: bankQuestions,
        revisionItems,
        recentQuestionIds: recentAttemptedTestQIds,
        subjectScope: subject,
        count: 15,
        includeRevisionVault: true,
        includeMasteredVault: true,
        seedKey: `focus_${student.uid}_${Date.now()}`,
      });
      if (selected.questionIds.length === 0) {
        throw new Error(`No ${SUBJECT_LABELS[subject].short} questions found in the Question Bank yet.`);
      }
      const createdTest = await createSmartPracticeTest({
        uid: student.uid,
        title: `${SUBJECT_LABELS[subject].short} Focus Booster (${selected.questionIds.length} Qs)`,
        subjectScope: subject,
        questionIds: selected.questionIds,
        durationMinutes: Math.max(10, selected.questionIds.length),
        scoringConfig,
        published: false,
      });
      onStartTest(createdTest);
    } catch (err) {
      setPracError(err instanceof Error ? err.message : 'Could not launch focus drill.');
    } finally {
      setPracBusy(false);
    }
  };

  const handleLaunchTier1Mock = async () => {
    setTier1Error(null);
    setTier1Busy(true);
    try {
      const test =
        selectedTier === 'tier2'
          ? await createTier2FullMock({ uid: student.uid })
          : await createTier1FullMock({ uid: student.uid });
      onStartTest(test);
    } catch (err) {
      setTier1Error(
        err instanceof Error
          ? err.message
          : `Unable to initialize ${selectedTier === 'tier2' ? 'Tier-II' : 'Tier-I'} Full Mock.`
      );
    } finally {
      setTier1Busy(false);
    }
  };

  const handleLaunchSmartTopicTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSmartTopicError(null);
    if (!smartTopicSelection?.title.trim()) {
      setSmartTopicError('Select a Subject or Topic from the syllabus dropdown to start.');
      return;
    }
    setSmartTopicBusy(true);
    try {
      const res = await createSmartTopicTest({
        uid: student.uid,
        topicInput: smartTopicSelection.title,
        subjectFilter: smartTopicSelection.subject,
        questionCount: smartTopicCount,
        timeLimitMinutes: smartTopicTime,
        scoringConfig,
      });
      onStartTest(res.test);
    } catch (err) {
      setSmartTopicError(err instanceof Error ? err.message : 'Unable to start Smart Topic test.');
    } finally {
      setSmartTopicBusy(false);
    }
  };

  const handleTargetPostChange = async (nextPost: string) => {
    if (!nextPost.trim() || nextPost === student.targetPost) return;
    setGamificationSaving(true);
    try {
      const updated = await updateStudentGamificationState(student.uid, {
        targetPost: nextPost,
      });
      onProfileUpdated?.(updated);
    } catch {
      onProfileUpdated?.({ ...student, targetPost: nextPost });
    } finally {
      setGamificationSaving(false);
    }
  };

  const handleTogglePhysicalItem = async (field: keyof PhysicalChecklistState) => {
    const base = student.physicalChecklist ?? DEFAULT_PHYSICAL_CHECKLIST;
    const nextChecklist: PhysicalChecklistState = {
      ...base,
      [field]: !base[field],
    };
    onProfileUpdated?.({ ...student, physicalChecklist: nextChecklist });
    setGamificationSaving(true);
    try {
      const updated = await updateStudentGamificationState(student.uid, {
        physicalChecklist: nextChecklist,
      });
      onProfileUpdated?.(updated);
    } catch {
      // Optimistic state already updated
    } finally {
      setGamificationSaving(false);
    }
  };

  const resolvedDreamPost = useMemo(
    () => resolveDreamPost(student.targetPost),
    [student.targetPost]
  );

  const syllabusMastery = student.syllabusMastery ?? {};
  const masteredChapterCount = useMemo(
    () => MICRO_SYLLABUS_CHAPTERS.filter((ch) => Boolean(syllabusMastery[ch.slug]?.mastered)).length,
    [syllabusMastery]
  );

  const aspirantCoach = useMemo(
    () =>
      computeAspirantCoachSummary({
        targetPost: student.targetPost,
        displayName: student.displayName,
        attempts,
        sessionLogs,
        pendingVaultCount,
        dailyGoal,
      }),
    [student.targetPost, student.displayName, attempts, sessionLogs, pendingVaultCount, dailyGoal]
  );

  const navBackButton =
    activeTab !== 'overview'
      ? { label: 'Back', onClick: handleBackFromSubView }
      : selectedMissionTask
        ? { label: 'All Tests', onClick: () => setSelectedMissionTaskId(null) }
        : onReturnToAdmin
          ? { label: 'Back to Admin', onClick: onReturnToAdmin }
          : null;

  return (
    <div className="min-h-screen bg-[#f4f6f8] dark:bg-[#0b0f17] text-slate-900 dark:text-slate-100 transition-colors">
      <TopNav
        tabs={[
          { id: 'overview', label: 'Mocks & Tasks' },
          { id: 'pending', label: `Pending (${pendingTestsCount})` },
          { id: 'completed', label: `Completed (${completedGroupsCount})` },
          { id: 'progress', label: 'Progress & Activity' },
          { id: 'leaderboard', label: 'Live Leaderboard' },
          { id: 'vault', label: `Revision Vault (${attempts.length})` },
          { id: 'profile', label: 'Profile' },
        ]}
        activeTab={activeTab}
        backButton={navBackButton}
        onOpenGlobalSearch={() => setShowGlobalSearch(true)}
        onOpenRules={onOpenRules}
        notificationSlot={
          <NotificationBell
            tests={tests}
            tasks={tasks}
            supportTickets={supportTickets}
            pendingVaultCount={pendingVaultCount}
            onLaunchTest={onStartTest}
            onNavigateTab={(tabId) => navigateTab(tabId as StudentTabId)}
            onAckSupportTicket={onAckSupportTicket}
          />
        }
        onSelectTab={(id) => {
          navigateTab(id as StudentTabId);
        }}
        onSignOut={onSignOut}
      />

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        {platformConfig.maintenanceBanner.trim().length > 0 && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/35 px-4 py-3 text-xs text-amber-950 dark:text-amber-100"
          >
            <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
            <p className="font-medium leading-relaxed">{platformConfig.maintenanceBanner}</p>
          </div>
        )}
        {/* Welcome, Rank Badge, Live & Lifetime Stats Strip */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              {student.avatarDataUrl ? (
                <img
                  src={student.avatarDataUrl}
                  alt={student.displayName}
                  className="h-14 w-14 rounded-full object-cover border-2 border-blue-200 dark:border-blue-800 shrink-0 shadow-xs"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-blue-200 dark:border-blue-800 bg-blue-100 dark:bg-blue-950/60 font-display text-xl font-bold text-blue-800 dark:text-blue-200"
                >
                  {(student.displayName || 'A').trim().charAt(0).toUpperCase()}
                </div>
              )}
              <div className="space-y-1.5 min-w-0">
                <RankBadge tier={rankTier} variant="hero" />
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  VIP Slot #{student.slotNumber} · Target: {student.targetPost} (Tier-I Cut-Off {resolvedDreamPost.tier1Cutoff}/200)
                  {student.targetYear ? ` · ${student.targetYear}` : ''}
                  {student.city ? ` · ${student.city}` : ''}
                </p>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white [text-wrap:balance]">
                  {formatWelcomeTitle(student.targetPost, student.displayName)}
                </h1>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  XP Rule (&gt;80% solved): +{scoringConfig.xpAttemptBase} base · +{scoringConfig.xpPerCorrect}{' '}
                  XP/correct · +{scoringConfig.xpAccuracyBonus} bonus at &ge;
                  {scoringConfig.xpAccuracyThreshold}% accuracy
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {onOpenDestSimulator && (
                <button
                  type="button"
                  onClick={onOpenDestSimulator}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3.5 py-2 text-xs font-semibold text-blue-900 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  <Keyboard className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                  <span>DEST &amp; Computer</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCustomMockBuilder(true)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 px-4 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Custom Mock Builder</span>
              </button>
              <button
                type="button"
                onClick={() => setShowFormulaBooster(true)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#18202c] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <BookOpen className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <span>Formula Sheet</span>
              </button>
              <button
                type="button"
                onClick={() => setShowEditProfileModal(true)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#18202c] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <UserCog className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <span>Edit Profile</span>
              </button>
              {onReturnToAdmin && (
                <button
                  type="button"
                  onClick={onReturnToAdmin}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-200 px-3.5 py-2 text-xs font-semibold text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Back to Admin Center</span>
                </button>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-200 dark:border-slate-800 pt-5 sm:grid-cols-5">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Cohort Rank</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {myRankIndex >= 0 ? `#${myRankIndex + 1} / ${ranked.length}` : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Total XP</div>
              <motion.div
                key={myLb?.totalXp ?? 0}
                initial={{ scale: 1.08 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.35 }}
                className="mt-1 font-mono text-2xl font-bold text-blue-700 dark:text-blue-400 tabular-nums"
              >
                {myLb?.totalXp ?? 0} XP
              </motion.div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Average Accuracy</div>
              <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                {myLb?.avgAccuracy ?? 0}%
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Study Time</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatSeconds(activitySummary.totalStudySec)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Reward Rate</div>
              <button
                type="button"
                onClick={() => navigateTab('progress')}
                className="mt-1 text-left font-mono text-xl font-bold text-blue-700 dark:text-blue-400 hover:underline tabular-nums cursor-pointer"
              >
                {activitySummary.rewardMultiplier.toFixed(2)}x · {activitySummary.tierLabel}
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4 sm:grid-cols-4">
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Lifetime Mocks Completed</div>
              <div className="mt-0.5 font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {lifetimeStats.mocksCompleted}{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  ({lifetimeStats.totalSubmissions} submitted)
                </span>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Lifetime Qs Attempted</div>
              <div className="mt-0.5 font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {lifetimeStats.questionsAttempted}{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  / {lifetimeStats.questionsFaced} faced
                </span>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Lifetime Correct</div>
              <div className="mt-0.5 font-mono text-base font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                {lifetimeStats.correctCount} Qs
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Lifetime Wrong (+Missed)
              </div>
              <div className="mt-0.5 font-mono text-base font-bold text-red-700 dark:text-red-400 tabular-nums">
                {lifetimeStats.wrongIncludingMissedCount}{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  ({lifetimeStats.wrongAttemptedCount} wrong · {lifetimeStats.missedCount} missed)
                </span>
              </div>
            </div>
          </div>
        </section>

        {activeTab === 'pending' && (
          <PendingTestsPanel
            tests={tests}
            attempts={attempts}
            testDrafts={testDrafts}
            revisionItems={revisionItems}
            onBack={handleBackFromSubView}
            onResumeDraft={onStartTest}
            onResumeIncompleteAttempt={(test, attemptId) => {
              if (onResumeIncompleteAttempt) {
                onResumeIncompleteAttempt(test, attemptId);
              } else {
                onStartTest(test);
              }
            }}
            onOpenVault={() => navigateTab('vault')}
          />
        )}

        {activeTab === 'profile' && (
          <StudentProfilePanel
            student={student}
            backupDoc={backupDoc}
            onProfileUpdated={(updated) => onProfileUpdated?.(updated)}
            onPrintReport={() => setShowPrintReport(true)}
            onBack={handleBackFromSubView}
          />
        )}

        {activeTab === 'completed' && (
          <CompletedTestsPanel
            uid={student.uid}
            loginId={student.loginId}
            studentName={student.displayName}
            targetPost={student.targetPost}
            attempts={attempts}
            tests={tests}
            revisionItems={revisionItems}
            scoringConfig={scoringConfig}
            onBack={handleBackFromSubView}
            onLaunchRevisionTest={onStartTest}
          />
        )}

        {activeTab === 'progress' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleBackFromSubView}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Mocks &amp; Tasks</span>
              </button>
            </div>
            <ProgressChartPanel
              studentName={student.displayName}
              summary={activitySummary}
              attempts={attempts}
              sessionLogs={sessionLogs}
              revisionItems={revisionItems}
              totalXp={myLb?.totalXp ?? 0}
              cohortEntries={leaderboard}
              liveSessionOverride={liveSessionOverride}
              showAttendanceTable={true}
              onPrintReport={() => setShowPrintReport(true)}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
              <button
                type="button"
                onClick={handleBackFromSubView}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Mocks &amp; Tasks</span>
              </button>
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Top</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'leaderboard' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleBackFromSubView}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Mocks &amp; Tasks</span>
              </button>
            </div>
            <LeaderboardPanel
              entries={leaderboard}
              currentUid={student.uid}
              recentLedger={xpLedger}
              sessionLogs={sessionLogs}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
              <button
                type="button"
                onClick={handleBackFromSubView}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Mocks &amp; Tasks</span>
              </button>
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Top</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'vault' && (
          <RevisionVault
            uid={student.uid}
            loginId={student.loginId}
            studentName={student.displayName}
            items={revisionItems}
            attempts={attempts}
            tests={tests}
            scoringConfig={scoringConfig}
            launchingTest={pracBusy}
            onBack={handleBackFromSubView}
            onLaunchVaultTest={handleLaunchVaultTest}
            onLaunchAdaptiveMiniMock={onStartTest}
          />
        )}

        {activeTab === 'overview' && (
          <div className="space-y-6">
            <AspirantCoachCard
              coach={aspirantCoach}
              dailyGoalValue={dailyGoal}
              onChangeDailyGoal={handleChangeDailyGoal}
              onQuickFocusDrill={handleQuickFocusDrill}
              onOpenFormulaBooster={() => setShowFormulaBooster(true)}
              pracBusy={pracBusy}
            />

            {/* Tier-I / Tier-II Dynamic Exam Toggle + Compact Smart Topic Filter */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Feature 2: Tier-I / Tier-II Dynamic Exam Engine Toggle */}
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-6 space-y-4 lg:col-span-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                      SSC CGL Exam Engine
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Official 100-question 4-section timed simulator
                    </p>
                  </div>
                  <div
                    role="group"
                    aria-label="Tier-I or Tier-II Exam Mode Toggle"
                    className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0f141d] p-1"
                  >
                    <button
                      type="button"
                      aria-pressed={selectedTier === 'tier1'}
                      onClick={() => setSelectedTier('tier1')}
                      className={`rounded-md px-3.5 py-1.5 text-xs font-bold cursor-pointer transition-colors ${
                        selectedTier === 'tier1'
                          ? 'bg-blue-700 text-white'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      Tier-I
                    </button>
                    <button
                      type="button"
                      aria-pressed={selectedTier === 'tier2'}
                      onClick={() => {
                        setSelectedTier('tier2');
                        setTier1Error(null);
                      }}
                      className={`rounded-md px-3.5 py-1.5 text-xs font-bold cursor-pointer transition-colors ${
                        selectedTier === 'tier2'
                          ? 'bg-emerald-700 text-white'
                          : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Tier-II · Mains
                    </button>
                  </div>
                </div>

                {tier1Error && (
                  <p className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-900 dark:text-red-200">
                    {tier1Error}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 text-xs">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f141d] px-3 py-2">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Questions</div>
                    <div className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                      {selectedTier === 'tier2' ? '100 Qs (Weighted)' : '100 Qs (25×4)'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f141d] px-3 py-2">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Total Timer</div>
                    <div className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                      {selectedTier === 'tier2' ? '80 Minutes' : '60 Minutes'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f141d] px-3 py-2">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Section Lock</div>
                    <div className="font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                      {selectedTier === 'tier2' ? '20m / Section' : '15m / Section'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f141d] px-3 py-2">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Marking</div>
                    <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {selectedTier === 'tier2' ? '+3.0 / -1.00' : '+2.0 / -0.50'}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {selectedTier === 'tier2'
                      ? 'Order: Quant (25) → Reasoning (25) → English (30) → GA (20)'
                      : 'Order: Reasoning → General Awareness → Quant → English'}
                  </span>
                  <button
                    type="button"
                    disabled={tier1Busy}
                    onClick={handleLaunchTier1Mock}
                    className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer transition-colors ${
                      selectedTier === 'tier2'
                        ? 'bg-emerald-700 hover:bg-emerald-800'
                        : 'bg-blue-700 hover:bg-blue-800'
                    }`}
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {tier1Busy
                        ? 'Loading 100 Qs...'
                        : selectedTier === 'tier2'
                          ? 'Start Tier-II Full Mock'
                          : 'Start Tier-I Full Mock'}
                    </span>
                  </button>
                </div>
              </section>

              {/* Feature 3: Compact Smart Topic Filter & PYQ+Gemini Dynamic Generator */}
              <section
                ref={smartTopicSectionRef}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-6 space-y-4 lg:col-span-6 scroll-mt-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white inline-flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                      <span>Smart Topic Filter</span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Choose any official SSC CGL syllabus chapter to launch a bilingual practice test with detailed explanations.
                    </p>
                  </div>
                </div>

                {smartTopicError && (
                  <p className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-900 dark:text-red-200">
                    {smartTopicError}
                  </p>
                )}

                <form onSubmit={handleLaunchSmartTopicTest} className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end">
                  <div className="sm:col-span-5">
                    <label
                      htmlFor="smart-topic-dropdown-trigger"
                      className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400"
                    >
                      Syllabus Topic
                    </label>
                    <div className="mt-1">
                      <SyllabusTopicDropdown
                        value={smartTopicSelection}
                        onChange={setSmartTopicSelection}
                        syllabusMastery={syllabusMastery}
                        disabled={smartTopicBusy}
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-3">
                    <label
                      htmlFor="smart-topic-count"
                      className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400"
                    >
                      Number of Questions
                    </label>
                    <input
                      id="smart-topic-count"
                      type="number"
                      min={1}
                      max={50}
                      value={smartTopicCount}
                      onChange={(e) => setSmartTopicCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#11151d] px-3 py-2 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label
                      htmlFor="smart-topic-time"
                      className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400"
                    >
                      Time Limit (min)
                    </label>
                    <input
                      id="smart-topic-time"
                      type="number"
                      min={1}
                      max={180}
                      value={smartTopicTime}
                      onChange={(e) => setSmartTopicTime(Math.max(1, Math.min(180, Number(e.target.value) || 1)))}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#11151d] px-3 py-2 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums"
                    />
                  </div>

                  <div className="sm:col-span-12 pt-1">
                    <button
                      type="submit"
                      disabled={smartTopicBusy}
                      className="w-full inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-slate-900 dark:bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-600 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{smartTopicBusy ? 'Preparing Custom Test...' : 'Start Custom Test'}</span>
                    </button>
                  </div>
                </form>
              </section>
            </div>

            {/* Feature 4: Dream Post Target, Inspector Checklist & Micro-Syllabus Map */}
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-6 space-y-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white inline-flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                    <span>Dream Post &amp; Micro-Syllabus Map</span>
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Benchmark every mock score against your post cut-off. Score &gt;80% on any topic test to turn its block green.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <label
                      htmlFor="dream-post-select"
                      className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400"
                    >
                      Target Post
                    </label>
                    <select
                      id="dream-post-select"
                      value={student.targetPost}
                      disabled={gamificationSaving}
                      onChange={(e) => void handleTargetPostChange(e.target.value)}
                      className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#11151d] px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100"
                    >
                      {!DREAM_POST_CATALOG.some((p) => p.label === student.targetPost) && (
                        <option value={student.targetPost}>{student.targetPost}</option>
                      )}
                      {DREAM_POST_CATALOG.map((post) => (
                        <option key={post.id} value={post.label}>
                          {post.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3.5 py-2 text-xs">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                      Tier-I UR Benchmark Cut-Off
                    </div>
                    <div className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                      {resolvedDreamPost.tier1Cutoff} / 200{' '}
                      <span className="font-sans text-[11px] font-normal text-slate-500 dark:text-slate-400">
                        · {resolvedDreamPost.ministry}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {resolvedDreamPost.isInspector && resolvedDreamPost.physicalStandards && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/20 p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200">
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      <span>Physical Standards Checklist ({resolvedDreamPost.label})</span>
                    </span>
                    <span className="text-[11px] text-amber-800 dark:text-amber-300">
                      Manual readiness self-verification
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs">
                    {(
                      [
                        { key: 'height', label: 'Height', desc: resolvedDreamPost.physicalStandards.height },
                        { key: 'walking', label: 'Walking', desc: resolvedDreamPost.physicalStandards.walking },
                        { key: 'cycling', label: 'Cycling', desc: resolvedDreamPost.physicalStandards.cycling },
                      ] as const
                    ).map((item) => {
                      const checked = Boolean(student.physicalChecklist?.[item.key]);
                      return (
                        <label
                          key={item.key}
                          className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                            checked
                              ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-100'
                              : 'border-amber-200 dark:border-amber-800/60 bg-[#faf9f6] dark:bg-[#11151d] text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => void handleTogglePhysicalItem(item.key)}
                            className="mt-0.5 accent-emerald-600"
                          />
                          <div>
                            <div className="font-semibold">{item.label}</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">{item.desc}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Visual Micro-Syllabus Map */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Click any chapter block to pre-fill Smart Topic Filter
                  </span>
                  <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {masteredChapterCount} / {MICRO_SYLLABUS_CHAPTERS.length} Mastered (&gt;80%)
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {(['quant', 'reasoning', 'english', 'ga'] as const).map((sub) => {
                    const chapters = MICRO_SYLLABUS_CHAPTERS.filter((c) => c.subject === sub);
                    return (
                      <div
                        key={sub}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0f141d] p-3.5 space-y-2.5"
                      >
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {SUBJECT_LABELS[sub].en}
                        </div>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {chapters.map((ch) => {
                            const entry = syllabusMastery[ch.slug];
                            const isMastered = Boolean(entry?.mastered);
                            return (
                              <button
                                key={ch.slug}
                                type="button"
                                onClick={() => {
                                  setSmartTopicSelection({
                                    slug: ch.slug,
                                    title: ch.title,
                                    subject: ch.subject,
                                  });
                                  smartTopicSectionRef.current?.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'center',
                                  });
                                }}
                                title={
                                  entry
                                    ? `${ch.title}: Best ${entry.bestAccuracy}% (${entry.attempts} test${entry.attempts > 1 ? 's' : ''})`
                                    : `Practice ${ch.title} (>80% to turn green)`
                                }
                                className={`flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-2 text-left text-[11px] font-semibold transition-colors cursor-pointer ${
                                  isMastered
                                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/45 text-emerald-900 dark:text-emerald-200'
                                    : 'border-slate-200 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#131924] text-slate-700 dark:text-slate-300 hover:border-blue-400'
                                }`}
                              >
                                <span className="truncate">{ch.title}</span>
                                {isMastered ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                                ) : entry ? (
                                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                                    {Math.round(entry.bestAccuracy)}%
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Auto Daily Mock + Revision Re-Test + Smart Adaptive Practice Bar */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Today's Auto Daily Live Mock */}
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-6 space-y-4 lg:col-span-5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-blue-700 dark:text-blue-400">
                    <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                    <span>Auto Daily Mock</span>
                  </span>
                  {todayDailyTest && (
                    <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      {todayDailyTest.questionCount} Qs · {todayDailyTest.durationMinutes}m
                    </span>
                  )}
                </div>

                {dailySyncing && !todayDailyTest && !todayDailyTestCompleted ? (
                  <div className="py-2 text-xs text-slate-600 dark:text-slate-400">
                    Generating today&apos;s fresh bilingual SSC CGL Daily Mock automatically...
                  </div>
                ) : todayDailyTest ? (
                  <>
                    <div>
                      <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                        {todayDailyTest.title}
                      </h2>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        Fresh daily blend across Quant, Reasoning, English &amp; GA plus priority revision topics.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => onStartTest(todayDailyTest)}
                        className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 hover:bg-blue-800 px-4 py-2 text-xs font-semibold text-white whitespace-nowrap cursor-pointer transition-colors"
                      >
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {draftByTestId.has(todayDailyTest.id)
                            ? `Resume Daily Mock (Q${draftByTestId.get(todayDailyTest.id)!.currentIdx + 1})`
                            : "Attempt Today's Daily Mock"}
                        </span>
                      </button>
                      {pendingVaultCount > 0 && (
                        <button
                          type="button"
                          disabled={pracBusy}
                          onClick={() =>
                            handleLaunchVaultTest({ subjectScope: 'full', includeMastered: false })
                          }
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 whitespace-nowrap cursor-pointer transition-colors"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Re-Test {pendingVaultCount} Vault Mistakes</span>
                        </button>
                      )}
                      {todayDailySectionals.length > 0 && (
                        <div className="w-full pt-3 border-t border-slate-200 dark:border-slate-800">
                          <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                            Daily Sectional Sprints
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {todayDailySectionals.map((sec) => (
                              <button
                                key={sec.id}
                                type="button"
                                onClick={() => onStartTest(sec)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#18202c] px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-blue-400 hover:text-blue-700 dark:hover:text-blue-400 cursor-pointer transition-colors"
                              >
                                <Play className="h-3 w-3 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                                <span>{SUBJECT_LABELS[sec.subjectScope as SubjectKey]?.short ?? sec.subjectScope} ({sec.questionCount}Q)</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : todayDailyTestCompleted ? (
                  <div className="space-y-3">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      <span>Today&apos;s Daily Live Mock archived</span>
                    </div>
                    {todayDailySectionals.length > 0 && (
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                        <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                          Remaining Daily Sectional Sprints
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {todayDailySectionals.map((sec) => (
                            <button
                              key={sec.id}
                              type="button"
                              onClick={() => onStartTest(sec)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#18202c] px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-blue-400 cursor-pointer transition-colors"
                            >
                              <Play className="h-3 w-3 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                              <span>{SUBJECT_LABELS[sec.subjectScope as SubjectKey]?.short ?? sec.subjectScope} ({sec.questionCount}Q)</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => navigateTab('completed')}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#18202c] px-3.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                    >
                      <span>Review Solutions in Completed ({completedGroupsCount})</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Ready to generate today&apos;s fresh Daily Live Mock &amp; 4 Sectional Sprints from AI + Question Bank.
                    </p>
                    <button
                      type="button"
                      disabled={pracBusy}
                      onClick={async () => {
                        setPracBusy(true);
                        try {
                          await ensureDailyAutomationSuite({ scoringConfig, revisionItems });
                        } finally {
                          setPracBusy(false);
                        }
                      }}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 hover:bg-blue-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{pracBusy ? 'Creating Daily Suite...' : "Create Today's Daily Mock & Sectionals"}</span>
                    </button>
                  </div>
                )}
              </section>

              {/* Unlimited Adaptive Practice Studio */}
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-6 space-y-4 lg:col-span-7">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white inline-flex items-center gap-2">
                      <Zap className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                      <span>Smart Adaptive Practice Studio</span>
                    </h2>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Builds an instant TCS iON drill combining unseen bank items and your Revision Vault weak spots.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCustomMockBuilder(true)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#18202c] px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer transition-colors"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                    <span>Custom Mock Builder</span>
                  </button>
                </div>

                {pracError && (
                  <p className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-900 dark:text-red-200">
                    {pracError}
                  </p>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end">
                  <div className="sm:col-span-4">
                    <label htmlFor="prac-scope" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                      Section Focus
                    </label>
                    <select
                      id="prac-scope"
                      value={pracScope}
                      onChange={(e) => setPracScope(e.target.value as 'full' | SubjectKey)}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#11151d] px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                    >
                      <option value="full">Mixed SSC CGL (All 4)</option>
                      <option value="quant">Quantitative Aptitude</option>
                      <option value="reasoning">General Intelligence</option>
                      <option value="english">English Comprehension</option>
                      <option value="ga">General Awareness</option>
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <label htmlFor="prac-count" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                      Questions
                    </label>
                    <select
                      id="prac-count"
                      value={pracCount}
                      onChange={(e) => setPracCount(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#11151d] px-3 py-2 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100"
                    >
                      <option value={10}>10 Qs (10m)</option>
                      <option value={15}>15 Qs (15m)</option>
                      <option value={25}>25 Qs (25m)</option>
                      <option value={40}>40 Qs (40m)</option>
                    </select>
                  </div>

                  <div className="sm:col-span-5">
                    <button
                      type="button"
                      disabled={pracBusy}
                      onClick={handleLaunchAdaptivePractice}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 dark:bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-600 disabled:opacity-50 cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                      <span>{pracBusy ? 'Preparing Practice Set...' : 'Generate & Launch Practice'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-700 dark:text-slate-300">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeVaultInPrac}
                      onChange={(e) => setIncludeVaultInPrac(e.target.checked)}
                      className="accent-blue-700"
                    />
                    <span>Include Revision Vault (wrong &amp; skipped · {pendingVaultCount} pending)</span>
                  </label>
                  <label
                    className={`inline-flex items-center gap-1.5 ${
                      platformConfig.aiTutorEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={!platformConfig.aiTutorEnabled}
                      checked={platformConfig.aiTutorEnabled ? includeAiFresh : false}
                      onChange={(e) => setIncludeAiFresh(e.target.checked)}
                      className="accent-blue-700"
                    />
                    <span>
                      {platformConfig.aiTutorEnabled
                        ? 'Generate brand-new AI questions (+5–8s)'
                        : 'AI question generation paused by Admin'}
                    </span>
                  </label>
                </div>
              </section>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* Available Mock Tests OR Active Mission Qualifying Tests */}
            <section ref={missionPanelRef} className="space-y-4 lg:col-span-7 scroll-mt-6">
              {selectedMissionTask ? (
                (() => {
                  const mProg = computeTaskProgress(selectedMissionTask, attempts);
                  const mClaimed = claimedTaskIds.has(selectedMissionTask.id);
                  const scaledBonusXp = applyActivityMultiplier(
                    selectedMissionTask.bonusXp,
                    activitySummary.rewardMultiplier
                  );
                  const remaining = Math.max(0, mProg.targetCount - mProg.completedCount);
                  const subjectName =
                    selectedMissionTask.targetSubject === 'all'
                      ? 'any SSC CGL Mock or Sectional'
                      : SUBJECT_LABELS[selectedMissionTask.targetSubject].en;

                  return (
                    <div className="rounded-2xl border-2 border-blue-600 bg-[#faf9f6] dark:bg-[#181d27] p-5 shadow-xs space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedMissionTaskId(null)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1e2431] px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>All Tests ({tests.length})</span>
                        </button>
                        <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                          Mission Reward: +{scaledBonusXp} Bonus XP
                          {scaledBonusXp !== selectedMissionTask.bonusXp
                            ? ` (Base ${selectedMissionTask.bonusXp} × ${activitySummary.rewardMultiplier.toFixed(2)}x)`
                            : ''}
                        </span>
                      </div>

                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                          Active Mission Briefing
                        </p>
                        <h2 className="mt-0.5 font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                          {selectedMissionTask.title}
                        </h2>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          {selectedMissionTask.description}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] p-3.5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            Qualifying Rule: Answer &gt;80% on {mProg.targetCount} unique published/daily test(s) covering{' '}
                            <span className="text-blue-700 dark:text-blue-400">{subjectName}</span>
                          </span>
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                            {mProg.completedCount} / {mProg.targetCount} done
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full bg-blue-700 transition-all"
                            style={{ width: `${mProg.percent}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <span className="text-xs text-slate-600">
                            {mClaimed
                              ? `Reward Claimed (+${scaledBonusXp} XP tier)`
                              : mProg.isExpired
                                ? `Mission expired on ${selectedMissionTask.dueDate}.`
                                : mProg.isEligible
                                  ? 'Mission complete! Scratch your card to claim Bonus XP.'
                                  : `${remaining} more unique qualifying test${remaining > 1 ? 's' : ''} needed below to unlock Scratch Card`}
                          </span>
                          {!mClaimed && !mProg.isExpired && mProg.isEligible && (
                            <button
                              type="button"
                              onClick={() => {
                                setClaimMsg(null);
                                setScratchTask(selectedMissionTask);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 cursor-pointer"
                            >
                              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Scratch &amp; Claim +{scaledBonusXp} XP</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                      Live Mock &amp; Sectional Tests
                    </h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={offlineCacheBusy || tests.length === 0}
                        onClick={() => void handleCacheAllOffline()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#18202c] px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                      >
                        <HardDriveDownload className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        <span>
                          {offlineCacheBusy
                            ? 'Caching Offline...'
                            : offlineSummary.cachedPacksCount > 0
                              ? `Offline Ready (${offlineSummary.cachedPacksCount} packs)`
                              : 'Cache Mocks Offline'}
                        </span>
                      </button>
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {filteredTests.length} pending · {completedGroupsCount} completed
                      </span>
                    </div>
                  </div>
                  {offlineCacheMsg && (
                    <p className="rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
                      {offlineCacheMsg}
                    </p>
                  )}

                  {activeAvailableTests.length > 0 && (
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter mock tests by subject">
                      {(
                        [
                          { id: 'all', label: `All (${activeAvailableTests.length})` },
                          { id: 'full', label: `Full / Tier-I & II (${activeAvailableTests.filter((t) => t.subjectScope === 'full').length})` },
                          { id: 'quant', label: `Quant (${activeAvailableTests.filter((t) => t.subjectScope === 'quant').length})` },
                          { id: 'reasoning', label: `Reasoning (${activeAvailableTests.filter((t) => t.subjectScope === 'reasoning').length})` },
                          { id: 'english', label: `English (${activeAvailableTests.filter((t) => t.subjectScope === 'english').length})` },
                          { id: 'ga', label: `GA / GS (${activeAvailableTests.filter((t) => t.subjectScope === 'ga').length})` },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setTestScopeFilter(opt.id)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                            testScopeFilter === opt.id
                              ? 'bg-blue-700 text-white'
                              : 'border border-slate-200 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {selectedMissionTask && (
                <div className="flex items-center justify-between pt-1">
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Qualifying Tests for This Mission ({filteredTests.length})
                  </h3>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Direct subject drills listed first
                  </span>
                </div>
              )}

              {filteredTests.length === 0 ? (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-8 text-center space-y-3">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {tests.length === 0
                      ? 'No mock tests published yet.'
                      : activeAvailableTests.length === 0
                        ? 'All published mock tests completed!'
                        : selectedMissionTask
                          ? 'No remaining uncompleted tests match this mission subject.'
                          : 'No tests match this subject filter.'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {tests.length === 0
                      ? 'New SSC CGL mock tests will appear here as soon as they are published.'
                      : activeAvailableTests.length === 0
                        ? 'Review solutions or build a revision test inside the Completed Archive tab.'
                        : selectedMissionTask
                          ? 'Check Completed Archive to review solved mocks or switch back to All Tests.'
                          : 'Select "All" above to view all pending SSC CGL mocks.'}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {(selectedMissionTask || testScopeFilter !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMissionTaskId(null);
                          setTestScopeFilter('all');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#18202c] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Back to All Tests</span>
                      </button>
                    )}
                    {completedGroupsCount > 0 && (
                      <button
                        type="button"
                        onClick={() => navigateTab('completed')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
                      >
                        <span>View Completed Archive ({completedGroupsCount})</span>
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] overflow-hidden">
                  {filteredTests.map((test) => {
                    const pastAttempts = attempts.filter((a) => a.testId === test.id);
                    const draft = draftByTestId.get(test.id);
                    const incompleteAttId = !draft ? incompleteAttemptByTestId.get(test.id) : undefined;
                    const scopeLabel =
                      test.subjectScope === 'full'
                        ? 'Full SSC CGL Tier-I'
                        : SUBJECT_LABELS[test.subjectScope].en;

                    const statusLabel = draft
                      ? `Paused at Q${draft.currentIdx + 1}/${test.questionCount}`
                      : incompleteAttId
                        ? 'Pending (<=80%)'
                        : isDailyMockTest(test.id)
                          ? 'Daily Mock'
                          : isDailySectionalTest(test.id)
                            ? 'Daily Sectional'
                            : selectedMissionTask
                              ? 'Mission Qualifier'
                              : null;

                    return (
                      <article
                        key={test.id}
                        className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/70 dark:hover:bg-[#171f2c] transition-colors"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                              {test.title}
                            </h3>
                            {statusLabel && (
                              <>
                                <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
                                  ·
                                </span>
                                <span
                                  className={`font-semibold ${
                                    incompleteAttId
                                      ? 'text-amber-700 dark:text-amber-400'
                                      : 'text-blue-700 dark:text-blue-400'
                                  }`}
                                >
                                  {statusLabel}
                                </span>
                              </>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                            {scopeLabel} · {test.questionCount} Qs · {test.durationMinutes} min · +{test.positiveMarks} / -{test.negativeMarks}
                            {draft
                              ? ` · ${draft.answeredCount}/${test.questionCount} answered (${formatSeconds(draft.secondsLeft)} left)`
                              : pastAttempts.length > 0
                                ? ` · Attempted ${pastAttempts.length}x`
                                : ''}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (incompleteAttId && onResumeIncompleteAttempt) {
                              onResumeIncompleteAttempt(test, incompleteAttId);
                            } else {
                              onStartTest(test);
                            }
                          }}
                          className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                            incompleteAttId
                              ? 'bg-amber-600 hover:bg-amber-700'
                              : 'bg-blue-700 hover:bg-blue-800'
                          }`}
                        >
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            {draft
                              ? 'Resume Test'
                              : incompleteAttId
                                ? 'Resume & Complete'
                                : selectedMissionTask
                                  ? 'Start Mission Test'
                                  : 'Launch TCS iON Test'}
                          </span>
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}

              {/* Attempt History */}
              <div className="pt-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                    Recent Test Submissions
                  </h2>
                  <button
                    type="button"
                    onClick={() => navigateTab('vault')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#18202c] px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    <span>Open Revision Vault &amp; Review Mode</span>
                  </button>
                </div>
                {attempts.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    Complete your first mock test to record live score, section timings, and XP.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924]">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                          <th className="px-4 py-3 font-semibold">Test</th>
                          <th className="px-4 py-3 text-right font-semibold">Score &amp; Cut-Off</th>
                          <th className="px-4 py-3 text-right font-semibold">Accuracy</th>
                          <th className="px-4 py-3 text-right font-semibold">Time</th>
                          <th className="px-4 py-3 text-right font-semibold">XP</th>
                          <th className="px-4 py-3 text-right font-semibold">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {attempts.slice(0, 8).map((att) => {
                          const complete = isAttemptComplete(att);
                          const statusText = getAttemptStatusLabel(att);
                          const pct = getAttemptCompletionPercent(att);
                          const cutoff = computeTargetCutoffBenchmark(
                            student.targetPost,
                            att.score,
                            att.maxScore
                          );
                          const matchingTest = tests.find((t) => t.id === att.testId);
                          return (
                            <tr key={att.id} className="hover:bg-slate-100/70 dark:hover:bg-[#171f2c]">
                              <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                                <div>{att.testTitle}</div>
                                <div className="mt-0.5 text-[11px]">
                                  {!complete ? (
                                    <span className="font-semibold text-amber-700 dark:text-amber-400">
                                      Pending (&le;80% · {pct}% solved · 0 XP)
                                    </span>
                                  ) : att.skippedCount > 0 ? (
                                    <span className="font-semibold text-amber-700 dark:text-amber-400">
                                      {statusText} · {att.skippedCount} in Vault
                                    </span>
                                  ) : att.xpEarned === 0 ? (
                                    <span className="font-medium text-slate-500 dark:text-slate-400">
                                      Practice Replay
                                    </span>
                                  ) : (
                                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                      {statusText}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums">
                                <div className="font-semibold text-slate-900 dark:text-slate-100">
                                  {att.score} / {att.maxScore}
                                </div>
                                <div
                                  className={`text-[10px] font-semibold ${
                                    cutoff.isAboveCutoff
                                      ? 'text-emerald-700 dark:text-emerald-400'
                                      : 'text-amber-700 dark:text-amber-400'
                                  }`}
                                >
                                  {cutoff.isAboveCutoff ? `+${cutoff.deltaMarks}` : cutoff.deltaMarks} vs {cutoff.postLabel} ({cutoff.scaledCutoff})
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">
                                {att.accuracy}%
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-3 w-3" aria-hidden="true" />
                                  {formatSeconds(att.totalTimeSec)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                                +{att.xpEarned}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                {!complete ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (matchingTest) {
                                        if (onResumeIncompleteAttempt) {
                                          onResumeIncompleteAttempt(matchingTest, att.id);
                                        } else {
                                          onStartTest(matchingTest);
                                        }
                                      } else {
                                        navigateTab('pending');
                                      }
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg bg-amber-600 hover:bg-amber-700 px-2.5 py-1.5 text-[11px] font-semibold text-white whitespace-nowrap cursor-pointer"
                                  >
                                    <Play className="h-3 w-3" aria-hidden="true" />
                                    <span>Resume &amp; Complete</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => navigateTab('vault')}
                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#18202c] px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
                                  >
                                    <span>Review</span>
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            {/* Right Column: Tasks + Mini Leaderboard */}
            <aside className="space-y-6 lg:col-span-5">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                    Active Cohort Tasks
                  </h2>
                  <Target className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                </div>

                {claimMsg && (
                  <p className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-2.5 text-xs font-medium text-emerald-900 dark:text-emerald-200">
                    {claimMsg}
                  </p>
                )}

                {openActiveTasks.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    All active missions completed or awaiting tomorrow&apos;s fresh daily sprint!
                  </p>
                ) : (
                  <div className="space-y-3">
                    {openActiveTasks.map((task) => {
                      const prog = computeTaskProgress(task, attempts);
                      const isMissionOpen = selectedMissionTask?.id === task.id;
                      const qualifyingCount = getQualifyingTestsForTask(
                        task,
                        activeAvailableTests
                      ).length;
                      const scaledBonusXp = applyActivityMultiplier(
                        task.bonusXp,
                        activitySummary.rewardMultiplier
                      );
                      return (
                        <div
                          key={task.id}
                          className={`rounded-lg border p-3.5 space-y-2 transition-colors ${
                            isMissionOpen
                              ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 ring-1 ring-blue-600'
                              : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] hover:border-blue-300 dark:hover:border-blue-700'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenMission(task)}
                            className="w-full text-left space-y-2 cursor-pointer"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {task.title}
                                </div>
                                <div className="text-xs text-slate-600 dark:text-slate-400">
                                  {task.description}
                                </div>
                              </div>
                              <span
                                title={`Base ${task.bonusXp} XP × ${activitySummary.rewardMultiplier.toFixed(2)}x (${activitySummary.tierLabel})`}
                                className="font-mono text-xs font-bold text-blue-700 dark:text-blue-400 whitespace-nowrap tabular-nums"
                              >
                                +{scaledBonusXp} XP
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                              <span>
                                Progress: {prog.completedCount} / {prog.targetCount} unique tests
                              </span>
                              <span>Due: {task.dueDate}</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                              <div
                                className="h-full bg-blue-700 dark:bg-blue-500 transition-all"
                                style={{ width: `${prog.percent}%` }}
                              />
                            </div>

                            <div className="flex items-center justify-between pt-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                              <span>
                                {isMissionOpen
                                  ? `Showing ${qualifyingCount} qualifying test${qualifyingCount === 1 ? '' : 's'}`
                                  : `View ${qualifyingCount} qualifying test${qualifyingCount === 1 ? '' : 's'}`}
                              </span>
                              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                            </div>
                          </button>

                          {prog.isEligible && (
                            <button
                              type="button"
                              onClick={() => {
                                setClaimMsg(null);
                                setScratchTask(task);
                              }}
                              className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-xs hover:bg-amber-400 transition-colors cursor-pointer"
                            >
                              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Scratch &amp; Claim +{scaledBonusXp} XP</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {pastTasks.length > 0 && (
                  <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                    <button
                      type="button"
                      aria-expanded={showPastTasks}
                      onClick={() => setShowPastTasks((v) => !v)}
                      className="flex w-full items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                    >
                      <span>Completed &amp; Past Missions ({pastTasks.length})</span>
                      {showPastTasks ? (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                    {showPastTasks && (
                      <ul className="mt-2.5 space-y-2">
                        {pastTasks.map((pt) => {
                          const wasClaimed = claimedTaskIds.has(pt.id);
                          return (
                            <li
                              key={pt.id}
                              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-3 py-2 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-slate-800 dark:text-slate-200">
                                  {pt.title}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  Due: {pt.dueDate}
                                </div>
                              </div>
                              {wasClaimed ? (
                                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap shrink-0">
                                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Claimed</span>
                                </span>
                              ) : (
                                <span className="font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                                  Expired
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                    Top Cohort Standings
                  </h2>
                  <button
                    type="button"
                    onClick={() => navigateTab('leaderboard')}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    <Award className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Full Board</span>
                  </button>
                </div>

                {ranked.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Waiting for first cohort test submission.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    {ranked.map((r, i) => (
                      <li key={r.uid} className="flex items-center justify-between py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-xs font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                            #{i + 1}
                          </span>
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {r.displayName} {r.uid === student.uid ? '(You)' : ''}
                          </span>
                        </div>
                        <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                          {r.totalXp} XP
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
            </div>
          </div>
        )}
      </main>

      {rankPromotion && (
        <RankLevelUpOverlay
          fromTier={rankPromotion.from}
          toTier={rankPromotion.to}
          onDismiss={() => setRankPromotion(null)}
        />
      )}

      {scratchTask && (
        <ScratchRewardModal
          task={scratchTask}
          currentTotalXp={myLb?.totalXp ?? 0}
          activityMultiplier={activitySummary.rewardMultiplier}
          activityTierLabel={activitySummary.tierLabel}
          onClaimCommit={handleCommitScratchReward}
          onClose={() => setScratchTask(null)}
        />
      )}

      {showCustomMockBuilder && (
        <CustomMockBuilderModal
          uid={student.uid}
          scoringConfig={scoringConfig}
          onClose={() => setShowCustomMockBuilder(false)}
          onTestCreated={(createdTest) => {
            setShowCustomMockBuilder(false);
            onStartTest(createdTest);
          }}
        />
      )}

      {showFormulaBooster && (
        <StudyFormulaBoosterModal onClose={() => setShowFormulaBooster(false)} />
      )}

      {showEditProfileModal && (
        <EditProfileModal
          student={student}
          onProfileUpdated={(updated) => onProfileUpdated?.(updated)}
          onClose={() => setShowEditProfileModal(false)}
        />
      )}

      {showPrintReport && (
        <PrintableReportModal
          studentName={student.displayName}
          loginId={student.loginId}
          slotNumber={student.slotNumber}
          targetPost={student.targetPost}
          rank={myRankIndex >= 0 ? myRankIndex + 1 : null}
          totalCohortSize={ranked.length}
          totalXp={myLb?.totalXp ?? 0}
          avgAccuracy={myLb?.avgAccuracy ?? 0}
          summary={activitySummary}
          attempts={attempts}
          sessionLogs={sessionLogs}
          onClose={() => setShowPrintReport(false)}
        />
      )}

      <GlobalSearchModal
        open={showGlobalSearch}
        onClose={() => setShowGlobalSearch(false)}
        tests={tests}
        revisionItems={revisionItems}
        onSelectMock={(t) => onStartTest(t)}
        onSelectSyllabusTopic={(subject, title) => {
          const found = MICRO_SYLLABUS_CHAPTERS.find(
            (c) => c.subject === subject && c.title === title
          );
          setSmartTopicSelection({
            slug: found?.slug ?? '',
            title,
            subject,
          });
          setActiveTab('overview');
          window.setTimeout(() => {
            smartTopicSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 80);
        }}
        onOpenRevisionVault={() => navigateTab('vault')}
      />

      <PopupRewardQuizModal
        open={popupQuizOpen}
        questions={popupQuizQuestions}
        onClose={() => setPopupQuizOpen(false)}
        onClaimReward={async (res) => {
          const xp = await creditPopupQuizRewardXp({
            uid: student.uid,
            studentName: student.displayName,
            targetPost: student.targetPost,
            correctCount: res.correctCount,
            totalCount: res.totalCount,
            bonusXp: res.xpAwarded,
            currentLeaderboard: fallbackLeaderboardEntry,
          });
          if (xp > 0) {
            setClaimMsg(`Surprise Flash Quiz Reward: +${xp} Bonus XP added to your standings!`);
          }
        }}
      />
    </div>
  );
};

