import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Flag, Loader2, X } from 'lucide-react';
import type { QuestionDoc } from '../types/exam';
import { submitReportedQuery } from '../lib/firestoreService';

const QUICK_REPORT_REASONS = [
  'Wrong Answer Key / Correct Option Marked Incorrect',
  'Calculation Error or Wrong AI Explanation',
  'Bilingual Translation / Hindi Mismatch',
  'Incomplete Question Data or Typo',
];

interface ReportQuestionModalProps {
  open: boolean;
  onClose: () => void;
  uid: string;
  loginId: string;
  studentName: string;
  question: QuestionDoc | null;
  sourceContext: string;
  aiExplanationSnapshot?: string;
}

export function ReportQuestionModal({
  open,
  onClose,
  uid,
  loginId,
  studentName,
  question,
  sourceContext,
  aiExplanationSnapshot,
}: ReportQuestionModalProps) {
  const [selectedPreset, setSelectedPreset] = useState(QUICK_REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (!open || !question) return null;

  const handleClose = () => {
    setError(null);
    setSubmitted(false);
    setDetails('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const combined = details.trim()
      ? `${selectedPreset} — ${details.trim()}`
      : selectedPreset;
    setSubmitting(true);
    setError(null);
    try {
      await submitReportedQuery({
        uid,
        loginId,
        studentName,
        question,
        sourceContext,
        reason: combined,
        aiExplanationSnapshot,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit error report right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Report Question or Explanation Error"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-700 bg-[#faf9f6] dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Report Question / Answer Error
            </h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close report modal"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {submitted ? (
          <div className="p-6 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400 mx-auto" />
            <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Report Sent to Admin Queue
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Once Admin verifies and updates the answer or explanation, the fix will automatically apply across all cohort mock reviews and question banks.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-2 rounded-lg bg-slate-900 dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {question.subject.toUpperCase()} · {question.topic}
              </p>
              <p className="mt-1 line-clamp-3 text-xs text-slate-800 dark:text-slate-200">
                {question.questionEn}
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Issue Category
              </label>
              <select
                value={selectedPreset}
                onChange={(e) => setSelectedPreset(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              >
                {QUICK_REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Additional Note for Admin (Optional)
              </label>
              <textarea
                rows={3}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={600}
                placeholder="Explain what should be corrected (e.g., Correct answer should be Option B because...)"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 px-4 py-2 text-xs font-semibold text-white"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Submit Error Report
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
