import React, { useState } from 'react';
import {
  Award,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  Flame,
  Gauge,
  Medal,
  Printer,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  SUBJECT_LABELS,
  type LeaderboardEntry,
  type RevisionItemDoc,
  type StudentActivitySummary,
  type StudentSessionLogDoc,
  type SubjectKey,
  type TestAttemptDoc,
} from '../types/exam';
import {
  computeWeeklyActivitySeries,
  formatDateTimeShort,
  formatSeconds,
  groupSessionLogsByDate,
  isAttemptComplete,
  isSessionLogLive,
  type LiveSessionOverride,
} from '../utils/examEngine';
import {
  buildStudyCalendarHeatmap,
  computeAchievementBadges,
  computeDynamicEfficiencyRank,
} from '../utils/studentAnalyticsEngine';

interface ProgressChartPanelProps {
  studentName: string;
  summary: StudentActivitySummary;
  attempts: TestAttemptDoc[];
  sessionLogs: StudentSessionLogDoc[];
  revisionItems?: RevisionItemDoc[];
  totalXp?: number;
  cohortEntries?: LeaderboardEntry[];
  liveSessionOverride?: LiveSessionOverride;
  showAttendanceTable?: boolean;
  onPrintReport?: () => void;
}

const TIER_STYLES: Record<
  StudentActivitySummary['tierLabel'],
  { badge: string; bar: string }
