import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PLATFORM_CONFIG, normalizePlatformConfig } from './platformConfig';

test('normalizePlatformConfig clamps auto-logout timeout and sanitizes fields cleanly', () => {
  const cfg = normalizePlatformConfig({
    appName: '  Path to CGL Pro  ',
    defaultLanguage: 'hi',
    offlineAutoLogoutSec: 12,
    strictCameraDefault: true,
    dailyAutoMockEnabled: false,
    maintenanceBanner: ' Scheduled maintenance at 10 PM ',
  });

  assert.equal(cfg.appName, 'Path to CGL Pro');
  assert.equal(cfg.defaultLanguage, 'hi');
  assert.equal(cfg.offlineAutoLogoutSec, 30); // clamped min 30s
  assert.equal(cfg.strictCameraDefault, true);
  assert.equal(cfg.dailyAutoMockEnabled, false);
  assert.equal(cfg.maintenanceBanner, 'Scheduled maintenance at 10 PM');

  const defaults = normalizePlatformConfig(null);
  assert.deepEqual(defaults, DEFAULT_PLATFORM_CONFIG);
});
