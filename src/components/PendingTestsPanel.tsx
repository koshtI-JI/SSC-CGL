import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookMarked,
  Clock,
  FolderClock,
  Play,
} from 'lucide-react';
import {
  SUBJECT_LABELS,
  type MockTestDoc,
  type RevisionItemDoc,
  type SubjectKey,
  type TestAttemptDoc,
  type TestDraftDoc,
} from '../types/exam';
import {
  formatDateTimeShort,
  formatSeconds,
  getMinQuestionsForXp,
  summarizePendingTests,
} from '../utils/examEngine';

interface PendingTestsPanelProps {
  tests: MockTestDoc[];
  attempts: TestAttemptDoc[];
  testDrafts: TestDraftDoc[];
  revisionItems: RevisionItemDoc[];
  onBack: () => void;
  onResumeDraft: (test: MockTestDoc) => void;
  onResumeIncompleteAttempt: (test: MockTestDoc, attemptId: string) => void;
  onOpenVault: () => void;
}

export const PendingTestsPanel: React.FC<PendingTestsPanelProps> = ({
  tests,
  attempts,
  testDrafts,
  revisionItems,
  onBack,
  onResumeDraft,
  onResumeIncompleteAttempt,
  onOpenVault,
}) => {
  const testById = useMemo(() => new Map(tests.map((t) => [t.id, t])), [tests]);

  // Active drafts matching an available test
  const activeDraftRows = useMemo(() => {
    return testDrafts
      .map((draft) => {
        const test = testById.get(draft.testId);
        if (!test) return null;
        const answeredCount = Object.values(draft.responses || {}).filter(
          (r) => typeof r.selectedIndex === 'number' && r.selectedIndex >= 0
        ).length;
        const total = Math.max(test.questionCount, draft.totalQuestions || test.questionIds.length);
        const pct = total > 0 ? Math.round((answeredCount / total) * 100) : 0;
        return { draft, test, answeredCount, total, pct };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => b.draft.updatedAtMs - a.draft.updatedAtMs);
  }, [testDrafts, testById]);

  const draftTestIds = useMemo(
    () => new Set(activeDraftRows.map((r) => r.test.id)),
    [activeDraftRows]
  );

  // Incomplete (<80%) submitted tests that do not currently have a live draft
  const incompleteGroups = useMemo(
    () =>
      summarizePendingTests({ tests, attempts, drafts: [] }).filter(
        (g) => !draftTestIds.has(g.testId)
      ),
    [attempts, tests, draftTestIds]
  );

  const pendingVaultCount = revisionItems.filter((r) => !r.mastered).length;
  const totalPendingTests = activeDraftRows.length + incompleteGroups.length;

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
          {totalPendingTests} Pending Test{totalPendingTests === 1 ? '' : 's'} · {pendingVaultCount} Vault Qs
        </span>
      </div>

      {/* Overview Header */}
      <section className="rounded-2xl border border-amber-300/80 dark:border-amber-800/60 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-2">
        <div className="flex items-center gap-2">
          <FolderClock className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
            Pending Tests &amp; Skipped Questions Folder
          </h2>
        </div>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Paused exams resume at your exact question and clock. Submitted tests with{' '}
          <strong>&le;80% questions attempted</strong> stay here with <strong>0 XP</strong> until you
          attempt more than 80% of the paper. Skipped questions also route automatically to your Revision Vault.
        </p>
      </section>

      {/* Active Auto-Saved Drafts */}
      {activeDraftRows.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
            In-Progress Saved Exams ({activeDraftRows.length})
          </h3>
          <div className="space-y-3">
            {activeDraftRows.map(({ draft, test, answeredCount, total, pct }) => {
              const scopeName =
                test.subjectScope === 'full'
                  ? 'Full SSC CGL'
                  : SUBJECT_LABELS[test.subjectScope as SubjectKey]?.short ?? test.subjectScope;

              return (
                <article
                  key={test.id}
                  className="rounded-xl border border-blue-200 dark:border-blue-800/60 bg-[#faf9f6] dark:bg-[#181d27] p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{scopeName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-blue-700 dark:text-blue-400">
                        Paused at Question {draft.currentIdx + 1} of {total}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Saved {formatDateTimeShort(draft.updatedAtMs)}</span>
                    </div>
                    <h4 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                      {test.title}
                    </h4>
                    <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                      <span>
                        Solved: <strong>{answeredCount}/{total}</strong> ({pct}%)
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                        <span>{formatSeconds(draft.secondsLeft)} remaining</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-full bg-blue-700 dark:bg-blue-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onResumeDraft(test)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 hover:bg-blue-800 px-4 py-2.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Resume Where Left Off</span>
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Incomplete (<80%) Submitted Attempts */}
      {incompleteGroups.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
            Incomplete Submissions (&le;80% Attempted · 0 XP) ({incompleteGroups.length})
          </h3>
          <div className="space-y-3">
            {incompleteGroups.map((grp) => {
              const targetTest = testById.get(grp.testId);
              const scopeName =
                grp.subjectScope === 'full'
                  ? 'Full SSC CGL'
                  : SUBJECT_LABELS[grp.subjectScope as SubjectKey]?.short ?? grp.subjectScope;
              const needOver80 = getMinQuestionsForXp(grp.totalQuestions);
              return (
                <article
                  key={grp.testId}
                  className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-[#faf9f6] dark:bg-[#181d27] p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{scopeName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{grp.completionPercent}% Attempted (Need &gt;80% for XP)</span>
                      </span>
                    </div>
                    <h4 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                      {grp.testTitle}
                    </h4>
                    <p className="text-xs font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                      Answered <strong>{grp.answeredCount}/{grp.totalQuestions}</strong> ({grp.skippedCount} skipped) ·
                      Answer at least <strong>{needOver80}</strong> Qs (&gt;80%) to unlock XP &amp; mark complete
                    </p>
                    <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-full bg-amber-500 transition-all"
                        style={{ width: `${grp.completionPercent}%` }}
                      />
                    </div>
                  </div>

                  {targetTest && grp.latestAttemptId && (
                    <button
                      type="button"
                      onClick={() => onResumeIncompleteAttempt(targetTest, grp.latestAttemptId!)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 px-4 py-2.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Resume &amp; Complete</span>
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {totalPendingTests === 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-8 text-center space-y-2">
          <FolderClock className="mx-auto h-7 w-7 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            No paused or incomplete tests right now.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            If you exit mid-test or submit with &le;80% questions attempted, the test is saved
            automatically here so you can finish it anytime.
          </p>
        </div>
      )}

      {/* Skipped & Wrong Questions Link to Revision Vault */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <BookMarked className="mt-0.5 h-5 w-5 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Pending Skipped &amp; Wrong Questions in Revision Vault ({pendingVaultCount})
            </h3>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              Every question skipped or answered incorrectly across your mock tests is stored safely in
              your Revision Vault for targeted practice.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenVault}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>Open Revision Vault</span>
        </button>
      </section>
    </div>
  );
};
