import React from 'react';
import { BookOpen, Flame, Target, TrendingUp, Zap } from 'lucide-react';
import type { SubjectKey } from '../types/exam';
import { TIER1_SAFE_BENCHMARK, type AspirantCoachSummary } from '../utils/studyCoach';

interface AspirantCoachCardProps {
  coach: AspirantCoachSummary;
  dailyGoalValue: number;
  onChangeDailyGoal: (goal: number) => void;
  onQuickFocusDrill: (subject: SubjectKey) => void;
  onOpenFormulaBooster: () => void;
  pracBusy?: boolean;
}

export const AspirantCoachCard: React.FC<AspirantCoachCardProps> = ({
  coach,
  dailyGoalValue,
  onChangeDailyGoal,
  onQuickFocusDrill,
  onOpenFormulaBooster,
  pracBusy = false,
}) => {
  const { streak, dailyGoal, subjectBreakdown, focusSubject, recentFullMockAvg200 } = coach;

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-6 space-y-6">
      {/* Header Row with Clean Unboxed Metadata */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1.5 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-blue-700 dark:text-blue-400">Daily Study Coach</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 font-mono tabular-nums text-amber-700 dark:text-amber-400 font-semibold">
              <Flame className="h-3.5 w-3.5" aria-hidden="true" />
              {streak.currentStreakDays}d Streak (Best: {streak.bestStreakDays}d)
            </span>
            {coach.accuracyTrendDelta !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={`inline-flex items-center gap-1 font-mono tabular-nums font-semibold ${
                    coach.accuracyTrendDelta >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                  {coach.accuracyTrendDelta >= 0
                    ? `+${coach.accuracyTrendDelta}%`
                    : `${coach.accuracyTrendDelta}%`}{' '}
                  Trend
                </span>
              </>
            )}
          </div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white [text-wrap:balance]">
            {coach.headline}
          </h2>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {coach.encouragement}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenFormulaBooster}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#18202c] px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <BookOpen className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>Formula Sheet</span>
          </button>
          {focusSubject && (
            <button
              type="button"
              disabled={pracBusy}
              onClick={() => onQuickFocusDrill(focusSubject.subject)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 hover:bg-blue-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Boost {focusSubject.label} (15 Qs)</span>
            </button>
          )}
        </div>
      </div>

      {/* Whitespace + Hairline Split: Daily Target & Subject Mastery */}
      <div className="grid grid-cols-1 gap-6 border-t border-slate-200 dark:border-slate-800 pt-5 lg:grid-cols-12">
        {/* Left: Today's Question Target */}
        <div className="space-y-3 lg:col-span-5 lg:border-r lg:border-slate-200 lg:dark:border-slate-800 lg:pr-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Target className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <span>Daily Question Target</span>
            </div>
            <div
              className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-[#0b0f17] p-0.5 border border-slate-200 dark:border-slate-800"
              role="group"
              aria-label="Select daily question goal"
            >
              {[25, 50, 100].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => onChangeDailyGoal(g)}
                  className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                    dailyGoalValue === g
                      ? 'bg-white dark:bg-[#18202c] text-blue-700 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {g}Q
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-baseline justify-between font-mono text-xs tabular-nums">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {dailyGoal.solvedToday} / {dailyGoal.goal} Qs solved today
            </span>
            <span
              className={`font-bold ${
                dailyGoal.goalMet
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-blue-700 dark:text-blue-400'
              }`}
            >
              {dailyGoal.percent}%
            </span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                dailyGoal.goalMet ? 'bg-emerald-600' : 'bg-blue-700 dark:bg-blue-500'
              }`}
              style={{ width: `${dailyGoal.percent}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{coach.actionTip}</p>
        </div>

        {/* Right: Subject Readiness Matrix */}
        <div className="space-y-3 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Subject Accuracy Snapshot
            </span>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {recentFullMockAvg200 !== null
                ? `Recent Full Mock Avg: ${recentFullMockAvg200}/200 (Safe Zone: ${TIER1_SAFE_BENCHMARK}+)`
                : `Tier-I Target Benchmark: ${TIER1_SAFE_BENCHMARK}+ / 200`}
            </span>
          </div>

          {subjectBreakdown.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
              Complete any mock or sectional sprint to populate live accuracy bars across Quant, Reasoning, English, and GA.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 pt-1">
              {subjectBreakdown.map((item) => {
                const isFocus = focusSubject?.subject === item.subject && item.accuracy < 75;
                return (
                  <button
                    key={item.subject}
                    type="button"
                    disabled={pracBusy}
                    onClick={() => onQuickFocusDrill(item.subject)}
                    title={`Launch 15-question ${item.label} drill`}
                    className="group text-left space-y-1.5 rounded-lg p-2 -m-2 hover:bg-slate-50 dark:hover:bg-[#18202c] transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
                        {item.label}
                      </span>
                      {isFocus && (
                        <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                          Focus
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                      {item.accuracy}%
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isFocus
                            ? 'bg-amber-500'
                            : item.accuracy >= 80
                              ? 'bg-emerald-600 dark:bg-emerald-500'
                              : 'bg-blue-700 dark:bg-blue-500'
                        }`}
                        style={{ width: `${Math.max(4, item.accuracy)}%` }}
                      />
                    </div>
                    <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {item.correct}/{item.attempted} Qs
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
