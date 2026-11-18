import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  Clock,
  Flag,
  Languages,
  Play,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { aiExplainQuestion } from '../lib/aiClient';
import {
  createSmartPracticeTest,
  fetchAllQuestionsOnce,
  fetchAttemptResponses,
  fetchQuestionsByIds,
  type SavedAttemptResponseDoc,
} from '../lib/firestoreService';
import {
  SUBJECT_LABELS,
  type LanguageMode,
  type MockTestDoc,
  type QuestionDoc,
  type RevisionItemDoc,
  type ScoringConfig,
  type SubjectKey,
  type TestAttemptDoc,
} from '../types/exam';
import { computeTargetCutoffBenchmark } from '../utils/dreamPostCatalog';
import {
  buildCompletedRevisionQuestionIds,
  formatDateTimeShort,
  formatSeconds,
  getAttemptCompletionPercent,
  getAttemptStatusLabel,
  summarizeCompletedTests,
  type CompletedTestGroup,
} from '../utils/examEngine';
import { formatMetadataBadge } from '../utils/questionSchema';
import { ReportQuestionModal } from './ReportQuestionModal';

interface CompletedTestsPanelProps {
  uid: string;
  loginId?: string;
  studentName?: string;
  targetPost?: string;
  attempts: TestAttemptDoc[];
  tests: MockTestDoc[];
  revisionItems: RevisionItemDoc[];
  scoringConfig: ScoringConfig;
  onBack: () => void;
  onLaunchRevisionTest: (test: MockTestDoc) => void;
}

type ReaderFilter = 'all' | 'wrong' | 'skipped' | 'correct';

