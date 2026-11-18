import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileText,
  FolderArchive,
  Printer,
} from 'lucide-react';
import type {
  LeaderboardEntry,
  StudentProfile,
  StudentSessionLogDoc,
  TestAttemptDoc,
  VipInvite,
} from '../types/exam';
import { buildStudentGitReportPayloads, type StudentGitReportPayload } from '../utils/examEngine';

interface GitReportsSyncCardProps {
  invites: VipInvite[];
  students: StudentProfile[];
  leaderboard: LeaderboardEntry[];
  attempts: TestAttemptDoc[];
  sessionLogs: StudentSessionLogDoc[];
  githubReportsEnabled?: boolean;
  onPrintStudent: (uid: string) => void;
}

function triggerBrowserDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatStudentMarkdownReport(rep: StudentGitReportPayload): string {
  const lines = [
    `# Path to CGL — Student Report: ${rep.displayName}`,
    '',
    `- **Login ID:** \`${rep.loginId}\``,
    `- **Slot:** #${rep.slotNumber}`,
    `- **Target Post:** ${rep.targetPost}`,
    `- **Total XP:** ${rep.totalXp}`,
    `- **Tests Attempted:** ${rep.testsAttempted}`,
    `- **Avg Accuracy:** ${rep.avgAccuracy}%`,
    `- **Best Score:** ${rep.bestScore}`,
    `- **Study Time:** ${rep.studyTimeFormatted}`,
    `- **Generated:** ${rep.generatedAtIso}`,
    '',
    '## Attempt History',
    '',
    '| Test | Score | Max | Accuracy | Date |',
    '|---|---:|---:|---:|---|',
    ...rep.recentAttempts.map(
      (a) =>
        `| ${a.testTitle.replace(/\|/g, '/')} | ${a.score} | ${a.maxScore} | ${a.accuracy}% | ${a.submittedAtIso.slice(0, 10)} |`
    ),
  ];
  return lines.join('\n');
}

export const GitReportsSyncCard: React.FC<GitReportsSyncCardProps> = ({
  invites,
  students,
  leaderboard,
  attempts,
  sessionLogs,
  githubReportsEnabled = true,
  onPrintStudent,
}) => {
  const [lastExportMsg, setLastExportMsg] = useState<string | null>(null);

  const reportPayloads = useMemo(
    () =>
      buildStudentGitReportPayloads({
        invites,
        students,
        leaderboard,
        attempts,
        sessionLogs,
      }),
    [invites, students, leaderboard, attempts, sessionLogs]
  );

  const handleDownloadJson = (rep: StudentGitReportPayload, slug: string) => {
    triggerBrowserDownload(
      `${slug}_report.json`,
      JSON.stringify(rep, null, 2),
      'application/json'
    );
    setLastExportMsg(`Downloaded ${slug}_report.json directly in browser.`);
  };

  const handleDownloadMd = (rep: StudentGitReportPayload, slug: string) => {
    triggerBrowserDownload(
      `${slug}_report.md`,
      formatStudentMarkdownReport(rep),
      'text/markdown;charset=utf-8'
    );
    setLastExportMsg(`Downloaded ${slug}_report.md directly in browser.`);
  };

  const handleExportAllBundle = () => {
    if (reportPayloads.length === 0) return;
    triggerBrowserDownload(
      `get_to_cgl_cohort_reports_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(reportPayloads, null, 2),
      'application/json'
    );
    setLastExportMsg(
      `Exported full JSON bundle for ${reportPayloads.length} student(s) purely client-side.`
    );
  };

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#181d27] p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
            <FolderArchive className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>Per-Student Report Exports ({reportPayloads.length} Student{reportPayloads.length === 1 ? '' : 's'})</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
            Generates and downloads individual <code className="font-mono">.json</code>,{' '}
            <code className="font-mono">.md</code>, and PDF print reports directly from live Firestore data in the browser.
          </p>
        </div>

        <button
          type="button"
          disabled={!githubReportsEnabled || reportPayloads.length === 0}
          onClick={handleExportAllBundle}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-800 disabled:opacity-50 cursor-pointer shrink-0"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Export All Cohort (.JSON)</span>
        </button>
      </div>

      {!githubReportsEnabled && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200"
        >
          Git report exports are paused in Dynamic Settings. Re-enable <strong>GitHub Cohort Reports</strong> in the Settings tab to download report bundles.
        </div>
      )}

      {lastExportMsg && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-2.5 text-xs text-emerald-950 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
          <span>{lastExportMsg}</span>
        </div>
      )}

      {reportPayloads.length === 0 ? (
        <p className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] p-4 text-xs text-slate-500 dark:text-slate-400">
          No active VIP student accounts yet. Add VIP students in the VIP Cohort tab and their report exports will appear here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] text-slate-600 dark:text-slate-400">
                <th className="px-4 py-2.5">Student</th>
                <th className="px-4 py-2.5">Target Post</th>
                <th className="px-4 py-2.5 text-right">XP / Tests</th>
                <th className="px-4 py-2.5 text-right">Study Time</th>
                <th className="px-4 py-2.5 text-right">Export / PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {reportPayloads.map((rep) => {
                const slug = rep.loginId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');

                return (
                  <tr key={rep.uid}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        #{rep.slotNumber} {rep.displayName}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {rep.loginId}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {rep.targetPost}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      <strong>{rep.totalXp} XP</strong> · {rep.testsAttempted}T
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {rep.studyTimeFormatted}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={!githubReportsEnabled}
                          onClick={() => handleDownloadMd(rep, slug)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                        >
                          <FileText className="h-3 w-3" aria-hidden="true" />
                          <span>.MD</span>
                        </button>
                        <button
                          type="button"
                          disabled={!githubReportsEnabled}
                          onClick={() => handleDownloadJson(rep, slug)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                        >
                          <Download className="h-3 w-3" aria-hidden="true" />
                          <span>.JSON</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onPrintStudent(rep.uid)}
                          className="inline-flex items-center gap-1 rounded bg-blue-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-800 cursor-pointer"
                        >
                          <Printer className="h-3 w-3" aria-hidden="true" />
                          <span>PDF Report</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
