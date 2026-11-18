import React from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import {
  SUBJECT_LABELS,
  type StudentActivitySummary,
  type StudentSessionLogDoc,
  type SubjectKey,
  type TestAttemptDoc,
} from '../types/exam';
import {
  computeWeeklyActivitySeries,
  formatDateTimeShort,
  formatSeconds,
  getAttemptStatusLabel,
  isAttemptComplete,
  isSessionLogLive,
} from '../utils/examEngine';

interface PrintableReportModalProps {
  studentName: string;
  loginId?: string;
  slotNumber?: number;
  targetPost?: string;
  rank?: number | null;
  totalCohortSize?: number;
  totalXp?: number;
  avgAccuracy?: number;
  summary: StudentActivitySummary;
  attempts: TestAttemptDoc[];
  sessionLogs: StudentSessionLogDoc[];
  onClose: () => void;
}

export const PrintableReportModal: React.FC<PrintableReportModalProps> = ({
  studentName,
  loginId = '',
  slotNumber,
  targetPost = 'SSC CGL Aspirant',
  rank = null,
  totalCohortSize = 0,
  totalXp = 0,
  avgAccuracy = 0,
  summary,
  attempts,
  sessionLogs,
  onClose,
}) => {
  const subjects: SubjectKey[] = ['quant', 'reasoning', 'english', 'ga'];
  const weekly = computeWeeklyActivitySeries(attempts, sessionLogs);
  const completedCount = attempts.filter(isAttemptComplete).length;

  const modalContent = (
    <div
      id="getcgl-print-portal"
      role="dialog"
      aria-modal="true"
      aria-label={`Printable PDF Progress Report for ${studentName}`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 sm:p-6 print:static print:bg-white print:p-0 print:block print:overflow-visible"
    >
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden print:shadow-none print:border-none print:rounded-none">
        {/* Toolbar (hidden when printing PDF) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-6 py-3.5">
          <div>
            <h2 className="font-display text-sm font-bold text-slate-900">
              Print / Save PDF Progress Report
            </h2>
            <p className="text-xs text-slate-500">
              Click Print / Save PDF below and choose &ldquo;Save as PDF&rdquo; in your browser print dialog.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Print / Save as PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Close</span>
            </button>
          </div>
        </div>

        {/* Printable A4 Sheet */}
        <div id="getcgl-print-root" className="p-6 sm:p-8 space-y-6 text-slate-900 bg-white">
          <header className="border-b-2 border-slate-900 pb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
                Path to CGL · Official Student Progress Report
              </p>
              <h1 className="mt-1 font-display text-2xl font-bold text-slate-900">
                {studentName}
              </h1>
              <p className="mt-0.5 text-xs text-slate-600">
                {loginId ? `Login ID: ${loginId}` : ''}
                {slotNumber ? ` · VIP Slot #${slotNumber}` : ''} · Target: {targetPost}
              </p>
            </div>
            <div className="text-right text-xs text-slate-500 font-mono">
              <div>Generated: {new Date().toLocaleString('en-IN')}</div>
              <div>Tier: {summary.rewardMultiplier.toFixed(2)}x ({summary.tierLabel})</div>
            </div>
          </header>

          {/* KPI Grid */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] text-slate-500">Cohort Rank</div>
              <div className="mt-0.5 font-mono text-lg font-bold">
                {rank ? `#${rank} / ${totalCohortSize}` : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] text-slate-500">Total XP</div>
              <div className="mt-0.5 font-mono text-lg font-bold text-blue-700">{totalXp} XP</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] text-slate-500">Tests Completed</div>
              <div className="mt-0.5 font-mono text-lg font-bold">{completedCount}</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] text-slate-500">Avg Accuracy</div>
              <div className="mt-0.5 font-mono text-lg font-bold text-emerald-700">
                {avgAccuracy}%
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] text-slate-500">Total Study Time</div>
              <div className="mt-0.5 font-mono text-lg font-bold">
                {formatSeconds(summary.totalStudySec)}
              </div>
            </div>
          </section>

          {/* Subject Breakdown Table */}
          <section className="space-y-2">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Subject-Wise Mastery Breakdown
            </h3>
            <table className="w-full border-collapse border border-slate-200 text-left text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="border border-slate-200 px-3 py-2">Subject</th>
                  <th className="border border-slate-200 px-3 py-2 text-right">Attempted</th>
                  <th className="border border-slate-200 px-3 py-2 text-right">Correct</th>
                  <th className="border border-slate-200 px-3 py-2 text-right">Wrong</th>
                  <th className="border border-slate-200 px-3 py-2 text-right">Skipped</th>
                  <th className="border border-slate-200 px-3 py-2 text-right">Accuracy</th>
                  <th className="border border-slate-200 px-3 py-2 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((sub) => {
                  const b = summary.subjectBreakdown[sub];
                  return (
                    <tr key={sub}>
                      <td className="border border-slate-200 px-3 py-2 font-semibold">
                        {SUBJECT_LABELS[sub].en}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right font-mono">
                        {b.attemptedQuestions}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right font-mono text-emerald-700">
                        {b.correctCount}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right font-mono text-red-700">
                        {b.wrongCount}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right font-mono">
                        {b.skippedCount}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right font-mono font-semibold">
                        {b.attemptedQuestions > 0 ? `${b.accuracy}%` : '—'}
                      </td>
                      <td className="border border-slate-200 px-3 py-2 text-right font-mono">
                        {formatSeconds(b.timeSec)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* Last 7 Days Output */}
          <section className="space-y-2">
            <h3 className="font-display text-sm font-bold text-slate-900">
              7-Day Daily Consistency &amp; Output
            </h3>
            <table className="w-full border-collapse border border-slate-200 text-left text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="border border-slate-200 px-3 py-2">Day</th>
                  <th className="border border-slate-200 px-3 py-2 text-right">Tests</th>
                  <th className="border border-slate-200 px-3 py-2 text-right">Questions</th>
                  <th className="border border-slate-200 px-3 py-2 text-right">Avg Accuracy</th>
                  <th className="border border-slate-200 px-3 py-2 text-right">Study Minutes</th>
                </tr>
              </thead>
              <tbody>
                {weekly.map((d) => (
                  <tr key={d.dateKey}>
                    <td className="border border-slate-200 px-3 py-1.5 font-medium">{d.label}</td>
                    <td className="border border-slate-200 px-3 py-1.5 text-right font-mono">
                      {d.attempts}
                    </td>
                    <td className="border border-slate-200 px-3 py-1.5 text-right font-mono">
                      {d.questionsSolved}
                    </td>
                    <td className="border border-slate-200 px-3 py-1.5 text-right font-mono">
                      {d.attempts > 0 ? `${d.avgAccuracy}%` : '—'}
                    </td>
                    <td className="border border-slate-200 px-3 py-1.5 text-right font-mono">
                      {d.studyMinutes}m
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Attempt History */}
          <section className="space-y-2">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Test Submission History ({attempts.length})
            </h3>
            {attempts.length === 0 ? (
              <p className="text-xs text-slate-500">No mock tests attempted yet.</p>
            ) : (
              <table className="w-full border-collapse border border-slate-200 text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className="border border-slate-200 px-3 py-2">Test Title</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">Score</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">Accuracy</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">Time</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">XP</th>
                    <th className="border border-slate-200 px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.slice(0, 25).map((a) => (
                    <tr key={a.id}>
                      <td className="border border-slate-200 px-3 py-1.5 font-medium">
                        {a.testTitle}
                      </td>
                      <td className="border border-slate-200 px-3 py-1.5 text-right font-mono">
                        {a.score}/{a.maxScore}
                      </td>
                      <td className="border border-slate-200 px-3 py-1.5 text-right font-mono">
                        {a.accuracy}%
                      </td>
                      <td className="border border-slate-200 px-3 py-1.5 text-right font-mono">
                        {formatSeconds(a.totalTimeSec)}
                      </td>
                      <td className="border border-slate-200 px-3 py-1.5 text-right font-mono font-semibold text-blue-700">
                        +{a.xpEarned}
                      </td>
                      <td className="border border-slate-200 px-3 py-1.5">
                        {getAttemptStatusLabel(a)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Session Attendance Summary */}
          <section className="space-y-2">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Recent Attendance &amp; Study Sessions ({sessionLogs.length})
            </h3>
            {sessionLogs.length === 0 ? (
              <p className="text-xs text-slate-500">No session logs recorded yet.</p>
            ) : (
              <table className="w-full border-collapse border border-slate-200 text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className="border border-slate-200 px-3 py-2">Login</th>
                    <th className="border border-slate-200 px-3 py-2">Exit / Last Seen</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">Duration</th>
                    <th className="border border-slate-200 px-3 py-2">Studied Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionLogs.slice(0, 12).map((s) => (
                    <tr key={s.id}>
                      <td className="border border-slate-200 px-3 py-1.5 font-mono">
                        {formatDateTimeShort(s.loginAtMs)}
                      </td>
                      <td className="border border-slate-200 px-3 py-1.5 font-mono">
                        {isSessionLogLive(s)
                          ? 'Active Now'
                          : formatDateTimeShort(s.logoutAtMs > 0 ? s.logoutAtMs : s.lastActiveAtMs)}
                      </td>
                      <td className="border border-slate-200 px-3 py-1.5 text-right font-mono">
                        {formatSeconds(s.activeDurationSec)}
                      </td>
                      <td className="border border-slate-200 px-3 py-1.5">
                        {s.lastActivityTitle}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

