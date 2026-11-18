import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { wipeAllQuestionsFromFirestore } from '../lib/firestoreService';

interface WipeQuestionsModalProps {
  open: boolean;
  liveQuestionCount: number;
  onClose: () => void;
  onWiped: (deletedCount: number) => void;
  onError: (message: string) => void;
}

const CONFIRM_PHRASE = 'WIPE QUESTIONS';

export const WipeQuestionsModal: React.FC<WipeQuestionsModalProps> = ({
  open,
  liveQuestionCount,
  onClose,
  onWiped,
  onError,
}) => {
  const [acknowledged, setAcknowledged] = useState(false);
  const [typedPhrase, setTypedPhrase] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setAcknowledged(false);
      setTypedPhrase('');
      setBusy(false);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  const canConfirm =
    !busy && acknowledged && typedPhrase.trim().toUpperCase() === CONFIRM_PHRASE;

  const handleConfirmWipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirm) return;
    setBusy(true);
    try {
      const { deleted } = await wipeAllQuestionsFromFirestore();
      onWiped(deleted);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to wipe questions collection.');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wipe-db-modal-title"
    >
      <form
        onSubmit={handleConfirmWipe}
        className="w-full max-w-md rounded-2xl border border-red-300 dark:border-red-900/70 bg-white dark:bg-[#161b24] p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="wipe-db-modal-title"
                className="font-display text-base font-bold text-slate-900 dark:text-slate-100"
              >
                Wipe Old Questions Database
              </h2>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                Irreversible batch delete on Firestore{' '}
                <code className="font-mono text-red-700 dark:text-red-400">questions</code>
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Cancel wipe database"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 p-3.5 text-xs text-red-950 dark:text-red-200 space-y-1.5">
          <p className="font-semibold">
            This will permanently delete all{' '}
            <span className="font-mono font-bold tabular-nums">{liveQuestionCount}</span> existing
            question document(s) in Firestore.
          </p>
          <p className="opacity-90">
            Student test history and Revision Vault snapshots are preserved, but old mock question
            references will be cleared before you commit your new categorized PYQs.
          </p>
        </div>

        <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#11151d] p-3 text-xs text-slate-800 dark:text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            disabled={busy}
            className="mt-0.5 h-4 w-4 accent-red-600 cursor-pointer"
          />
          <span>
            I understand that all old documents in the{' '}
            <span className="font-mono font-semibold">questions</span> collection will be
            permanently wiped.
          </span>
        </label>

        <div>
          <label
            htmlFor="wipe-confirm-phrase"
            className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            Type <span className="font-mono font-bold text-red-700 dark:text-red-400">{CONFIRM_PHRASE}</span> to confirm
          </label>
          <input
            id="wipe-confirm-phrase"
            type="text"
            value={typedPhrase}
            onChange={(e) => setTypedPhrase(e.target.value)}
            disabled={busy}
            autoComplete="off"
            placeholder={CONFIRM_PHRASE}
            className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>Wiping Firestore...</span>
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Permanently Delete All Questions</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
