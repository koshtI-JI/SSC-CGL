import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  canShowSwUpdatePrompt,
  shouldAutoApplySwUpdate,
} from '../utils/pwaUpdateGuard';

interface PwaUpdateBannerProps {
  activeExamOpen: boolean;
  isDestActive: boolean;
}

const SW_LAST_RELOAD_KEY = 'getcgl_sw_last_reload_ms';
const SW_UPDATE_POLL_INTERVAL_MS = 60_000;

function readLastReloadAtMs(): number | null {
  try {
    const raw = sessionStorage.getItem(SW_LAST_RELOAD_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function recordLastReloadAtMs(nowMs: number): void {
  try {
    sessionStorage.setItem(SW_LAST_RELOAD_KEY, String(nowMs));
  } catch {
    // Ignore storage errors
  }
}

export const PwaUpdateBanner: React.FC<PwaUpdateBannerProps> = ({
  activeExamOpen,
  isDestActive,
}) => {
  const [dismissed, setDismissed] = useState(false);
  const [autoUpdating, setAutoUpdating] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const autoAppliedRef = useRef(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      registrationRef.current = registration;
      void registration.update().catch(() => {});
    },
  });

  // Proactively check for fresh deployments on tab focus, visibility return, reconnect, and interval
  useEffect(() => {
    const checkForUpdates = () => {
      const reg = registrationRef.current;
      if (!reg) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void reg.update().catch(() => {});
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdates();
      }
    };

    window.addEventListener('focus', checkForUpdates);
    window.addEventListener('online', checkForUpdates);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const intervalId = window.setInterval(checkForUpdates, SW_UPDATE_POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', checkForUpdates);
      window.removeEventListener('online', checkForUpdates);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, []);

  // Automatically activate fresh deployments when idle (never during an active exam or DEST simulator)
  useEffect(() => {
    if (autoAppliedRef.current) return;
    const nowMs = Date.now();
    if (
      !shouldAutoApplySwUpdate({
        needRefresh,
        activeExamOpen,
        isDestActive,
        lastReloadAtMs: readLastReloadAtMs(),
        nowMs,
      })
    ) {
      return;
    }
    autoAppliedRef.current = true;
    setAutoUpdating(true);
    recordLastReloadAtMs(nowMs);
    const timer = window.setTimeout(() => {
      void updateServiceWorker(true).catch(() => {
        setAutoUpdating(false);
        autoAppliedRef.current = false;
      });
    }, 600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [needRefresh, activeExamOpen, isDestActive, updateServiceWorker]);

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
            {autoUpdating ? 'Applying Latest Update...' : 'Update Ready for Path to CGL'}
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            {autoUpdating
              ? 'Loading your newest changes automatically.'
              : 'Reload cleanly when ready — active exams are never interrupted.'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={autoUpdating}
            onClick={() => {
              recordLastReloadAtMs(Date.now());
              void updateServiceWorker(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${autoUpdating ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{autoUpdating ? 'Updating...' : 'Reload'}</span>
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
