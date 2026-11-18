import React from 'react';
import { Award, Crown, Shield, Sparkles, Trophy, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { RankDivision, RankTierInfo } from '../utils/examEngine';

interface DivisionTheme {
  accentText: string;
  barFill: string;
}

const DIVISION_THEMES: Record<RankDivision, DivisionTheme> = {
  Bronze: {
    accentText: 'text-amber-700 dark:text-amber-400',
    barFill: 'bg-amber-600 dark:bg-amber-500',
  },
  Silver: {
    accentText: 'text-slate-700 dark:text-slate-300',
    barFill: 'bg-slate-600 dark:bg-slate-400',
  },
  Gold: {
    accentText: 'text-yellow-700 dark:text-yellow-400',
    barFill: 'bg-yellow-500',
  },
  Platinum: {
    accentText: 'text-cyan-700 dark:text-cyan-400',
    barFill: 'bg-cyan-600 dark:bg-cyan-500',
  },
  Diamond: {
    accentText: 'text-indigo-700 dark:text-indigo-400',
    barFill: 'bg-indigo-600 dark:bg-indigo-500',
  },
};

function DivisionEmblem({ division, className }: { division: RankDivision; className?: string }) {
  if (division === 'Diamond') return <Crown className={className} aria-hidden="true" />;
  if (division === 'Platinum') return <Trophy className={className} aria-hidden="true" />;
  if (division === 'Gold') return <Award className={className} aria-hidden="true" />;
  return <Shield className={className} aria-hidden="true" />;
}

interface RankBadgeProps {
  tier: RankTierInfo;
  variant?: 'hero' | 'compact';
}

export const RankBadge: React.FC<RankBadgeProps> = ({ tier, variant = 'hero' }) => {
  const theme = DIVISION_THEMES[tier.division];

  if (variant === 'compact') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold whitespace-nowrap tabular-nums ${theme.accentText}`}
        title={`${tier.label} · Rank Power ${tier.tierScore}`}
      >
        <DivisionEmblem division={tier.division} className="h-3.5 w-3.5 shrink-0" />
        <span>{tier.label}</span>
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <motion.div
        key={tier.step}
        initial={{ opacity: 0.7 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className={`inline-flex items-center gap-1.5 font-mono font-bold whitespace-nowrap tabular-nums ${theme.accentText}`}
      >
        <DivisionEmblem division={tier.division} className="h-4 w-4 shrink-0" />
        <span>{tier.label}</span>
        <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
          ·
        </span>
        <span className="text-slate-600 dark:text-slate-400 font-semibold">
          Step {tier.step}/25
        </span>
      </motion.div>

      <div className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className={`h-full transition-all duration-300 ${theme.barFill}`}
            style={{ width: `${Math.max(4, tier.progressPercent)}%` }}
          />
        </div>
        <span>
          {tier.nextLabel && tier.nextStepScore !== null
            ? `${tier.tierScore}/${tier.nextStepScore} → ${tier.nextLabel}`
            : 'Max Tier Reached'}
        </span>
      </div>
    </div>
  );
};

interface RankLevelUpOverlayProps {
  fromTier: RankTierInfo;
  toTier: RankTierInfo;
  onDismiss: () => void;
}

export const RankLevelUpOverlay: React.FC<RankLevelUpOverlayProps> = ({
  fromTier,
  toTier,
  onDismiss,
}) => {
  const fromTheme = DIVISION_THEMES[fromTier.division];
  const toTheme = DIVISION_THEMES[toTier.division];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-label="Rank Promotion"
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131924] p-6 shadow-xl"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 dark:text-blue-400">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <span>Rank Tier Promoted</span>
            </span>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close rank promotion dialog"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-4 text-center space-y-4">
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              Level Up! New Rank Unlocked
            </h2>

            <div className="flex items-center justify-center gap-4 py-3 border-y border-slate-200 dark:border-slate-800">
              <div className={`inline-flex items-center gap-1.5 font-mono text-xs font-bold opacity-70 ${fromTheme.accentText}`}>
                <DivisionEmblem division={fromTier.division} className="h-4 w-4" />
                <span>{fromTier.label}</span>
              </div>

              <span className="font-mono text-sm font-bold text-slate-400" aria-hidden="true">
                →
              </span>

              <div className={`inline-flex items-center gap-2 font-mono text-sm font-bold ${toTheme.accentText}`}>
                <DivisionEmblem division={toTier.division} className="h-5 w-5" />
                <span>{toTier.label}</span>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Consistent mock completions, daily study days, and XP earned promoted you from{' '}
              <strong>{fromTier.label}</strong> to <strong>{toTier.label}</strong>.
            </p>

            <button
              type="button"
              onClick={onDismiss}
              className="w-full min-h-[40px] rounded-lg bg-blue-700 hover:bg-blue-800 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              Continue Practice
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
