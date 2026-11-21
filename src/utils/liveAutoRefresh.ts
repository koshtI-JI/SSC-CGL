import { shouldDeferSwUpdate, type SwUpdateGuardState } from './pwaUpdateGuard';

export const LIVE_REFRESH_POLL_INTERVAL_MS = 10_000;
export const LIVE_REFRESH_COOLDOWN_MS = 12_000;

export function parseBuildVersionPayload(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = (raw as { version?: unknown }).version;
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function shouldAutoReloadForVersion(
  params: SwUpdateGuardState & {
    currentVersion: string;
    remoteVersion: string | null;
    lastReloadAtMs?: number | null;
    nowMs?: number;
    cooldownMs?: number;
  }
): boolean {
  const current = params.currentVersion.trim();
  const remote = params.remoteVersion ? params.remoteVersion.trim() : '';
  if (!current || !remote || current === remote) {
    return false;
  }
  if (
    shouldDeferSwUpdate({
      activeExamOpen: params.activeExamOpen,
      isDestActive: params.isDestActive,
    })
  ) {
    return false;
  }
  const now = params.nowMs ?? Date.now();
  const cooldown = params.cooldownMs ?? LIVE_REFRESH_COOLDOWN_MS;
  if (
    typeof params.lastReloadAtMs === 'number' &&
    Number.isFinite(params.lastReloadAtMs) &&
    params.lastReloadAtMs > 0 &&
    now - params.lastReloadAtMs < cooldown
  ) {
    return false;
  }
  return true;
}
