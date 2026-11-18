import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  BookMarked,
  BookOpen,
  CheckCircle2,
  Clock,
  Eye,
  Flag,
  History,
  Languages,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  Target,
  Trash2,
  XCircle,
} from 'lucide-react';
import { aiExplainQuestion, aiTranslateBatch } from '../lib/aiClient';
import {
  createSmartPracticeTest,
  deleteRevisionItem,
  fetchAllQuestionsOnce,
  fetchAttemptResponses,
  fetchMockTestById,
  fetchQuestionsByIds,
  updateRevisionItem,
  type SavedAttemptResponseDoc,
} from '../lib/firestoreService';
import {
  DEFAULT_SCORING_CONFIG,
  SUBJECT_LABELS,
  type LanguageMode,
  type MockTestDoc,
  type QuestionDoc,
  type RevisionItemDoc,
  type ScoringConfig,
  type SubjectKey,
  type TestAttemptDoc,
} from '../types/exam';
import { formatSeconds } from '../utils/examEngine';
import { formatMetadataBadge } from '../utils/questionSchema';
import {
  buildReviewModeRows,
  buildTestHistoryEntries,
  filterReviewModeRows,
  filterTestHistoryEntries,
  summarizeReviewCounts,
  type ReviewFilterMode,
  type TestHistoryCategoryFilter,
  type TestHistoryEntry,
} from '../utils/revisionHistory';
import {
  buildRevisionMicroTopicClusters,
  selectAdaptiveMicroTopicMockQuestions,
} from '../utils/studentAnalyticsEngine';
import {
  hasNativeHindiTranslation,
  MISTAKE_TAGS,
  normalizeTranslationBatchResponse,
  resolveBilingualQuestionView,
  type MistakeTagId,
  type TranslatedQuestionPayload,
} from '../utils/studyCoach';
import { QuestionTimeGraph } from './QuestionTimeGraph';
import { ReportQuestionModal } from './ReportQuestionModal';

interface RevisionVaultProps {
  uid: string;
  loginId?: string;
  studentName?: string;
  items: RevisionItemDoc[];
  attempts?: TestAttemptDoc[];
  tests?: MockTestDoc[];
  scoringConfig?: ScoringConfig;
  launchingTest?: boolean;
  onBack?: () => void;
  onLaunchVaultTest?: (opts: {
    subjectScope: 'full' | SubjectKey;
    includeMastered: boolean;
  }) => Promise<void> | void;
  onLaunchAdaptiveMiniMock?: (test: MockTestDoc) => void;
}

