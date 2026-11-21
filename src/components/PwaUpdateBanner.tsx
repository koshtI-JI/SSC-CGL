import React, { useEffect, useRef } from 'react';
import {
  LIVE_REFRESH_POLL_INTERVAL_MS,
  parseBuildVersionPayload,
  shouldAutoReloadForVersion,
} from '../utils/liveAutoRefresh';

interface PwaUpdateBannerProps {
  activeExamOpen: boolean;
  isDestActive: boolean;
}

const LAST_RELOAD_KEY = 'getcgl_live_refresh_last_ms';

function readLastReloadAtMs(): number | null {
  try {
    const raw = sessionStorage.getItem(LAST_RELOAD_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function recordLastReloadAtMs(nowMs: number): void {
  try {
    sessionStorage.setItem(LAST_RELOAD_KEY, String(nowMs));
  } catch {
    // Ignore storage errors
  }
}

async function clearStaleSwAndCaches(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));
    }
  } catch {
    // Ignore SW cleanup errors
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
    }
  } catch {
    // Ignore cache cleanup errors
  }
}

export const PwaUpdateBanner: React.FC<PwaUpdateBannerProps> = ({
  activeExamOpen,
  isDestActive,
}) => {
  const reloadingRef = useRef(false);
  const examOpenRef = useRef(activeExamOpen);
  const destActiveRef = useRef(isDestActive);

  useEffect(() => {
    examOpenRef.current = activeExamOpen;
    destActiveRef.current = isDestActive;
  }, [activeExamOpen, isDestActive]);

  useEffect(() => {
    // Ensure any legacy PWA service worker or cached bundle is removed
    void clearStaleSwAndCaches();

    const currentVersion =
      typeof __APP_BUILD_VERSION__ === 'string' ? __APP_BUILD_VERSION__ : '';
    if (!currentVersion) return;

    const baseUrl = import.meta.env.BASE_URL || '/';
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

    let disposed = false;

    const checkLiveVersion = async () => {
      if (disposed || reloadingRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      try {
        const res = await fetch(`${normalizedBase}version.json?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) return;
        const json: unknown = await res.json();
        const remoteVersion = parseBuildVersionPayload(json);
        const nowMs = Date.now();

        if (
          shouldAutoReloadForVersion({
            currentVersion,
            remoteVersion,
            activeExamOpen: examOpenRef.current,
            isDestActive: destActiveRef.current,
            lastReloadAtMs: readLastReloadAtMs(),
            nowMs,
          })
        ) {
          reloadingRef.current = true;
          recordLastReloadAtMs(nowMs);
          await clearStaleSwAndCaches();
          window.location.reload();
        }
      } catch {
        // Ignore transient network failures while polling
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkLiveVersion();
      }
    };

    const onFocusOrOnline = () => {
      void checkLiveVersion();
    };

    window.addEventListener('focus', onFocusOrOnline);
    window.addEventListener('online', onFocusOrOnline);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const intervalId = window.setInterval(() => {
      void checkLiveVersion();
    }, LIVE_REFRESH_POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      window.removeEventListener('focus', onFocusOrOnline);
      window.removeEventListener('online', onFocusOrOnline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, []);

  return null;
};
