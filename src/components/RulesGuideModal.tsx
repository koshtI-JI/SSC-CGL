import React, { useEffect } from 'react';
import {
  Award,
  Camera,
  CheckCircle2,
  DatabaseBackup,
  FolderClock,
  ShieldAlert,
  Timer,
  X,
} from 'lucide-react';
import type { ScoringConfig } from '../types/exam';
import { DEFAULT_SCORING_CONFIG } from '../types/exam';

interface RulesGuideModalProps {
  onClose: () => void;
  scoringConfig?: ScoringConfig;
}

export const RulesGuideModal: React.FC<RulesGuideModalProps> = ({
  onClose,
  scoringConfig = DEFAULT_SCORING_CONFIG,
}) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-guide-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-5"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-[#f4f6f9] dark:bg-[#0f141d] text-slate-900 dark:text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] px-5 py-4 sm:px-6">
          <div>
            <h2 id="rules-guide-title" className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
              Rules, XP System &amp; Exam Guidelines
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Path to CGL Private Cohort · Official Terms, Reward Criteria &amp; Test Environment Policy
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close rules and guidelines"
            className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 text-sm">
          {/* 01. How to Collect XP */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                01. How to Collect XP &amp; Unlock Cohort Ranks
              </h3>
            </div>
            <ul className="space-y-2 text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span>
                  <strong>Mandatory &gt;80% Attempt Threshold:</strong> XP points are ONLY credited when you
                  attempt <strong>more than 80% of the total questions</strong> in a test. Submissions
                  at or below 80% yield <strong>0 XP</strong>, do not update the Leaderboard, and move into
                  your Pending folder.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span>
                  <strong>XP Calculation Formula:</strong>{' '}
                  <span className="font-mono">
                    +{scoringConfig.xpAttemptBase} XP base + {scoringConfig.xpPerCorrect} XP per correct answer
                  </span>{' '}
                  plus a{' '}
                  <span className="font-mono">
                    +{scoringConfig.xpAccuracyBonus} XP bonus
                  </span>{' '}
                  when accuracy reaches &ge;{scoringConfig.xpAccuracyThreshold}%.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span>
                  <strong>Consistency Multiplier &amp; Scratch Missions:</strong> Staying consistent
                  across the week scales your earned XP from <span className="font-mono">0.85x</span> up
                  to <span className="font-mono">1.40x</span>. Completing Active Cohort Missions unlocks
                  Bonus XP Scratch Cards.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <span>
                  <strong>First Qualifying Credit Only:</strong> Replaying an already-completed test
                  updates your Revision Vault and saves practice history without granting repeat XP.
                </span>
              </li>
            </ul>
          </section>

          {/* 02. Proctoring & Camera Rules */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                02. Proctoring &amp; Camera Guidelines
              </h3>
            </div>
            <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 p-3.5 text-xs sm:text-sm font-medium leading-relaxed text-slate-800 dark:text-slate-200">
              Camera access is required during Full Mock Tests to detect physical movement and
              tab-switching, ensuring a real TCS iON exam environment.
            </div>
            <ul className="space-y-1.5 text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              <li>
                • Switching browser tabs or leaving the active window during a mock test is
                automatically detected and recorded on your attempt telemetry.
              </li>
              <li>
                • Ensure your study desk is well lit and stay within frame throughout Full Mock Tests
                for authentic exam simulation discipline.
              </li>
            </ul>
          </section>

          {/* 03. Pending Folder & Auto-Save */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <FolderClock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                03. Zero-Loss Auto-Save, Skipped Questions &amp; Pending Folder
              </h3>
            </div>
            <ul className="space-y-1.5 text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              <li>
                • <strong>Exact Question &amp; Timer Resume:</strong> Every selected option, question
                index, language choice, and remaining second is saved continuously. If your internet
                drops or tab closes, reopening the test picks up at the exact question and clock.
              </li>
              <li>
                • <strong>Skipped Questions &amp; Incomplete Tests:</strong> Leaving questions skipped
                means the test is never labelled 100% Complete. Any skipped questions route to your{' '}
                <strong>Revision Vault</strong>, and paused or &le;80% tests stay in your{' '}
                <strong>Pending</strong> folder until you finish them.
              </li>
            </ul>
          </section>

          {/* 04. General Rules, Session Security & Backups */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-slate-700 dark:text-slate-300 shrink-0" aria-hidden="true" />
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  04. Marking &amp; Session Auto-Logout
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                Standard Tier-I scoring awards <span className="font-mono font-semibold">+{scoringConfig.pointsPerCorrect}</span>{' '}
                for correct answers, <span className="font-mono font-semibold">-{scoringConfig.negativeMarks}</span>{' '}
                for wrong answers, and <span className="font-mono font-semibold">0</span> for unanswered
                questions. Closing the tab or navigating away automatically marks your presence Offline
                and logs you out for cohort security.
              </p>
            </section>

            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-4 space-y-2">
              <div className="flex items-center gap-2">
                <DatabaseBackup className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  05. Permanent Progress Backups
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                Every student&apos;s test history, XP ledger, and progress report are permanently backed up
                across cloud Firestore and browser storage. Deletion of student progress reports is disabled
                system-wide.
              </p>
            </section>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/60 px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-300">
            <ShieldAlert className="h-4 w-4 text-slate-600 dark:text-slate-400 shrink-0" aria-hidden="true" />
            <span>
              By signing in to Path to CGL, you agree to follow fair test conduct, the &gt;80% XP
              threshold, and automatic session lock rules.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] px-5 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-blue-700 hover:bg-blue-800 px-5 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            Got It, Close Rules
          </button>
        </div>
      </div>
    </div>
  );
};