export const RevisionVault: React.FC<RevisionVaultProps> = ({
  uid,
  loginId,
  studentName,
  items,
  attempts = [],
  tests = [],
  scoringConfig = DEFAULT_SCORING_CONFIG,
  launchingTest = false,
  onBack,
  onLaunchVaultTest,
  onLaunchAdaptiveMiniMock,
}) => {
  const [vaultSection, setVaultSection] = useState<'history' | 'mistakes'>('history');

  // --- Test History & Review Mode State ---
  const [historyCategory, setHistoryCategory] = useState<TestHistoryCategoryFilter>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [reviewEntry, setReviewEntry] = useState<TestHistoryEntry | null>(null);
  const [reviewQuestions, setReviewQuestions] = useState<QuestionDoc[]>([]);
  const [reviewResponses, setReviewResponses] = useState<Record<string, SavedAttemptResponseDoc>>({});
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewLoadError, setReviewLoadError] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilterMode>('all');
  const [reviewLang, setReviewLang] = useState<LanguageMode>('en');
  const [reviewAiNotes, setReviewAiNotes] = useState<Record<string, string>>({});
  const [reviewAiBusyId, setReviewAiBusyId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{
    q: QuestionDoc;
    sourceContext: string;
    aiNote?: string;
  } | null>(null);

  // --- Question-Level Mistake Vault State ---
  const [questionsMap, setQuestionsMap] = useState<Record<string, QuestionDoc>>({});
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState<'all' | SubjectKey>('all');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'mastered' | 'all'>('pending');
  const [lang, setLang] = useState<LanguageMode>('en');
  const [questionLangOverrides, setQuestionLangOverrides] = useState<Record<string, LanguageMode>>({});
  const [retrySelection, setRetrySelection] = useState<Record<string, number>>({});
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [liveTranslations, setLiveTranslations] = useState<Record<string, TranslatedQuestionPayload>>({});
  const [translatingQIds, setTranslatingQIds] = useState<Record<string, boolean>>({});
  const requestedTransIdsRef = useRef<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState<'all' | MistakeTagId>('all');
  const [mistakeTags, setMistakeTags] = useState<Record<string, MistakeTagId>>(() => {
    try {
      const raw = localStorage.getItem(`getcgl_mistake_tags_v1_${uid}`);
      return raw ? (JSON.parse(raw) as Record<string, MistakeTagId>) : {};
    } catch {
      return {};
    }
  });

  const historyEntries = useMemo(
    () => buildTestHistoryEntries(attempts, tests),
    [attempts, tests]
  );

  const filteredHistoryEntries = useMemo(
    () =>
      filterTestHistoryEntries(historyEntries, {
        category: historyCategory,
        searchQuery: historySearch,
      }),
    [historyEntries, historyCategory, historySearch]
  );

  const reviewRows = useMemo(
    () => buildReviewModeRows(reviewQuestions, reviewResponses),
    [reviewQuestions, reviewResponses]
  );

  const reviewCounts = useMemo(() => summarizeReviewCounts(reviewRows), [reviewRows]);

  const filteredReviewRows = useMemo(
    () => filterReviewModeRows(reviewRows, reviewFilter),
    [reviewRows, reviewFilter]
  );

  const [selectedClusterKey, setSelectedClusterKey] = useState<string>('all');
  const [miniMockBusyKey, setMiniMockBusyKey] = useState<string | null>(null);
  const [miniMockError, setMiniMockError] = useState<string | null>(null);

  const microTopicClusters = useMemo(
    () =>
      buildRevisionMicroTopicClusters({
        revisionItems: items,
        questionsMap,
      }),
    [items, questionsMap]
  );

  const handleLaunchClusterMiniMock = async (clusterMicroTopic?: string) => {
    if (!onLaunchAdaptiveMiniMock) return;
    setMiniMockError(null);
    const busyId = clusterMicroTopic ?? '__all__';
    setMiniMockBusyKey(busyId);
    try {
      const bankQuestions = await fetchAllQuestionsOnce();
      const targetCluster = clusterMicroTopic
        ? microTopicClusters.find((c) => c.microTopic === clusterMicroTopic)
        : microTopicClusters[0];

      let chosenQuestionIds: string[] = [];
      let label = 'Adaptive Weak-Area Mini-Mock';

      if (clusterMicroTopic && targetCluster) {
        chosenQuestionIds = selectAdaptiveMicroTopicMockQuestions({
          cluster: targetCluster,
          allQuestions: bankQuestions,
          targetCount: 15,
        });
        label = `Adaptive Mini-Mock: ${targetCluster.microTopic}`;
      } else {
        // Multi-cluster weak-area sampler across top 3 urgent micro-topics
        const merged = new Set<string>();
        const coveredNames: string[] = [];
        for (const c of microTopicClusters.slice(0, 3)) {
          const picked = selectAdaptiveMicroTopicMockQuestions({
            cluster: c,
            allQuestions: bankQuestions,
            targetCount: 6,
          });
          if (picked.length > 0) coveredNames.push(c.microTopic);
          for (const id of picked) {
            if (merged.size < 15) merged.add(id);
          }
        }
        chosenQuestionIds = Array.from(merged);
        label = `Adaptive Weak-Area Mini-Mock (${coveredNames.slice(0, 2).join(', ') || 'Mixed'})`;
      }

      if (chosenQuestionIds.length === 0) {
        throw new Error('No weak-topic questions found to assemble an adaptive mini-mock.');
      }
      const created = await createSmartPracticeTest({
        uid,
        title: label.slice(0, 120),
        subjectScope: clusterMicroTopic && targetCluster ? targetCluster.subject : 'full',
        questionIds: chosenQuestionIds,
        durationMinutes: Math.max(5, Math.min(30, chosenQuestionIds.length)),
        scoringConfig,
        published: false,
      });
      onLaunchAdaptiveMiniMock(created);
    } catch (err) {
      setMiniMockError(err instanceof Error ? err.message : 'Unable to launch Adaptive Mini-Mock.');
    } finally {
      setMiniMockBusyKey(null);
    }
  };

  const handleSetMistakeTag = (questionId: string, tagId: MistakeTagId) => {
    setMistakeTags((prev) => {
      const next = { ...prev };
      if (next[questionId] === tagId) {
        delete next[questionId];
      } else {
        next[questionId] = tagId;
      }
      try {
        localStorage.setItem(`getcgl_mistake_tags_v1_${uid}`, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  };

  const requestVaultTranslation = useCallback(async (batch: QuestionDoc[]) => {
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
    if (lang !== 'hi') return;
    const missing = Object.values(questionsMap).filter(
      (q) =>
        (questionLangOverrides[q.id] ?? lang) === 'hi' &&
        !hasNativeHindiTranslation(q) &&
        !liveTranslations[q.id]
    );
    if (missing.length > 0) {
      void requestVaultTranslation(missing.slice(0, 6));
    }
  }, [lang, questionsMap, questionLangOverrides, liveTranslations, requestVaultTranslation]);

  useEffect(() => {
    if (reviewLang !== 'hi' || reviewQuestions.length === 0) return;
    const missing = reviewQuestions.filter(
      (q) =>
        (questionLangOverrides[q.id] ?? reviewLang) === 'hi' &&
        !hasNativeHindiTranslation(q) &&
        !liveTranslations[q.id]
    );
    if (missing.length > 0) {
      void requestVaultTranslation(missing.slice(0, 6));
    }
  }, [reviewLang, reviewQuestions, questionLangOverrides, liveTranslations, requestVaultTranslation]);

  useEffect(() => {
    const missingIds = items
      .map((it) => it.questionId)
      .filter((id) => !checkedIds[id]);
    if (missingIds.length === 0) return;

    setLoading(true);
    fetchQuestionsByIds(missingIds)
      .then((qs) => {
        setQuestionsMap((prev) => {
          const next = { ...prev };
          for (const q of qs) next[q.id] = q;
          return next;
        });
        setCheckedIds((prev) => {
          const next = { ...prev };
          for (const id of missingIds) next[id] = true;
          return next;
        });
      })
      .finally(() => setLoading(false));
  }, [items, checkedIds]);

  const handleOpenReviewMode = async (entry: TestHistoryEntry) => {
    setReviewEntry(entry);
    setReviewLoading(true);
    setReviewLoadError(null);
    setReviewFilter('all');
    setReviewQuestions([]);
    setReviewResponses({});
    try {
      const respMap = await fetchAttemptResponses(uid, entry.attempt.id);
      setReviewResponses(respMap);

      let orderedIds = entry.questionIds;
      if (orderedIds.length === 0) {
        const fetchedTest = await fetchMockTestById(entry.testId);
        if (fetchedTest && Array.isArray(fetchedTest.questionIds) && fetchedTest.questionIds.length > 0) {
          orderedIds = fetchedTest.questionIds;
        } else {
          orderedIds = Object.keys(respMap);
        }
      }

      if (orderedIds.length === 0) {
        setReviewQuestions([]);
        return;
      }

      const qs = await fetchQuestionsByIds(orderedIds);
      const byId = new Map(qs.map((q) => [q.id, q]));
      const orderedQuestions = orderedIds
        .map((id) => byId.get(id))
        .filter((q): q is QuestionDoc => Boolean(q));
      setReviewQuestions(orderedQuestions);
    } catch (err) {
      setReviewLoadError(
        err instanceof Error ? err.message : 'Unable to load saved answers for this test.'
      );
    } finally {
      setReviewLoading(false);
    }
  };

  const handleAskReviewAiExplain = async (q: QuestionDoc, selectedIndex: number) => {
    setReviewAiBusyId(q.id);
    try {
      const data = await aiExplainQuestion({
        questionEn: q.questionEn,
        optionsEn: q.optionsEn,
        correctIndex: q.correctIndex,
        selectedIndex,
        subject: SUBJECT_LABELS[q.subject].en,
        topic: q.topic,
      });
      setReviewAiNotes((prev) => ({ ...prev, [q.id]: data.explanation || '' }));
    } catch (err) {
      setReviewAiNotes((prev) => ({
        ...prev,
        [q.id]: err instanceof Error ? err.message : 'AI explanation unavailable right now.',
      }));
    } finally {
      setReviewAiBusyId(null);
    }
  };

  const filtered = items.filter((item) => {
    if (subjectFilter !== 'all' && item.subject !== subjectFilter) return false;
    if (statusFilter === 'pending' && item.mastered) return false;
    if (statusFilter === 'mastered' && !item.mastered) return false;
    if (tagFilter !== 'all' && mistakeTags[item.questionId] !== tagFilter) return false;
    if (selectedClusterKey !== 'all') {
      const targetCluster = microTopicClusters.find((c) => c.microTopic === selectedClusterKey);
      if (targetCluster && !targetCluster.questionIds.includes(item.questionId)) return false;
    }
    return true;
  });

  const handleToggleMastered = async (item: RevisionItemDoc) => {
    setAiError(null);
    try {
      await updateRevisionItem(uid, item.questionId, { mastered: !item.mastered });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Could not update mastery status.');
    }
  };

  const handleGenerateDeepNote = async (item: RevisionItemDoc, q: QuestionDoc) => {
    setAiError(null);
    setAiLoadingId(item.questionId);
    try {
      const data = await aiExplainQuestion({
        questionEn: q.questionEn,
        optionsEn: q.optionsEn,
        correctIndex: q.correctIndex,
        selectedIndex: item.lastSelectedIndex,
        subject: SUBJECT_LABELS[q.subject].en,
        topic: q.topic,
      });
      await updateRevisionItem(uid, item.questionId, {
        aiDeepNote: String(data.explanation || '').slice(0, 6000),
      });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Deep breakdown failed.');
    } finally {
      setAiLoadingId(null);
    }
  };

  const letters = ['A', 'B', 'C', 'D'];

  const pendingMatchingScope = items.filter(
    (it) => !it.mastered && (subjectFilter === 'all' || it.subject === subjectFilter)
  );
  const allMatchingScope = items.filter(
    (it) => subjectFilter === 'all' || it.subject === subjectFilter
  );

  // --- Dedicated Review Mode View for a Selected Past Test ---
  if (vaultSection === 'history' && reviewEntry) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5 min-w-0">
            <button
              type="button"
              onClick={() => setReviewEntry(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#1e2431] px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Back to Test History</span>
            </button>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              Review Mode · {reviewEntry.testTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Topic: {reviewEntry.topicLabel} · Date: {reviewEntry.dateLabel} · Score:{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {reviewEntry.score} / {reviewEntry.maxScore}
              </strong>{' '}
              · Accuracy:{' '}
              <strong className="text-emerald-700 dark:text-emerald-400">
                {reviewEntry.accuracy}%
              </strong>{' '}
              · Time: {formatSeconds(reviewEntry.totalTimeSec)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setReviewLang((l) => (l === 'en' ? 'hi' : 'en'))}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              <Languages className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <span>{reviewLang === 'en' ? 'English (Switch to हिं)' : 'हिन्दी (Switch to EN)'}</span>
            </button>
          </div>
        </div>

        {/* Review Status Filter */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter reviewed questions">
            {(
              [
                { id: 'all', label: `All Questions (${reviewCounts.all})` },
                { id: 'correct', label: `Correct (${reviewCounts.correct})` },
                { id: 'wrong', label: `Wrong (${reviewCounts.wrong})` },
                { id: 'unanswered', label: `Unanswered (${reviewCounts.unanswered})` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setReviewFilter(f.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  reviewFilter === f.id
                    ? 'bg-slate-900 dark:bg-blue-700 text-white'
                    : 'border border-slate-200 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {reviewLoadError && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 text-xs text-red-900 dark:text-red-200">
            {reviewLoadError}
          </div>
        )}

        {reviewLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-10 text-xs text-slate-600 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>Loading questions, your selected options, and detailed explanations...</span>
          </div>
        ) : filteredReviewRows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-10 text-center space-y-2">
            <BookOpen className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {reviewRows.length === 0
                ? 'Question records for this historical attempt are unavailable.'
                : 'No questions match the selected review filter.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {reviewRows.some((r) => r.timeSpentSec > 0) && (
              <QuestionTimeGraph
                title="Question-Wise Time-Spent Breakdown"
                items={reviewRows.map((row) => ({
                  questionNumber: row.questionNumber,
                  subject: row.question.subject,
                  topic: row.question.topic,
                  timeSpentSec: row.timeSpentSec,
                  isCorrect: row.status === 'correct',
                  isSkipped: row.status === 'unanswered',
                }))}
              />
            )}
            {filteredReviewRows.map((row) => {
              const q = row.question;
              const qLang = questionLangOverrides[q.id] ?? reviewLang;
              const view = resolveBilingualQuestionView(q, qLang, liveTranslations[q.id]);
              const pyqBadge = formatMetadataBadge(q);
              const baseExplanation = view.explanation;

              return (
                <article
                  key={q.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        Q{row.questionNumber}.
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {SUBJECT_LABELS[q.subject].short}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{q.topic}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[11px]">{pyqBadge}</span>
                      {row.timeSpentSec > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{row.timeSpentSec}s</span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {translatingQIds[q.id] && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          <span>Translating...</span>
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const nextL = qLang === 'en' ? 'hi' : 'en';
                          setQuestionLangOverrides((prev) => ({ ...prev, [q.id]: nextL }));
                          if (nextL === 'hi' && !hasNativeHindiTranslation(q) && !liveTranslations[q.id]) {
                            void requestVaultTranslation([q]);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#1e2431] px-2.5 py-1 text-[11px] font-bold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <span>A/अ</span>
                        <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400">
                          {qLang === 'en' ? 'EN' : 'HI'}
                        </span>
                      </button>

                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                          row.status === 'correct'
                            ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                            : row.status === 'wrong'
                              ? 'border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
                              : 'border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {row.status === 'correct' ? (
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>
                          {row.status === 'correct'
                            ? `Correct (${letters[row.selectedIndex]})`
                            : row.status === 'wrong'
                              ? `Wrong · Selected ${letters[row.selectedIndex]}`
                              : 'Unanswered'}
                        </span>
                      </span>
                    </div>
                  </div>

                  <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                    {view.stem}
                  </p>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {view.options.map((opt, optIdx) => {
                      const isCorrectOpt = optIdx === row.correctIndex;
                      const isUserSelected = optIdx === row.selectedIndex;
                      const isChosenWrong = isUserSelected && !isCorrectOpt;

                      return (
                        <div
                          key={optIdx}
                          className={`flex items-start justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
                            isCorrectOpt
                              ? 'border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 font-semibold text-emerald-950 dark:text-emerald-200'
                              : isChosenWrong
                                ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-mono font-bold mr-1.5">{letters[optIdx]}.</span>
                            <span>{opt}</span>
                          </div>
                          <div className="shrink-0 text-[10px] font-bold">
                            {isCorrectOpt && isUserSelected ? (
                              <span className="text-emerald-800 dark:text-emerald-300">
                                ✓ Your Selection · Correct
                              </span>
                            ) : isCorrectOpt ? (
                              <span className="text-emerald-800 dark:text-emerald-300">
                                ✓ Correct Answer
                              </span>
                            ) : isChosenWrong ? (
                              <span className="text-red-800 dark:text-red-300">
                                ✗ Your Selection
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Detailed Explanation Block */}
                  <div className="rounded-lg border border-blue-100 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/25 p-3.5 text-xs text-slate-800 dark:text-slate-200 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-blue-900 dark:text-blue-300">
                        Detailed Explanation · Correct Option: {letters[row.correctIndex]}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        {!reviewAiNotes[q.id] && (
                          <button
                            type="button"
                            disabled={reviewAiBusyId === q.id}
                            onClick={() => void handleAskReviewAiExplain(q, row.selectedIndex)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline disabled:opacity-50 cursor-pointer"
                          >
                            <Sparkles className="h-3 w-3" aria-hidden="true" />
                            <span>
                              {reviewAiBusyId === q.id
                                ? 'Generating AI Shortcut...'
                                : 'Ask AI for Shortcut'}
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setReportTarget({
                              q,
                              sourceContext: `Revision History Review: ${reviewEntry?.testTitle ?? 'Mock Review'}`,
                              aiNote: reviewAiNotes[q.id],
                            })
                          }
                          className="inline-flex items-center gap-1 rounded border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/35 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60 cursor-pointer"
                        >
                          <Flag className="h-3 w-3" aria-hidden="true" />
                          <span>Report Error</span>
                        </button>
                      </div>
                    </div>
                    {baseExplanation ? (
                      <p className="whitespace-pre-wrap leading-relaxed">{baseExplanation}</p>
                    ) : (
                      <p className="text-slate-500 dark:text-slate-400">
                        Correct answer is Option {letters[row.correctIndex]} ({view.options[row.correctIndex]}). Click &ldquo;Ask AI for Shortcut&rdquo; above for a full bilingual derivation.
                      </p>
                    )}
                    {q.shortTrick && (
                      <div className="rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-2.5 py-1.5 text-emerald-900 dark:text-emerald-200">
                        <span className="font-bold">Exam Shortcut: </span>
                        <span>{q.shortTrick}</span>
                      </div>
                    )}
                    {reviewAiNotes[q.id] && (
                      <div className="border-t border-blue-200 dark:border-blue-900/60 pt-2 whitespace-pre-wrap leading-relaxed">
                        {reviewAiNotes[q.id]}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => setReviewEntry(null)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to Test History</span>
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

        <ReportQuestionModal
          open={Boolean(reportTarget)}
          onClose={() => setReportTarget(null)}
          uid={uid}
          loginId={loginId ?? uid}
          studentName={studentName ?? 'Aspirant'}
          question={reportTarget?.q ?? null}
          sourceContext={reportTarget?.sourceContext ?? 'Revision History Review'}
          aiExplanationSnapshot={reportTarget?.aiNote}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Revision Vault Top Header & Section Switcher */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1e2431] px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Back to Mocks &amp; Tasks</span>
            </button>
          )}
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
            Revision Vault
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Review every completed Full Mock &amp; Custom Topic test with answers and explanations, or drill your mistake questions.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Revision Vault Views"
          className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#11151d] p-1 self-start sm:self-center"
        >
          <button
            type="button"
            role="tab"
            aria-selected={vaultSection === 'history'}
            onClick={() => setVaultSection('history')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              vaultSection === 'history'
                ? 'bg-blue-700 text-white'
                : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Test History ({historyEntries.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={vaultSection === 'mistakes'}
            onClick={() => setVaultSection('mistakes')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              vaultSection === 'mistakes'
                ? 'bg-blue-700 text-white'
                : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BookMarked className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Mistake Questions ({items.filter((i) => !i.mastered).length})</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: Test History List */}
      {vaultSection === 'history' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 dark:bg-[#141923] p-1">
              {(
                [
                  { id: 'all', label: `All Tests (${historyEntries.length})` },
                  {
                    id: 'full',
                    label: `Full Mocks (${historyEntries.filter((e) => e.category === 'full').length})`,
                  },
                  {
                    id: 'custom_topic',
                    label: `Custom Topics (${historyEntries.filter((e) => e.category === 'custom_topic').length})`,
                  },
                  {
                    id: 'sectional',
                    label: `Sectionals (${historyEntries.filter((e) => e.category === 'sectional').length})`,
                  },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setHistoryCategory(cat.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    historyCategory === cat.id
                      ? 'bg-[#faf9f6] dark:bg-[#1e2533] text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search by topic or test title..."
                aria-label="Search past tests"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] py-2 pl-8 pr-3 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {filteredHistoryEntries.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-10 text-center space-y-2.5">
              <History className="mx-auto h-7 w-7 text-slate-400 dark:text-slate-500" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {historyEntries.length === 0
                  ? 'No completed tests in your Revision Vault yet.'
                  : 'No past tests match your filter or search.'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Complete any Tier-I Full Mock or Smart Topic Custom Test and it will appear here for full question-by-question review.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27]">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Topic &amp; Test</th>
                    <th className="px-4 py-3 text-right font-semibold">Score</th>
                    <th className="px-4 py-3 text-right font-semibold">Accuracy</th>
                    <th className="px-4 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredHistoryEntries.map((entry) => (
                    <tr
                      key={entry.attempt.id}
                      onClick={() => void handleOpenReviewMode(entry)}
                      className="hover:bg-slate-50 dark:hover:bg-[#1e2431]/80 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap tabular-nums">
                        {entry.dateLabel}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {entry.topicLabel}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {entry.testTitle} · {entry.correctCount}R / {entry.wrongCount}W / {entry.skippedCount}S ·{' '}
                          <Clock className="inline h-3 w-3 mr-0.5" aria-hidden="true" />
                          <span className="font-mono tabular-nums">{formatSeconds(entry.totalTimeSec)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap tabular-nums">
                        {entry.score} / {entry.maxScore}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400 whitespace-nowrap tabular-nums">
                        {entry.accuracy}%
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleOpenReviewMode(entry);
                          }}
                          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-3 py-1.5 text-xs font-semibold text-blue-800 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 whitespace-nowrap cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Review Mode</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: Question-Level Mistake Vault (Preserved Full Feature Set) */}
      {vaultSection === 'mistakes' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {onLaunchVaultTest && pendingMatchingScope.length > 0 && (
                <button
                  type="button"
                  disabled={launchingTest}
                  onClick={() =>
                    onLaunchVaultTest({
                      subjectScope: subjectFilter === 'all' ? 'full' : subjectFilter,
                      includeMastered: false,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {launchingTest
                      ? 'Building Re-Test...'
                      : `Re-Test Pending (${pendingMatchingScope.length} Qs)`}
                  </span>
                </button>
              )}
              {onLaunchVaultTest && allMatchingScope.length > 0 && (
                <button
                  type="button"
                  disabled={launchingTest}
                  onClick={() =>
                    onLaunchVaultTest({
                      subjectScope: subjectFilter === 'all' ? 'full' : subjectFilter,
                      includeMastered: true,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/35 px-3.5 py-2 text-xs font-semibold text-blue-800 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/60 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Spaced Review All ({allMatchingScope.length} Qs)</span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setLang((l) => (l === 'en' ? 'hi' : 'en'))}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Languages className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <span>{lang === 'en' ? 'Language: English (Switch to हिं)' : 'भाषा: हिन्दी (Switch to EN)'}</span>
            </button>
          </div>

          {/* Smart Revision Vault 2.0 — Micro-Topic Weakness Clusters */}
          {microTopicClusters.length > 0 && (
            <section className="rounded-xl border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5">
                    <Target className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                    <span>Smart Revision Vault 2.0 · Weak Micro-Topic Clusters</span>
                  </h3>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    Auto-categorized from your wrong &amp; skipped mistakes. Click any micro-topic to filter or launch an Adaptive Mini-Mock.
                  </p>
                </div>
                {onLaunchAdaptiveMiniMock && (
                  <button
                    type="button"
                    disabled={miniMockBusyKey !== null || launchingTest}
                    onClick={() => void handleLaunchClusterMiniMock()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {miniMockBusyKey === '__all__'
                        ? 'Building Mini-Mock...'
                        : 'Adaptive Weak-Area Mini-Mock (15 Qs)'}
                    </span>
                  </button>
                )}
              </div>

              {miniMockError && (
                <p className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-900 dark:text-red-200">
                  {miniMockError}
                </p>
              )}

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {microTopicClusters.slice(0, 6).map((cluster) => {
                  const isActive = selectedClusterKey === cluster.microTopic;
                  return (
                    <div
                      key={`${cluster.subject}_${cluster.microTopic}`}
                      className={`rounded-lg border p-3 text-xs space-y-2 transition-colors ${
                        isActive
                          ? 'border-indigo-600 bg-[#faf9f6] dark:bg-[#181d27] ring-1 ring-indigo-600'
                          : 'border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedClusterKey((prev) =>
                              prev === cluster.microTopic ? 'all' : cluster.microTopic
                            )
                          }
                          className="text-left font-bold text-slate-900 dark:text-slate-100 hover:text-indigo-700 dark:hover:text-indigo-400 cursor-pointer"
                        >
                          {cluster.microTopic}
                        </button>
                        <span className="rounded bg-amber-100 dark:bg-amber-950/50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-900 dark:text-amber-300 shrink-0">
                          {cluster.pendingCount} pending
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-mono">
                          {cluster.wrongCount}W · {cluster.skippedCount}S · {cluster.masteredCount}M
                        </span>
                        {onLaunchAdaptiveMiniMock && (
                          <button
                            type="button"
                            disabled={miniMockBusyKey !== null || launchingTest}
                            onClick={() => void handleLaunchClusterMiniMock(cluster.microTopic)}
                            className="font-semibold text-indigo-700 dark:text-indigo-400 hover:underline disabled:opacity-50 cursor-pointer"
                          >
                            {miniMockBusyKey === cluster.microTopic ? 'Launching...' : 'Mini-Mock →'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedClusterKey !== 'all' && (
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setSelectedClusterKey('all')}
                    className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    Clear Micro-Topic Filter
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 dark:bg-[#141923] p-1">
              {(['all', 'quant', 'reasoning', 'english', 'ga'] as const).map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setSubjectFilter(sub)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    subjectFilter === sub
                      ? 'bg-[#faf9f6] dark:bg-[#1e2533] text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {sub === 'all' ? 'All Sections' : SUBJECT_LABELS[sub].short}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-[#141923] p-1">
              {(['pending', 'mastered', 'all'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    statusFilter === st
                      ? 'bg-[#faf9f6] dark:bg-[#1e2533] text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {st === 'pending' ? 'Needs Review' : st === 'mastered' ? 'Mastered' : 'All'}
                </button>
              ))}
            </div>
          </div>

          {/* Mistake Cause Tag Filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-1">
              <Tag className="h-3 w-3" aria-hidden="true" />
              <span>Mistake Type:</span>
            </span>
            <button
              type="button"
              onClick={() => setTagFilter('all')}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                tagFilter === 'all'
                  ? 'bg-slate-900 dark:bg-blue-700 text-white'
                  : 'border border-slate-200 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              All Tags
            </button>
            {MISTAKE_TAGS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTagFilter(t.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                  tagFilter === t.id
                    ? 'bg-blue-700 text-white'
                    : 'border border-slate-200 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {aiError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-900 dark:text-red-200">
              {aiError}
            </div>
          )}

          {loading && filtered.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Loading saved questions...
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-10 text-center space-y-3">
              <BookMarked className="mx-auto h-7 w-7 text-slate-400 dark:text-slate-500" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {items.length === 0
                  ? 'Your Mistake Vault is clean.'
                  : 'No questions match the selected section/status filter.'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Any question answered wrong or left skipped during a mock test is automatically filed here for targeted revision.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {items.length > 0 && (subjectFilter !== 'all' || statusFilter !== 'all' || tagFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSubjectFilter('all');
                      setStatusFilter('all');
                      setTagFilter('all');
                    }}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Show All Vault Questions
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {filtered.map((item) => {
                const q = questionsMap[item.questionId];
                if (!q) {
                  if (!checkedIds[item.questionId]) return null;
                  return (
                    <article
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/30 p-4 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-amber-950 dark:text-amber-200">
                          Question Removed from Bank · {SUBJECT_LABELS[item.subject].short}
                        </div>
                        <div className="text-amber-800 dark:text-amber-300">
                          From: {item.testTitle} — Removed from Master Bank.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          setAiError(null);
                          try {
                            await deleteRevisionItem(uid, item.questionId);
                          } catch (err) {
                            setAiError(err instanceof Error ? err.message : 'Could not remove item from Vault.');
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3 py-1.5 font-semibold text-amber-950 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950/60 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Remove from Vault</span>
                      </button>
                    </article>
                  );
                }
                const qLang = questionLangOverrides[q.id] ?? lang;
                const view = resolveBilingualQuestionView(q, qLang, liveTranslations[q.id]);
                const stem = view.stem;
                const options = view.options;
                const explanation = view.explanation;
                const picked = retrySelection[item.questionId];
                const pyqBadge = formatMetadataBadge(q);

                return (
                  <article
                    key={item.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {SUBJECT_LABELS[item.subject].short}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span>{q.topic}</span>
                        <span className="rounded border border-blue-200 dark:border-blue-800/70 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-800 dark:text-blue-300">
                          {pyqBadge}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span>From: {item.testTitle}</span>
                        <span aria-hidden="true"> · </span>
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            item.lastSelectedIndex === -1
                              ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                          }`}
                        >
                          {item.lastSelectedIndex === -1 ? 'Skipped / Unanswered' : 'Wrong Answer'}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span>{item.mastered ? 'Status: Mastered' : 'Status: Needs Review'}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {translatingQIds[q.id] && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            Translating...
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const nextL = qLang === 'en' ? 'hi' : 'en';
                            setQuestionLangOverrides((prev) => ({
                              ...prev,
                              [q.id]: nextL,
                            }));
                            if (nextL === 'hi' && !hasNativeHindiTranslation(q) && !liveTranslations[q.id]) {
                              void requestVaultTranslation([q]);
                            }
                          }}
                          title="Toggle this question between English and Hindi"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#1e2431] px-2.5 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <span>A/अ</span>
                          <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400">
                            {qLang === 'en' ? 'EN' : 'HI'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleMastered(item)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                            item.mastered
                              ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100'
                              : 'border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{item.mastered ? 'Mastered' : 'Mark Mastered'}</span>
                        </button>
                      </div>
                    </div>

                    <p className="text-sm font-medium leading-relaxed text-slate-900 dark:text-slate-100">{stem}</p>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {options.map((opt, idx) => {
                        const isCorrect = idx === q.correctIndex;
                        const wasMistake = idx === item.lastSelectedIndex;
                        const isRetried = picked === idx;
                        let cls =
                          'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] text-slate-800 dark:text-slate-200';
                        if (picked !== undefined) {
                          if (isCorrect)
                            cls =
                              'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-200 font-semibold';
                          else if (isRetried)
                            cls =
                              'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200';
                        } else if (wasMistake) {
                          cls =
                            'border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/35 text-amber-950 dark:text-amber-200';
                        }

                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() =>
                              setRetrySelection((prev) => ({ ...prev, [item.questionId]: idx }))
                            }
                            className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-left text-xs transition-colors cursor-pointer ${cls}`}
                          >
                            <span className="font-mono font-bold">{letters[idx]}.</span>
                            <span className="flex-1">{opt}</span>
                            {wasMistake && picked === undefined && (
                              <span className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
                                Your mistake
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                      <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <div>
                          Correct Answer:{' '}
                          <strong className="text-emerald-800 dark:text-emerald-300">
                            {letters[q.correctIndex]} ({options[q.correctIndex]})
                          </strong>
                          {explanation ? ` — ${explanation}` : ''}
                        </div>
                        {q.shortTrick && (
                          <div className="rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-2.5 py-1 text-emerald-900 dark:text-emerald-200">
                            <span className="font-bold">Short Trick: </span>
                            <span>{q.shortTrick}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setReportTarget({
                              q,
                              sourceContext: `Smart Revision Vault: ${q.topic}`,
                              aiNote: item.aiDeepNote,
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/35 px-2.5 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60 whitespace-nowrap cursor-pointer"
                        >
                          <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Report Error</span>
                        </button>
                        <button
                          type="button"
                          disabled={aiLoadingId === item.questionId}
                          onClick={() => handleGenerateDeepNote(item, q)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/35 px-3 py-1.5 text-xs font-semibold text-blue-800 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/60 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                        >
                          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            {aiLoadingId === item.questionId
                              ? 'Thinking deeply...'
                              : item.aiDeepNote
                                ? 'Refresh Bilingual Breakdown'
                                : 'Generate Bilingual Breakdown'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Quick Mistake Cause Tagging */}
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 dark:border-slate-800 pt-2.5">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1">
                        Why was this missed?
                      </span>
                      {MISTAKE_TAGS.map((tag) => {
                        const active = mistakeTags[item.questionId] === tag.id;
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            title={tag.hint}
                            onClick={() => handleSetMistakeTag(item.questionId, tag.id)}
                            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                              active
                                ? 'bg-blue-700 text-white'
                                : 'border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#131720] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            {tag.label}
                          </button>
                        );
                      })}
                    </div>

                    {item.aiDeepNote && (
                      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] p-4 text-xs leading-relaxed whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                        {item.aiDeepNote}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {onBack && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to Mocks &amp; Tasks</span>
          </button>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to Top</span>
          </button>
        </div>
      )}
      <ReportQuestionModal
        open={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        uid={uid}
        loginId={loginId ?? uid}
        studentName={studentName ?? 'Aspirant'}
        question={reportTarget?.q ?? null}
        sourceContext={reportTarget?.sourceContext ?? 'Smart Revision Vault'}
        aiExplanationSnapshot={reportTarget?.aiNote}
      />
    </div>
  );
};
