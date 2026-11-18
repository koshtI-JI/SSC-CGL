import { useMemo, useState } from 'react';
import { Award, CheckCircle2, Sparkles, X, Zap } from 'lucide-react';
import type { QuestionDoc } from '../types/exam';
import { scorePopupRewardQuiz } from '../utils/sessionAndOverrides';

interface PopupRewardQuizModalProps {
  open: boolean;
  questions: QuestionDoc[];
  onClose: () => void;
  onClaimReward: (result: { correctCount: number; totalCount: number; xpAwarded: number }) => Promise<void>;
}

export function PopupRewardQuizModal({
  open,
  questions,
  onClose,
  onClaimReward,
}: PopupRewardQuizModalProps) {
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimedDone, setClaimedDone] = useState(false);

  const outcome = useMemo(
    () => scorePopupRewardQuiz(questions, selected),
    [questions, selected]
  );

  if (!open || questions.length === 0) return null;

  const allAnswered = questions.every((q) => typeof selected[q.id] === 'number');

  const handleSubmit = async () => {
    if (!allAnswered || submittingOrLocked()) return;
    setSubmitted(true);
    if (outcome.xpAwarded > 0) {
      setClaiming(true);
      try {
        await onClaimReward(outcome);
        setClaimedDone(true);
      } finally {
        setClaiming(false);
      }
    } else {
      setClaimedDone(true);
    }
  };

  function submittingOrLocked() {
    return claiming || submitted;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Bonus XP Flash Quiz"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-amber-200 dark:border-amber-800/70 bg-[#faf9f6] dark:bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-amber-200/80 dark:border-slate-800 bg-amber-50/70 dark:bg-amber-950/30 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Surprise XP Flash Quiz
              </h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Quick 2-hour active session checkpoint · Earn up to +25 Bonus XP!
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss flash quiz"
            className="rounded-md p-1 text-slate-500 hover:bg-amber-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-5 space-y-4">
          {questions.map((q, qIdx) => {
            const chosen = selected[q.id];
            return (
              <div
                key={q.id}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/60 p-4 space-y-2.5"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  Q{qIdx + 1} · {q.subject.toUpperCase()} · {q.topic}
                </p>
                <p className="text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 leading-relaxed">
                  {q.questionEn}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {q.optionsEn.map((opt, idx) => {
                    const isPicked = chosen === idx;
                    const isRight = q.correctIndex === idx;
                    let cls =
                      'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:border-blue-400';
                    if (submitted) {
                      if (isRight) {
                        cls =
                          'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 font-semibold';
                      } else if (isPicked && !isRight) {
                        cls =
                          'border-rose-500 bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200';
                      }
                    } else if (isPicked) {
                      cls =
                        'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100 font-semibold';
                    }

                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={submitted}
                        onClick={() => setSelected((prev) => ({ ...prev, [q.id]: idx }))}
                        className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${cls}`}
                      >
                        <span className="font-mono font-semibold mr-1.5">
                          {String.fromCharCode(65 + idx)}.
                        </span>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {submitted && (
            <div
              className={`rounded-lg border p-3.5 flex items-center justify-between ${
                outcome.xpAwarded > 0
                  ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {outcome.xpAwarded > 0 ? (
                  <Award className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-slate-500 shrink-0" />
                )}
                <div>
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {outcome.correctCount} / {outcome.totalCount} Correct
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    {outcome.xpAwarded > 0
                      ? claiming
                        ? 'Crediting bonus XP to leaderboard...'
                        : claimedDone
                          ? `+${outcome.xpAwarded} Bonus XP credited instantly!`
                          : `+${outcome.xpAwarded} Bonus XP unlocked`
                      : 'Keep revising your daily mocks — next checkpoint in 2 hours!'}
                  </p>
                </div>
              </div>
              {outcome.xpAwarded > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white">
                  <Zap className="h-3.5 w-3.5" />+{outcome.xpAwarded} XP
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 px-5 py-3">
          {submitted ? (
            <button
              type="button"
              disabled={claiming}
              onClick={onClose}
              className="rounded-lg bg-slate-900 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              Back to Study
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Skip This Time
              </button>
              <button
                type="button"
                disabled={!allAnswered || claiming}
                onClick={handleSubmit}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white"
              >
                <Zap className="h-3.5 w-3.5" />
                Submit & Claim XP
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
