import React, { useEffect, useState } from 'react';
import { CheckCircle2, Cpu, Eye, EyeOff, KeyRound, Loader2, ShieldAlert, Trash2, Wifi, X } from 'lucide-react';
import {
  AI_PROVIDER_PRESETS,
  clearRuntimeAiConfig,
  getAiEngineStatus,
  getRuntimeAiConfig,
  maskApiKey,
  resolveEffectiveAiConfig,
  setRuntimeAiConfig,
  subscribeAiEngineStatus,
  testAiConnection,
  type AiEngineStatus,
} from '../lib/aiClient';
import type { AiProviderPreset } from '../types/exam';

interface AiKeySettingsModalProps {
  onClose: () => void;
}

export const AiKeySettingsModal: React.FC<AiKeySettingsModalProps> = ({ onClose }) => {
  const [status, setStatus] = useState<AiEngineStatus>(() => getAiEngineStatus());
  const initialConfig = resolveEffectiveAiConfig();
  const [provider, setProvider] = useState<AiProviderPreset>(() => initialConfig.provider);
  const [baseUrl, setBaseUrl] = useState(() => initialConfig.baseUrl);
  const [model, setModel] = useState(() => initialConfig.model);
  const [keyInput, setKeyInput] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    return subscribeAiEngineStatus(setStatus);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const effective = resolveEffectiveAiConfig();
  const runtimeCfg = getRuntimeAiConfig();
  const hasBrowserOverride = Boolean(runtimeCfg?.apiKey || runtimeCfg?.baseUrl || runtimeCfg?.model || effective.source === 'ui');
  const masked = maskApiKey(effective.key);
  const cooldownSec =
    status.rateLimitedUntilMs && status.rateLimitedUntilMs > Date.now()
      ? Math.ceil((status.rateLimitedUntilMs - Date.now()) / 1000)
      : 0;

  const handleProviderChange = (nextProvider: AiProviderPreset) => {
    setProvider(nextProvider);
    const preset = AI_PROVIDER_PRESETS[nextProvider];
    setBaseUrl(preset.baseUrl);
    setModel(preset.defaultModel);
    setFeedback(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const candidateKey = keyInput.trim() || effective.key || '';
    if (!candidateKey || candidateKey.length < 8) {
      setFeedback({ type: 'err', text: 'Please enter a valid API key (minimum 8 characters).' });
      return;
    }
    try {
      const saved = setRuntimeAiConfig({
        provider,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: candidateKey,
      });
      setKeyInput('');
      setProvider(saved.provider);
      setBaseUrl(saved.baseUrl);
      setModel(saved.model);
      setStatus(getAiEngineStatus());
      setFeedback({
        type: 'ok',
        text: `Saved ${AI_PROVIDER_PRESETS[saved.provider].label} (${saved.model}) in browser storage. All Admin & Student AI tools now route through this endpoint.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save LLM configuration.',
      });
    }
  };

  const handleTest = async () => {
    const candidateKey = keyInput.trim() || effective.key || '';
    if (!candidateKey) {
      setFeedback({
        type: 'err',
        text: 'Enter an API key or configure VITE_GROQ_API_KEY / VITE_AI_API_KEY first to test.',
      });
      return;
    }
    setTesting(true);
    setFeedback(null);
    try {
      const res = await testAiConnection({
        apiKey: candidateKey,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
      });
      if (res.ok) {
        if (keyInput.trim() || baseUrl.trim() !== effective.baseUrl || model.trim() !== effective.model) {
          setRuntimeAiConfig({
            provider,
            baseUrl: baseUrl.trim(),
            model: model.trim(),
            apiKey: candidateKey,
          });
          setKeyInput('');
        }
        setFeedback({ type: 'ok', text: res.message });
      } else {
        setFeedback({ type: 'err', text: res.message || 'Endpoint verification failed.' });
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Endpoint verification failed.',
      });
    } finally {
      setTesting(false);
      setStatus(getAiEngineStatus());
    }
  };

  const handleClear = () => {
    clearRuntimeAiConfig();
    setKeyInput('');
    const fallbackCfg = resolveEffectiveAiConfig();
    setProvider(fallbackCfg.provider);
    setBaseUrl(fallbackCfg.baseUrl);
    setModel(fallbackCfg.model);
    setStatus(getAiEngineStatus());
    setFeedback({
      type: 'ok',
      text: 'Cleared browser LLM override. Using .env defaults if configured, otherwise Offline Deterministic Fallback.',
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-key-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs overflow-y-auto"
    >
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#131924] p-6 shadow-2xl space-y-5 my-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400">
              <Cpu className="h-4.5 w-4.5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="ai-key-settings-title"
                className="font-display text-base font-bold text-slate-900 dark:text-white"
              >
                Multi-Provider LLM Engine Config (Admin Only)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Scalable OpenAI-compatible client setup (Groq, OpenAI, OpenRouter, Together, Custom)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI Key Settings"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Status Card */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-[#0f141d] p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-600 dark:text-slate-400">Active Key Source</span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${
                effective.source === 'none'
                  ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-900 dark:text-amber-300'
                  : 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-300'
              }`}
            >
              {effective.source === 'ui'
                ? 'Browser Admin Override'
                : effective.source === 'env'
                  ? 'Vite .env Config'
                  : 'Offline Deterministic Mode'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">Active Model &amp; Provider</span>
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[65%]">
              {effective.provider.toUpperCase()} · {effective.model}
            </span>
          </div>
          {masked && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400">Configured Key</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{masked}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">Cached AI Responses</span>
            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
              {status.cacheEntries} cached locally
            </span>
          </div>
          {cooldownSec > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5 text-amber-900 dark:text-amber-200">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Rate-limit cooldown active ({cooldownSec}s left). Serving smart local fallbacks seamlessly.</span>
            </div>
          )}
        </div>

        {feedback && (
          <div
            role="status"
            className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
              feedback.type === 'ok'
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200'
            }`}
          >
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-3.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="ai-provider-select"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                LLM Provider Preset
              </label>
              <select
                id="ai-provider-select"
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as AiProviderPreset)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f141d] px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
              >
                {(Object.keys(AI_PROVIDER_PRESETS) as AiProviderPreset[]).map((key) => (
                  <option key={key} value={key}>
                    {AI_PROVIDER_PRESETS[key].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="ai-model-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Model ID
              </label>
              <input
                id="ai-model-input"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={AI_PROVIDER_PRESETS[provider].defaultModel}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f141d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="ai-baseurl-input"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              Chat Completions Endpoint URL
            </label>
            <input
              id="ai-baseurl-input"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={AI_PROVIDER_PRESETS[provider].baseUrl}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f141d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label
              htmlFor="groq-runtime-key-input"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              API Key {effective.key ? '(Leave blank to keep existing key while updating provider/model)' : ''}
            </label>
            <div className="relative mt-1">
              <input
                id="groq-runtime-key-input"
                type={showRaw ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={AI_PROVIDER_PRESETS[provider].placeholderKey}
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f141d] py-2 pl-3 pr-10 font-mono text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                aria-label={showRaw ? 'Hide API key' : 'Show API key'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                {showRaw ? (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              Stored strictly in Admin&apos;s browser <code className="font-mono">localStorage</code>. Students never see API key settings.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Save Config</span>
              </button>
              <button
                type="button"
                disabled={testing}
                onClick={() => void handleTest()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#18202c] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Wifi className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                )}
                <span>{testing ? 'Testing...' : 'Test Connection'}</span>
              </button>
            </div>

            {hasBrowserOverride && (
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Clear Override</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
