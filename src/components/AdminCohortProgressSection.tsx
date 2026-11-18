import React, { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CalendarClock, ChevronDown, ChevronRight, Target, Users } from 'lucide-react';
import {
  SUBJECT_LABELS,
  type LeaderboardEntry,
  type QuestionDoc,
  type RevisionItemDoc,
  type StudentProfile,
  type StudentSessionLogDoc,
  type TestAttemptDoc,
  type VipInvite,
} from '../types/exam';
import { buildAdminUserManagementRows, computeCohortCommandCenterStats } from '../utils/adminCommandCenter';
import {
  computeStudentActivitySummary,
  computeStudentRankTier,
  formatDateTimeShort,
  formatSeconds,
  groupSessionLogsByDate,
  isAttemptComplete,
  isSessionLogLive,
  rankLeaderboard,
} from '../utils/examEngine';
import { filterRealCohortRecords, isRealCohortStudentUid } from '../utils/sessionAndOverrides';
import { GitReportsSyncCard } from './GitReportsSyncCard';
import { PrintableReportModal } from './PrintableReportModal';
import { ProgressChartPanel } from './ProgressChartPanel';
import { RankBadge } from './RankBadge';

interface AdminCohortProgressSectionProps {
  invites: VipInvite[];
  students: StudentProfile[];
  leaderboard: LeaderboardEntry[];
  attempts: TestAttemptDoc[];
  sessionLogs: StudentSessionLogDoc[];
  questions?: QuestionDoc[];
  revisionVaultByUid?: Record<string, RevisionItemDoc[]>;
  githubReportsEnabled?: boolean;
}

