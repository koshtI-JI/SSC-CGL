import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Timer } from 'lucide-react';
import { SUBJECT_LABELS, type SubjectKey } from '../types/exam';
import {
  buildQuestionTimeSeries,
  SUBJECT_TARGET_PACE_SEC,
  type QuestionTimePoint,
} from '../utils/studentAnalyticsEngine';

interface QuestionTimeGraphProps {
  items: Array<{
    questionNumber: number;
    subject: SubjectKey;
    topic?: string;
    timeSpentSec: number;
    isCorrect: boolean;
    isSkipped: boolean;
  }>;
  title?: string;
  onSelectQuestionNumber?: (qNum: number) => void;
}

export const QuestionTimeGraph: React.FC<QuestionTimeGraphProps> = ({
  items,
  title = 'Question-Wise Time-Spent Analysis',
  onSelectQuestionNumber,
}) => {
  const analytics = useMemo(
    () =>
      buildQuestionTimeSeries(
        items.map((it) => ({
          questionId: String(it.questionNumber),
          subject: it.subject,
          topic: it.topic,
          timeSpentSec: it.timeSpentSec,
          selectedIndex: it.isSkipped ? -1 : 0,
          isCorrect: it.isCorrect,
        }))
      ),
    [items]
  );
  const [selectedPoint, setSelectedPoint] = useState<QuestionTimePoint | null>(null);

  if (analytics.points.length === 0) {
    return null;
  }

  const maxSec = Math.max(45, analytics.maxTimeSec);
  const activePoint =
    selectedPoint && analytics.points.some((p) => p.questionNumber === selectedPoint.questionNumber)
      ? selectedPoint
      : analytics.points.find((p) => p.paceBand === 'time_sink') ?? analytics.points[0];

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#181d27] p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
            <Timer className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>{title}</span>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Seconds spent per question vs. SSC CGL target pace (dashes mark slow traps &gt; 1.6x target)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold">
          <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <span className="h-2.5 w-2.5 rounded-xs bg-emerald-600" /> Correct
          </span>
          <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-400">
            <span className="h-2.5 w-2.5 rounded-xs bg-red-600" /> Wrong
          </span>
          <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <span className="h-2.5 w-2.5 rounded-xs bg-amber-500" /> Skipped
          </span>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] px-3 py-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Average Pace / Q</div>
          <div className="mt-0.5 font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {analytics.avgTimeSec}s
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] px-3 py-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Peak Question Time</div>
          <div className="mt-0.5 font-mono text-base font-bold text-blue-700 dark:text-blue-400 tabular-nums">
            {analytics.maxTimeSec}s
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] px-3 py-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Time Sinks Flagged</div>
          <div className="mt-0.5 font-mono text-base font-bold text-amber-700 dark:text-amber-400 tabular-nums">
            {analytics.timeSinksCount} Qs
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] px-3 py-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Wasted on Wrong</div>
          <div className="mt-0.5 font-mono text-base font-bold text-red-700 dark:text-red-400 tabular-nums">
            {analytics.wastedTimeOnWrongSec}s
          </div>
        </div>
      </div>

      {/* Horizontal Scrollable SVG/Bar Plot */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#11151d] p-4">
        <div className="flex items-end gap-1.5 min-w-max h-36 pt-4">
          {analytics.points.map((pt) => {
            const heightPct =
              pt.timeSpentSec > 0 ? Math.max(8, Math.min(100, Math.round((pt.timeSpentSec / maxSec) * 100))) : 4;
            const targetPct = Math.min(100, Math.round((pt.targetPaceSec / maxSec) * 100));
            const isSelected = activePoint?.questionNumber === pt.questionNumber;
            const barColor =
              pt.status === 'correct'
                ? 'bg-emerald-600 dark:bg-emerald-500'
                : pt.status === 'wrong'
                  ? 'bg-red-600 dark:bg-red-500'
                  : 'bg-amber-500 dark:bg-amber-400';

            return (
              <button
                key={pt.questionNumber}
                type="button"
                onClick={() => {
                  setSelectedPoint(pt);
                  onSelectQuestionNumber?.(pt.questionNumber);
                }}
                aria-label={`Q${pt.questionNumber} ${SUBJECT_LABELS[pt.subject].short}: ${pt.timeSpentSec}s (${pt.status})`}
                title={`Q${pt.questionNumber} (${SUBJECT_LABELS[pt.subject].short} · ${pt.topic}) — ${pt.timeSpentSec}s vs ${pt.targetPaceSec}s target`}
                className={`group relative flex h-full w-6 flex-col items-center justify-end gap-1 rounded-t px-0.5 transition-colors cursor-pointer ${
                  isSelected ? 'ring-2 ring-blue-600 bg-blue-50/70 dark:bg-blue-950/30' : 'hover:bg-slate-200/60 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="relative flex h-24 w-3.5 items-end overflow-hidden rounded-t bg-slate-200 dark:bg-slate-800">
                  <div
                    className={`w-full transition-all ${barColor}`}
                    style={{ height: `${heightPct}%` }}
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-700/70 dark:border-slate-300/60"
                    style={{ bottom: `${targetPct}%` }}
                  />
                </div>
                <span className="font-mono text-[9px] font-semibold text-slate-600 dark:text-slate-400 tabular-nums">
                  {pt.questionNumber}
                </span>
                {pt.paceBand === 'time_sink' && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Question Inspector Strip */}
      {activePoint && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] px-3.5 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
            <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
              Q{activePoint.questionNumber}
            </span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {SUBJECT_LABELS[activePoint.subject].short} · {activePoint.topic}
            </span>
            {activePoint.paceBand === 'time_sink' && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-100 dark:bg-amber-950/50 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:text-amber-300">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                Time Sink (&gt;1.6x target)
              </span>
            )}
          </div>
          <div className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">
            Spent <strong>{activePoint.timeSpentSec}s</strong> · Target{' '}
            <strong>{SUBJECT_TARGET_PACE_SEC[activePoint.subject]}s</strong> ·{' '}
            <span
              className={
                activePoint.status === 'correct'
                  ? 'font-bold text-emerald-700 dark:text-emerald-400'
                  : activePoint.status === 'wrong'
                    ? 'font-bold text-red-700 dark:text-red-400'
                    : 'font-bold text-amber-700 dark:text-amber-400'
              }
            >
              {activePoint.status.toUpperCase()}
            </span>
          </div>
        </div>
      )}
    </section>
  );
};
