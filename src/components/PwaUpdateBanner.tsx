import React, { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { canShowSwUpdatePrompt } from '../utils/pwaUpdateGuard';

interface PwaUpdateBannerProps {
  activeExamOpen: boolean;
  isDestActive: boolean;
}

export const PwaUpdateBanner: React.FC<PwaUpdateBannerProps> = ({
  activeExamOpen,
  isDestActive,
}) => {
  const [dismissed, setDismissed] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const visible = canShowSwUpdatePrompt({
    needRefresh,
    activeExamOpen,
    isDestActive,
    dismissed,
  });

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,440px)] rounded-xl border border-blue-300 dark:border-blue-700 bg-white dark:bg-[#131924] px-4 py-3 text-xs text-slate-900 dark:text-slate-100 shadow-xl no-print"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-blue-800 dark:text-blue-300">
            Update Ready for Path to CGL
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            Reload cleanly when ready — active exams are never interrupted.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void updateServiceWorker(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 px-3 py-1.5 text-[11px] font-semibold text-white cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reload</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              setNeedRefresh(false);
            }}
            aria-label="Dismiss update notification"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};