> = {
  'Low Activity': {
    badge: 'border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/35 text-amber-900 dark:text-amber-200',
    bar: 'bg-amber-500',
  },
  Regular: {
    badge: 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-[#1e2431] text-slate-800 dark:text-slate-200',
    bar: 'bg-slate-600',
  },
  'Active Learner': {
    badge: 'border-blue-300 dark:border-blue-800/70 bg-blue-50 dark:bg-blue-950/35 text-blue-900 dark:text-blue-200',
    bar: 'bg-blue-600',
  },
  Dedicated: {
    badge: 'border-emerald-300 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/35 text-emerald-900 dark:text-emerald-200',
    bar: 'bg-emerald-600',
  },
  'Top Hustler': {
    badge: 'border-violet-300 dark:border-violet-800/70 bg-violet-50 dark:bg-violet-950/35 text-violet-900 dark:text-violet-200',
    bar: 'bg-violet-600',
  },
};

export const ProgressChartPanel: React.FC<ProgressChartPanelProps> = ({
  studentName,
  summary,
  attempts,
  sessionLogs,
  revisionItems = [],
  totalXp = 0,
  cohortEntries = [],
  liveSessionOverride,
  showAttendanceTable = true,
  onPrintReport,
}) => {
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});
  const [hoveredCellKey, setHoveredCellKey] = useState<string | null>(null);
  const weekly = computeWeeklyActivitySeries(attempts, sessionLogs, new Date(), liveSessionOverride);
  const heatmap = buildStudyCalendarHeatmap({
    attempts,
    sessionLogs,
    daysCount: 126,
  });
  const efficiencyRank = computeDynamicEfficiencyRank({
    attempts,
    totalXp,
  });
  const badges = computeAchievementBadges({
    attempts,
    revisionItems,
    sessionLogs,
  });
  const cohortStandingLabel =
    cohortEntries.length > 0
      ? (() => {
          const higher = cohortEntries.filter((e) => e.totalXp > totalXp).length;
          return `#${higher + 1} / ${cohortEntries.length} VIP`;
        })()
      : efficiencyRank.tierCode;
  const unlockedBadgesCount = badges.filter((b) => b.unlocked).length;
  const groupedDays = groupSessionLogsByDate(sessionLogs, { liveOverride: liveSessionOverride });
  const completedAttemptsCount = attempts.filter(isAttemptComplete).length;
  const maxStudyMins = Math.max(20, ...weekly.map((d) => d.studyMinutes));
  const tierStyle = TIER_STYLES[summary.tierLabel];
  const subjects: SubjectKey[] = ['quant', 'reasoning', 'english', 'ga'];

  const activeHeatmapCell =
    heatmap.days.find((c) => c.dateKey === hoveredCellKey) ??
    heatmap.days[heatmap.days.length - 1];

  const toggleDateRow = (groupKey: string) => {
    setExpandedDates((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  return (
    <div className="space-y-6">
      {onPrintReport && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] px-5 py-3.5">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              {studentName} — Progress &amp; Performance Report
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Export complete marks, accuracy, subject breakdown &amp; attendance log as a printable PDF.
            </p>
          </div>
          <button
            type="button"
            onClick={onPrintReport}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Print / Save PDF Report</span>
          </button>
        </div>
      )}

      {/* Top Activity & Dynamic Reward KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total Study Time</span>
            <Clock className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
          </div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatSeconds(summary.totalStudySec)}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {summary.sessionsCount} session{summary.sessionsCount === 1 ? '' : 's'} · {summary.activeDays7d} active day{summary.activeDays7d === 1 ? '' : 's'} (7d)
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Questions Practiced</span>
            <BookOpen className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {summary.totalQuestionsAttempted} Qs
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Across {summary.subjectsCoveredCount} / 4 SSC CGL subjects
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Tests Completed (&gt;80%)</span>
            <TrendingUp className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
          </div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {completedAttemptsCount}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Last 7d avg accuracy:{' '}
            {(() => {
              const active = weekly.filter((d) => d.attempts > 0);
              if (active.length === 0) return '—';
              const avg = active.reduce((s, d) => s + d.avgAccuracy, 0) / active.length;
              return `${Math.round(avg * 10) / 10}%`;
            })()}
          </p>
        </div>

        <div className={`rounded-xl border p-4 ${tierStyle.badge}`}>
          <div className="flex items-center justify-between text-xs font-semibold">
            <span>Activity XP Multiplier</span>
            <Zap className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums">
              {summary.rewardMultiplier.toFixed(2)}x
            </span>
            <span className="text-xs font-semibold">{summary.tierLabel}</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug opacity-90">
            {summary.nextMilestoneHint}
          </p>
        </div>
      </div>

      {/* Charts Row: 7-Day Study & Accuracy Chart + Subject Breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 7-Day Dual Progress Chart */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-4 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                7-Day Study Time &amp; Accuracy Chart ({studentName})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Daily active study minutes alongside mock accuracy &amp; score percentage
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-medium text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-xs bg-blue-700" />
                Accuracy %
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-xs bg-emerald-600" />
                Study Mins
              </span>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-2 items-end h-52 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] px-3 pt-5 pb-3">
            {weekly.map((day) => {
              const accHeight = day.attempts > 0 ? Math.max(8, Math.min(100, day.avgAccuracy)) : 0;
              const minHeight =
                day.studyMinutes > 0
                  ? Math.max(8, Math.min(100, Math.round((day.studyMinutes / maxStudyMins) * 100)))
                  : 0;

              return (
                <div
                  key={day.dateKey}
                  className="flex h-full flex-col items-center justify-end gap-1.5"
                >
                  <div className="text-center font-mono text-[10px] leading-tight text-slate-600 dark:text-slate-400 tabular-nums">
                    <div>{day.attempts > 0 ? `${day.avgAccuracy}%` : '—'}</div>
                    <div className="text-emerald-700 dark:text-emerald-400">
                      {day.studyMinutes > 0 ? `${day.studyMinutes}m` : '0m'}
                    </div>
                  </div>

                  <div className="flex h-28 w-full max-w-[44px] items-end justify-center gap-1">
                    <div className="flex h-full w-4 items-end overflow-hidden rounded-t bg-slate-200 dark:bg-slate-800">
                      <div
                        className="w-full bg-blue-700 dark:bg-blue-500 transition-all"
                        style={{ height: `${accHeight}%` }}
                        title={`${day.label}: ${day.avgAccuracy}% accuracy (${day.attempts} tests)`}
                      />
                    </div>
                    <div className="flex h-full w-4 items-end overflow-hidden rounded-t bg-slate-200 dark:bg-slate-800">
                      <div
                        className="w-full bg-emerald-600 dark:bg-emerald-500 transition-all"
                        style={{ height: `${minHeight}%` }}
                        title={`${day.label}: ${day.studyMinutes}m studied`}
                      />
                    </div>
                  </div>

                  <div className="text-center">
                    <div className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {day.label.split(' ')[0]}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {day.attempts}T · {day.questionsSolved}Q
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] px-3.5 py-2.5 text-xs text-slate-700 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Award className="h-4 w-4 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
              Reward Basis: {summary.tierReason}
            </span>
            <span className="font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums">
              Current Rate: {summary.rewardMultiplier.toFixed(2)}x XP
            </span>
          </div>
        </section>

        {/* Subject-Wise Study & Mastery Chart */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-4 lg:col-span-5">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Subject Mastery (Kya Padha &amp; Kitna Padha)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Accuracy, questions attempted, and time invested per SSC CGL section
            </p>
          </div>

          <div className="space-y-3.5">
            {subjects.map((sub) => {
              const b = summary.subjectBreakdown[sub];
              const pct = b.attemptedQuestions > 0 ? b.accuracy : 0;
              return (
                <div key={sub} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {SUBJECT_LABELS[sub].en}
                    </span>
                    <span className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                      {b.attemptedQuestions > 0 ? `${pct}% acc` : 'Not started'} ·{' '}
                      {formatSeconds(b.timeSec)}
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full transition-all ${
                        pct >= 75
                          ? 'bg-emerald-600'
                          : pct >= 50
                            ? 'bg-blue-700'
                            : pct > 0
                              ? 'bg-amber-500'
                              : 'bg-slate-200 dark:bg-slate-700'
                      }`}
                      style={{ width: `${Math.max(b.attemptedQuestions > 0 ? 6 : 0, pct)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    <span>
                      Correct: {b.correctCount} · Wrong: {b.wrongCount} · Skip: {b.skippedCount}
                    </span>
                    <span>Total: {b.correctCount + b.wrongCount + b.skippedCount} Qs</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* 18-Week (126-Day) Study Calendar Heatmap & Streaks */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span>18-Week Study Streak Calendar Heatmap</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {heatmap.totalActiveDays} active study days · {heatmap.totalQuestionsSolved} questions solved across 126 days
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums">
            <span className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 font-bold text-amber-900 dark:text-amber-300">
              Current Streak: {heatmap.currentStreakDays}d
            </span>
            <span className="rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 font-bold text-emerald-900 dark:text-emerald-300">
              Best Streak: {heatmap.bestStreakDays}d
            </span>
          </div>
        </div>

        <div className="overflow-x-auto pb-1">
          <div className="inline-grid grid-flow-col grid-rows-7 gap-1 min-w-max">
            {heatmap.days.map((cell) => {
              const colorCls =
                cell.intensity === 4
                  ? 'bg-emerald-600 dark:bg-emerald-500 border-emerald-700'
                  : cell.intensity === 3
                    ? 'bg-emerald-500 dark:bg-emerald-600 border-emerald-600'
                    : cell.intensity === 2
                      ? 'bg-emerald-300 dark:bg-emerald-700 border-emerald-400'
                      : cell.intensity === 1
                        ? 'bg-emerald-100 dark:bg-emerald-900/70 border-emerald-200 dark:border-emerald-800'
                        : 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/60';
              return (
                <button
                  key={cell.dateKey}
                  type="button"
                  onMouseEnter={() => setHoveredCellKey(cell.dateKey)}
                  onFocus={() => setHoveredCellKey(cell.dateKey)}
                  onClick={() => setHoveredCellKey(cell.dateKey)}
                  aria-label={`${cell.label}: ${cell.studyMinutes} mins, ${cell.questionsSolved} Qs, ${cell.testsCompleted} tests`}
                  title={`${cell.label}: ${cell.studyMinutes}m studied · ${cell.questionsSolved} Qs · ${cell.testsCompleted} tests`}
                  className={`h-3.5 w-3.5 rounded-[3px] border transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer ${colorCls}`}
                />
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
          <div className="font-mono">
            {activeHeatmapCell && (
              <span>
                <strong>{activeHeatmapCell.label}</strong>: {activeHeatmapCell.studyMinutes}m studied ·{' '}
                {activeHeatmapCell.questionsSolved} Qs · {activeHeatmapCell.testsCompleted} mock
                {activeHeatmapCell.testsCompleted === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span>Less</span>
            <span className="h-3 w-3 rounded-[2px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" />
            <span className="h-3 w-3 rounded-[2px] bg-emerald-100 dark:bg-emerald-900/70" />
            <span className="h-3 w-3 rounded-[2px] bg-emerald-300 dark:bg-emerald-700" />
            <span className="h-3 w-3 rounded-[2px] bg-emerald-500 dark:bg-emerald-600" />
            <span className="h-3 w-3 rounded-[2px] bg-emerald-600 dark:bg-emerald-500" />
            <span>More</span>
          </div>
        </div>
      </section>

      {/* Dynamic Efficiency Rank + Achievement Badges Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-4 lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
                <Gauge className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <span>Speed × Accuracy Efficiency Rank</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Real-time percentile &amp; pace index computed from completed mocks
              </p>
            </div>
            <span className="rounded-md bg-blue-50 dark:bg-blue-950/50 px-2.5 py-1 font-mono text-xs font-bold text-blue-800 dark:text-blue-300 tabular-nums">
              Index {efficiencyRank.efficiencyScore}/100
            </span>
          </div>

          <div className="rounded-xl border border-blue-200/80 dark:border-blue-800/60 bg-blue-50/60 dark:bg-blue-950/25 p-4 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-display text-lg font-bold text-slate-900 dark:text-white">
                {efficiencyRank.rankTitle}
              </div>
              <div className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                Est. {efficiencyRank.estimatedPercentile}th Percentile
              </div>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Quadrant: <strong>{efficiencyRank.quadrant}</strong> · Tier {efficiencyRank.tierCode}
            </p>
            <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px] tabular-nums">
              <div className="rounded-lg bg-white dark:bg-[#131720] px-2.5 py-1.5 border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400 block">Avg Acc</span>
                <strong className="text-slate-900 dark:text-slate-100">{efficiencyRank.avgAccuracy}%</strong>
              </div>
              <div className="rounded-lg bg-white dark:bg-[#131720] px-2.5 py-1.5 border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400 block">Pace / Q</span>
                <strong className="text-slate-900 dark:text-slate-100">{efficiencyRank.avgSecPerQuestion}s</strong>
              </div>
              <div className="rounded-lg bg-white dark:bg-[#131720] px-2.5 py-1.5 border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400 block">Cohort Standing</span>
                <strong className="text-blue-700 dark:text-blue-400">{cohortStandingLabel}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 space-y-4 lg:col-span-7">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
                <Medal className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span>Aspirant Achievement Badges</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Unlocked automatically via section mastery, streaks &amp; revision clearance
              </p>
            </div>
            <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-400 tabular-nums">
              {unlockedBadgesCount} / {badges.length} Unlocked
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {badges.map((badge) => (
              <div
                key={badge.id}
                className={`rounded-lg border px-3 py-2.5 text-xs space-y-1.5 transition-colors ${
                  badge.unlocked
                    ? 'border-emerald-300 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/25'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] opacity-80'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 dark:text-slate-100 truncate">
                    {badge.title}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                      badge.unlocked
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {badge.unlocked ? 'Unlocked' : badge.progressLabel}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                  {badge.description}
                </p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className={`h-full transition-all ${
                      badge.unlocked ? 'bg-emerald-600' : 'bg-blue-600'
                    }`}
                    style={{ width: `${badge.progressPercent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Date-Grouped Attendance Accordion (Click Date for Detailed Sessions) */}
      {showAttendanceTable && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Daily Attendance &amp; Study Time ({studentName})
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Click any date row to view Aaye/Gaye timestamps and subjects studied
                </p>
              </div>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {groupedDays.length} active day{groupedDays.length === 1 ? '' : 's'} · {sessionLogs.length} session{sessionLogs.length === 1 ? '' : 's'}
            </span>
          </div>

          {groupedDays.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Login &amp; study sessions appear here automatically grouped by date.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {groupedDays.map((day) => {
                const isOpen = Boolean(expandedDates[day.groupKey]);
                return (
                  <div key={day.groupKey} className="bg-[#faf9f6] dark:bg-[#181d27]">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => toggleDateRow(day.groupKey)}
                      className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                              {day.dateLabel}
                            </span>
                            {day.hasLiveSession && (
                              <span className="rounded border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
                                Active Now
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                            {day.sessionCount} session{day.sessionCount === 1 ? '' : 's'} ·{' '}
                            {day.totalTestsCompleted}T · {day.totalQuestionsAttempted}Q
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">Total Active</div>
                          <div className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                            {formatSeconds(day.totalActiveSec)}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 whitespace-nowrap">
                          {isOpen ? 'Hide Details' : 'View Details'}
                        </span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-[#131720] overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                              <th className="px-5 py-2">Aaye (Login)</th>
                              <th className="px-4 py-2">Gaye (Exit / Last Seen)</th>
                              <th className="px-4 py-2 text-right">Study Time</th>
                              <th className="px-4 py-2">Kya Padha</th>
                              <th className="px-5 py-2 text-right">Tests / Qs</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {day.sessions.map((sess) => {
                              const exitMs = sess.logoutAtMs > 0 ? sess.logoutAtMs : sess.lastActiveAtMs;
                              const subjText =
                                sess.subjectsStudied.length > 0
                                  ? sess.subjectsStudied.map((s) => SUBJECT_LABELS[s].short).join(', ')
                                  : 'General Practice';
                              return (
                                <tr key={sess.id}>
                                  <td className="px-5 py-2.5 font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap tabular-nums">
                                    {formatDateTimeShort(sess.loginAtMs)}
                                  </td>
                                  <td className="px-4 py-2.5 whitespace-nowrap">
                                    {isSessionLogLive(sess) ? (
                                      <span className="inline-flex items-center rounded border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
                                        Active Now
                                      </span>
                                    ) : (
                                      <span className="font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                                        {formatDateTimeShort(exitMs)}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                                    {formatSeconds(sess.activeDurationSec)}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-xs">
                                      {sess.lastActivityTitle}
                                    </div>
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{subjText}</div>
                                  </td>
                                  <td className="px-5 py-2.5 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
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
      )}
    </div>
  );
};