export const AdminCohortProgressSection: React.FC<AdminCohortProgressSectionProps> = ({
  invites,
  students,
  leaderboard,
  attempts,
  sessionLogs,
  questions = [],
  revisionVaultByUid = {},
  githubReportsEnabled = true,
}) => {
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [logFilterUid, setLogFilterUid] = useState<string>('all');
  const [expandedLogKeys, setExpandedLogKeys] = useState<Record<string, boolean>>({});
  const [printingUid, setPrintingUid] = useState<string | null>(null);

  const realInvites = useMemo(
    () => invites.filter((i) => isRealCohortStudentUid(i.id)),
    [invites]
  );
  const realVipUids = useMemo(
    () => new Set(realInvites.map((i) => i.id)),
    [realInvites]
  );
  const realStudents = useMemo(
    () => filterRealCohortRecords(students, (s) => s.uid, realVipUids),
    [students, realVipUids]
  );
  const realLeaderboard = useMemo(
    () => filterRealCohortRecords(leaderboard, (l) => l.uid, realVipUids),
    [leaderboard, realVipUids]
  );
  const realAttempts = useMemo(
    () => filterRealCohortRecords(attempts, (a) => a.uid, realVipUids),
    [attempts, realVipUids]
  );
  const realSessionLogs = useMemo(
    () => filterRealCohortRecords(sessionLogs, (s) => s.uid, realVipUids),
    [sessionLogs, realVipUids]
  );

  const cohortCommand = useMemo(() => {
    const mappedVaults: Record<string, Record<string, RevisionItemDoc>> = {};
    for (const [uid, list] of Object.entries(revisionVaultByUid)) {
      if (!isRealCohortStudentUid(uid, realVipUids)) continue;
      const rec: Record<string, RevisionItemDoc> = {};
      for (const item of list) {
        rec[item.questionId || item.id] = item;
      }
      mappedVaults[uid] = rec;
    }
    return computeCohortCommandCenterStats({
      students: realStudents,
      attempts: realAttempts,
      leaderboard: realLeaderboard,
      questions,
      sessionLogs: realSessionLogs,
      revisionVaultByUid: mappedVaults,
    });
  }, [realStudents, realAttempts, realLeaderboard, questions, realSessionLogs, revisionVaultByUid, realVipUids]);

  const cohortCandidates = useMemo(() => {
    return buildAdminUserManagementRows({
      invites: realInvites,
      students: realStudents,
      leaderboard: realLeaderboard,
      attempts: realAttempts,
      presences: [],
    }).map((row) => ({
      uid: row.uid,
      displayName: row.displayName,
      loginId: row.loginId,
      slotNumber: row.slotNumber,
      targetPost: row.targetPost,
    }));
  }, [realInvites, realStudents, realLeaderboard, realAttempts]);

  const studentSummaries = useMemo(() => {
    return cohortCandidates.map((cand) => {
      const stAttempts = realAttempts.filter((a) => a.uid === cand.uid && isAttemptComplete(a));
      const stSessions = realSessionLogs.filter((s) => s.uid === cand.uid);
      const summary = computeStudentActivitySummary(cand.uid, realAttempts, realSessionLogs);
      const lb = realLeaderboard.find((l) => l.uid === cand.uid);
      const rankTier = computeStudentRankTier({
        totalXp: lb?.totalXp ?? 0,
        testsCompleted: stAttempts.length,
        activeDays: summary.activeDays7d,
        questionsAttempted: summary.totalQuestionsAttempted,
      });
      const lastSession = stSessions[0];
      const avgAcc =
        stAttempts.length > 0
          ? Math.round(
              (stAttempts.reduce((sum, a) => sum + a.accuracy, 0) / stAttempts.length) * 10
            ) / 10
          : 0;
      return {
        ...cand,
        summary,
        rankTier,
        attemptsCount: stAttempts.length,
        avgAccuracy: avgAcc,
        lastSession,
      };
    });
  }, [cohortCandidates, realAttempts, realSessionLogs, realLeaderboard]);

  const activeUid =
    selectedUid && cohortCandidates.some((c) => c.uid === selectedUid)
      ? selectedUid
      : cohortCandidates[0]?.uid ?? '';

  const activeCandidate = cohortCandidates.find((c) => c.uid === activeUid) ?? null;
  const activeSummary =
    studentSummaries.find((s) => s.uid === activeUid)?.summary ??
    (activeCandidate
      ? computeStudentActivitySummary(activeCandidate.uid, realAttempts, realSessionLogs)
      : null);

  const filteredLogs = useMemo(() => {
    if (logFilterUid === 'all') return realSessionLogs;
    return realSessionLogs.filter((l) => l.uid === logFilterUid);
  }, [realSessionLogs, logFilterUid]);

  const groupedAttendanceRows = useMemo(
    () => groupSessionLogsByDate(filteredLogs, { groupByStudent: true }),
    [filteredLogs]
  );

  const maxStudySec = Math.max(
    600,
    ...studentSummaries.map((s) => s.summary.totalStudySec)
  );

  return (
    <div className="space-y-6">
      {/* 0. Cohort Command Center KPI Strip & Platform-Wide Top Weak Topics */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white inline-flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <span>Cohort Command Center</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live platform-wide averages, mock scores, and aggregated weak topics across all VIP aspirants
            </p>
          </div>
          <span className="rounded-md border border-blue-200 dark:border-blue-800/70 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 font-mono text-[11px] font-bold text-blue-800 dark:text-blue-300 tabular-nums">
            {cohortCandidates.length} VIP Aspirants · {cohortCommand.qualifyingAttemptsCount} Completed Mocks
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Avg Mock Score</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              {cohortCommand.cohortAvgScorePct}%
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Equiv. {cohortCommand.cohortAvgMock200} / 200 Tier-I
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Platform Avg Accuracy</div>
            <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {cohortCommand.cohortAvgAccuracy}%
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {cohortCommand.totalQuestionsSolved} questions solved
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total Cohort Study</div>
            <div className="mt-1 font-mono text-2xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">
              {cohortCommand.totalStudyHours} hrs
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Combined tracked active time
            </div>
          </div>
          <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/25 p-4">
            <div className="text-xs font-semibold text-amber-900 dark:text-amber-300">
              #1 Platform Weak Topic
            </div>
            <div className="mt-1 font-display text-sm font-bold text-slate-900 dark:text-white truncate">
              {cohortCommand.topWeakTopics[0]?.microTopic ?? 'No weak clusters yet'}
            </div>
            <div className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-400 font-mono">
              {cohortCommand.topWeakTopics[0]
                ? `${cohortCommand.topWeakTopics[0].totalMisses} misses · ${cohortCommand.topWeakTopics[0].affectedStudentsCount} student(s)`
                : 'Appears after test submissions'}
            </div>
          </div>
        </div>

        {/* Top Weak Topics Matrix */}
        {cohortCommand.topWeakTopics.length > 0 && (
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span>Top Weak Topics Across Platform (Prioritize in Next Daily Mock)</span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {cohortCommand.topWeakTopics.slice(0, 8).map((wt) => (
                <div
                  key={`${wt.subject}_${wt.microTopic}`}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] px-3.5 py-2.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 dark:text-slate-100 truncate">
                      {wt.microTopic}
                    </span>
                    <span className="rounded bg-red-100 dark:bg-red-950/50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-800 dark:text-red-300 shrink-0">
                      {wt.totalMisses} miss
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {SUBJECT_LABELS[wt.subject].short} · {wt.affectedStudentsCount} student
                    {wt.affectedStudentsCount === 1 ? '' : 's'}
                    {wt.avgScorePct !== null ? ` · Avg ${wt.avgScorePct}%` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 1. Cohort-Wide Study & Reward Multiplier Comparison Chart */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              All VIP Students — Study Output &amp; Reward Multiplier Chart
            </h2>
            <p className="text-xs text-slate-500">
              Click any student below to inspect their 7-day progress chart &amp; subject breakdown. XP rewards automatically scale from 0.85x to 1.40x based on study activity.
            </p>
          </div>
          <Users className="h-5 w-5 text-blue-700" aria-hidden="true" />
        </div>

        {studentSummaries.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
            <BarChart3 className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-slate-800">
              No VIP student accounts created yet.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Create VIP Student IDs in the VIP Cohort tab to track attendance and progress charts here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {studentSummaries.map((row) => {
              const isSelected = row.uid === activeUid;
              const barPct = Math.max(
                row.summary.totalStudySec > 0 ? 6 : 0,
                Math.round((row.summary.totalStudySec / maxStudySec) * 100)
              );
              const isOnlineNow = isSessionLogLive(row.lastSession);

              return (
                <button
                  key={row.uid}
                  type="button"
                  onClick={() => setSelectedUid(row.uid)}
                  className={`w-full rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/40 ring-1 ring-blue-600'
                      : 'border-slate-200 bg-slate-50 hover:border-blue-300'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className="font-mono text-xs font-bold text-slate-500 pt-0.5">
                        #{row.slotNumber}
                      </span>
                      <div className="min-w-0 space-y-1">
                        <RankBadge tier={row.rankTier} variant="compact" />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-sm font-bold text-slate-900 truncate">
                            {row.displayName}
                          </span>
                          <span className="font-mono text-xs text-slate-500">({row.loginId})</span>
                          {isOnlineNow && (
                            <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                              Active Now
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums">
                      <span className="text-slate-700">
                        Study: <strong>{formatSeconds(row.summary.totalStudySec)}</strong>
                      </span>
                      <span className="text-slate-700">
                        Qs: <strong>{row.summary.totalQuestionsAttempted}</strong>
                      </span>
                      <span className="text-slate-700">
                        Subjects: <strong>{row.summary.subjectsCoveredCount}/4</strong>
                      </span>
                      <span className="text-emerald-700">
                        Acc: <strong>{row.attemptsCount > 0 ? `${row.avgAccuracy}%` : '—'}</strong>
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 font-bold ${
                          row.summary.rewardMultiplier >= 1.25
                            ? 'bg-emerald-100 text-emerald-900'
                            : row.summary.rewardMultiplier > 1
                              ? 'bg-blue-100 text-blue-900'
                              : row.summary.rewardMultiplier < 1
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-slate-200 text-slate-800'
                        }`}
                      >
                        {row.summary.rewardMultiplier.toFixed(2)}x · {row.summary.tierLabel}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full bg-blue-700 transition-all"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Selected Student Detailed Progress Chart */}
      {activeCandidate && activeSummary && (
        <ProgressChartPanel
          studentName={activeCandidate.displayName}
          summary={activeSummary}
          attempts={realAttempts.filter((a) => a.uid === activeCandidate.uid)}
          sessionLogs={realSessionLogs.filter((s) => s.uid === activeCandidate.uid)}
          revisionItems={revisionVaultByUid[activeCandidate.uid] ?? []}
          totalXp={realLeaderboard.find((l) => l.uid === activeCandidate.uid)?.totalXp ?? 0}
          cohortEntries={realLeaderboard}
          showAttendanceTable={false}
          onPrintReport={() => setPrintingUid(activeCandidate.uid)}
        />
      )}

      {/* 2b. Per-Student Report Files & Git Repo Sync */}
      <GitReportsSyncCard
        invites={realInvites}
        students={realStudents}
        leaderboard={realLeaderboard}
        attempts={realAttempts}
        sessionLogs={realSessionLogs}
        githubReportsEnabled={githubReportsEnabled}
        onPrintStudent={(uid) => setPrintingUid(uid)}
      />

      {/* 3. Full Cohort Attendance & Study Log ("Kab Aaye / Kab Gaye / Kya Padha / Kitna Padha") */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-blue-700" aria-hidden="true" />
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Cohort Attendance Log — Kab Aaye, Kab Gaye, Kya &amp; Kitna Padha
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Every student login/logout session with active study duration and studied subjects
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="attendance-student-filter" className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Filter Student:
            </label>
            <select
              id="attendance-student-filter"
              value={logFilterUid}
              onChange={(e) => setLogFilterUid(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#11151d] px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100"
            >
              <option value="all">All VIP Students ({realSessionLogs.length} logs)</option>
              {cohortCandidates.map((c) => (
                <option key={c.uid} value={c.uid}>
                  #{c.slotNumber} — {c.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {groupedAttendanceRows.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-500">
            No attendance session logs recorded yet. As soon as any student logs in, their daily summary and expandable session details appear here live.
          </p>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {groupedAttendanceRows.slice(0, 30).map((row) => {
              const isOpen = Boolean(expandedLogKeys[row.groupKey]);
              return (
                <div key={row.groupKey} className="bg-[#faf9f6] dark:bg-[#181d27]">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setExpandedLogKeys((prev) => ({
                        ...prev,
                        [row.groupKey]: !prev[row.groupKey],
                      }))
                    }
                    className="flex w-full flex-wrap items-center justify-between gap-3 px-6 py-3.5 text-left hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
                      )}
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-sm font-bold text-slate-900">
                            {row.dateLabel}
                          </span>
                          <span className="text-xs font-semibold text-blue-700">
                            {row.displayName}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500">
                            ({row.loginId})
                          </span>
                          {row.hasLiveSession && (
                            <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                              Active Now
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
                          {row.sessionCount} session{row.sessionCount === 1 ? '' : 's'} ·{' '}
                          {row.totalTestsCompleted}T · {row.totalQuestionsAttempted}Q
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-[10px] font-medium text-slate-500">Total Active</div>
                        <div className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                          {formatSeconds(row.totalActiveSec)}
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-blue-700 whitespace-nowrap">
                        {isOpen ? 'Hide' : 'Details'}
                      </span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/70 overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="px-6 py-2">Aaye (Login)</th>
                            <th className="px-4 py-2">Gaye (Exit / Last Seen)</th>
                            <th className="px-4 py-2 text-right">Kitna Padha</th>
                            <th className="px-4 py-2">Kya Padha (Activity &amp; Subjects)</th>
                            <th className="px-6 py-2 text-right">Output</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {row.sessions.map((sess) => {
                            const exitMs = sess.logoutAtMs > 0 ? sess.logoutAtMs : sess.lastActiveAtMs;
                            const subjText =
                              sess.subjectsStudied.length > 0
                                ? sess.subjectsStudied.map((s) => SUBJECT_LABELS[s].short).join(', ')
                                : 'Dashboard / Review';
                            return (
                              <tr key={sess.id}>
                                <td className="px-6 py-2.5 font-mono text-slate-800 whitespace-nowrap tabular-nums">
                                  {formatDateTimeShort(sess.loginAtMs)}
                                </td>
                                <td className="px-4 py-2.5 whitespace-nowrap">
                                  {isSessionLogLive(sess) ? (
                                    <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                                      Active Now
                                    </span>
                                  ) : (
                                    <span className="font-mono text-slate-600 tabular-nums">
                                      {formatDateTimeShort(exitMs)}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums">
                                  {formatSeconds(sess.activeDurationSec)}
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="font-medium text-slate-900 max-w-xs truncate">
                                    {sess.lastActivityTitle}
                                  </div>
                                  <div className="text-[11px] text-slate-500">{subjText}</div>
                                </td>
                                <td className="px-6 py-2.5 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                                  {sess.testsCompleted}T · {sess.questionsAttempted}Q
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {printingUid && (() => {
        const cand = cohortCandidates.find((c) => c.uid === printingUid);
        if (!cand) return null;
        const ranked = rankLeaderboard(realLeaderboard);
        const rIdx = ranked.findIndex((r) => r.uid === cand.uid);
        const lb = rIdx >= 0 ? ranked[rIdx] : null;
        const stSummary =
          studentSummaries.find((s) => s.uid === cand.uid)?.summary ??
          computeStudentActivitySummary(cand.uid, realAttempts, realSessionLogs);
        return (
          <PrintableReportModal
            studentName={cand.displayName}
            loginId={cand.loginId}
            slotNumber={cand.slotNumber}
            targetPost={cand.targetPost}
            rank={rIdx >= 0 ? rIdx + 1 : null}
            totalCohortSize={ranked.length}
            totalXp={lb?.totalXp ?? 0}
            avgAccuracy={lb?.avgAccuracy ?? 0}
            summary={stSummary}
            attempts={realAttempts.filter((a) => a.uid === cand.uid)}
            sessionLogs={realSessionLogs.filter((s) => s.uid === cand.uid)}
            onClose={() => setPrintingUid(null)}
          />
        );
      })()}
    </div>
  );
};

