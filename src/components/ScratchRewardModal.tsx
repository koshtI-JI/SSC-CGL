import React, { useEffect, useRef, useState } from 'react';
import { Award, CheckCircle2, Sparkles, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { CohortTaskDoc } from '../types/exam';
import { applyActivityMultiplier } from '../utils/examEngine';

interface ScratchRewardModalProps {
  task: CohortTaskDoc;
  currentTotalXp: number;
  activityMultiplier?: number;
  activityTierLabel?: string;
  onClaimCommit: (task: CohortTaskDoc) => Promise<void>;
  onClose: () => void;
}

const CONFETTI_PIECES = [
  { x: -120, y: -95, rot: -45, color: 'bg-blue-600' },
  { x: -85, y: -125, rot: 30, color: 'bg-emerald-500' },
  { x: -45, y: -110, rot: -75, color: 'bg-amber-400' },
  { x: 0, y: -135, rot: 15, color: 'bg-blue-500' },
  { x: 48, y: -115, rot: 65, color: 'bg-emerald-600' },
  { x: 90, y: -120, rot: -35, color: 'bg-amber-500' },
  { x: 125, y: -90, rot: 50, color: 'bg-violet-500' },
  { x: -110, y: -45, rot: 25, color: 'bg-amber-400' },
  { x: 115, y: -40, rot: -55, color: 'bg-blue-600' },
  { x: -65, y: -70, rot: 80, color: 'bg-violet-500' },
  { x: 70, y: -75, rot: -20, color: 'bg-emerald-500' },
  { x: 15, y: -95, rot: 40, color: 'bg-amber-500' },
];

export const ScratchRewardModal: React.FC<ScratchRewardModalProps> = ({
  task,
  currentTotalXp,
  activityMultiplier = 1,
  activityTierLabel,
  onClaimCommit,
  onClose,
}) => {
  const effectiveBonusXp = applyActivityMultiplier(task.bonusXp, activityMultiplier);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const hasTriggeredRevealRef = useRef(false);

  const [revealed, setRevealed] = useState(false);
  const [scratchPercent, setScratchPercent] = useState(0);
  const [displayXp, setDisplayXp] = useState(0);
  const [commitState, setCommitState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [commitError, setCommitError] = useState<string | null>(null);

  // Paint metallic scratch foil onto canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#cbd5e1');
    grad.addColorStop(0.35, '#94a3b8');
    grad.addColorStop(0.65, '#e2e8f0');
    grad.addColorStop(1, '#64748b');

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle diagonal foil pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    for (let x = -h; x < w + h; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
      ctx.stroke();
    }

    // Center prompt on foil
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 16px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SCRATCH HERE TO REVEAL', w / 2, h / 2 - 10);

    ctx.fillStyle = '#334155';
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillText(
      `Task Reward · +${effectiveBonusXp} Bonus XP (${activityMultiplier.toFixed(2)}x Activity)`,
      w / 2,
      h / 2 + 16
    );
  }, [effectiveBonusXp, activityMultiplier]);

  const triggerRevealAndClaim = async () => {
    if (hasTriggeredRevealRef.current) return;
    hasTriggeredRevealRef.current = true;
    setRevealed(true);
    setScratchPercent(100);
    setCommitState('saving');
    setCommitError(null);
    try {
      await onClaimCommit(task);
      setCommitState('saved');
    } catch (err) {
      setCommitState('error');
      setCommitError(err instanceof Error ? err.message : 'Failed to credit Bonus XP.');
    }
  };

  // Smooth XP count-up once revealed
  useEffect(() => {
    if (!revealed) return;
    const duration = 700;
    const start = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayXp(Math.round(eased * effectiveBonusXp));
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [revealed, effectiveBonusXp]);

  const computeClearedRatio = (): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let transparent = 0;
    let total = 0;
    // Sample every 16th pixel (stride 64 bytes) for crisp O(1)-feel speed
    for (let i = 3; i < data.length; i += 64) {
      total += 1;
      if (data[i] < 32) transparent += 1;
    }
    return total > 0 ? Math.round((transparent / total) * 100) : 0;
  };

  const getLocalCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const scratchAt = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 42;

    if (lastPointRef.current) {
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 21, 0, Math.PI * 2);
      ctx.fill();
    }
    lastPointRef.current = { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (revealed) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    lastPointRef.current = null;
    const pt = getLocalCoords(e);
    scratchAt(pt.x, pt.y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || revealed) return;
    const pt = getLocalCoords(e);
    scratchAt(pt.x, pt.y);
    const pct = computeClearedRatio();
    setScratchPercent(pct);
    if (pct >= 38) {
      isDrawingRef.current = false;
      void triggerRevealAndClaim();
    }
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    const pct = computeClearedRatio();
    setScratchPercent(pct);
    if (pct >= 38) {
      void triggerRevealAndClaim();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scratch-reward-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        className="relative w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#181d27] p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
              Cohort Goal Achieved
            </p>
            <h2 id="scratch-reward-title" className="mt-0.5 font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              {task.title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close reward card"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scratch Card Stage */}
        <div className="relative mx-auto w-full overflow-hidden rounded-xl border-2 border-dashed border-amber-400 dark:border-amber-600/70 bg-gradient-to-br from-amber-50 via-white to-blue-50 dark:from-amber-950/30 dark:via-[#181d27] dark:to-blue-950/30">
          {/* Confetti Burst on Reveal */}
          {revealed && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible">
              {CONFETTI_PIECES.map((c, idx) => (
                <motion.span
                  key={idx}
                  initial={{ opacity: 1, x: 0, y: 0, scale: 0.4, rotate: 0 }}
                  animate={{
                    opacity: [1, 1, 0],
                    x: c.x,
                    y: c.y,
                    scale: [0.6, 1.1, 0.9],
                    rotate: c.rot * 2,
                  }}
                  transition={{ duration: 0.85, ease: 'easeOut' }}
                  className={`absolute h-2.5 w-2.5 rounded-xs ${c.color}`}
                />
              ))}
            </div>
          )}

          {/* Underneath Reward Layer */}
          <div className="flex h-48 flex-col items-center justify-center p-5 text-center">
            <motion.div
              animate={revealed ? { scale: [0.85, 1.12, 1] } : { scale: 1 }}
              transition={{ duration: 0.45 }}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300"
            >
              <Award className="h-6 w-6" aria-hidden="true" />
            </motion.div>

            <div className="mt-3 font-mono text-3xl font-bold tracking-tight text-blue-700 dark:text-blue-400 tabular-nums">
              +{revealed ? displayXp : effectiveBonusXp} XP
            </div>
            <div className="mt-1 text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
              Base {task.bonusXp} XP × {activityMultiplier.toFixed(2)}x ({activityTierLabel ?? 'Activity'})
            </div>
            <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              {commitState === 'saved'
                ? `Added to Live Leaderboard · New Total: ${currentTotalXp} XP`
                : commitState === 'saving'
                  ? 'Crediting Bonus XP to Live Leaderboard...'
                  : commitState === 'error'
                    ? commitError
                    : 'Bonus XP Unlocked!'}
            </p>
          </div>

          {/* Interactive Scratch Canvas Overlay */}
          <motion.canvas
            ref={canvasRef}
            width={400}
            height={192}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            animate={{ opacity: revealed ? 0 : 1 }}
            transition={{ duration: 0.35 }}
            style={{ touchAction: 'none' }}
            className={`absolute inset-0 h-full w-full ${
              revealed ? 'pointer-events-none' : 'cursor-grab active:cursor-grabbing'
            }`}
          />
        </div>

        {/* Footer Controls */}
        <div className="flex items-center justify-between gap-3">
          {!revealed ? (
            <>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                Scratched {scratchPercent}%
              </span>
              <button
                type="button"
                onClick={() => void triggerRevealAndClaim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Reveal &amp; Claim Instantly</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              disabled={commitState === 'saving'}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <span>
                {commitState === 'saving' ? 'Crediting XP...' : 'Done · Back to Dashboard'}
              </span>
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
};
