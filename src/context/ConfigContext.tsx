import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  savePlatformConfig,
  saveScoringConfig,
  subscribePlatformConfig,
  subscribeScoringConfig,
} from '../lib/firestoreService';
import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from '../types/exam';
import {
  DEFAULT_PLATFORM_CONFIG,
  normalizePlatformConfig,
  type PlatformConfig,
} from '../utils/platformConfig';

interface ConfigContextValue {
  scoringConfig: ScoringConfig;
  platformConfig: PlatformConfig;
  configLoaded: boolean;
  updateScoringConfig: (next: ScoringConfig) => Promise<void>;
  updatePlatformConfig: (
    patch: Partial<PlatformConfig>
  ) => Promise<{ savedLocally: boolean; remoteSynced: boolean }>;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [scoringConfig, setScoringConfig] = useState<ScoringConfig>(DEFAULT_SCORING_CONFIG);
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig>(DEFAULT_PLATFORM_CONFIG);
  const [scoringReady, setScoringReady] = useState(false);
  const [platformReady, setPlatformReady] = useState(false);

  useEffect(() => {
    const unsubScoring = subscribeScoringConfig((cfg) => {
      setScoringConfig(cfg);
      setScoringReady(true);
    });
    const unsubPlatform = subscribePlatformConfig((cfg) => {
      setPlatformConfig(normalizePlatformConfig(cfg));
      setPlatformReady(true);
    });
    return () => {
      unsubScoring();
      unsubPlatform();
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const appTitle = platformConfig.appName.trim() || DEFAULT_PLATFORM_CONFIG.appName;
    const cohortLabel = platformConfig.cohortName.trim() || DEFAULT_PLATFORM_CONFIG.cohortName;
    document.title = `${appTitle} — ${cohortLabel}`;
  }, [platformConfig.appName, platformConfig.cohortName]);

  const updateScoringConfig = useCallback(async (next: ScoringConfig) => {
    await saveScoringConfig(next);
  }, []);

  const updatePlatformConfig = useCallback(async (patch: Partial<PlatformConfig>) => {
    return savePlatformConfig(patch);
  }, []);

  return (
    <ConfigContext.Provider
      value={{
        scoringConfig,
        platformConfig,
        configLoaded: scoringReady && platformReady,
        updateScoringConfig,
        updatePlatformConfig,
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
};

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error('useConfig must be used inside ConfigProvider');
  }
  return ctx;
}