export const CompletedTestsPanel: React.FC<CompletedTestsPanelProps> = ({
  uid,
  loginId,
  studentName,
  targetPost,
  attempts,
  tests,
  revisionItems,
  scoringConfig,
  onBack,
  onLaunchRevisionTest,
}) => {
  const completedGroups = useMemo(
    () => summarizeCompletedTests(attempts, tests),
    [attempts, tests]
  );

  // Selected tests for Revision Test Generator
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [revCount, setRevCount] = useState<number>(20);
  const [prioritizeWeak, setPrioritizeWeak] = useState(true);
  const [revBusy, setRevBusy] = useState(false);
  const [revError, setRevError] = useState<string | null>(null);

  // Read Questions & Solutions state
  const [readingGroup, setReadingGroup] = useState<CompletedTestGroup | null>(null);
  const [readerQuestions, setReaderQuestions] = useState<QuestionDoc[]>([]);
  const [readerResponses, setReaderResponses] = useState<Record<string, SavedAttemptResponseDoc>>({});
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerLang, setReaderLang] = useState<LanguageMode>('en');
  const [questionLangOverrides, setQuestionLangOverrides] = useState<Record<string, LanguageMode>>({});
  const [readerFilter, setReaderFilter] = useState<ReaderFilter>('all');
  const [aiNotes, setAiNotes] = useState<Record<string, string>>({});
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ q: QuestionDoc; aiNote?: string } | null>(null);

  const toggleSelectTest = (testId: string) => {
    setSelectedTestIds((prev) =>
      prev.includes(testId) ? prev.filter((id) => id !== testId) : [...prev, testId]
    );
  };

  const handleOpenReader = async (group: CompletedTestGroup) => {
    setReadingGroup(group);
    setReaderLoading(true);
    setReaderFilter('all');
    try {
      const respMap = await fetchAttemptResponses(uid, group.latestAttempt.id);
      setReaderResponses(respMap);
      const qIds =
        group.questionIds.length > 0 ? group.questionIds : Object.keys(respMap);
      const qs = qIds.length > 0 ? await fetchQuestionsByIds(qIds) : [];
      setReaderQuestions(qs);
    } catch {
      setReaderQuestions([]);
      setReaderResponses({});
    } finally {
      setReaderLoading(false);
    }
  };

  const handleAskAiExplain = async (q: QuestionDoc, selectedIndex: number) => {
    setAiLoadingId(q.id);
    try {
      const data = await aiExplainQuestion({
        questionEn: q.questionEn,
        optionsEn: q.optionsEn,
        correctIndex: q.correctIndex,
        selectedIndex,
        subject: q.subject,
        topic: q.topic,
      });
      setAiNotes((prev) => ({ ...prev, [q.id]: data.explanation || '' }));
    } catch (err) {
      setAiNotes((prev) => ({
        ...prev,
        [q.id]: err instanceof Error ? err.message : 'AI shortcut unavailable right now.',
      }));
    } finally {
      setAiLoadingId(null);
    }
  };

  const handleGenerateCompletedRevisionTest = async (explicitTestIds?: string[]) => {
    setRevError(null);
    const targetIds =
      explicitTestIds && explicitTestIds.length > 0
        ? explicitTestIds
        : selectedTestIds.length > 0
          ? selectedTestIds
          : completedGroups.map((g) => g.testId);

    if (targetIds.length === 0) {
      setRevError('Complete at least 1 mock test first to generate a revision test from it.');
      return;
    }

    setRevBusy(true);
    try {
      const allBank = await fetchAllQuestionsOnce();
      const missingTests = targetIds.filter((tid) => !tests.some((t) => t.id === tid));
      let effectiveTests = [...tests];

      // Recover questionIds from latest attempt responses if original test doc was deleted
      if (missingTests.length > 0) {
        const extraMocks: MockTestDoc[] = [];
        for (const tid of missingTests) {
          const grp = completedGroups.find((g) => g.testId === tid);
          if (!grp) continue;
          const respMap = await fetchAttemptResponses(uid, grp.latestAttempt.id);
          const recoveredIds = Object.keys(respMap);
          if (recoveredIds.length > 0) {
            extraMocks.push({
              id: tid,
              title: grp.testTitle,
              subjectScope: (['full', 'quant', 'reasoning', 'english', 'ga'].includes(grp.subjectScope)
                ? grp.subjectScope
                : 'full') as 'full' | SubjectKey,
              durationMinutes: 15,
              positiveMarks: scoringConfig.pointsPerCorrect,
              negativeMarks: scoringConfig.negativeMarks,
              questionIds: recoveredIds,
              questionCount: recoveredIds.length,
              published: false,
              createdBy: uid,
            });
          }
        }
        effectiveTests = [...effectiveTests, ...extraMocks];
      }

      const sel = buildCompletedRevisionQuestionIds({
        selectedTestIds: targetIds,
        tests: effectiveTests,
        revisionItems,
        allQuestions: allBank,
        maxQuestions: revCount,
        prioritizeWeak,
        seedKey: `comp_${uid}_${Date.now()}`,
      });

      if (sel.questionIds.length === 0) {
        throw new Error(
          'No active questions from those completed tests remain in the Question Bank.'
        );
      }

      const created = await createSmartPracticeTest({
        uid,
        title: `Completed Tests Revision (${sel.questionIds.length} Qs)`,
        subjectScope: 'full',
        questionIds: sel.questionIds,
        durationMinutes: Math.max(8, Math.min(60, sel.questionIds.length)),
        scoringConfig,
        published: false,
      });
      onLaunchRevisionTest(created);
    } catch (err) {
      setRevError(
        err instanceof Error ? err.message : 'Could not build revision test from completed tests.'
      );
    } finally {
      setRevBusy(false);
    }
  };

  if (readingGroup) {
    const filteredQs = readerQuestions.filter((q) => {
      const r = readerResponses[q.id];
      const sel = r ? r.selectedIndex : -1;
      const isCorrect = sel === q.correctIndex;
      const isSkipped = sel < 0 || sel > 3;
      if (readerFilter === 'wrong') return !isSkipped && !isCorrect;
      if (readerFilter === 'skipped') return isSkipped;
      if (readerFilter === 'correct') return isCorrect;
      return true;
    });

    const letters = ['A', 'B', 'C', 'D'];

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setReadingGroup(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#1e2431] px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Back to Completed Tests</span>
            </button>
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                {readingGroup.testTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Score: {readingGroup.latestAttempt.score}/{readingGroup.latestAttempt.maxScore} · Accuracy:{' '}
                {readingGroup.latestAttempt.accuracy}%
                {targetPost && (() => {
                  const bm = computeTargetCutoffBenchmark(
                    targetPost,
                    readingGroup.latestAttempt.score,
                    readingGroup.latestAttempt.maxScore
                  );
                  return ` · ${bm.postLabel} Cut-Off Delta: ${bm.deltaMarks >= 0 ? '+' : ''}${bm.deltaMarks}`;
                })()}
                {' '}· Read mode with answers &amp; explanations
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setReaderLang((l) => (l === 'en' ? 'hi' : 'en'))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Languages className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <span>{readerLang === 'en' ? 'English / Switch Hindi' : 'हिन्दी / Switch EN'}</span>
            </button>
            <button
              type="button"
              disabled={revBusy}
              onClick={() => void handleGenerateCompletedRevisionTest([readingGroup.testId])}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Re-Test These Questions</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'all', label: `All (${readerQuestions.length})` },
              {
                id: 'wrong',
                label: `Wrong (${readerQuestions.filter((q) => {
                  const sel = readerResponses[q.id]?.selectedIndex ?? -1;
                  return sel >= 0 && sel <= 3 && sel !== q.correctIndex;
                }).length})`,
              },
              {
                id: 'skipped',
                label: `Unanswered · 0 -ve (${readerQuestions.filter((q) => {
                  const sel = readerResponses[q.id]?.selectedIndex ?? -1;
                  return sel < 0 || sel > 3;
                }).length})`,
              },
              {
                id: 'correct',
                label: `Correct (${readerQuestions.filter((q) => readerResponses[q.id]?.selectedIndex === q.correctIndex).length})`,
              },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setReaderFilter(f.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                readerFilter === f.id
                  ? 'bg-slate-900 dark:bg-blue-700 text-white'
                  : 'border border-slate-200 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {readerLoading ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-8 text-center text-xs text-slate-600 dark:text-slate-400">
            Loading test questions, your saved answers, and solutions...
          </div>
        ) : filteredQs.length === 0 ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No questions match this filter inside this completed test.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredQs.map((q, idx) => {
              const resp = readerResponses[q.id];
              const selectedIdx = resp ? resp.selectedIndex : -1;
              const isSkipped = selectedIdx < 0 || selectedIdx > 3;
              const isCorrect = !isSkipped && selectedIdx === q.correctIndex;
              const qLang = questionLangOverrides[q.id] ?? readerLang;
              const opts =
                qLang === 'hi' && q.optionsHi && q.optionsHi.length === 4
                  ? q.optionsHi
                  : q.optionsEn;
              const qText =
                qLang === 'hi' && q.questionHi ? q.questionHi : q.questionEn;
              const baseExplanation =
                qLang === 'hi' && q.explanationHi
                  ? q.explanationHi
                  : q.explanationEn || q.explanationHi;
              const pyqBadge = formatMetadataBadge(q);

              return (
                <article
                  key={q.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-slate-900 dark:text-slate-100">Q{idx + 1}.</span>
                      <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-semibold text-slate-700 dark:text-slate-300">
                        {SUBJECT_LABELS[q.subject].short} · {q.topic}
                      </span>
                      <span className="rounded border border-blue-200 dark:border-blue-800/70 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-800 dark:text-blue-300">
                        {pyqBadge}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setQuestionLangOverrides((prev) => ({
                            ...prev,
                            [q.id]: qLang === 'en' ? 'hi' : 'en',
                          }))
                        }
                        title="Toggle this question between English and Hindi"
                        className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#1e2431] px-2 py-0.5 text-[11px] font-bold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <span>A/अ</span>
                        <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400">
                          {qLang === 'en' ? 'EN' : 'HI'}
                        </span>
                      </button>
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold ${
                          isCorrect
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
                            : isSkipped
                              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60'
                              : 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800/60'
                        }`}
                      >
                        {isCorrect ? (
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>
                          {isCorrect
                            ? 'Correct'
                            : isSkipped
                              ? 'Unanswered · Marked Wrong (0 -ve penalty)'
                              : `Wrong (Marked ${letters[selectedIdx] ?? '?'})`}
                        </span>
                      </span>
                    </div>
                  </div>

                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-relaxed whitespace-pre-wrap">
                    {qText}
                  </p>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {opts.map((opt, optIdx) => {
                      const isRightOpt = optIdx === q.correctIndex;
                      const isChosenWrong = optIdx === selectedIdx && !isRightOpt;
                      return (
                        <div
                          key={optIdx}
                          className={`rounded-lg border px-3 py-2 text-xs ${
                            isRightOpt
                              ? 'border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 font-semibold text-emerald-950 dark:text-emerald-200'
                              : isChosenWrong
                                ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <span className="font-mono font-bold mr-1.5">{letters[optIdx]}.</span>
                          <span>{opt}</span>
                          {isRightOpt && (
                            <span className="ml-2 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                              ✓ Correct
                            </span>
                          )}
                          {isChosenWrong && (
                            <span className="ml-2 text-[10px] font-bold text-red-800 dark:text-red-300">
                              ✗ Your Choice
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {(baseExplanation || q.shortTrick || aiNotes[q.id]) && (
                    <div className="rounded-lg border border-blue-100 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/25 p-3 text-xs text-slate-800 dark:text-slate-200 space-y-1.5">
                      <div className="font-bold text-blue-900 dark:text-blue-300">Solution / Explanation:</div>
                      {baseExplanation && (
                        <p className="whitespace-pre-wrap leading-relaxed">{baseExplanation}</p>
                      )}
                      {q.shortTrick && (
                        <div className="rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-2.5 py-1.5 text-emerald-900 dark:text-emerald-200">
                          <span className="font-bold">Short Trick: </span>
                          <span>{q.shortTrick}</span>
                        </div>
                      )}
                      {aiNotes[q.id] && (
                        <p className="whitespace-pre-wrap leading-relaxed border-t border-blue-200 dark:border-blue-900/60 pt-2">
                          {aiNotes[q.id]}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    {!aiNotes[q.id] ? (
                      <button
                        type="button"
                        disabled={aiLoadingId === q.id}
                        onClick={() => void handleAskAiExplain(q, selectedIdx)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline disabled:opacity-50 cursor-pointer"
                      >
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {aiLoadingId === q.id
                            ? 'Generating Bilingual Shortcut...'
                            : 'Get Detailed Bilingual Shortcut'}
                        </span>
                      </button>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      onClick={() => setReportTarget({ q, aiNote: aiNotes[q.id] })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/60 cursor-pointer"
                    >
                      <Flag className="h-3 w-3" aria-hidden="true" />
                      <span>Report Error</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => setReadingGroup(null)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to Completed Tests</span>
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
          sourceContext={`Completed Tests Archive: ${readingGroup.testTitle}`}
          aiExplanationSnapshot={reportTarget?.aiNote}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Mocks &amp; Tasks</span>
        </button>
        <span className="font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
          {completedGroups.length} Unique Completed Test{completedGroups.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Revision Test Builder from Completed Tests */}
      <section className="rounded-2xl border border-blue-200 dark:border-blue-900/50 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              Completed Tests Archive &amp; Revision Test Builder
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Only tests with &gt;80% questions attempted qualify as completed. Read solutions or build targeted revision drills below.
            </p>
          </div>
          {completedGroups.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setSelectedTestIds(
                  selectedTestIds.length === completedGroups.length
                    ? []
                    : completedGroups.map((g) => g.testId)
                )
              }
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#1e2431] px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              {selectedTestIds.length === completedGroups.length
                ? 'Clear Selection'
                : `Select All (${completedGroups.length})`}
            </button>
          )}
        </div>

        {revError && (
          <p className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-900 dark:text-red-200">
            {revError}
          </p>
        )}

        {completedGroups.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] p-4">
            <div className="sm:col-span-4">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Selected Scope</div>
              <div className="mt-1 text-xs font-bold text-slate-900 dark:text-slate-100">
                {selectedTestIds.length > 0
                  ? `${selectedTestIds.length} test(s) checked`
                  : `All ${completedGroups.length} completed test(s)`}
              </div>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="comp-rev-count" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                Revision Questions
              </label>
              <select
                id="comp-rev-count"
                value={revCount}
                onChange={(e) => setRevCount(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] px-3 py-2 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100"
              >
                <option value={10}>10 Qs (10m)</option>
                <option value={20}>20 Qs (20m)</option>
                <option value={30}>30 Qs (30m)</option>
                <option value={50}>50 Qs (50m)</option>
              </select>
            </div>

            <div className="sm:col-span-5">
              <button
                type="button"
                disabled={revBusy}
                onClick={() => void handleGenerateCompletedRevisionTest()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {revBusy
                    ? 'Building Revision Test...'
                    : 'Start Revision Test from Completed'}
                </span>
              </button>
            </div>

            <label className="sm:col-span-12 inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={prioritizeWeak}
                onChange={(e) => setPrioritizeWeak(e.target.checked)}
                className="accent-blue-700"
              />
              <span>Prioritize wrong &amp; skipped questions from these completed tests first</span>
            </label>
          </div>
        )}
      </section>

      {/* List of Completed Tests */}
      {completedGroups.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-10 text-center space-y-2">
          <BookOpen className="mx-auto h-6 w-6 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">No completed tests yet.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Attempt more than 80% of questions in any mock test or daily sprint to mark it completed here!
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {completedGroups.map((grp) => {
            const checked = selectedTestIds.includes(grp.testId);
            const scopeName =
              grp.subjectScope === 'full'
                ? 'Full Mixed'
                : SUBJECT_LABELS[grp.subjectScope as SubjectKey]?.short ?? grp.subjectScope;
            const latestMs = (() => {
              const raw = grp.latestAttempt.createdAt as { toMillis?: () => number } | undefined;
              return raw && typeof raw.toMillis === 'function' ? raw.toMillis() : undefined;
            })();
            const pct = getAttemptCompletionPercent(grp.latestAttempt);
            const hasSkipped = grp.latestAttempt.skippedCount > 0;
            const statusText = getAttemptStatusLabel(grp.latestAttempt);

            return (
              <article
                key={grp.testId}
                className={`rounded-xl border bg-[#faf9f6] dark:bg-[#181d27] p-5 transition-colors ${
                  checked
                    ? 'border-blue-600 ring-1 ring-blue-600'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelectTest(grp.testId)}
                      className="mt-1 h-4 w-4 accent-blue-700"
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                          {grp.testTitle}
                        </h3>
                        <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                          {scopeName}
                        </span>
                        {!hasSkipped ? (
                          <span className="rounded border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
                            {statusText}
                          </span>
                        ) : (
                          <span className="rounded border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                            {pct}% Solved · {grp.latestAttempt.skippedCount} Skipped → Vault
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                        Best Score: <strong>{grp.bestScore}/{grp.maxScore}</strong>
                        {targetPost && (() => {
                          const bm = computeTargetCutoffBenchmark(targetPost, grp.bestScore, grp.maxScore);
                          return (
                            <>
                              {' '}·{' '}
                              <span
                                className={
                                  bm.isAboveCutoff
                                    ? 'text-emerald-700 dark:text-emerald-400 font-bold'
                                    : 'text-amber-700 dark:text-amber-400 font-bold'
                                }
                              >
                                {bm.deltaMarks >= 0 ? '+' : ''}{bm.deltaMarks} vs {bm.postLabel} ({bm.scaledCutoff}/{bm.maxScore})
                              </span>
                            </>
                          );
                        })()}
                        {' '}· Best Acc:{' '}
                        <strong>{grp.bestAccuracy}%</strong> · Attempted {grp.attemptCount}x ·{' '}
                        <Clock className="inline h-3 w-3 mr-0.5" aria-hidden="true" />
                        {formatSeconds(grp.latestAttempt.totalTimeSec)}
                        {latestMs ? ` · ${formatDateTimeShort(latestMs)}` : ''}
                      </p>
                    </div>
                  </label>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleOpenReader(grp)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <BookOpen className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                      <span>Read Questions &amp; Solutions</span>
                    </button>
                    <button
                      type="button"
                      disabled={revBusy}
                      onClick={() => void handleGenerateCompletedRevisionTest([grp.testId])}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-600 disabled:opacity-50 cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Revision Test</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

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
    </div>
  );
};
