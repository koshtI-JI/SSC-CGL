import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIVE_REFRESH_COOLDOWN_MS,
  parseBuildVersionPayload,
  shouldAutoReloadForVersion,
} from './liveAutoRefresh';

test('parseBuildVersionPayload extracts non-empty version strings and rejects malformed values', () => {
  assert.equal(parseBuildVersionPayload({ version: '2026-11-21-abc' }), '2026-11-21-abc');
  assert.equal(parseBuildVersionPayload({ version: '  v2  ' }), 'v2');
  assert.equal(parseBuildVersionPayload({ version: '' }), null);
  assert.equal(parseBuildVersionPayload({ version: 123 }), null);
  assert.equal(parseBuildVersionPayload(null), null);
});

test('shouldAutoReloadForVersion triggers only when version changes, idle, and outside cooldown', () => {
  assert.equal(
    shouldAutoReloadForVersion({
      currentVersion: 'v1',
      remoteVersion: 'v1',
      activeExamOpen: false,
      isDestActive: false,
    }),
    false
  );

  assert.equal(
    shouldAutoReloadForVersion({
      currentVersion: 'v1',
      remoteVersion: 'v2',
      activeExamOpen: false,
      isDestActive: false,
      lastReloadAtMs: null,
      nowMs: 100_000,
    }),
    true
  );

  assert.equal(
    shouldAutoReloadForVersion({
      currentVersion: 'v1',
      remoteVersion: 'v2',
      activeExamOpen: true,
      isDestActive: false,
      lastReloadAtMs: null,
      nowMs: 100_000,
    }),
    false
  );

  assert.equal(
    shouldAutoReloadForVersion({
      currentVersion: 'v1',
      remoteVersion: 'v2',
      activeExamOpen: false,
      isDestActive: true,
      lastReloadAtMs: null,
      nowMs: 100_000,
    }),
    false
  );

  assert.equal(
    shouldAutoReloadForVersion({
      currentVersion: 'v1',
      remoteVersion: 'v2',
      activeExamOpen: false,
      isDestActive: false,
      lastReloadAtMs: 100_000,
      nowMs: 100_000 + LIVE_REFRESH_COOLDOWN_MS - 1_000,
    }),
    false
  );

  assert.equal(
    shouldAutoReloadForVersion({
      currentVersion: 'v1',
      remoteVersion: 'v2',
      activeExamOpen: false,
      isDestActive: false,
      lastReloadAtMs: 100_000,
      nowMs: 100_000 + LIVE_REFRESH_COOLDOWN_MS + 500,
    }),
    true
  );
});
