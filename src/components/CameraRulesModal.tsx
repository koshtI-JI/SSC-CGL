import React, { useEffect, useState } from 'react';
import { AlertCircle, Camera, ShieldCheck, X } from 'lucide-react';
import type { MockTestDoc } from '../types/exam';

interface CameraRulesModalProps {
  test: MockTestDoc;
  busy: boolean;
  errorMsg: string | null;
  defaultStrictCamera?: boolean;
  onGrantAndStart: (strictCameraRequired: boolean) => Promise<void>;
  onContinueWithoutCamera: () => void;
  onCancel: () => void;
}

export const CameraRulesModal: React.FC<CameraRulesModalProps> = ({
  test,
  busy,
  errorMsg,
  defaultStrictCamera = false,
  onGrantAndStart,
  onContinueWithoutCamera,
  onCancel,
}) => {
  const [checked, setChecked] = useState(false);
  const [strictCameraRequired, setStrictCameraRequired] = useState(defaultStrictCamera);

  useEffect(() => {
    setStrictCameraRequired(defaultStrictCamera);
  }, [defaultStrictCamera]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-rules-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#181d27] p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3.5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 p-2.5 text-blue-700 dark:text-blue-400">
              <Camera className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="camera-rules-title"
                className="font-display text-lg font-bold text-slate-900 dark:text-slate-100"
              >
                Strict Exam Rules &amp; Camera Proctoring
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Before starting <strong className="text-slate-800 dark:text-slate-200">{test.title}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Cancel and return"
            className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <ul className="space-y-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] p-4 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>
              <strong>Live Camera Proctoring:</strong> When a webcam is available, it stays active for discipline verification. If camera access is denied or no webcam exists, the exam still launches safely in non-camera mode unless Strict Camera Lock is enabled.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>
              <strong>One-Time Rule Consent:</strong> Once you allow camera access here, this prompt will not appear again on future tests unless browser camera permission is revoked.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>
              <strong>&gt;80% Attempt Rule for XP:</strong> Attempt strictly more than 80% of questions to earn XP and appear on the cohort leaderboard. Skipped questions auto-save to Pending &amp; Revision Vault.
            </span>
          </li>
        </ul>

        <div className="space-y-2">
          <label className="flex items-start gap-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] p-3.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-blue-700"
            />
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              I agree to the exam rules and allow camera check if a webcam is connected
            </span>
          </label>

          <label className="flex items-center gap-2.5 px-1 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={strictCameraRequired}
              onChange={(e) => setStrictCameraRequired(e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-700"
            />
            <span>Enforce Strict Camera Lock (block exam launch if camera is unavailable)</span>
          </label>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/35 p-3 text-xs text-amber-950 dark:text-amber-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            Not Now
          </button>
          {!strictCameraRequired && (
            <button
              type="button"
              disabled={!checked || busy}
              onClick={onContinueWithoutCamera}
              className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-2 text-xs font-semibold text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              Start Without Camera
            </button>
          )}
          <button
            type="button"
            disabled={!checked || busy}
            onClick={() => void onGrantAndStart(strictCameraRequired)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 hover:bg-blue-800 px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{busy ? 'Checking Camera...' : 'Enable Camera & Start Test'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
