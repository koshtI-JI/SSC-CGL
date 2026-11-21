import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canShowSwUpdatePrompt,
  shouldAutoApplySwUpdate,
  shouldDeferSwUpdate,
} from './pwaUpdateGuard';

test('shouldDeferSwUpdate blocks updates during live mock exam or DEST simulator', () => {
  assert.equal(shouldDeferSwUpdate({ activeExamOpen: true, isDestActive: false }), true);
  assert.equal(shouldDeferSwUpdate({ activeExamOpen: false, isDestActive: true }), true);
  assert.equal(shouldDeferSwUpdate({ activeExamOpen: true, isDestActive: true }), true);
  assert.equal(shouldDeferSwUpdate({ activeExamOpen: false, isDestActive: false }), false);
});

test('canShowSwUpdatePrompt only allows prompt when update is pending, not dismissed, and no assessment is active', () => {
  assert.equal(
    canShowSwUpdatePrompt({ needRefresh: true, activeExamOpen: false, isDestActive: false }),
    true
  );
  assert.equal(
    canShowSwUpdatePrompt({ needRefresh: true, activeExamOpen: true, isDestActive: false }),
    false
  );
  assert.equal(
    canShowSwUpdatePrompt({ needRefresh: true, activeExamOpen: false, isDestActive: true }),
    false
  );
  assert.equal(
    canShowSwUpdatePrompt({
      needRefresh: true,
      activeExamOpen: false,
      isDestActive: false,
      dismissed: true,
    }),
    false
  );
  assert.equal(
    canShowSwUpdatePrompt({ needRefresh: false, activeExamOpen: false, isDestActive: false }),
    false
  );
});

test('shouldAutoApplySwUpdate applies immediately when idle, defers in exams, and respects cooldown', () => {
  const now = 1_700_000_000_000;
  assert.equal(
    shouldAutoApplySwUpdate({
      needRefresh: true,
      activeExamOpen: false,
      isDestActive: false,
      lastReloadAtMs: null,
      nowMs: now,
    }),
    true
  );
  assert.equal(
    shouldAutoApplySwUpdate({
      needRefresh: true,
      activeExamOpen: true,
      isDestActive: false,
      lastReloadAtMs: null,
      nowMs: now,
    }),
    false
  );
  assert.equal(
    shouldAutoApplySwUpdate({
      needRefresh: true,
      activeExamOpen: false,
      isDestActive: true,
      lastReloadAtMs: null,
      nowMs: now,
    }),
    false
  );
  assert.equal(
    shouldAutoApplySwUpdate({
      needRefresh: true,
      activeExamOpen: false,
      isDestActive: false,
      lastReloadAtMs: now - 5_000,
      nowMs: now,
    }),
    false
  );
  assert.equal(
    shouldAutoApplySwUpdate({
      needRefresh: true,
      activeExamOpen: false,
      isDestActive: false,
      lastReloadAtMs: now - 20_000,
      nowMs: now,
    }),
    true
  );
});
