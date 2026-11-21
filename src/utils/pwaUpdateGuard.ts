export interface SwUpdateGuardState {
  activeExamOpen: boolean;
  isDestActive: boolean;
}

export function shouldDeferSwUpdate(state: SwUpdateGuardState): boolean {
  return Boolean(state.activeExamOpen || state.isDestActive);
}

export function canShowSwUpdatePrompt(
  params: SwUpdateGuardState & { needRefresh: boolean; dismissed?: boolean }
): boolean {
  if (!params.needRefresh || params.dismissed) return false;
  return !shouldDeferSwUpdate({
    activeExamOpen: params.activeExamOpen,
    isDestActive: params.isDestActive,
  });
}

export const SW_AUTO_RELOAD_COOLDOWN_MS = 15_000;

export function shouldAutoApplySwUpdate(
  params: SwUpdateGuardState & {
    needRefresh: boolean;
    lastReloadAtMs?: number | null;
    nowMs?: number;
    cooldownMs?: number;
  }
): boolean {
  if (!params.needRefresh) return false;
  if (
    shouldDeferSwUpdate({
      activeExamOpen: params.activeExamOpen,
      isDestActive: params.isDestActive,
    })
  ) {
    return false;
  }
  const now = params.nowMs ?? Date.now();
  const cooldown = params.cooldownMs ?? SW_AUTO_RELOAD_COOLDOWN_MS;
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
