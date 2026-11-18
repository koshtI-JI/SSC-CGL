import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Calculator,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Flag,
  Grid,
  Languages,
  Loader2,
  Lock,
  Maximize2,
  PenTool,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Target,
  Timer,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  createWrongTopicsRevisionTest,
  deleteTestDraft,
  fetchAttemptResponses,
  fetchQuestionsByIds,
  fetchTestDraft,
  saveTestDraft,
  submitTestAttempt,
} from '../lib/firestoreService';
import {
  SUBJECT_LABELS,
  type CameraState,
  type LanguageMode,
  type LeaderboardEntry,
  type MockTestDoc,
  type PaletteStatus,
  type QuestionDoc,
  type QuestionResponseState,
  type ScoringConfig,
  type SubjectKey,
} from '../types/exam';
import { computeTargetCutoffBenchmark, resolveDreamPost } from '../utils/dreamPostCatalog';
import {
  analyzeTestResultAnalytics,
  formatHumanAvgSeconds,
  formatSeconds,
  getMinQuestionsForXp,
  getPaletteStatus,
  type CalculatedTestOutcome,
} from '../utils/examEngine';
import {
  computeWallClockRemainingSeconds,
  createExamSessionId,
  resolveBilingualQuestionView,
} from '../utils/examTimer';
import {
  buildInitialSectionTimers,
  computeExamSectionRanges,
  TIER1_SECTION_DURATION_SEC,
  TIER1_SECTION_ORDER,
} from '../utils/tier1Engine';
import { formatMetadataBadge } from '../utils/questionSchema';
import {
  buildPostTestEncouragement,
  hasNativeHindiTranslation,
  normalizeTranslationBatchResponse,
  type TranslatedQuestionPayload,
} from '../utils/studyCoach';
import {
  aiPostMortemAnalysis,
  aiTranslateBatch,
  buildDeterministicPostMortem,
  type ExamPostMortemReport,
} from '../lib/aiClient';
import { ExamCalculator } from './ExamCalculator';
import { ExamRoughPadModal } from './ExamRoughPadModal';
import { QuestionTimeGraph } from './QuestionTimeGraph';
import { ReportQuestionModal } from './ReportQuestionModal';

interface TcsIonTestEngineProps {
  uid: string;
  loginId?: string;
  studentName: string;
  targetPost: string;
  test: MockTestDoc;
  scoringConfig: ScoringConfig;
  currentLeaderboard: LeaderboardEntry | null;
  activityMultiplier?: number;
  activityTierLabel?: string;
  priorIncompleteAttemptId?: string | null;
  flushDraftRef?: React.MutableRefObject<(() => void) | null>;
  proctorStream?: MediaStream | null;
  cameraState?: CameraState;
  cameraWarning?: string | null;
  onTestCompleted?: (questionsSolved: number, subjects: SubjectKey[], isComplete: boolean) => void;
  onTopicMasteryEvaluated?: (topicTag: string, scorePercent: number) => void;
  onActiveQuestionChange?: (questionIndex: number) => void;
  onLaunchRevisionTest?: (test: MockTestDoc) => void;
  defaultLang?: LanguageMode;
  onExit: () => void;
}

const PALETTE_STYLE: Record<
  PaletteStatus,
  { bg: string; label: string; shortCode: string }
> = {
  not_visited: {
    bg: 'border-slate-300 bg-slate-100 text-slate-700',
    label: 'Not Visited',
    shortCode: 'NV',
  },
  not_answered: {
    bg: 'border-red-400 bg-red-600 text-white rounded-b-xl',
    label: 'Not Answered',
    shortCode: 'NA',
  },
  answered: {
    bg: 'border-emerald-600 bg-emerald-600 text-white rounded-t-xl',
    label: 'Answered',
    shortCode: 'A',
  },
  marked: {
    bg: 'border-violet-700 bg-violet-700 text-white rounded-full',
    label: 'Marked for Review',
    shortCode: 'M',
  },
  answered_marked: {
    bg: 'border-violet-700 bg-violet-700 text-white rounded-full ring-2 ring-emerald-400',
    label: 'Answered & Marked',
    shortCode: 'AM',
  },
};

