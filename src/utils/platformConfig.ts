export type ThemePreferenceMode = 'system' | 'light' | 'dark';

export interface PlatformConfig {
  appName: string;
  cohortName: string;
  defaultLanguage: 'en' | 'hi';
  strictCameraDefault: boolean;
  offlineAutoLogoutSec: number;
  dailyAutoMockEnabled: boolean;
  githubReportsEnabled: boolean;
  aiTutorEnabled: boolean;
  maintenanceBanner: string;
  updatedAtMs: number;
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  appName: 'Path to CGL',
  cohortName: 'SSC CGL VIP Cohort',
  defaultLanguage: 'en',
  strictCameraDefault: false,
  offlineAutoLogoutSec: 60,
  dailyAutoMockEnabled: true,
  githubReportsEnabled: true,
  aiTutorEnabled: true,
  maintenanceBanner: '',
  updatedAtMs: 0,
};

export function normalizePlatformConfig(
  raw?: Partial<PlatformConfig> | null
): PlatformConfig {
  const src = raw ?? {};
  const sec = Number(src.offlineAutoLogoutSec);
  const clampedLogoutSec = Number.isFinite(sec)
    ? Math.max(30, Math.min(600, Math.round(sec)))
    : DEFAULT_PLATFORM_CONFIG.offlineAutoLogoutSec;

  return {
    appName:
      typeof src.appName === 'string' && src.appName.trim().length > 0
        ? src.appName.trim().slice(0, 80)
        : DEFAULT_PLATFORM_CONFIG.appName,
    cohortName:
      typeof src.cohortName === 'string' && src.cohortName.trim().length > 0
        ? src.cohortName.trim().slice(0, 80)
        : DEFAULT_PLATFORM_CONFIG.cohortName,
    defaultLanguage: src.defaultLanguage === 'hi' ? 'hi' : 'en',
    strictCameraDefault: Boolean(src.strictCameraDefault),
    offlineAutoLogoutSec: clampedLogoutSec,
    dailyAutoMockEnabled:
      typeof src.dailyAutoMockEnabled === 'boolean'
        ? src.dailyAutoMockEnabled
        : DEFAULT_PLATFORM_CONFIG.dailyAutoMockEnabled,
    githubReportsEnabled:
      typeof src.githubReportsEnabled === 'boolean'
        ? src.githubReportsEnabled
        : DEFAULT_PLATFORM_CONFIG.githubReportsEnabled,
    aiTutorEnabled:
      typeof src.aiTutorEnabled === 'boolean'
        ? src.aiTutorEnabled
        : DEFAULT_PLATFORM_CONFIG.aiTutorEnabled,
    maintenanceBanner:
      typeof src.maintenanceBanner === 'string'
        ? src.maintenanceBanner.trim().slice(0, 240)
        : '',
    updatedAtMs:
      typeof src.updatedAtMs === 'number' && Number.isFinite(src.updatedAtMs)
        ? src.updatedAtMs
        : 0,
  };
}
