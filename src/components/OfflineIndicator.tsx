import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Trash2,
  WifiOff,
} from 'lucide-react';
import type { SyncHealthState } from '../utils/cloudFirstSync';
import type { FailedSyncOp } from '../utils/localFallbackStore';

interface OfflineIndicatorProps {
  pendingSyncCount?: number;
  syncHealth?: SyncHealthState;
  failedOps?: FailedSyncOp[];
  onRetrySync?: () => void;
  onRetryFailed?: (key?: string) => void;
  onDismissFailed?: (key: string) => void;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  pendingSyncCount = 0,
  syncHealth,
  failedOps = [],
  onRetrySync,
  onRetryFailed,
  onDismissFailed,
}) => {
  const [expanded, setExpanded] = useState(false);
  const status = syncHealth?.status ?? (pendingSyncCount > 0 ? 'pending' : 'synced');
  const effectivePending = syncHealth?.pendingCount ?? pendingSyncCount;
  const effectiveFailed = syncHealth?.failedCount ?? failedOps.length;

  // When online, synced cleanly, zero pending, zero failed: stay minimal & unobtrusive.
  if (status === 'synced' && effectivePending === 0 && effectiveFailed === 0) {
    return null;
  }

  const isOffline = status === 'offline';
  const hasFailures = effectiveFailed > 0 || status === 'failed';
  const isQuota = status === 'quota_limited';

  const toneClasses = hasFailures
    ? 'border-red-300 dark:border-red-800/70 bg-red-50 dark:bg-red-950/90 text-red-950 dark:text-red-100'
    : isOffline || isQuota
      ? 'border-amber-300 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/90 text-amber-950 dark:text-amber-100'
      : 'border-blue-200 dark:border-blue-800/70 bg-blue-50 dark:bg-blue-950/90 text-blue-950 dark:text-blue-100';

  const summaryLabel = hasFailures
    ? `${effectiveFailed} sync failure${effectiveFailed === 1 ? '' : 's'} · needs review`
    : isOffline
      ? `Offline · IndexedDB active${effectivePending > 0 ? ` (${effectivePending} queued)` : ''}`
      : isQuota
        ? `Cloud quota paused · ${effectivePending} saved locally`
        : status === 'syncing'
          ? `Syncing ${effectivePending} queued item${effectivePending === 1 ? '' : 's'}...`
          : `${effectivePending} local change${effectivePending === 1 ? '' : 's'} queued`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-4 z-50 max-w-sm rounded-xl border px-3.5 py-2 text-xs shadow-lg no-print ${toneClasses}`}
    >
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 font-semibold min-w-0">
          {hasFailures ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
          ) : isOffline ? (
            <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          ) : status === 'synced' ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          ) : (
            <RefreshCw
              className={`h-3.5 w-3.5 shrink-0 ${status === 'syncing' ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          )}
          <span className="truncate">{summaryLabel}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {(effectivePending > 0 || hasFailures) && !isOffline && onRetrySync && (
            <button
              type="button"
              onClick={() => (hasFailures && onRetryFailed ? onRetryFailed() : onRetrySync())}
              disabled={status === 'syncing'}
              className="rounded border border-current/25 px-2 py-0.5 text-[11px] font-bold hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 cursor-pointer"
            >
              Retry
            </button>
          )}
          {(failedOps.length > 0 || syncHealth?.lastError) && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Hide sync details' : 'Show sync details'}
              className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-2.5 border-t border-current/15 pt-2 space-y-2 text-[11px]">
          {syncHealth?.lastError && (
            <p className="opacity-90 break-words">
              <strong>Last error:</strong> {syncHealth.lastError}
            </p>
          )}
          {failedOps.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1.5">
              {failedOps.map((op) => (
                <div
                  key={op.key}
                  className="flex items-start justify-between gap-2 rounded border border-current/20 bg-white/50 dark:bg-black/25 p-1.5"
                >
                  <div className="min-w-0">
                    <div className="font-mono font-bold truncate">{op.key}</div>
                    <div className="opacity-85 break-words">{op.errorMessage}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {onRetryFailed && (
                      <button
                        type="button"
                        onClick={() => onRetryFailed(op.key)}
                        className="rounded border border-current/30 px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer"
                      >
                        Retry
                      </button>
                    )}
                    {onDismissFailed && (
                      <button
                        type="button"
                        onClick={() => onDismissFailed(op.key)}
                        aria-label={`Dismiss ${op.key}`}
                        className="rounded p-0.5 hover:bg-black/10 cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