export const TcsIonTestEngine: React.FC<TcsIonTestEngineProps> = ({
  uid,
  loginId,
  studentName,
  targetPost,
  test,
  scoringConfig,
  currentLeaderboard,
  activityMultiplier = 1,
  activityTierLabel,
  priorIncompleteAttemptId = null,
  flushDraftRef,
  proctorStream = null,
  cameraState = 'off',
  cameraWarning = null,
  onTestCompleted,
  onTopicMasteryEvaluated,
  onActiveQuestionChange,
  onLaunchRevisionTest,
  defaultLang = 'en',
  onExit,
}) => {
  const isTier1Sectional = test.examMode === 'tier1_sectional';
  const configuredSectionDurationSec = test.sectionDurationSec ?? TIER1_SECTION_DURATION_SEC;

  const [questions, setQuestions] = useState<QuestionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [responses, setResponses] = useState<Record<string, QuestionResponseState>>({});
  const [secondsLeft, setSecondsLeft] = useState(test.durationMinutes * 60);
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [sectionSecondsLeft, setSectionSecondsLeft] = useState<Partial<Record<SubjectKey, number>>>(() => ({
    reasoning: configuredSectionDurationSec,
    ga: configuredSectionDurationSec,
    quant: configuredSectionDurationSec,
    english: configuredSectionDurationSec,
  }));
  const [sectionNotice, setSectionNotice] = useState<string | null>(null);
  const [showNextSectionModal, setShowNextSectionModal] = useState(false);
  const [showMobilePalette, setShowMobilePalette] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completedOutcome, setCompletedOutcome] = useState<CalculatedTestOutcome | null>(null);
  const [masteredVaultCount, setMasteredVaultCount] = useState(0);

  // Strict Mode (Full Mock anti-cheat enforcement)
  const isStrictMode = test.subjectScope === 'full' && !completedOutcome && !loading && !loadError && questions.length > 0;
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );
  const [strictViolations, setStrictViolations] = useState(0);
  const [strictWarning, setStrictWarning] = useState<string | null>(null);

  // Revision Test Launcher & Post-Mortem Diagnostics from Result Weakness Analyzer
  const [weakRevBusy, setWeakRevBusy] = useState(false);
  const [weakRevError, setWeakRevError] = useState<string | null>(null);
  const [postMortem, setPostMortem] = useState<ExamPostMortemReport | null>(null);
  const [postMortemBusy, setPostMortemBusy] = useState(false);
  const [reportQuestion, setReportQuestion] = useState<QuestionDoc | null>(null);

  // Exam Hall Helpers: Rough Pad, Desktop Calculator, Font Size & Live Hindi Translation Cache
  const [showRoughPad, setShowRoughPad] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [roughNotes, setRoughNotes] = useState('');
  const [fontScale, setFontScale] = useState<'sm' | 'md' | 'lg'>('md');
  const [lang, setLang] = useState<LanguageMode>(defaultLang);
  const [liveTranslations, setLiveTranslations] = useState<Record<string, TranslatedQuestionPayload>>({});
  const [translatingQIds, setTranslatingQIds] = useState<Record<string, boolean>>({});
  const requestedTransIdsRef = useRef<Set<string>>(new Set());
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);

  const draftKey = `getcgl_exam_draft_${uid}_${test.id}`;
  const legacyDraftKey = `sankalp_exam_draft_${uid}_${test.id}`;
  const [resumedDraftNotice, setResumedDraftNotice] = useState(false);

  const sectionOrder = useMemo<SubjectKey[]>(() => {
    if (test.sectionOrder && test.sectionOrder.length > 0) return test.sectionOrder;
    return isTier1Sectional ? [...TIER1_SECTION_ORDER] : ['quant', 'reasoning', 'english', 'ga'];
  }, [test.sectionOrder, isTier1Sectional]);

  const sectionRanges = useMemo(
    () => computeExamSectionRanges(questions, sectionOrder),
    [questions, sectionOrder]
  );
  const sectionRangesRef = useRef(sectionRanges);
  sectionRangesRef.current = sectionRanges;

  const currentIdxRef = useRef(0);
  currentIdxRef.current = currentIdx;
  const questionsRef = useRef<QuestionDoc[]>([]);
  questionsRef.current = questions;
  const responsesRef = useRef<Record<string, QuestionResponseState>>({});
  responsesRef.current = responses;
  const secondsLeftRef = useRef(secondsLeft);
  secondsLeftRef.current = secondsLeft;
  const activeSectionIdxRef = useRef(activeSectionIdx);
  activeSectionIdxRef.current = activeSectionIdx;
  const sectionSecondsLeftRef = useRef(sectionSecondsLeft);
  sectionSecondsLeftRef.current = sectionSecondsLeft;
  const completedOutcomeRef = useRef<CalculatedTestOutcome | null>(null);
  completedOutcomeRef.current = completedOutcome;
  const langRef = useRef<LanguageMode>(lang);
  langRef.current = lang;
  const examSessionIdRef = useRef<string>(createExamSessionId());
  const deadlineAtMsRef = useRef<number | null>(null);
  const sectionDeadlineAtMsRef = useRef<number | null>(null);
  const lastQuestionTickMsRef = useRef<number>(Date.now());
  const submitLockRef = useRef(false);
  const submittedOutcomeRef = useRef(false);
  const lastRemoteSyncMsRef = useRef(0);

  useEffect(() => {
    const el = liveVideoRef.current;
    if (!el) return;
    if (proctorStream) {
      if (el.srcObject !== proctorStream) {
        el.srcObject = proctorStream;
      }
      void el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [proctorStream, loading, completedOutcome]);

  const flushDraftNow = useCallback(
    (syncRemote: boolean, options?: { paused?: boolean }) => {
      if (completedOutcomeRef.current || submittedOutcomeRef.current || questionsRef.current.length === 0) {
        return;
      }
      const curResponses = responsesRef.current;
      const curIdx = currentIdxRef.current;
      const curSeconds = secondsLeftRef.current;
      const curSectionIdx = activeSectionIdxRef.current;
      const curSectionTimers = sectionSecondsLeftRef.current;
      const curLang: LanguageMode = langRef.current === 'hi' ? 'hi' : 'en';
      const isPaused = Boolean(options?.paused);
      const activeDeadline = !isPaused && deadlineAtMsRef.current ? deadlineAtMsRef.current : undefined;
      const activeSecDeadline =
        !isPaused && isTier1Sectional && sectionDeadlineAtMsRef.current
          ? sectionDeadlineAtMsRef.current
          : undefined;

      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            id: test.id,
            uid,
            testId: test.id,
            testTitle: test.title,
            subjectScope: test.subjectScope,
            responses: curResponses,
            secondsLeft: curSeconds,
            currentIdx: curIdx,
            lang: curLang,
            examSessionId: examSessionIdRef.current,
            ...(activeDeadline ? { deadlineAtMs: activeDeadline } : {}),
            ...(activeSecDeadline ? { sectionDeadlineAtMs: activeSecDeadline } : {}),
            totalQuestions: questionsRef.current.length,
            ...(isTier1Sectional
              ? { sectionSecondsLeft: curSectionTimers, activeSectionIdx: curSectionIdx }
              : {}),
            updatedAtMs: Date.now(),
          })
        );
      } catch {
        // Ignore quota errors
      }

      if (syncRemote) {
        lastRemoteSyncMsRef.current = Date.now();
        void saveTestDraft({
          uid,
          testId: test.id,
          testTitle: test.title,
          subjectScope: test.subjectScope,
          currentIdx: curIdx,
          secondsLeft: curSeconds,
          lang: curLang,
          totalQuestions: questionsRef.current.length,
          responses: curResponses,
          examSessionId: examSessionIdRef.current,
          ...(activeDeadline ? { deadlineAtMs: activeDeadline } : {}),
          ...(activeSecDeadline ? { sectionDeadlineAtMs: activeSecDeadline } : {}),
          ...(isTier1Sectional
            ? { sectionSecondsLeft: curSectionTimers, activeSectionIdx: curSectionIdx }
            : {}),
        }).catch(() => {});
      }
    },
    [draftKey, isTier1Sectional, test.id, test.subjectScope, test.title, uid]
  );

  useEffect(() => {
    if (!flushDraftRef) return;
    flushDraftRef.current = () => flushDraftNow(true);
    return () => {
      if (flushDraftRef) flushDraftRef.current = null;
    };
  }, [flushDraftRef, flushDraftNow]);

  useEffect(() => {
    onActiveQuestionChange?.(currentIdx);
  }, [currentIdx, onActiveQuestionChange]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchQuestionsByIds(test.questionIds)
      .then(async (qs) => {
        if (!active) return;
        const byId = new Map(qs.map((q) => [q.id, q]));
        const ordered = test.questionIds.map((id) => byId.get(id)).filter(Boolean) as QuestionDoc[];
        setQuestions(ordered);

        const init: Record<string, QuestionResponseState> = {};
        ordered.forEach((q, idx) => {
          init[q.id] = {
            questionId: q.id,
            visited: idx === 0,
            selectedIndex: -1,
            markedForReview: false,
            timeSpentSec: 0,
          };
        });

        let restored = false;
        let restoredGlobalSec = test.durationMinutes * 60;
        let restoredSecIdx = 0;
        let restoredSecTimers: Partial<Record<SubjectKey, number>> = {
          reasoning: configuredSectionDurationSec,
          ga: configuredSectionDurationSec,
          quant: configuredSectionDurationSec,
          english: configuredSectionDurationSec,
        };
        let restoredSecDeadlineMs: number | undefined;
        let restoredGlobalDeadlineMs: number | undefined;

        try {
          const savedDraft = await fetchTestDraft(uid, test.id);
          if (!active) return;
          if (savedDraft && savedDraft.responses && typeof savedDraft.responses === 'object') {
            for (const q of ordered) {
              if (savedDraft.responses[q.id]) {
                init[q.id] = { ...init[q.id], ...savedDraft.responses[q.id] };
              }
            }
            if (savedDraft.examSessionId) {
              examSessionIdRef.current = savedDraft.examSessionId;
            }
            if (savedDraft.lang === 'hi' || savedDraft.lang === 'en') {
              setLang(savedDraft.lang);
            }
            const fallbackSec =
              typeof savedDraft.secondsLeft === 'number' && savedDraft.secondsLeft >= 0
                ? savedDraft.secondsLeft
                : test.durationMinutes * 60;
            restoredGlobalSec = Math.max(
              0,
              Math.min(
                test.durationMinutes * 60,
                computeWallClockRemainingSeconds(savedDraft.deadlineAtMs, fallbackSec, Date.now())
              )
            );
            setSecondsLeft(restoredGlobalSec);
            if (typeof savedDraft.deadlineAtMs === 'number' && savedDraft.deadlineAtMs > 0) {
              restoredGlobalDeadlineMs = savedDraft.deadlineAtMs;
            }
            if (
              typeof savedDraft.currentIdx === 'number' &&
              savedDraft.currentIdx >= 0 &&
              savedDraft.currentIdx < ordered.length
            ) {
              setCurrentIdx(savedDraft.currentIdx);
            }
            if (isTier1Sectional) {
              if (savedDraft.sectionSecondsLeft) {
                restoredSecTimers = {
                  ...restoredSecTimers,
                  ...savedDraft.sectionSecondsLeft,
                };
              }
              if (typeof savedDraft.activeSectionIdx === 'number' && savedDraft.activeSectionIdx >= 0) {
                restoredSecIdx = Math.min(3, savedDraft.activeSectionIdx);
                setActiveSectionIdx(restoredSecIdx);
              }
              if (typeof savedDraft.sectionDeadlineAtMs === 'number' && savedDraft.sectionDeadlineAtMs > 0) {
                restoredSecDeadlineMs = savedDraft.sectionDeadlineAtMs;
              }
              const computedRanges = computeExamSectionRanges(ordered, sectionOrder);
              const activeSub = computedRanges[restoredSecIdx]?.subject;
              if (activeSub && restoredSecDeadlineMs) {
                restoredSecTimers[activeSub] = Math.min(
                  configuredSectionDurationSec,
                  computeWallClockRemainingSeconds(
                    restoredSecDeadlineMs,
                    restoredSecTimers[activeSub] ?? configuredSectionDurationSec,
                    Date.now()
                  )
                );
              }
              setSectionSecondsLeft(restoredSecTimers);
            }
            restored = true;
          }
        } catch {
          // Ignore draft read errors and continue
        }

        if (!restored && priorIncompleteAttemptId) {
          try {
            const priorMap = await fetchAttemptResponses(uid, priorIncompleteAttemptId);
            if (!active) return;
            let firstUnanswered = -1;
            ordered.forEach((q, idx) => {
              const prev = priorMap[q.id];
              if (prev && prev.selectedIndex >= 0) {
                init[q.id] = {
                  ...init[q.id],
                  visited: true,
                  selectedIndex: prev.selectedIndex,
                  markedForReview: Boolean(prev.markedForReview),
                  timeSpentSec: Math.max(0, prev.timeSpentSec || 0),
                };
              } else if (firstUnanswered === -1) {
                firstUnanswered = idx;
              }
            });
            if (firstUnanswered >= 0) {
              init[ordered[firstUnanswered].id] = {
                ...init[ordered[firstUnanswered].id],
                visited: true,
              };
              setCurrentIdx(firstUnanswered);
            }
            if (Object.keys(priorMap).length > 0) {
              restored = true;
            }
          } catch {
            // Fall back cleanly if prior attempt responses cannot be loaded
          }
        }

        if (!active) return;
        const initNowMs = Date.now();
        deadlineAtMsRef.current = restoredGlobalDeadlineMs ?? initNowMs + restoredGlobalSec * 1000;
        if (isTier1Sectional) {
          const computedRanges = computeExamSectionRanges(ordered, sectionOrder);
          const activeSub = computedRanges[restoredSecIdx]?.subject;
          const activeSecRem = activeSub ? restoredSecTimers[activeSub] ?? configuredSectionDurationSec : configuredSectionDurationSec;
          sectionDeadlineAtMsRef.current = restoredSecDeadlineMs ?? initNowMs + activeSecRem * 1000;
        }
        lastQuestionTickMsRef.current = initNowMs;

        if (restored) setResumedDraftNotice(true);
        setResponses(init);
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof Error ? err.message : 'Failed to load test questions.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [test.id, test.questionIds, test.durationMinutes, uid, priorIncompleteAttemptId]);

  // Continuous checkpointing of in-progress answers & remaining time (localStorage every change, Firestore every ~120s)
  useEffect(() => {
    if (loading || loadError || completedOutcome || questions.length === 0) return;
    const now = Date.now();
    const shouldSyncRemote = now - lastRemoteSyncMsRef.current >= 120_000;
    flushDraftNow(shouldSyncRemote);
  }, [loading, loadError, completedOutcome, questions.length, responses, secondsLeft, currentIdx, lang, flushDraftNow]);

  // Flush synchronously on tab hide / pagehide / beforeunload so zero progress is lost on tab close
  useEffect(() => {
    if (loading || loadError || completedOutcome || questions.length === 0) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        flushDraftNow(true);
      }
    };
    const onPageHide = () => {
      flushDraftNow(true);
    };
    const onBeforeUnload = () => {
      flushDraftNow(true);
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [loading, loadError, completedOutcome, questions.length, flushDraftNow]);

  const advanceToNextSection = useCallback((reason: 'manual' | 'timeout') => {
    const ranges = sectionRangesRef.current;
    const curSecIdx = activeSectionIdxRef.current;
    if (curSecIdx + 1 >= ranges.length) {
      // Final section expired -> auto submit
      deadlineAtMsRef.current = Date.now();
      setSecondsLeft(0);
      return;
    }
    const prevSec = ranges[curSecIdx];
    const nextIdx = curSecIdx + 1;
    const nextRange = ranges[nextIdx];
    const nextSecRemaining =
      sectionSecondsLeftRef.current[nextRange.subject] ?? configuredSectionDurationSec;
    sectionDeadlineAtMsRef.current = Date.now() + nextSecRemaining * 1000;
    setActiveSectionIdx(nextIdx);
    setCurrentIdx(nextRange.startIdx);
    const nextQ = questionsRef.current[nextRange.startIdx];
    if (nextQ) {
      setResponses((prev) => ({
        ...prev,
        [nextQ.id]: {
          ...(prev[nextQ.id] ?? {
            questionId: nextQ.id,
            selectedIndex: -1,
            markedForReview: false,
            timeSpentSec: 0,
          }),
          visited: true,
        },
      }));
    }
    setShowNextSectionModal(false);
    setShowMobilePalette(false);
    setSectionNotice(
      reason === 'timeout'
        ? `15:00 sectional time ended for ${SUBJECT_LABELS[prevSec.subject].short}. Switched to ${SUBJECT_LABELS[nextRange.subject].en} (${formatSeconds(nextSecRemaining)}).`
        : `Locked ${SUBJECT_LABELS[prevSec.subject].short} & moved to ${SUBJECT_LABELS[nextRange.subject].en}.`
    );
  }, [configuredSectionDurationSec]);

  // Authoritative Wall-Clock Countdown (Global + Strict Sectional Timer) + Per-Question Time Telemetry
  useEffect(() => {
    if (loading || loadError || completedOutcome || questions.length === 0) return;
    const tickNowMs = Date.now();
    if (!deadlineAtMsRef.current) {
      deadlineAtMsRef.current = tickNowMs + secondsLeftRef.current * 1000;
    }
    if (isTier1Sectional && !sectionDeadlineAtMsRef.current) {
      const curRange = sectionRangesRef.current[activeSectionIdxRef.current];
      const rem = curRange
        ? sectionSecondsLeftRef.current[curRange.subject] ?? configuredSectionDurationSec
        : configuredSectionDurationSec;
      sectionDeadlineAtMsRef.current = tickNowMs + rem * 1000;
    }
    lastQuestionTickMsRef.current = tickNowMs;

    const timer = window.setInterval(() => {
      const nowMs = Date.now();
      const nextGlobalSec = computeWallClockRemainingSeconds(
        deadlineAtMsRef.current,
        secondsLeftRef.current,
        nowMs
      );
      if (nextGlobalSec !== secondsLeftRef.current) {
        setSecondsLeft(nextGlobalSec);
      }

      if (isTier1Sectional) {
        const ranges = sectionRangesRef.current;
        const curSecIdx = activeSectionIdxRef.current;
        const activeRange = ranges[curSecIdx];
        if (activeRange) {
          const activeSub = activeRange.subject;
          const prevSecLeft = sectionSecondsLeftRef.current[activeSub] ?? 0;
          const nextSecLeft = computeWallClockRemainingSeconds(
            sectionDeadlineAtMsRef.current,
            prevSecLeft,
            nowMs
          );
          if (nextSecLeft <= 0) {
            if (prevSecLeft !== 0) {
              setSectionSecondsLeft((prev) => ({ ...prev, [activeSub]: 0 }));
            }
            if (curSecIdx + 1 < ranges.length) {
              advanceToNextSection('timeout');
            } else {
              window.clearInterval(timer);
              deadlineAtMsRef.current = nowMs;
              setSecondsLeft(0);
            }
          } else if (nextSecLeft !== prevSecLeft) {
            setSectionSecondsLeft((prev) => ({
              ...prev,
              [activeSub]: nextSecLeft,
            }));
          }
        }
      }

      const elapsedQuestionSec = Math.floor((nowMs - lastQuestionTickMsRef.current) / 1000);
      if (elapsedQuestionSec >= 1) {
        lastQuestionTickMsRef.current += elapsedQuestionSec * 1000;
        const cappedDelta = Math.min(elapsedQuestionSec, 60);
        const activeQ = questionsRef.current[currentIdxRef.current];
        if (activeQ) {
          setResponses((prev) => {
            const cur = prev[activeQ.id];
            if (!cur) return prev;
            return {
              ...prev,
              [activeQ.id]: {
                ...cur,
                visited: true,
                timeSpentSec: cur.timeSpentSec + cappedDelta,
              },
            };
          });
        }
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [
    loading,
    loadError,
    completedOutcome,
    questions.length,
    isTier1Sectional,
    configuredSectionDurationSec,
    advanceToNextSection,
  ]);

  // Auto-submit when timer hits 0
  useEffect(() => {
    if (
      secondsLeft === 0 &&
      !completedOutcome &&
      !submitting &&
      !submitLockRef.current &&
      !submittedOutcomeRef.current &&
      questions.length > 0
    ) {
      void handleConfirmSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  const enterFullscreenSafe = useCallback(() => {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen && !document.fullscreenElement) {
        void el.requestFullscreen().catch(() => {});
      }
    } catch {
      // Ignore browser fullscreen gesture restriction
    }
  }, []);

  const exitFullscreenSafe = useCallback(() => {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {});
      }
    } catch {
      // Ignore
    }
  }, []);

  // TCS iON Strict Mode Enforcement for Full Mock Tests
  useEffect(() => {
    if (!isStrictMode) {
      if (completedOutcome) {
        exitFullscreenSafe();
      }
      return;
    }

    enterFullscreenSafe();

    const onFullscreenChange = () => {
      const activeFs = Boolean(document.fullscreenElement);
      setIsFullscreen(activeFs);
      if (!activeFs) {
        setStrictViolations((v) => v + 1);
        setStrictWarning(
          'Strict Mode Alert: Fullscreen exited! Click "Re-enter Fullscreen" to maintain TCS iON exam integrity.'
        );
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setStrictWarning('Strict Mode: Right-click context menu is disabled during Full Mock Tests.');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const lower = key.toLowerCase();
      if (key === 'Escape' || key === 'F11' || key === 'F12') {
        e.preventDefault();
        e.stopPropagation();
        setStrictWarning(`Strict Mode: "${key}" key is disabled during Full Mock Tests.`);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ['c', 'u', 's', 'p', 'i', 'j'].includes(lower)) {
        e.preventDefault();
        e.stopPropagation();
        setStrictWarning('Strict Mode: Copy & developer shortcuts are disabled during Full Mock Tests.');
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setStrictViolations((v) => v + 1);
        setStrictWarning(
          'Strict Mode Alert: Tab switch detected and recorded. Remain inside the exam window.'
        );
      }
    };

    const onWindowBlur = () => {
      setStrictViolations((v) => v + 1);
      setStrictWarning(
        'Strict Mode Alert: Window focus lost. Tab-switching & external windows are prohibited during Full Mock Tests.'
      );
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [isStrictMode, completedOutcome, enterFullscreenSafe, exitFullscreenSafe]);

  const requestQuestionsTranslation = useCallback(async (batch: QuestionDoc[]) => {
    const needed = batch
      .filter((q) => !hasNativeHindiTranslation(q) && !requestedTransIdsRef.current.has(q.id))
      .slice(0, 6);
    if (needed.length === 0) return;

    needed.forEach((q) => requestedTransIdsRef.current.add(q.id));
    setTranslatingQIds((prev) => {
      const next = { ...prev };
      needed.forEach((q) => {
        next[q.id] = true;
      });
      return next;
    });

    try {
      const data = await aiTranslateBatch({
        questions: needed.map((q) => ({
          subject: q.subject,
          questionEn: q.questionEn,
          optionsEn: q.optionsEn,
          explanationEn: q.explanationEn || '',
        })),
      });
      const mapped = normalizeTranslationBatchResponse(
        data.translations,
        needed.map((q) => q.optionsEn)
      );
      if (mapped.size > 0) {
        setLiveTranslations((prev) => {
          const next = { ...prev };
          mapped.forEach((tr, idx) => {
            const target = needed[idx];
            if (target) next[target.id] = tr;
          });
          return next;
        });
      }
    } catch {
      needed.forEach((q) => requestedTransIdsRef.current.delete(q.id));
    } finally {
      setTranslatingQIds((prev) => {
        const next = { ...prev };
        needed.forEach((q) => {
          delete next[q.id];
        });
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (questions.length === 0) return;
    if (!completedOutcome) {
      const activeQ = questions[currentIdx];
      if (!activeQ) return;
      const slice = [activeQ, ...questions.slice(currentIdx + 1, currentIdx + 5)].filter(
        (q) => !hasNativeHindiTranslation(q) && !liveTranslations[q.id]
      );
      if (slice.length > 0) {
        void requestQuestionsTranslation(slice);
      }
    } else {
      const untranslated = questions.filter(
        (q) => !hasNativeHindiTranslation(q) && !liveTranslations[q.id]
      );
      if (untranslated.length > 0) {
        void requestQuestionsTranslation(untranslated.slice(0, 6));
      }
    }
  }, [
    questions,
    currentIdx,
    completedOutcome,
    liveTranslations,
    requestQuestionsTranslation,
  ]);

  const resultAnalytics = useMemo(
    () => (completedOutcome ? analyzeTestResultAnalytics(questions, completedOutcome) : null),
    [completedOutcome, questions]
  );

  const sections = useMemo(() => {
    if (sectionRanges.length > 0) {
      return sectionRanges.map((r) => r.subject);
    }
    const order: SubjectKey[] = ['quant', 'reasoning', 'english', 'ga'];
    return order.filter((sub) => questions.some((q) => q.subject === sub));
  }, [questions, sectionRanges]);

  const activeSectionRange = isTier1Sectional ? sectionRanges[activeSectionIdx] ?? null : null;

  const statusCounts = useMemo(() => {
    const counts: Record<PaletteStatus, number> = {
      not_visited: 0,
      not_answered: 0,
      answered: 0,
      marked: 0,
      answered_marked: 0,
    };
    for (const q of questions) {
      counts[getPaletteStatus(responses[q.id])] += 1;
    }
    return counts;
  }, [questions, responses]);

  const navigateToIndex = (nextIdx: number) => {
    if (nextIdx < 0 || nextIdx >= questions.length) return;
    if (activeSectionRange && (nextIdx < activeSectionRange.startIdx || nextIdx > activeSectionRange.endIdx)) {
      return;
    }
    const targetQ = questions[nextIdx];
    setResponses((prev) => ({
      ...prev,
      [targetQ.id]: {
        ...(prev[targetQ.id] ?? {
          questionId: targetQ.id,
          selectedIndex: -1,
          markedForReview: false,
          timeSpentSec: 0,
        }),
        visited: true,
      },
    }));
    setCurrentIdx(nextIdx);
    setShowMobilePalette(false);
  };

  const selectOption = (optIndex: number) => {
    const q = questions[currentIdx];
    if (!q) return;
    setResponses((prev) => ({
      ...prev,
      [q.id]: {
        ...prev[q.id],
        visited: true,
        selectedIndex: optIndex,
      },
    }));
  };

  const handleClearResponse = () => {
    const q = questions[currentIdx];
    if (!q) return;
    setResponses((prev) => ({
      ...prev,
      [q.id]: {
        ...prev[q.id],
        visited: true,
        selectedIndex: -1,
      },
    }));
  };

  const maxIdxAllowed = activeSectionRange ? activeSectionRange.endIdx : questions.length - 1;
  const minIdxAllowed = activeSectionRange ? activeSectionRange.startIdx : 0;

  const handleSaveAndNext = () => {
    const q = questions[currentIdx];
    if (!q) return;
    setResponses((prev) => ({
      ...prev,
      [q.id]: {
        ...prev[q.id],
        visited: true,
        markedForReview: false,
      },
    }));
    if (currentIdx + 1 <= maxIdxAllowed) {
      navigateToIndex(currentIdx + 1);
    }
  };

  const handleMarkAndNext = () => {
    const q = questions[currentIdx];
    if (!q) return;
    setResponses((prev) => ({
      ...prev,
      [q.id]: {
        ...prev[q.id],
        visited: true,
        markedForReview: true,
      },
    }));
    if (currentIdx + 1 <= maxIdxAllowed) {
      navigateToIndex(currentIdx + 1);
    }
  };

  useEffect(() => {
    if (loading || loadError || completedOutcome || showRoughPad || showSubmitModal || showExitModal) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') {
        e.preventDefault();
        selectOption(Number(e.key) - 1);
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        handleSaveAndNext();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleMarkAndNext();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        handleClearResponse();
      } else if (e.key === 'ArrowLeft' && currentIdx > minIdxAllowed) {
        e.preventDefault();
        navigateToIndex(currentIdx - 1);
      } else if (e.key === 'ArrowRight' && currentIdx + 1 <= maxIdxAllowed) {
        e.preventDefault();
        navigateToIndex(currentIdx + 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handleConfirmSubmit = async () => {
    if (submitLockRef.current || submittedOutcomeRef.current || submitting) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { outcome, masteredVaultCount: newlyMastered } = await submitTestAttempt({
        uid,
        studentName,
        targetPost,
        test,
        questions,
        responsesById: responsesRef.current,
        scoringConfig,
        currentLeaderboard,
        activityMultiplier,
        activityTierLabel,
        examSessionId: examSessionIdRef.current,
      });
      submittedOutcomeRef.current = true;
      onTestCompleted?.(
        outcome.correctCount + outcome.wrongCount,
        Object.keys(outcome.sectionStats) as SubjectKey[],
        outcome.isComplete
      );
      if (test.topicTag && outcome.maxScore > 0) {
        const scorePct = Math.max(0, Math.round((outcome.score / outcome.maxScore) * 1000) / 10);
        onTopicMasteryEvaluated?.(test.topicTag, scorePct);
      }
      try {
        localStorage.removeItem(draftKey);
        localStorage.removeItem(legacyDraftKey);
      } catch {
        // Ignore
      }
      void deleteTestDraft(uid, test.id);
      setMasteredVaultCount(newlyMastered);
      setCompletedOutcome(outcome);
      setShowSubmitModal(false);
    } catch (err) {
      submitLockRef.current = false;
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit test attempt.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExitWithCleanup = () => {
    exitFullscreenSafe();
    onExit();
  };

  const handleStartWeakTopicsRevision = async () => {
    if (!resultAnalytics || resultAnalytics.revisionQuestionIds.length === 0) return;
    setWeakRevError(null);
    setWeakRevBusy(true);
    try {
      const revTest = await createWrongTopicsRevisionTest({
        uid,
        topicNames: resultAnalytics.revisionTopicNames,
        wrongQuestionIds: resultAnalytics.revisionQuestionIds,
        targetCount: Math.max(10, Math.min(30, resultAnalytics.revisionQuestionIds.length + 5)),
        scoringConfig,
      });
      if (onLaunchRevisionTest) {
        onLaunchRevisionTest(revTest);
      } else {
        setWeakRevError('Revision test created, return to dashboard to launch.');
      }
    } catch (err) {
      setWeakRevError(
        err instanceof Error ? err.message : 'Unable to create revision test for weak topics.'
      );
    } finally {
      setWeakRevBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] dark:bg-[#11151d] p-6">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] px-6 py-5 text-sm font-medium text-slate-700 dark:text-slate-200">
          Loading TCS iON Exam Environment...
        </div>
      </div>
    );
  }

  if (loadError || questions.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] dark:bg-[#11151d] p-6">
        <div className="max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 text-center space-y-4">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">
            {loadError || 'This test has no active questions in Firestore.'}
          </p>
          <button
            type="button"
            onClick={handleExitWithCleanup}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-200 px-4 py-2 text-sm font-semibold text-white dark:text-slate-900 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to Dashboard</span>
          </button>
        </div>
      </div>
    );
  }

  // Post-Test Scorecard, Time Analytics, Weakness Analyzer & Bilingual Solution Review
  if (completedOutcome) {
    const letters = ['A', 'B', 'C', 'D'];
    return (
      <div className="min-h-screen bg-[#f4f6f8] dark:bg-[#11151d] text-slate-900 dark:text-slate-100">
        <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#141923] px-4 py-3.5 sm:px-6">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={handleExitWithCleanup}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#1e2431] px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back</span>
              </button>
              <div className="min-w-0">
                <h1 className="truncate font-display text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                  {test.title} — Performance Report
                </h1>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  Candidate: {studentName} ·{' '}
                  {!completedOutcome.isComplete
                    ? 'Pending (<=80% solved · 0 XP · Excluded from Leaderboard)'
                    : completedOutcome.isRepeatAttempt
                      ? 'Practice Replay (Repeat test · 0 XP)'
                      : completedOutcome.skippedCount > 0
                        ? `Scored (${completedOutcome.completionPercent}% solved) · ${completedOutcome.skippedCount} skipped saved to Vault`
                        : '100% Completed · Wrong answers filed to Revision Vault'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setLang((prev) => (prev === 'en' ? 'hi' : 'en'))}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Languages className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <span>{lang === 'en' ? 'EN ·Switch हिं' : 'हिं · Switch EN'}</span>
              </button>
              <button
                type="button"
                onClick={handleExitWithCleanup}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Dashboard</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
          {(() => {
            const enc = buildPostTestEncouragement({
              score: completedOutcome.score,
              maxScore: completedOutcome.maxScore,
              accuracy: completedOutcome.accuracy,
              isComplete: completedOutcome.isComplete,
              completionPercent: completedOutcome.completionPercent,
              priorBestScore: currentLeaderboard ? currentLeaderboard.bestScore : null,
              targetPost,
            });
            const toneClass =
              enc.tone === 'emerald'
                ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/80 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-100'
                : enc.tone === 'blue'
                  ? 'border-blue-200 dark:border-blue-800/60 bg-blue-50/80 dark:bg-blue-950/30 text-blue-950 dark:text-blue-100'
                  : 'border-amber-200 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100';
            return (
              <div className={`rounded-xl border px-5 py-4 space-y-1 ${toneClass}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-white/80 dark:bg-black/25 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide">
                    {enc.badge}
                  </span>
                  <h2 className="font-display text-sm sm:text-base font-bold">{enc.title}</h2>
                </div>
                <p className="text-xs opacity-90 leading-relaxed">{enc.message}</p>
              </div>
            );
          })()}

          {!completedOutcome.isComplete && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 px-5 py-3.5 text-sm text-amber-950 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <div>
                <strong>Moved to Pending Folder ({completedOutcome.completionPercent}% solved · 0 XP):</strong>{' '}
                More than 80% (&gt;80%) of questions must be attempted to earn XP, update Leaderboard stats, or count toward Cohort Missions. This test remains in your Pending folder and skipped questions are saved to Revision Vault.
              </div>
            </div>
          )}

          {completedOutcome.isComplete && completedOutcome.skippedCount > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/70 dark:bg-amber-950/25 px-5 py-3.5 text-sm text-amber-950 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <div>
                <strong>{completedOutcome.skippedCount} Skipped Question{completedOutcome.skippedCount > 1 ? 's' : ''} Filed to Revision Vault:</strong>{' '}
                Because questions were skipped, this test is marked <strong>{completedOutcome.completionPercent}% Attempted</strong> (not 100% Complete). Practice your skipped items anytime from the Revision Vault.
              </div>
            </div>
          )}

          {completedOutcome.isComplete && completedOutcome.isRepeatAttempt && (
            <div className="flex items-start gap-3 rounded-xl border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-950/30 px-5 py-3.5 text-sm text-blue-950 dark:text-blue-200">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <div>
                <strong>Practice Replay (Repeat Attempt):</strong>{' '}
                You have already completed this mock before, so no repeat XP or Mission credit was added. Your score and Revision Vault updates are saved.
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Final Score</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {completedOutcome.score} / {completedOutcome.maxScore}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Accuracy</div>
              <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                {completedOutcome.accuracy}%
              </div>
            </div>
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 20 }}
              className="rounded-xl border border-blue-200 dark:border-blue-800/60 bg-blue-50/70 dark:bg-blue-950/30 p-4"
            >
              <div className="text-xs font-medium text-blue-800 dark:text-blue-300">XP Earned</div>
              <div className="mt-1 font-mono text-2xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                +{completedOutcome.xpEarned} XP
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-blue-800 dark:text-blue-300 tabular-nums">
                {!completedOutcome.isComplete
                  ? 'Pending (<=80% solved)'
                  : completedOutcome.isRepeatAttempt
                    ? 'Practice Replay (0 XP)'
                    : `Base ${completedOutcome.baseXp} × ${completedOutcome.activityMultiplier.toFixed(2)}x`}
              </div>
            </motion.div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Correct / Wrong (incl. Missed)</div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {completedOutcome.correctCount} / {completedOutcome.effectiveWrongCount}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {completedOutcome.wrongCount} wrong (-ve) · {completedOutcome.skippedCount} skipped (0 -ve)
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Time</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatSeconds(completedOutcome.totalTimeSec)}
              </div>
            </div>
          </div>

          {/* Dream Post Cut-Off Benchmark Card */}
          {(() => {
            const dreamPost = resolveDreamPost(targetPost);
            const bench = computeTargetCutoffBenchmark(
              targetPost,
              completedOutcome.score,
              completedOutcome.maxScore
            );
            const pctScore =
              completedOutcome.maxScore > 0
                ? Math.max(0, Math.min(100, Math.round((completedOutcome.score / completedOutcome.maxScore) * 100)))
                : 0;
            const pctCutoff =
              completedOutcome.maxScore > 0
                ? Math.max(0, Math.min(100, Math.round((bench.scaledCutoff / completedOutcome.maxScore) * 100)))
                : 75;
            return (
              <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                    <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      Dream Post Cut-Off Benchmark · {dreamPost.label}
                    </h2>
                  </div>
                  <span
                    className={`rounded-md px-2.5 py-1 font-mono text-xs font-bold tabular-nums ${
                      bench.isAboveCutoff
                        ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                        : 'bg-amber-100 dark:bg-amber-950/50 text-amber-900 dark:text-amber-300'
                    }`}
                  >
                    {bench.isAboveCutoff
                      ? `Cleared by +${bench.deltaMarks} marks`
                      : `${Math.abs(bench.deltaMarks)} marks below cut-off`}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-3.5 py-2.5">
                    <span className="text-slate-500 dark:text-slate-400">Your Score</span>
                    <div className="mt-0.5 font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {completedOutcome.score} / {completedOutcome.maxScore}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-3.5 py-2.5">
                    <span className="text-slate-500 dark:text-slate-400">Scaled Benchmark</span>
                    <div className="mt-0.5 font-mono text-base font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                      {bench.scaledCutoff} / {completedOutcome.maxScore}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-3.5 py-2.5">
                    <span className="text-slate-500 dark:text-slate-400">Official Tier-I UR Reference</span>
                    <div className="mt-0.5 font-mono text-base font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                      {bench.tier1Cutoff} / 200
                    </div>
                  </div>
                </div>
                <div className="relative h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all ${bench.isAboveCutoff ? 'bg-emerald-600' : 'bg-blue-600'}`}
                    style={{ width: `${pctScore}%` }}
                  />
                  <div
                    title={`Target cut-off: ${bench.scaledCutoff}`}
                    className="absolute top-0 bottom-0 w-0.5 bg-red-600 dark:bg-red-400"
                    style={{ left: `${pctCutoff}%` }}
                  />
                </div>
                {test.topicTag && (() => {
                  const rawPct =
                    completedOutcome.maxScore > 0
                      ? Math.max(0, Math.round((completedOutcome.score / completedOutcome.maxScore) * 1000) / 10)
                      : 0;
                  return rawPct > 80 ? (
                    <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 px-3.5 py-2 text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                      Micro-Syllabus Milestone Unlocked: &ldquo;{test.topicTag}&rdquo; scored {rawPct}% (&gt;80%) — marked Green on your Micro-Syllabus Map!
                    </div>
                  ) : null;
                })()}
              </section>
            );
          })()}

          {masteredVaultCount > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 px-5 py-3.5 text-sm font-medium text-emerald-950 dark:text-emerald-200">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>
                <strong>{masteredVaultCount} Revision Vault</strong> question{masteredVaultCount > 1 ? 's' : ''} solved correctly and automatically promoted to <strong>Mastered</strong>!
              </span>
            </div>
          )}

          {/* Time Analytics & Weakness Analyzer Cards */}
          {resultAnalytics && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Subject Time Analytics */}
              <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Timer className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                    <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      Time Analytics (Per-Question Pace)
                    </h2>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    Tracked silently per Q
                  </span>
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] p-3.5 space-y-1">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {resultAnalytics.timeInsightEn}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {resultAnalytics.timeInsightHi}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {resultAnalytics.subjectPaces.map((pace) => (
                    <div
                      key={pace.subject}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131720] px-3 py-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {pace.labelShort}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {pace.questionCount} Qs · Total {formatSeconds(pace.totalTimeSec)}
                        </div>
                      </div>
                      <div className="shrink-0 whitespace-nowrap text-right font-mono text-xs font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                        {pace.avgTimeText}/Q
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Weakness Analyzer & Wrong Topics Revision CTA */}
              <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-3.5 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                      <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                        Weakness Analyzer &amp; Target Topics
                      </h2>
                    </div>
                    <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {resultAnalytics.wrongTopicsOnly.length > 0
                        ? `${resultAnalytics.wrongTopicsOnly.length} wrong topic${resultAnalytics.wrongTopicsOnly.length > 1 ? 's' : ''}`
                        : resultAnalytics.weakTopics.length > 0
                          ? `${resultAnalytics.weakTopics.length} skipped topic${resultAnalytics.weakTopics.length > 1 ? 's' : ''}`
                          : 'Zero weak topics'}
                    </span>
                  </div>

                  <div className="rounded-lg border border-amber-200/80 dark:border-amber-800/40 bg-amber-50/70 dark:bg-amber-950/20 p-3.5 space-y-1">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {resultAnalytics.weaknessInsightEn}
                    </p>
                    <p className="text-xs text-slate-700 dark:text-slate-300">
                      {resultAnalytics.weaknessInsightHi}
                    </p>
                  </div>

                  {resultAnalytics.weakTopics.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {resultAnalytics.weakTopics.map((wt) => (
                        <span
                          key={`${wt.subject}_${wt.topic}`}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                            wt.wrongCount > 0
                              ? 'border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200'
                              : 'border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                          }`}
                        >
                          <span>{wt.topic}</span>
                          <span className="font-mono text-[11px] opacity-80">
                            {wt.wrongCount > 0 ? `${wt.wrongCount} wrong` : `${wt.skippedCount} skipped`}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}

                  {weakRevError && (
                    <p className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-900 dark:text-red-200">
                      {weakRevError}
                    </p>
                  )}
                </div>

                {resultAnalytics.revisionQuestionIds.length > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      disabled={weakRevBusy}
                      onClick={() => void handleStartWeakTopicsRevision()}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-600 disabled:opacity-50 cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {weakRevBusy
                          ? 'Preparing Targeted Revision Test...'
                          : 'Take Revision Test of Wrong Topics'}
                      </span>
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* AI Exam Post-Mortem & Negative-Mark Leakage Blueprint */}
          {(() => {
            const baselineReport = buildDeterministicPostMortem({
              testTitle: test.title,
              targetPost,
              score: completedOutcome.score,
              maxScore: completedOutcome.maxScore,
              accuracy: completedOutcome.accuracy,
              correctCount: completedOutcome.correctCount,
              wrongCount: completedOutcome.wrongCount,
              skippedCount: completedOutcome.skippedCount,
              negativeMarks: test.negativeMarks,
              positiveMarks: test.positiveMarks,
              weakTopics: resultAnalytics?.weakTopics.map((t) => t.topic) ?? [],
              slowestSection: resultAnalytics?.subjectPaces?.[0]?.labelShort,
            });
            const activeReport = postMortem ?? baselineReport;
            const handleGenerateAiPostMortem = async () => {
              setPostMortemBusy(true);
              try {
                const res = await aiPostMortemAnalysis({
                  testTitle: test.title,
                  targetPost,
                  score: completedOutcome.score,
                  maxScore: completedOutcome.maxScore,
                  accuracy: completedOutcome.accuracy,
                  correctCount: completedOutcome.correctCount,
                  wrongCount: completedOutcome.wrongCount,
                  skippedCount: completedOutcome.skippedCount,
                  negativeMarks: test.negativeMarks,
                  positiveMarks: test.positiveMarks,
                  weakTopics: resultAnalytics?.weakTopics.map((t) => t.topic) ?? [],
                  slowestSection: resultAnalytics?.subjectPaces?.[0]?.labelShort,
                });
                setPostMortem(res);
              } finally {
                setPostMortemBusy(false);
              }
            };
            return (
              <section className="rounded-xl border border-indigo-200 dark:border-indigo-800/60 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                    <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      AI Exam Post-Mortem &amp; Recovery Blueprint
                    </h2>
                    <span className="rounded bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-indigo-700 dark:text-indigo-300">
                      {activeReport.source === 'groq_ai' ? 'Groq Deep Insight' : 'Instant Diagnostic'}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={postMortemBusy}
                    onClick={() => void handleGenerateAiPostMortem()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {postMortemBusy
                        ? 'Analyzing Errors...'
                        : postMortem?.source === 'groq_ai'
                          ? 'Refresh AI Post-Mortem'
                          : 'Generate AI Post-Mortem'}
                    </span>
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-red-200/80 dark:border-red-800/50 bg-red-50/70 dark:bg-red-950/25 px-3.5 py-2.5">
                    <div className="text-[11px] font-medium text-red-800 dark:text-red-300">
                      Negative-Mark Leakage
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-red-700 dark:text-red-400 tabular-nums">
                      -{activeReport.marksLostToNegative} marks
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-200/80 dark:border-emerald-800/50 bg-emerald-50/70 dark:bg-emerald-950/25 px-3.5 py-2.5">
                    <div className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                      Recoverable Score Swing
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      +{activeReport.potentialBoostMarks} marks
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-3.5 py-2.5 flex flex-col justify-center">
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Key Takeaway
                    </div>
                    <div className="mt-0.5 text-xs font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                      {activeReport.headline}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                  <ul className="space-y-2 lg:col-span-7">
                    {activeReport.actionChecklist.map((step, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-3.5 py-2.5 text-xs text-slate-800 dark:text-slate-200"
                      >
                        <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600 font-mono text-[10px] font-bold text-white">
                          {i + 1}
                        </span>
                        <span className="leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="rounded-lg border border-amber-200/80 dark:border-amber-800/40 bg-amber-50/70 dark:bg-amber-950/20 p-3.5 space-y-1.5 lg:col-span-5">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-amber-900 dark:text-amber-300">
                      Hindi Action Summary
                    </div>
                    <p className="text-xs leading-relaxed text-slate-800 dark:text-slate-200">
                      {activeReport.hindiTakeaway}
                    </p>
                  </div>
                </div>
              </section>
            );
          })()}

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27]">
            <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Section-Wise Time &amp; Accuracy Breakdown
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <th className="px-5 py-3">Section</th>
                    <th className="px-5 py-3 text-right">Correct</th>
                    <th className="px-5 py-3 text-right">Wrong (Attempted)</th>
                    <th className="px-5 py-3 text-right">Skipped (0 -ve)</th>
                    <th className="px-5 py-3 text-right">Accuracy</th>
                    <th className="px-5 py-3 text-right">Avg / Q</th>
                    <th className="px-5 py-3 text-right">Time Spent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(Object.entries(completedOutcome.sectionStats) as Array<
                    [SubjectKey, { correct: number; wrong: number; skipped: number; timeSec: number }]
                  >).map(([sub, st]) => {
                    const att = st.correct + st.wrong;
                    const totalQInSec = att + st.skipped;
                    const avgSec = totalQInSec > 0 ? Math.round(st.timeSec / totalQInSec) : 0;
                    const acc = att > 0 ? Math.round((st.correct / att) * 1000) / 10 : 0;
                    return (
                      <tr key={sub}>
                        <td className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100">
                          {SUBJECT_LABELS[sub].en}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {st.correct}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-red-700 dark:text-red-400 tabular-nums">
                          {st.wrong}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-amber-800 dark:text-amber-400 tabular-nums">
                          {st.skipped}
                        </td>
                        <td className="px-5 py-3 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                          {acc}%
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-blue-700 dark:text-blue-400 tabular-nums">
                          {formatHumanAvgSeconds(avgSec)}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                          {formatSeconds(st.timeSec)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <QuestionTimeGraph
            items={questions.map((q, idx) => {
              const r = completedOutcome.perQuestionResults[idx];
              return {
                questionNumber: idx + 1,
                subject: q.subject,
                topic: q.topic,
                timeSpentSec: r?.timeSpentSec ?? 0,
                isCorrect: Boolean(r?.isCorrect),
                isSkipped: r ? r.selectedIndex === -1 : true,
              };
            })}
          />

          <div className="space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Question-by-Question Solutions
            </h2>
            {questions.map((q, idx) => {
              const r = completedOutcome.perQuestionResults[idx];
              const liveTr = liveTranslations[q.id];
              const qView = resolveBilingualQuestionView({
                question: q,
                lang,
                liveTranslation: liveTr,
              });
              const pyqBadge = formatMetadataBadge(q);

              return (
                <article
                  key={q.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Q{idx + 1} · {SUBJECT_LABELS[q.subject].short} · {q.topic}
                      </span>
                      <span className="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-[#1e2431] px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        [{pyqBadge}]
                      </span>
                      <span className="font-mono text-[11px]">
                        Time: {formatSeconds(r.timeSpentSec)}
                      </span>
                      {translatingQIds[q.id] && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          Loading Hindi...
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setReportQuestion(q)}
                        className="inline-flex items-center gap-1 rounded border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/35 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60 cursor-pointer"
                      >
                        <Flag className="h-3 w-3" aria-hidden="true" />
                        <span>Report Error</span>
                      </button>
                      <span
                        className={`font-semibold ${
                          r.isCorrect
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : r.selectedIndex === -1
                              ? 'text-amber-800 dark:text-amber-400'
                              : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {r.isCorrect
                          ? `Correct (+${test.positiveMarks})`
                          : r.selectedIndex === -1
                            ? 'Skipped · Saved to Vault (0 -ve)'
                            : `Incorrect (-${test.negativeMarks})`}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{qView.primaryStem}</p>
                    {qView.secondaryStem && (
                      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        {qView.secondaryStem}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {qView.primaryOptions.map((optPrimary, optIdx) => {
                      const optSecondary = (qView.secondaryOptions?.[optIdx] || '').trim();
                      const isAns = optIdx === q.correctIndex;
                      const isPicked = optIdx === r.selectedIndex;
                      let cls =
                        'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#131720] text-slate-700 dark:text-slate-300';
                      if (isAns) {
                        cls =
                          'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-200 font-semibold';
                      } else if (isPicked && !isAns) {
                        cls =
                          'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/35 text-red-900 dark:text-red-200';
                      }
                      return (
                        <div key={optIdx} className={`rounded-lg border px-3 py-2 text-xs space-y-0.5 ${cls}`}>
                          <div>
                            <span className="font-mono font-bold">{letters[optIdx]}.</span> {optPrimary}
                          </div>
                          {optSecondary && optSecondary !== optPrimary && (
                            <div className="pl-5 text-[11px] opacity-85">{optSecondary}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {(qView.primaryExplanation || qView.secondaryExplanation || q.shortTrick) && (
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-2.5 space-y-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {qView.primaryExplanation && (
                        <p>
                          <strong>{lang === 'hi' && qView.hindiAvailable ? 'व्याख्या:' : 'Explanation:'}</strong>{' '}
                          {qView.primaryExplanation}
                        </p>
                      )}
                      {qView.secondaryExplanation && (
                        <p className="text-slate-600 dark:text-slate-400">
                          <strong>{lang === 'hi' && qView.hindiAvailable ? 'Explanation:' : 'व्याख्या:'}</strong>{' '}
                          {qView.secondaryExplanation}
                        </p>
                      )}
                      {q.shortTrick && (
                        <p className="rounded-lg border border-blue-200/70 dark:border-blue-800/50 bg-blue-50/60 dark:bg-blue-950/25 px-3 py-2 text-blue-950 dark:text-blue-200">
                          <strong>Short Trick:</strong> {q.shortTrick}
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-5">
            <button
              type="button"
              onClick={handleExitWithCleanup}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Dashboard</span>
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
        </main>

        <ReportQuestionModal
          open={Boolean(reportQuestion)}
          onClose={() => setReportQuestion(null)}
          uid={uid}
          loginId={loginId ?? uid}
          studentName={studentName}
          question={reportQuestion}
          sourceContext={`Post-Test Solution: ${test.title}`}
        />
      </div>
    );
  }

  const activeQuestion = questions[currentIdx];
  const activeResponse = responses[activeQuestion.id];
  const activeLiveTr = liveTranslations[activeQuestion.id];
  const activeView = resolveBilingualQuestionView({
    question: activeQuestion,
    lang,
    liveTranslation: activeLiveTr,
  });
  const isTranslatingActive = Boolean(translatingQIds[activeQuestion.id]);
  const activePyqBadge = formatMetadataBadge(activeQuestion);
  const letters = ['A', 'B', 'C', 'D'];

  const timerUrgent = secondsLeft <= 120;
  const timerWarn = secondsLeft > 120 && secondsLeft <= 600;

  const handleRequestExit = () => {
    flushDraftNow(true, { paused: true });
    const hasProgress =
      currentIdx > 0 ||
      secondsLeft < test.durationMinutes * 60 - 2 ||
      Object.values(responses).some((r) => r.selectedIndex >= 0 || r.markedForReview);
    if (hasProgress) {
      setShowExitModal(true);
    } else {
      onExit();
    }
  };

  const minRequiredForXp = getMinQuestionsForXp(questions.length);
  const answeredCountNow = statusCounts.answered + statusCounts.answered_marked;

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f6f8] dark:bg-[#11151d] text-slate-900 dark:text-slate-100">
      {/* TCS iON Top Header Strip */}
      <header className="sticky top-0 z-30 bg-[#181e29] text-slate-100 px-4 py-2.5 sm:px-6 border-b border-slate-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleRequestExit}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 shrink-0 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Pause</span>
            </button>
            <div className="min-w-0">
              <h1 className="truncate font-display text-sm font-bold sm:text-base">
                {test.title}
              </h1>
              <p className="truncate text-[11px] sm:text-xs text-slate-300">
                Candidate: {targetPost ? `${targetPost} ` : ''}{studentName} · +{test.positiveMarks} / -{test.negativeMarks}
                {resumedDraftNotice ? ' · Resumed Exactly Where Left Off' : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setShowCalculator((v) => !v)}
              title="Open Desktop Exam Calculator"
              aria-pressed={showCalculator}
              className={`hidden lg:inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold cursor-pointer ${
                showCalculator
                  ? 'border-blue-500 bg-blue-700 text-white'
                  : 'border-slate-600 bg-slate-800 text-white hover:bg-slate-700'
              }`}
            >
              <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Calculator</span>
            </button>
            <button
              type="button"
              onClick={() => setShowRoughPad(true)}
              title="Open Rough Sheet & Calculation Pad"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 cursor-pointer"
            >
              <PenTool className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Rough Pad</span>
            </button>

            {isTier1Sectional && activeSectionRange && (
              <div
                role="timer"
                aria-label="Sectional time remaining"
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-xs font-bold tabular-nums border ${
                  (sectionSecondsLeft[activeSectionRange.subject] ?? 0) <= 120
                    ? 'border-red-400 bg-red-900/60 text-red-100'
                    : 'border-amber-400/60 bg-slate-800 text-amber-300'
                }`}
              >
                <Timer className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {SUBJECT_LABELS[activeSectionRange.subject].short}:{' '}
                  {formatSeconds(sectionSecondsLeft[activeSectionRange.subject] ?? 0)}
                </span>
              </div>
            )}

            <div
              role="timer"
              aria-label="Total time remaining"
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 sm:px-3 py-1.5 font-mono text-xs sm:text-sm font-bold tabular-nums ${
                timerUrgent
                  ? 'bg-red-600 text-white'
                  : timerWarn
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-blue-700 text-white'
              }`}
            >
              <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
              <span>{formatSeconds(secondsLeft)}</span>
            </div>

            <button
              type="button"
              aria-label="Open Question Palette"
              onClick={() => setShowMobilePalette(true)}
              className="inline-flex lg:hidden items-center gap-1 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white cursor-pointer"
            >
              <Grid className="h-4 w-4" aria-hidden="true" />
              <span>Palette</span>
            </button>
          </div>
        </div>
      </header>

      {/* Section Switcher Bar */}
      <div className="border-b border-slate-300 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#141923] px-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 py-2">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1 shrink-0">
              {isTier1Sectional
                ? `${test.title.toLowerCase().includes('tier-ii') || configuredSectionDurationSec >= 1200 ? 'Tier-II' : 'Tier-I'} Sections (${Math.round(configuredSectionDurationSec / 60)}m each):`
                : 'Sections:'}
            </span>
            {sections.map((sub, secIdx) => {
              if (isTier1Sectional) {
                const isCurrentSec = secIdx === activeSectionIdx;
                const isLockedCompleted = secIdx < activeSectionIdx;
                const isFutureLocked = secIdx > activeSectionIdx;
                const secSecLeft = sectionSecondsLeft[sub] ?? 0;
                return (
                  <button
                    key={sub}
                    type="button"
                    disabled={isLockedCompleted || isFutureLocked}
                    title={
                      isLockedCompleted
                        ? 'Section completed & locked'
                        : isFutureLocked
                          ? 'Unlocks sequentially after current section'
                          : 'Active section'
                    }
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                      isCurrentSec
                        ? 'bg-blue-700 text-white'
                        : isLockedCompleted
                          ? 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 opacity-75 cursor-not-allowed'
                          : 'bg-slate-100 dark:bg-[#1e2431] text-slate-500 dark:text-slate-400 opacity-80 cursor-not-allowed'
                    }`}
                  >
                    {(isLockedCompleted || isFutureLocked) && (
                      <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                    )}
                    <span>{SUBJECT_LABELS[sub].en}</span>
                    {isCurrentSec && (
                      <span className="font-mono text-[11px] opacity-90 tabular-nums">
                        ({formatSeconds(secSecLeft)})
                      </span>
                    )}
                  </button>
                );
              }
              const isCurrentSec = activeQuestion.subject === sub;
              const firstIdxInSec = questions.findIndex((q) => q.subject === sub);
              return (
                <button
                  key={sub}
                  type="button"
                  onClick={() => navigateToIndex(firstIdxInSec)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isCurrentSec
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-100 dark:bg-[#1e2431] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  {SUBJECT_LABELS[sub].en}
                </button>
              );
            })}
          </div>
          {isTier1Sectional && activeSectionIdx + 1 < sectionRanges.length && (
            <button
              type="button"
              onClick={() => setShowNextSectionModal(true)}
              className="inline-flex items-center gap-1 rounded-md bg-slate-900 dark:bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-600 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Next Section</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {sectionNotice && isTier1Sectional && (
        <div className="border-b border-blue-200 dark:border-blue-800/60 bg-blue-50 dark:bg-blue-950/35 px-4 py-1.5 sm:px-6">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 text-xs font-semibold text-blue-900 dark:text-blue-200">
            <span>{sectionNotice}</span>
            <button
              type="button"
              onClick={() => setSectionNotice(null)}
              aria-label="Dismiss section notice"
              className="rounded p-0.5 hover:bg-blue-200/50 dark:hover:bg-blue-900/50 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Live Proctoring Feed & Compliance Strip */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#151a24] px-4 py-1.5 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-2.5">
            {proctorStream ? (
              <div className="relative h-10 w-14 overflow-hidden rounded border border-emerald-500/60 bg-slate-900 shrink-0">
                <video
                  ref={liveVideoRef}
                  autoPlay
                  muted
                  playsInline
                  aria-label="Live Proctoring Camera Feed"
                  className="h-full w-full object-cover"
                />
                <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-emerald-500" />
              </div>
            ) : (
              <Camera className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
            )}
            <span>
              {proctorStream
                ? 'Live Camera Feed Active · Movement & Tab Proctoring Enabled'
                : cameraWarning
                  ? cameraWarning
                  : cameraState === 'denied'
                    ? 'Camera permission denied or no webcam found · Continuing in non-camera proctoring mode'
                    : 'Camera Proctoring Standby'}
            </span>
          </div>
          {test.subjectScope === 'full' && (
            <div className="flex items-center gap-2">
              {strictViolations > 0 && (
                <span className="inline-flex items-center gap-1 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-2 py-0.5 font-mono font-bold text-red-700 dark:text-red-300">
                  <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                  <span>{strictViolations} Warning{strictViolations > 1 ? 's' : ''}</span>
                </span>
              )}
              {!isFullscreen && (
                <button
                  type="button"
                  onClick={enterFullscreenSafe}
                  className="inline-flex items-center gap-1 rounded border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-0.5 font-semibold text-blue-800 dark:text-blue-300 hover:bg-blue-100 cursor-pointer"
                >
                  <Maximize2 className="h-3 w-3" aria-hidden="true" />
                  <span>Enter Fullscreen</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {strictWarning && isStrictMode && (
        <div className="border-b border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 px-4 py-2 sm:px-6">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 text-xs font-semibold text-red-900 dark:text-red-200">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
              <span>{strictWarning}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!isFullscreen && (
                <button
                  type="button"
                  onClick={() => {
                    enterFullscreenSafe();
                    setStrictWarning(null);
                  }}
                  className="rounded bg-red-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-800 cursor-pointer"
                >
                  Re-enter Fullscreen
                </button>
              )}
              <button
                type="button"
                aria-label="Dismiss Strict Mode Alert"
                onClick={() => setStrictWarning(null)}
                className="rounded p-0.5 hover:bg-red-200/50 dark:hover:bg-red-900/50 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Split Exam Workspace — items-start prevents stretching empty void below options */}
      <div className="mx-auto flex w-full max-w-7xl items-start gap-4 p-3 sm:p-5">
        {/* Left Question Canvas */}
        <section className="flex flex-1 flex-col rounded-xl border border-slate-300 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] overflow-hidden">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-4 py-2.5 sm:px-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Question No. {currentIdx + 1} of {questions.length}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  {SUBJECT_LABELS[activeQuestion.subject].short} · {activeQuestion.topic}
                </span>
                <div
                  role="group"
                  aria-label="Exam question language"
                  className="inline-flex items-center rounded-md border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setLang('en')}
                    aria-pressed={lang === 'en'}
                    className={`px-2 py-1 font-mono text-[11px] font-bold cursor-pointer ${
                      lang === 'en'
                        ? 'bg-blue-700 text-white'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    EN
                  </button>
                  <button
                    type="button"
                    onClick={() => setLang('hi')}
                    aria-pressed={lang === 'hi'}
                    className={`px-2 py-1 text-[11px] font-bold cursor-pointer ${
                      lang === 'hi'
                        ? 'bg-blue-700 text-white'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    हिं
                  </button>
                </div>
                <div className="inline-flex items-center rounded-md border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] overflow-hidden">
                  {(['sm', 'md', 'lg'] as const).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setFontScale(sz)}
                      title={`Question text size: ${sz.toUpperCase()}`}
                      className={`px-2 py-1 font-mono text-[11px] font-bold cursor-pointer ${
                        fontScale === sz
                          ? 'bg-blue-700 text-white'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {sz === 'sm' ? 'A-' : sz === 'md' ? 'A' : 'A+'}
                    </button>
                  ))}
                </div>
                {isTranslatingActive && (
                  <span className="inline-flex items-center gap-1 rounded bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    Loading Hindi...
                  </span>
                )}
              </div>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              {/* Exam Metadata Badge Above Question Text */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-[#1e2431] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  [{activePyqBadge}]
                </span>
                {activeView.hindiFallbackUsed && !isTranslatingActive && (
                  <span className="text-[11px] text-amber-700 dark:text-amber-300">
                    Hindi translation unavailable for this question — showing English.
                  </span>
                )}
              </div>

              {/* Stacked Bilingual Question Stem */}
              <div className="space-y-1.5">
                <p
                  className={`font-medium leading-relaxed text-slate-900 dark:text-slate-100 ${
                    fontScale === 'sm' ? 'text-sm' : fontScale === 'lg' ? 'text-lg' : 'text-base'
                  }`}
                >
                  {activeView.primaryStem}
                </p>
                {activeView.secondaryStem ? (
                  <p
                    className={`leading-relaxed text-slate-600 dark:text-slate-300 ${
                      fontScale === 'sm' ? 'text-sm' : fontScale === 'lg' ? 'text-lg' : 'text-base'
                    }`}
                  >
                    {activeView.secondaryStem}
                  </p>
                ) : isTranslatingActive ? (
                  <p className="text-xs italic text-slate-400 dark:text-slate-500">
                    हिन्दी अनुवाद लोड हो रहा है...
                  </p>
                ) : null}
              </div>

              {/* Stacked Bilingual Options */}
              <fieldset className="space-y-2.5">
                <legend className="sr-only">Answer options</legend>
                {activeView.primaryOptions.map((optPrimary, idx) => {
                  const optSecondary = (activeView.secondaryOptions?.[idx] || '').trim();
                  const selected = activeResponse?.selectedIndex === idx;
                  return (
                    <label
                      key={idx}
                      className={`flex items-start gap-3 rounded-lg border p-3 transition-colors cursor-pointer ${
                        fontScale === 'sm' ? 'text-xs' : fontScale === 'lg' ? 'text-base' : 'text-sm'
                      } ${
                        selected
                          ? 'border-blue-700 dark:border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-slate-950 dark:text-slate-100 font-medium'
                          : 'border-slate-200 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#131720] text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1c222e]'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`q_${activeQuestion.id}`}
                        checked={selected}
                        onChange={() => selectOption(idx)}
                        className="mt-1 h-4 w-4 accent-blue-700"
                      />
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                        {letters[idx]}.
                      </span>
                      <span className="flex-1 space-y-0.5">
                        <span className="block">{optPrimary}</span>
                        {optSecondary && optSecondary !== optPrimary && (
                          <span className="block text-[0.92em] font-normal text-slate-600 dark:text-slate-300">
                            {optSecondary}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            </div>
          </div>

          {/* TCS iON Action Strip — directly below options + sticky on small screens */}
          <div className="sticky bottom-0 z-20 lg:static flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              {currentIdx > minIdxAllowed && (
                <button
                  type="button"
                  onClick={() => navigateToIndex(currentIdx - 1)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Prev</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleMarkAndNext}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/40 px-3 py-2 text-xs font-semibold text-violet-900 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/40 cursor-pointer"
              >
                <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Mark for Review &amp; Next</span>
              </button>
              <button
                type="button"
                onClick={handleClearResponse}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Clear Response
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveAndNext}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{currentIdx + 1 <= maxIdxAllowed ? 'Save & Next' : 'Save Response'}</span>
              </button>
              {isTier1Sectional && activeSectionIdx + 1 < sectionRanges.length && currentIdx === maxIdxAllowed ? (
                <button
                  type="button"
                  onClick={() => setShowNextSectionModal(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                >
                  <span>Next Section</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
              >
                Submit Test
              </button>
            </div>
          </div>
        </section>

        {/* Right Question Palette (Desktop) */}
        <aside className="hidden w-80 shrink-0 flex-col justify-between rounded-xl border border-slate-300 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] lg:flex">
          <div>
            <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Question Palette
              </h2>
              {activeSectionRange && (
                <span className="font-mono text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                  Sec {activeSectionIdx + 1}/{sectionRanges.length} · {SUBJECT_LABELS[activeSectionRange.subject].short}
                </span>
              )}
            </div>

            {/* 5-State Legend */}
            <div className="grid grid-cols-2 gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] p-3 text-xs">
              {(Object.keys(PALETTE_STYLE) as PaletteStatus[]).map((st) => (
                <div key={st} className="flex items-center gap-2">
                  <span
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center border text-[10px] font-mono font-bold tabular-nums ${PALETTE_STYLE[st].bg}`}
                  >
                    {statusCounts[st]}
                  </span>
                  <span className="text-slate-700 dark:text-slate-300 leading-tight">
                    {PALETTE_STYLE[st].label}
                  </span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-5 gap-2 p-4 max-h-[380px] overflow-y-auto">
              {questions.map((q, idx) => {
                const st = getPaletteStatus(responses[q.id]);
                const isCur = idx === currentIdx;
                const lockedOut =
                  Boolean(activeSectionRange) &&
                  (idx < activeSectionRange!.startIdx || idx > activeSectionRange!.endIdx);
                return (
                  <button
                    key={q.id}
                    type="button"
                    disabled={lockedOut}
                    aria-label={`Question ${idx + 1}, ${PALETTE_STYLE[st].label}${lockedOut ? ', locked section' : ''}`}
                    onClick={() => navigateToIndex(idx)}
                    className={`h-9 border font-mono text-xs font-bold tabular-nums transition-transform ${
                      lockedOut
                        ? 'opacity-30 cursor-not-allowed border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-400'
                        : `${PALETTE_STYLE[st].bg} cursor-pointer`
                    } ${isCur ? 'ring-2 ring-blue-700 dark:ring-blue-400 ring-offset-1 dark:ring-offset-[#181d27]' : ''}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 p-4 space-y-2">
            <button
              type="button"
              onClick={() => setShowSubmitModal(true)}
              className="w-full rounded-lg bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
            >
              Submit Exam
            </button>
            <button
              type="button"
              onClick={handleRequestExit}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Save &amp; Pause to Pending
            </button>
          </div>
        </aside>
      </div>

      {/* Mobile Palette Slide-Over */}
      {showMobilePalette && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 lg:hidden">
          <div className="flex h-full w-80 flex-col justify-between bg-[#faf9f6] dark:bg-[#181d27] p-4 shadow-xl">
            <div className="space-y-4 overflow-y-auto no-scrollbar">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Question Palette
                </h2>
                <button
                  type="button"
                  aria-label="Close Palette"
                  onClick={() => setShowMobilePalette(false)}
                  className="rounded-md p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                {(Object.keys(PALETTE_STYLE) as PaletteStatus[]).map((st) => (
                  <div key={st} className="flex items-center gap-2">
                    <span
                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center border text-[10px] font-mono font-bold ${PALETTE_STYLE[st].bg}`}
                    >
                      {statusCounts[st]}
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">{PALETTE_STYLE[st].label}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-5 gap-2">
                {questions.map((q, idx) => {
                  const st = getPaletteStatus(responses[q.id]);
                  const lockedOut =
                    Boolean(activeSectionRange) &&
                    (idx < activeSectionRange!.startIdx || idx > activeSectionRange!.endIdx);
                  return (
                    <button
                      key={q.id}
                      type="button"
                      disabled={lockedOut}
                      onClick={() => navigateToIndex(idx)}
                      className={`h-9 border font-mono text-xs font-bold tabular-nums ${
                        lockedOut
                          ? 'opacity-30 cursor-not-allowed border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-400'
                          : `${PALETTE_STYLE[st].bg} cursor-pointer`
                      } ${idx === currentIdx ? 'ring-2 ring-blue-700 dark:ring-blue-400' : ''}`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
              <button
                type="button"
                onClick={() => {
                  setShowMobilePalette(false);
                  setShowSubmitModal(true);
                }}
                className="w-full rounded-lg bg-emerald-700 py-2.5 text-sm font-semibold text-white cursor-pointer"
              >
                Submit Exam
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMobilePalette(false);
                  handleRequestExit();
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Save &amp; Pause to Pending
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit Confirmation Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 shadow-xl space-y-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600 shrink-0" aria-hidden="true" />
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                  Confirm Exam Submission
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  Review your response summary before locking your score and updating the live leaderboard.
                </p>
              </div>
            </div>

            <table className="w-full text-left text-xs border border-slate-200 dark:border-slate-800">
              <thead className="bg-slate-50 dark:bg-[#141923] text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                <tr>
                  <td className="px-3 py-2 font-medium text-emerald-800 dark:text-emerald-400">Answered</td>
                  <td className="px-3 py-2 text-right font-mono font-bold tabular-nums">
                    {statusCounts.answered}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-violet-800 dark:text-violet-400">
                    Answered &amp; Marked for Review
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold tabular-nums">
                    {statusCounts.answered_marked}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-red-700 dark:text-red-400">Not Answered</td>
                  <td className="px-3 py-2 text-right font-mono font-bold tabular-nums">
                    {statusCounts.not_answered}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">
                    Marked for Review (Unanswered)
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold tabular-nums">
                    {statusCounts.marked}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-slate-500 dark:text-slate-400">Not Visited</td>
                  <td className="px-3 py-2 text-right font-mono font-bold tabular-nums">
                    {statusCounts.not_visited}
                  </td>
                </tr>
              </tbody>
            </table>

            {answeredCountNow < minRequiredForXp && (
              <div className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs leading-relaxed text-amber-950 dark:text-amber-200">
                <strong>Not Over 80% Attempted ({answeredCountNow}/{questions.length}):</strong>{' '}
                More than 80% (at least <strong>{minRequiredForXp} questions</strong>) must be answered to earn XP.
                Submitting now yields <strong>0 XP</strong> and places this test in your{' '}
                <strong>Pending Folder</strong> (skipped questions save to Revision Vault).
              </div>
            )}

            {submitError && (
              <p className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-900 dark:text-red-200">
                {submitError}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowSubmitModal(false)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Resume Exam
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmSubmit}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>{submitting ? 'Submitting...' : 'Confirm & Submit'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save & Pause to Pending Modal */}
      {showExitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <ArrowLeft className="mt-0.5 h-5 w-5 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Save &amp; Pause to Pending?
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Your current question (Q{currentIdx + 1}), all selected answers, and remaining clock (
                  {formatSeconds(secondsLeft)}) are saved to your <strong>Pending</strong> folder so
                  you can resume right where you left off.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowExitModal(false)}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
              >
                Continue Exam
              </button>
              <button
                type="button"
                onClick={() => {
                  flushDraftNow(true, { paused: true });
                  setShowExitModal(false);
                  onExit();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Save &amp; Pause</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Next Section Lock Confirmation Modal */}
      {showNextSectionModal && isTier1Sectional && activeSectionRange && activeSectionIdx + 1 < sectionRanges.length && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 h-5 w-5 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Lock {SUBJECT_LABELS[activeSectionRange.subject].en} &amp; Advance?
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Following SSC CGL Tier-I sectional rules, once you move to{' '}
                  <strong>{SUBJECT_LABELS[sectionRanges[activeSectionIdx + 1].subject].en}</strong>, you
                  cannot return to edit this section.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowNextSectionModal(false)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Stay Here
              </button>
              <button
                type="button"
                onClick={() => advanceToNextSection('manual')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
              >
                <span>Lock &amp; Next Section</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}

      {showRoughPad && (
        <ExamRoughPadModal
          notes={roughNotes}
          onChangeNotes={setRoughNotes}
          onClose={() => setShowRoughPad(false)}
        />
      )}

      {showCalculator && <ExamCalculator onClose={() => setShowCalculator(false)} />}
    </div>
  );
};
