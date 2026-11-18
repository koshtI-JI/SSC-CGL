import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Languages,
  RotateCcw,
  Save,
  Shield,
  Sliders,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { useConfig } from '../context/ConfigContext';
import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from '../types/exam';
import {
  DEFAULT_PLATFORM_CONFIG,
  normalizePlatformConfig,
  type PlatformConfig,
} from '../utils/platformConfig';

interface DynamicSettingsManagerPanelProps {
  onNotify?: (type: 'ok' | 'err', text: string) => void;
}

export const DynamicSettingsManagerPanel: React.FC<DynamicSettingsManagerPanelProps> = ({
  onNotify,
}) => {
  const {
    scoringConfig,
    platformConfig,
    updateScoringConfig,
    updatePlatformConfig,
  } = useConfig();

  const [savingConfig, setSavingConfig] = useState(false);
  const [draftPlatform, setDraftPlatform] = useState<PlatformConfig>(platformConfig);
  const [draftScoring, setDraftScoring] = useState<ScoringConfig>(scoringConfig);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setDraftPlatform(platformConfig);
  }, [platformConfig]);

  useEffect(() => {
    setDraftScoring(scoringConfig);
  }, [scoringConfig]);

  const report = (type: 'ok' | 'err', text: string) => {
    setStatusMsg({ type, text });
    onNotify?.(type, text);
  };

  const handleSavePlatform = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const normalized = normalizePlatformConfig(draftPlatform);
      const res = await updatePlatformConfig(normalized);
      report(
        'ok',
        res.remoteSynced
          ? 'Platform feature flags & runtime settings saved and synced to Firestore.'
          : 'Platform settings saved locally (remote Firestore settings/platform rule requires DRAFT_firestore.rules deployment).'
      );
    } catch (err) {
      report('err', err instanceof Error ? err.message : 'Failed to save platform settings.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleResetPlatformDefaults = async () => {
    setSavingConfig(true);
    try {
      setDraftPlatform(DEFAULT_PLATFORM_CONFIG);
      await updatePlatformConfig(DEFAULT_PLATFORM_CONFIG);
      report('ok', 'Restored platform feature flags & timers to official Path to CGL defaults.');
    } catch (err) {
      report('err', err instanceof Error ? err.message : 'Failed to reset platform defaults.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveScoring = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      await updateScoringConfig({
        pointsPerCorrect: Math.max(0, Math.min(20, Number(draftScoring.pointsPerCorrect) || 0)),
        negativeMarks: Math.max(0, Math.min(10, Number(draftScoring.negativeMarks) || 0)),
        xpAttemptBase: Math.max(0, Math.min(500, Math.round(Number(draftScoring.xpAttemptBase) || 0))),
        xpPerCorrect: Math.max(0, Math.min(100, Math.round(Number(draftScoring.xpPerCorrect) || 0))),
        xpAccuracyThreshold: Math.max(
          0,
          Math.min(100, Math.round(Number(draftScoring.xpAccuracyThreshold) || 0))
        ),
        xpAccuracyBonus: Math.max(
          0,
          Math.min(1000, Math.round(Number(draftScoring.xpAccuracyBonus) || 0))
        ),
      });
      report('ok', 'Live SSC scoring & XP defaults updated.');
    } catch (err) {
      report('err', err instanceof Error ? err.message : 'Failed to save scoring defaults.');
    } finally {
      setSavingConfig(false);
    }
  };

  const toggleFlag = (
    key: 'strictCameraDefault' | 'dailyAutoMockEnabled' | 'githubReportsEnabled' | 'aiTutorEnabled'
  ) => {
    setDraftPlatform((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="space-y-6">
      {statusMsg && (
        <div
          role="status"
          className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-xs font-medium ${
            statusMsg.type === 'ok'
              ? 'border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/35 text-emerald-900 dark:text-emerald-200'
              : 'border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/35 text-red-900 dark:text-red-200'
          }`}
        >
          {statusMsg.type === 'ok' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Platform Feature Flags & Runtime Policy */}
        <form
          onSubmit={handleSavePlatform}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-5 lg:col-span-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <Sliders className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Dynamic Platform Settings &amp; Feature Flags
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Control default exam language, daily auto-mock scheduling, proctoring defaults, and auto-logout guard.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={savingConfig}
              onClick={() => void handleResetPlatformDefaults()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#131720] px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset Defaults</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="plat-default-lang"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                <Languages className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <span>Default Exam Language</span>
              </label>
              <select
                id="plat-default-lang"
                value={draftPlatform.defaultLanguage}
                onChange={(e) =>
                  setDraftPlatform((prev) => ({
                    ...prev,
                    defaultLanguage: e.target.value === 'hi' ? 'hi' : 'en',
                  }))
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
              >
                <option value="en">English Primary (Bilingual Hindi Toggle)</option>
                <option value="hi">Hindi Primary · हिन्दी (Bilingual English Toggle)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="plat-offline-logout"
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                <Shield className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <span>Offline Auto-Logout Guard (sec)</span>
              </label>
              <input
                id="plat-offline-logout"
                type="number"
                min={30}
                max={600}
                step={10}
                value={draftPlatform.offlineAutoLogoutSec}
                onChange={(e) =>
                  setDraftPlatform((prev) => ({
                    ...prev,
                    offlineAutoLogoutSec: Number(e.target.value),
                  }))
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
              />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Clamped 30s–600s. Ignored while an exam is active so tests never abort mid-paper.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                {
                  key: 'dailyAutoMockEnabled',
                  label: 'Daily Auto Mock Engine',
                  desc: 'Automatically assemble today’s Live Daily Mock & 4 Sectional Sprints.',
                },
                {
                  key: 'strictCameraDefault',
                  label: 'Strict Camera Proctoring Default',
                  desc: 'Prompt webcam & fullscreen readiness before full mocks.',
                },
                {
                  key: 'aiTutorEnabled',
                  label: 'AI Study Coach & Translator',
                  desc: 'Enable optional BYOK AI Tutor & Hindi question translator.',
                },
                {
                  key: 'githubReportsEnabled',
                  label: 'Cohort Report Exports',
                  desc: 'Enable per-student JSON, Markdown & PDF cohort exports.',
                },
              ] as const
            ).map((item) => {
              const enabled = draftPlatform[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => toggleFlag(item.key)}
                  className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer ${
                    enabled
                      ? 'border-blue-300 dark:border-blue-800/70 bg-blue-50/60 dark:bg-blue-950/25'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131720]'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {item.label}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                      {item.desc}
                    </p>
                  </div>
                  {enabled ? (
                    <ToggleRight className="h-5 w-5 shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                  ) : (
                    <ToggleLeft className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>

          <div>
            <label
              htmlFor="plat-banner"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              Cohort Announcement / Maintenance Banner (optional, max 240 chars)
            </label>
            <input
              id="plat-banner"
              type="text"
              maxLength={240}
              value={draftPlatform.maintenanceBanner}
              onChange={(e) =>
                setDraftPlatform((prev) => ({
                  ...prev,
                  maintenanceBanner: e.target.value,
                }))
              }
              placeholder="e.g., Sunday 8 PM Tier-I All-India Rank Sprint live in Mocks tab"
              className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <button
            type="submit"
            disabled={savingConfig}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{savingConfig ? 'Saving Settings...' : 'Save Platform Settings'}</span>
          </button>
        </form>

        {/* Official Scoring Defaults Quick Card */}
        <form
          onSubmit={handleSaveScoring}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4 lg:col-span-5"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Scoring &amp; XP Policy
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Synced directly with live Firestore <code className="font-mono">settings/scoring</code>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraftScoring(DEFAULT_SCORING_CONFIG)}
              className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Load +2 / -0.5 Defaults
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dyn-pos" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                +Marks / Correct
              </label>
              <input
                id="dyn-pos"
                type="number"
                step="0.5"
                value={draftScoring.pointsPerCorrect}
                onChange={(e) =>
                  setDraftScoring((p) => ({ ...p, pointsPerCorrect: Number(e.target.value) }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="dyn-neg" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                -Negative / Wrong
              </label>
              <input
                id="dyn-neg"
                type="number"
                step="0.25"
                value={draftScoring.negativeMarks}
                onChange={(e) =>
                  setDraftScoring((p) => ({ ...p, negativeMarks: Number(e.target.value) }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="dyn-xp-base" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Attempt Base XP
              </label>
              <input
                id="dyn-xp-base"
                type="number"
                value={draftScoring.xpAttemptBase}
                onChange={(e) =>
                  setDraftScoring((p) => ({ ...p, xpAttemptBase: Number(e.target.value) }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="dyn-xp-corr" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                XP / Correct
              </label>
              <input
                id="dyn-xp-corr"
                type="number"
                value={draftScoring.xpPerCorrect}
                onChange={(e) =>
                  setDraftScoring((p) => ({ ...p, xpPerCorrect: Number(e.target.value) }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="dyn-xp-thr" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Accuracy Bonus %
              </label>
              <input
                id="dyn-xp-thr"
                type="number"
                value={draftScoring.xpAccuracyThreshold}
                onChange={(e) =>
                  setDraftScoring((p) => ({ ...p, xpAccuracyThreshold: Number(e.target.value) }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="dyn-xp-bon" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Accuracy Bonus XP
              </label>
              <input
                id="dyn-xp-bon"
                type="number"
                value={draftScoring.xpAccuracyBonus}
                onChange={(e) =>
                  setDraftScoring((p) => ({ ...p, xpAccuracyBonus: Number(e.target.value) }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={savingConfig}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 dark:bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-600 disabled:opacity-50 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{savingConfig ? 'Saving Scoring...' : 'Save Live Scoring Policy'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
