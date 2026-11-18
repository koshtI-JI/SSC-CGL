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
