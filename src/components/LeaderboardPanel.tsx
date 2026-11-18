import React from 'react';
import { Award } from 'lucide-react';
import type { LeaderboardEntry, StudentSessionLogDoc, XpLedgerEntryDoc } from '../types/exam';
import {
  computeStudentRankTier,
  formatSeconds,
  rankLeaderboard,
  toLocalDateKey,
} from '../utils/examEngine';
import { isRealCohortStudentUid } from '../utils/sessionAndOverrides';
import { RankBadge } from './RankBadge';

interface LeaderboardPanelProps {
  entries: LeaderboardEntry[];
  currentUid?: string;
  recentLedger?: XpLedgerEntryDoc[];
  sessionLogs?: StudentSessionLogDoc[];
}

export const LeaderboardPanel: React.FC<LeaderboardPanelProps> = ({
  entries,
  currentUid,
  recentLedger = [],
  sessionLogs = [],
}) => {
  const realEntries = entries.filter((e) => isRealCohortStudentUid(e.uid));
  const realLedger = recentLedger.filter((entry) => isRealCohortStudentUid(entry.uid));
  const ranked = rankLeaderboard(realEntries);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27]">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              Live Cohort Leaderboard
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Real-time Firestore ranking · Primary: Total XP · Tie-break: Best Score &amp; Accuracy
            </p>
          </div>
          <Award className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
        </div>

        {ranked.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              No VIP cohort members have signed in yet.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Once invited students log in and attempt mock tests, their live rank will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <th className="px-5 py-3">Rank</th>
                  <th className="px-5 py-3">Aspirant</th>
                  <th className="px-5 py-3 text-right">Total XP</th>
                  <th className="px-5 py-3 text-right">Best Score</th>
                  <th className="px-5 py-3 text-right">Avg Accuracy</th>
                  <th className="px-5 py-3 text-right">Mocks</th>
                  <th className="px-5 py-3 text-right">Time Logged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ranked.map((row, idx) => {
                  const isMe = currentUid === row.uid;
                  const activeDaysSet = new Set<string>();
                  for (const s of sessionLogs) {
                    if (s.uid === row.uid && s.loginAtMs > 0) {
                      activeDaysSet.add(toLocalDateKey(s.loginAtMs));
                    }
                  }
                  const tier = computeStudentRankTier({
                    totalXp: row.totalXp,
                    testsCompleted: row.testsAttempted,
                    activeDays: activeDaysSet.size,
                  });
                  return (
                    <tr
                      key={row.uid}
                      className={
                        isMe
                          ? 'bg-blue-50/60 dark:bg-blue-950/30'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }
                    >
                      <td className="px-5 py-3 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        #{idx + 1}
                      </td>
                      <td className="px-5 py-3">
                        <div className="mb-1">
                          <RankBadge tier={tier} variant="compact" />
                        </div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {row.displayName} {isMe ? '(You)' : ''}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{row.targetPost}</div>
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                        {row.totalXp} XP
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                        {row.bestScore}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                        {row.avgAccuracy}%
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                        {row.testsAttempted}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                        {formatSeconds(row.totalTimeSec)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {realLedger.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27]">
          <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Recent XP Activity
            </h3>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {realLedger.slice(0, 6).map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900 dark:text-slate-100">{entry.reason}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {entry.studentName} · {entry.sourceType}
                  </p>
                </div>
                <span
                  className={`font-mono text-sm font-bold tabular-nums shrink-0 ${
                    entry.deltaXp >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {entry.deltaXp >= 0 ? `+${entry.deltaXp}` : entry.deltaXp} XP
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
