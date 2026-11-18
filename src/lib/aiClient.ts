import type { AiProviderConfig, AiProviderPreset, QuestionInput, SubjectKey } from '../types/exam';
import {
  buildPdfExtractionPrompt,
  parseAiPdfQuestionsJson,
  type IngestedQuestionDraft,
  type PdfPageChunk,
  type StrictIngestSubjectName,
} from '../utils/pdfIngestor';
import {
  buildRawTextMcqExtractionPrompt,
  parseExtractedMcqJson,
  type ExtractedPdfQuestionRow,
} from '../utils/pdfQuestionExtractor';
import {
  fetchStaticGKQuestions,
  isGeneralAwarenessSubjectOrTopic,
} from '../utils/staticGkBank';

export interface AiClientEnvLike {
  VITE_GROQ_API_KEY?: unknown;
  VITE_AI_API_KEY?: unknown;
  VITE_AI_API_URL?: unknown;
  VITE_AI_MODEL?: unknown;
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const AI_PROVIDER_PRESETS: Record<
  AiProviderPreset,
  { label: string; baseUrl: string; defaultModel: string; placeholderKey: string }
> = {
  groq: {
    label: 'Groq Cloud (Fast Inference)',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'openai/gpt-oss-120b',
    placeholderKey: 'gsk_xxxxxxxxxxxxxxxxxxxx',
  },
  openai: {
    label: 'OpenAI (GPT-4o / o-series)',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    placeholderKey: 'sk-xxxxxxxxxxxxxxxxxxxx',
  },
  openrouter: {
    label: 'OpenRouter (Multi-Model Gateway)',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-4o-mini',
    placeholderKey: 'sk-or-v1-xxxxxxxxxxxxxxxxxxxx',
  },
  together: {
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1/chat/completions',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    placeholderKey: 'xxxxxxxxxxxxxxxxxxxx',
  },
  custom: {
    label: 'Custom OpenAI-Compatible Endpoint',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'openai/gpt-oss-120b',
    placeholderKey: 'Bearer token / API key',
  },
};

/**
 * Ordered fallback list of Groq models. The first model is tried first; if the
 * request fails (e.g. HTTP 404/400 because a model was decommissioned), the next
 * model is attempted automatically until one succeeds.
 */
export const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.1-8b-instant',
];

const AI_CACHE_STORAGE_KEY = 'getcgl_ai_cache_v1';
export const RUNTIME_GROQ_KEY_STORAGE_KEY = 'getcgl_runtime_groq_key_v1';
export const RUNTIME_AI_CONFIG_STORAGE_KEY = 'getcgl_runtime_ai_config_v1';
const MAX_AI_CACHE_ENTRIES = 100;
const AI_EXPLAIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AI_FORMULA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AI_TRANSLATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const AI_POSTMORTEM_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 45 * 1000;

export interface AiEngineStatus {
  hasKey: boolean;
  keySource: 'ui' | 'env' | 'none';
  maskedKey: string | null;
  provider: AiProviderPreset;
  baseUrl: string;
  configuredModel: string;
  rateLimitedUntilMs: number | null;
  rateLimitRemainingSec: number;
  lastError: string | null;
  lastUsedModel: string | null;
  cacheEntries: number;
}

type AiStatusListener = (status: AiEngineStatus) => void;
const aiStatusListeners = new Set<AiStatusListener>();
const modelCooldownUntilMs = new Map<string, number>();
let globalRateLimitedUntilMs: number | null = null;
let lastAiErrorMessage: string | null = null;
let lastUsedAiModel: string | null = null;
let memoryRuntimeGroqKey: string | null = null;
let memoryRuntimeAiConfig: Partial<AiProviderConfig> | null = null;

interface CachedAiEntry {
  value: unknown;
  savedAtMs: number;
  ttlMs: number;
}

const memoryAiCache = new Map<string, CachedAiEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();

function hashCacheKey(raw: string): string {
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `k_${h.toString(36)}_${raw.length}`;
}

function readAiCacheMap(): Record<string, CachedAiEntry> {
  const result: Record<string, CachedAiEntry> = {};
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(AI_CACHE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, CachedAiEntry>;
        if (parsed && typeof parsed === 'object') {
          Object.assign(result, parsed);
        }
      }
    } catch {
      // Ignore malformed cache
    }
  }
  for (const [k, v] of memoryAiCache.entries()) {
    result[k] = v;
  }
  return result;
}

function getCachedAiValue<T>(key: string): T | null {
  const now = Date.now();
  const mem = memoryAiCache.get(key);
  if (mem && now - mem.savedAtMs <= mem.ttlMs) {
    return mem.value as T;
  }
  if (typeof localStorage !== 'undefined') {
    const map = readAiCacheMap();
    const hit = map[key];
    if (hit && typeof hit.savedAtMs === 'number' && typeof hit.ttlMs === 'number' && now - hit.savedAtMs <= hit.ttlMs) {
      memoryAiCache.set(key, hit);
      return hit.value as T;
    }
  }
  return null;
}

function setCachedAiValue(key: string, value: unknown, ttlMs: number): void {
  const entry: CachedAiEntry = { value, savedAtMs: Date.now(), ttlMs };
  memoryAiCache.set(key, entry);
  if (memoryAiCache.size > MAX_AI_CACHE_ENTRIES) {
    const oldest = Array.from(memoryAiCache.entries()).sort((a, b) => a[1].savedAtMs - b[1].savedAtMs);
    for (const [oldKey] of oldest.slice(0, memoryAiCache.size - MAX_AI_CACHE_ENTRIES)) {
      memoryAiCache.delete(oldKey);
    }
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const map = readAiCacheMap();
      map[key] = entry;
      const entries = Object.entries(map)
        .filter(([, v]) => v && typeof v.savedAtMs === 'number')
        .sort((a, b) => b[1].savedAtMs - a[1].savedAtMs)
        .slice(0, MAX_AI_CACHE_ENTRIES);
      localStorage.setItem(AI_CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // Ignore storage quota issues
    }
  }
  notifyAiStatusListeners();
}

export function clearAiCacheForTests(): void {
  memoryAiCache.clear();
  inFlightRequests.clear();
  modelCooldownUntilMs.clear();
  globalRateLimitedUntilMs = null;
  lastAiErrorMessage = null;
  lastUsedAiModel = null;
  memoryRuntimeGroqKey = null;
  memoryRuntimeAiConfig = null;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(AI_CACHE_STORAGE_KEY);
      localStorage.removeItem(RUNTIME_GROQ_KEY_STORAGE_KEY);
      localStorage.removeItem(RUNTIME_AI_CONFIG_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  notifyAiStatusListeners();
}

async function runDeduplicated<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = task().finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, p);
  return p;
}

function sanitizeKeyString(raw: unknown): string | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed || trimmed === 'MY_GROQ_API_KEY') return null;
  return trimmed;
}

function sanitizeBaseUrl(raw: unknown): string | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return null;
  if (/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(trimmed)) return trimmed;
  return null;
}

function inferProviderPreset(baseUrl: string): AiProviderPreset {
  const low = baseUrl.toLowerCase();
  if (low.includes('api.groq.com')) return 'groq';
  if (low.includes('api.openai.com')) return 'openai';
  if (low.includes('openrouter.ai')) return 'openrouter';
  if (low.includes('api.together.xyz')) return 'together';
  return 'custom';
}

export function getRuntimeAiConfig(): Partial<AiProviderConfig> | null {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(RUNTIME_AI_CONFIG_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AiProviderConfig>;
        if (parsed && typeof parsed === 'object') {
          memoryRuntimeAiConfig = parsed;
          return parsed;
        }
      }
    } catch {
      // Ignore malformed config
    }
  }
  return memoryRuntimeAiConfig;
}

export function setRuntimeAiConfig(config: {
  provider?: AiProviderPreset;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}): AiProviderConfig {
  const existing = getRuntimeAiConfig();
  const preset: AiProviderPreset =
    config.provider && config.provider in AI_PROVIDER_PRESETS
      ? config.provider
      : existing?.provider && existing.provider in AI_PROVIDER_PRESETS
        ? existing.provider
        : 'groq';
  const baseUrl =
    sanitizeBaseUrl(config.baseUrl) ??
    sanitizeBaseUrl(existing?.baseUrl) ??
    AI_PROVIDER_PRESETS[preset].baseUrl;
  const model =
    (typeof config.model === 'string' && config.model.trim()) ||
    (typeof existing?.model === 'string' && existing.model.trim()) ||
    AI_PROVIDER_PRESETS[preset].defaultModel;
  const cleanKey = sanitizeKeyString(config.apiKey) ?? getRuntimeGroqApiKey();
  if (!cleanKey || cleanKey.length < 8) {
    throw new Error('Please enter a valid API key (minimum 8 characters).');
  }

  const next: AiProviderConfig = {
    provider: preset,
    baseUrl,
    model,
    apiKey: cleanKey,
  };
  memoryRuntimeAiConfig = next;
  memoryRuntimeGroqKey = cleanKey;
  modelCooldownUntilMs.clear();
  globalRateLimitedUntilMs = null;
  lastAiErrorMessage = null;

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(RUNTIME_AI_CONFIG_STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(RUNTIME_GROQ_KEY_STORAGE_KEY, cleanKey);
    } catch {
      // Ignore storage quota issues
    }
  }
  notifyAiStatusListeners();
  return next;
}

export function clearRuntimeAiConfig(): void {
  memoryRuntimeAiConfig = null;
  clearRuntimeGroqApiKey();
}

export function getRuntimeGroqApiKey(): string | null {
  if (typeof localStorage !== 'undefined') {
    try {
      const storedCfg = localStorage.getItem(RUNTIME_AI_CONFIG_STORAGE_KEY);
      if (storedCfg) {
        const parsed = JSON.parse(storedCfg) as Partial<AiProviderConfig>;
        const cfgKey = sanitizeKeyString(parsed?.apiKey);
        if (cfgKey) {
          memoryRuntimeGroqKey = cfgKey;
          return cfgKey;
        }
      }
      const stored = sanitizeKeyString(localStorage.getItem(RUNTIME_GROQ_KEY_STORAGE_KEY));
      if (stored) {
        memoryRuntimeGroqKey = stored;
        return stored;
      }
    } catch {
      // Ignore storage access errors
    }
  }
  return memoryRuntimeGroqKey ?? sanitizeKeyString(memoryRuntimeAiConfig?.apiKey);
}

export function setRuntimeGroqApiKey(rawKey: string): string {
  const clean = sanitizeKeyString(rawKey);
  if (!clean || clean.length < 8) {
    throw new Error('Please enter a valid Groq / OpenAI-compatible API key (min 8 characters).');
  }
  memoryRuntimeGroqKey = clean;
  if (memoryRuntimeAiConfig) {
    memoryRuntimeAiConfig = { ...memoryRuntimeAiConfig, apiKey: clean };
  }
  modelCooldownUntilMs.clear();
  globalRateLimitedUntilMs = null;
  lastAiErrorMessage = null;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(RUNTIME_GROQ_KEY_STORAGE_KEY, clean);
      if (memoryRuntimeAiConfig) {
        localStorage.setItem(RUNTIME_AI_CONFIG_STORAGE_KEY, JSON.stringify(memoryRuntimeAiConfig));
      }
    } catch {
      // Ignore quota issues
    }
  }
  notifyAiStatusListeners();
  return clean;
}

export function clearRuntimeGroqApiKey(): void {
  memoryRuntimeGroqKey = null;
  if (memoryRuntimeAiConfig) {
    memoryRuntimeAiConfig = { ...memoryRuntimeAiConfig, apiKey: '' };
  }
  lastAiErrorMessage = null;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(RUNTIME_GROQ_KEY_STORAGE_KEY);
      localStorage.removeItem(RUNTIME_AI_CONFIG_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  notifyAiStatusListeners();
}

export function maskApiKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 10) return `${key.slice(0, 3)}••••`;
  return `${key.slice(0, 6)}••••••${key.slice(-4)}`;
}

/**
 * Strictly reads `import.meta.env.VITE_GROQ_API_KEY` or `VITE_AI_API_KEY` (or injected env) for deterministic tests.
 */
export function resolveViteGroqApiKey(env?: AiClientEnvLike): string | null {
  const source =
    env ??
    (typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env as AiClientEnvLike)
      : undefined);
  return sanitizeKeyString(source?.VITE_AI_API_KEY) ?? sanitizeKeyString(source?.VITE_GROQ_API_KEY);
}

/**
 * Resolves the active API key with full dynamic fallback:
 * 1) Explicit env override (unit tests),
 * 2) Admin/browser-supplied runtime UI key (`localStorage`),
 * 3) Build-time `.env` (`VITE_AI_API_KEY` / `VITE_GROQ_API_KEY`).
 */
export function resolveEffectiveGroqApiKey(env?: AiClientEnvLike): {
  key: string | null;
  source: 'ui' | 'env' | 'none';
} {
  if (env) {
    const k = resolveViteGroqApiKey(env);
    if (k) return { key: k, source: 'env' };
  }
  const uiKey = getRuntimeGroqApiKey();
  if (uiKey) return { key: uiKey, source: 'ui' };
  const envKey = resolveViteGroqApiKey();
  if (envKey) return { key: envKey, source: 'env' };
  return { key: null, source: 'none' };
}

export function resolveEffectiveAiConfig(env?: AiClientEnvLike): {
  provider: AiProviderPreset;
  baseUrl: string;
  model: string;
  key: string | null;
  source: 'ui' | 'env' | 'none';
} {
  const keyInfo = resolveEffectiveGroqApiKey(env);
  const envSource =
    env ??
    (typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env as AiClientEnvLike)
      : undefined);
  const runtimeCfg = env ? null : getRuntimeAiConfig();
  const envUrl = sanitizeBaseUrl(envSource?.VITE_AI_API_URL);
  const uiUrl = sanitizeBaseUrl(runtimeCfg?.baseUrl);
  const baseUrl = uiUrl ?? envUrl ?? GROQ_API_URL;
  const provider: AiProviderPreset =
    runtimeCfg?.provider && runtimeCfg.provider in AI_PROVIDER_PRESETS
      ? runtimeCfg.provider
      : inferProviderPreset(baseUrl);
  const uiModel = typeof runtimeCfg?.model === 'string' && runtimeCfg.model.trim() ? runtimeCfg.model.trim() : null;
  const envModel = typeof envSource?.VITE_AI_MODEL === 'string' && envSource.VITE_AI_MODEL.trim() ? envSource.VITE_AI_MODEL.trim() : null;
  const model = uiModel ?? envModel ?? AI_PROVIDER_PRESETS[provider].defaultModel ?? GROQ_MODELS[0];

  return {
    provider,
    baseUrl,
    model,
    key: keyInfo.key,
    source: keyInfo.source,
  };
}

export function getAiEngineStatus(env?: AiClientEnvLike): AiEngineStatus {
  const resolved = resolveEffectiveAiConfig(env);
  const now = Date.now();
  const rateLimitedUntilMs =
    globalRateLimitedUntilMs && globalRateLimitedUntilMs > now ? globalRateLimitedUntilMs : null;
  const cacheMap = readAiCacheMap();
  return {
    hasKey: Boolean(resolved.key),
    keySource: resolved.source,
    maskedKey: maskApiKey(resolved.key),
    provider: resolved.provider,
    baseUrl: resolved.baseUrl,
    configuredModel: resolved.model,
    rateLimitedUntilMs,
    rateLimitRemainingSec: rateLimitedUntilMs ? Math.max(1, Math.ceil((rateLimitedUntilMs - now) / 1000)) : 0,
    lastError: lastAiErrorMessage,
    lastUsedModel: lastUsedAiModel,
    cacheEntries: Object.keys(cacheMap).length,
  };
}

function notifyAiStatusListeners(): void {
  const snap = getAiEngineStatus();
  for (const listener of aiStatusListeners) {
    try {
      listener(snap);
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function subscribeAiEngineStatus(listener: AiStatusListener): () => void {
  aiStatusListeners.add(listener);
  listener(getAiEngineStatus());
  return () => {
    aiStatusListeners.delete(listener);
  };
}

export function getMissingGroqKeyMessage(): string {
  return 'AI service is running in Offline Diagnostic mode because VITE_GROQ_API_KEY is not configured in .env or AI Key Settings.';
}

interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function parseRetryAfterMs(res: Response): number {
  const header = res.headers.get('retry-after');
  if (!header) return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  const sec = Number(header);
  if (Number.isFinite(sec) && sec > 0) {
    return Math.min(180_000, Math.max(5_000, Math.round(sec * 1000)));
  }
  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

/**
 * Shared OpenAI-compatible chat completion call supporting Groq, OpenAI, OpenRouter,
 * Together AI, or any custom OpenAI-compatible endpoint. Returns trimmed assistant
 * content and honors per-model 429 cooldowns.
 */
async function callGroqChat(params: {
  messages: GroqChatMessage[];
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  env?: AiClientEnvLike;
  overrideApiKey?: string;
  overrideBaseUrl?: string;
  overrideModel?: string;
}): Promise<string> {
  const effectiveCfg = resolveEffectiveAiConfig(params.env);
  const apiKey = sanitizeKeyString(params.overrideApiKey) ?? effectiveCfg.key;
  if (!apiKey) {
    throw new Error(getMissingGroqKeyMessage());
  }

  const endpointUrl = sanitizeBaseUrl(params.overrideBaseUrl) ?? effectiveCfg.baseUrl ?? GROQ_API_URL;
  const isDefaultGroqEndpoint = endpointUrl.toLowerCase().includes('api.groq.com');
  const preferredModel = (params.overrideModel && params.overrideModel.trim()) || effectiveCfg.model;

  const modelCandidates = isDefaultGroqEndpoint
    ? Array.from(new Set([preferredModel, ...GROQ_MODELS]))
    : [preferredModel];

  const hasExplicitOverride = Boolean(params.overrideApiKey || params.overrideBaseUrl || params.overrideModel);
  const now = Date.now();
  if (globalRateLimitedUntilMs && globalRateLimitedUntilMs > now && !hasExplicitOverride) {
    const waitSec = Math.ceil((globalRateLimitedUntilMs - now) / 1000);
    throw new Error(`AI rate limit active — cooling down for ${waitSec}s (offline fallback active).`);
  }

  const failures: string[] = [];
  let rateLimitHits = 0;

  for (const model of modelCandidates) {
    const cooldownKey = `${endpointUrl}::${model}`;
    const cooldownUntil = modelCooldownUntilMs.get(cooldownKey) ?? 0;
    if (cooldownUntil > Date.now() && !hasExplicitOverride) {
      failures.push(`${model}: cooling down (429)`);
      continue;
    }

    const body: Record<string, unknown> = {
      model,
      messages: params.messages,
      temperature: params.temperature ?? 0.5,
      max_tokens: params.maxTokens ?? 4096,
    };
    if (params.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    let res: Response;
    try {
      res = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      failures.push(`${model}: ${err instanceof Error ? err.message : 'network error'}`);
      continue;
    }

    if (!res.ok) {
      let detail = '';
      try {
        const errPayload = (await res.json()) as { error?: { message?: string } };
        if (errPayload?.error?.message) detail = `: ${errPayload.error.message}`;
      } catch {
        // Ignore non-JSON error bodies
      }
      if (res.status === 429) {
        rateLimitHits += 1;
        const retryMs = parseRetryAfterMs(res);
        modelCooldownUntilMs.set(cooldownKey, Date.now() + retryMs);
      }
      if (res.status === 401 || res.status === 403) {
        const authErr = `Invalid or unauthorized AI API key (HTTP ${res.status}${detail}).`;
        lastAiErrorMessage = authErr;
        notifyAiStatusListeners();
        throw new Error(authErr);
      }
      failures.push(`${model}: HTTP ${res.status}${detail}`);
      continue;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content;
    const trimmed = typeof content === 'string' ? content.trim() : '';
    if (!trimmed) {
      failures.push(`${model}: empty completion content`);
      continue;
    }
    lastUsedAiModel = model;
    lastAiErrorMessage = null;
    globalRateLimitedUntilMs = null;
    notifyAiStatusListeners();
    return trimmed;
  }

  if (rateLimitHits > 0) {
    globalRateLimitedUntilMs = Date.now() + 30_000;
  }
  const msg = `AI API request failed for configured model(s) (${modelCandidates.join(', ')}). ${failures.join(' | ')}`;
  lastAiErrorMessage = msg;
  notifyAiStatusListeners();
  throw new Error(msg);
}

export async function testAiConnection(candidate?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): Promise<{
  ok: boolean;
  model?: string;
  message: string;
}> {
  const effective = resolveEffectiveAiConfig();
  const keyToTest = sanitizeKeyString(candidate?.apiKey) ?? effective.key;
  if (!keyToTest) {
    return {
      ok: false,
      message: 'No API key provided. Enter an API key or configure VITE_GROQ_API_KEY / VITE_AI_API_KEY.',
    };
  }
  const baseUrl = sanitizeBaseUrl(candidate?.baseUrl) ?? effective.baseUrl;
  const model = (candidate?.model && candidate.model.trim()) || effective.model;
  try {
    await callGroqChat({
      messages: [{ role: 'user', content: 'Reply with single word: OK' }],
      maxTokens: 16,
      temperature: 0,
      overrideApiKey: keyToTest,
      overrideBaseUrl: baseUrl,
      overrideModel: model,
    });
    return {
      ok: true,
      model: lastUsedAiModel ?? model,
      message: `Connected cleanly via ${lastUsedAiModel ?? model}.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Connection verification failed.',
    };
  }
}

export async function testGroqApiKey(candidateKey?: string): Promise<{
  ok: boolean;
  model?: string;
  message: string;
}> {
  return testAiConnection({ apiKey: candidateKey });
}

function stripJsonCodeFences(raw: string): string {
  const text = (raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text;
}

function parseLooseJson(raw: string): unknown {
  const text = stripJsonCodeFences(raw);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/[[{]/);
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Groq JSON mode can only return a JSON object, so array responses are wrapped
 * (e.g. `{"questions": [...]}`). This unwraps the first usable array.
 */
function coerceJsonArray(raw: string, preferredKeys: string[] = []): unknown[] {
  const parsed = parseLooseJson(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const keys = [...preferredKeys, 'items', 'data', 'results', 'questions', 'list'];
    for (const key of keys) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) return val;
    }
  }
  return [];
}

function buildOfflineExplanationFallback(params: {
  questionEn: string;
  optionsEn: string[];
  correctIndex: number;
  selectedIndex: number;
  subject?: string;
  topic?: string;
}): string {
  const letters = ['A', 'B', 'C', 'D'];
  const correctLetter = letters[params.correctIndex] ?? 'A';
  const correctText = params.optionsEn[params.correctIndex] ?? '';
  const pickedValid = params.selectedIndex >= 0 && params.selectedIndex <= 3 && params.selectedIndex !== params.correctIndex;
  const pickedPartEn = pickedValid
    ? `Option ${letters[params.selectedIndex]} (${params.optionsEn[params.selectedIndex]}) is a distractor — verify key values/conditions before marking to avoid negative marking.`
    : 'Review the core rule and time-saving elimination check before attempting under timed pressure.';
  const pickedPartHi = pickedValid
    ? `विकल्प ${letters[params.selectedIndex]} (${params.optionsEn[params.selectedIndex]}) भ्रामक विकल्प है — नेगेटिव मार्किंग से बचने के लिए मुख्य शर्तें दोबारा जाँचें।`
    : 'नेगेटिव मार्किंग से बचने के लिए मुख्य नियम और विकल्प-उन्मूलन (Option Elimination) का अभ्यास करें।';

  return [
    `1. Concept & Exam Shortcut (English · ${params.subject || 'SSC CGL'} — ${params.topic || 'Core'})`,
    `Correct Answer: Option ${correctLetter}) ${correctText}.`,
    pickedPartEn,
    'Revision Tip: Mark this pattern and re-verify using unit/approximation checks in <35 seconds.',
    '',
    '2. अवधारणा और शॉर्टकट (Hindi)',
    `सही उत्तर: विकल्प ${correctLetter}) ${correctText}।`,
    pickedPartHi,
  ].join('\n');
}

export async function aiExplainQuestion(params: {
  questionEn: string;
  optionsEn: string[];
  correctIndex: number;
  selectedIndex: number;
  subject?: string;
  topic?: string;
}): Promise<{ explanation: string }> {
  const cacheKey = hashCacheKey(
    `explain|${params.subject || ''}|${params.topic || ''}|${params.questionEn}|${params.correctIndex}|${params.selectedIndex}`
  );
  const cached = getCachedAiValue<string>(cacheKey);
  if (cached) {
    return { explanation: cached };
  }

  return runDeduplicated(cacheKey, async () => {
    const letters = ['A', 'B', 'C', 'D'];
    const prompt = [
      `You are an elite SSC CGL mentor. Provide a crisp, high-yield bilingual explanation for this ${params.subject || 'SSC CGL'} (${params.topic || 'General'}) question.`,
      `Question: ${params.questionEn}`,
      `Options: ${params.optionsEn.map((o, i) => `${letters[i]}) ${o}`).join(' | ')}`,
      `Correct Option: ${letters[params.correctIndex] ?? 'A'} (${params.optionsEn[params.correctIndex] ?? ''})`,
      params.selectedIndex >= 0 && params.selectedIndex <= 3
        ? `Student Selected: ${letters[params.selectedIndex]} (${params.optionsEn[params.selectedIndex]}) — explain briefly why that trap option is wrong.`
        : 'Student skipped this question.',
      'Format clearly with:',
      '1. Concept & Exam Shortcut (English)',
      '2. अवधारणा और शॉर्टकट (Hindi)',
      'Keep it concise, accurate, and directly useful for SSC CGL revision.',
    ].join('\n');

    try {
      const explanation = await callGroqChat({
        messages: [{ role: 'user', content: prompt }],
      });
      setCachedAiValue(cacheKey, explanation, AI_EXPLAIN_TTL_MS);
      return { explanation };
    } catch {
      const fallback = buildOfflineExplanationFallback(params);
      return { explanation: fallback };
    }
  });
}

export interface FormulaCardOutput {
  subject: SubjectKey;
  topic: string;
  title: string;
  content: string;
  examTip: string;
  example: string;
}

function buildOfflineFormulaFallback(params: {
  query: string;
  subject: string;
  lang: 'en' | 'hi';
}): FormulaCardOutput[] {
  const q = params.query.trim();
  const lower = q.toLowerCase();
  const guessedSubject: SubjectKey =
    params.subject !== 'all'
      ? (params.subject as SubjectKey)
      : /vocab|grammar|tense|idiom|voice|narration|error/.test(lower)
        ? 'english'
        : /syllogism|series|coding|mirror|dice|blood|analogy/.test(lower)
          ? 'reasoning'
          : /article|polity|history|science|vitamin|river|constitution|gk|ga/.test(lower)
            ? 'ga'
            : 'quant';

  if (params.lang === 'hi') {
    return [
      {
        subject: guessedSubject,
        topic: q || 'SSC CGL Quick Sheet',
        title: `${q || 'त्वरित सूत्र'} — मुख्य परीक्षा नियम`,
        content:
          guessedSubject === 'quant'
            ? 'प्रतिशत वृद्धि/कमी: नेट परिवर्तन = a + b + (ab/100)% | लाभ% = (लाभ / क्रय मूल्य) × 100 | समय = दूरी / सापेक्ष चाल'
            : guessedSubject === 'english'
              ? 'Subject-Verb Agreement: Each/Every/Neither + एकवचन क्रिया; No sooner...than; Hardly/Scarcely...when'
              : 'मुख्य तथ्य: मूल अवधारणा, अपवाद और पिछले वर्षों के SSC CGL पैटर्न को पहले दोहराएँ।',
        examTip: 'इकाई अंक (Unit Digit), 100 मानकर हल करने की विधि या विकल्प-उन्मूलन से 20 सेकंड बचाएँ।',
        example: `उदाहरण: यदि किसी मान में +20% और फिर -20% परिवर्तन हो, तो नेट परिवर्तन = 20 - 20 - (400/100) = -4% होगा।`,
      },
    ];
  }

  return [
    {
      subject: guessedSubject,
      topic: q || 'SSC CGL Quick Sheet',
      title: `${q || 'High-Yield Rule'} — Rapid Exam Formula Sheet`,
      content:
        guessedSubject === 'quant'
          ? 'Successive % Change = a + b + (ab/100) | Ratio Link: scale common variable via LCM | Trig Identity: sin²θ + cos²θ = 1, sec²θ − tan²θ = 1'
          : guessedSubject === 'english'
            ? 'Subject-Verb Core: Each/Every/Either/Neither takes Singular Verb; Lest takes Should; Hardly/Scarcely pairs with When.'
            : guessedSubject === 'reasoning'
              ? 'Coding/Series Check: Difference -> Double Difference -> Squares/Cubes (±n) -> Opposite letter sum (27).'
              : 'GS Anchor: Focus on Constitutional Articles (14–32, 352–360), Five-Year Plans, SI Units, Vitamins & Amendments.',
      examTip: 'Use unit-digit verification, symmetry, or 100-base substitution before full calculation.',
      example: 'Quick Check: +20% then −20% yields 20 − 20 − (20×20)/100 = −4% net loss.',
    },
  ];
}

export async function aiFormulaLookup(params: {
  query: string;
  subject: string;
  lang: 'en' | 'hi';
}): Promise<{ cards: FormulaCardOutput[]; cached: boolean }> {
  const cacheKey = hashCacheKey(`formula|${params.lang}|${params.subject}|${params.query.trim().toLowerCase()}`);
  const cachedCards = getCachedAiValue<FormulaCardOutput[]>(cacheKey);
  if (cachedCards && cachedCards.length > 0) {
    return { cards: cachedCards, cached: true };
  }

  return runDeduplicated(cacheKey, async () => {
    const langInstruction =
      params.lang === 'hi'
        ? 'MANDATORY LANGUAGE: Output title, content, examTip, and example STRICTLY in Hindi (Devanagari script / हिंदी), NOT pure English. Keep only mathematical symbols/variables (P, R, T, x, %, ₹) and brief exam terms if needed.'
        : 'Write crisp, concise exam-oriented English with standard math symbols.';

    const prompt = [
      `SSC CGL Tier-I/II Formula Pocket Sheet lookup for: "${params.query}".`,
      params.subject !== 'all'
        ? `Subject: ${params.subject}.`
        : 'Pick best subject: quant | reasoning | english | ga.',
      langInstruction,
      'Return 2 to 3 compact, high-yield cards: exact formula/rule in content, fast exam trick in examTip, and 1 short solved example.',
      'Respond with a JSON object of the exact shape {"cards": [{"subject": "...", "topic": "...", "title": "...", "content": "...", "examTip": "...", "example": "..."}]}.',
    ].join('\n');

    try {
      const rawText = await callGroqChat({
        messages: [{ role: 'user', content: prompt }],
        jsonMode: true,
      });

      const parsed = coerceJsonArray(rawText, ['cards']) as Array<Record<string, unknown>>;
      const validSubjects = new Set(['quant', 'reasoning', 'english', 'ga']);
      const cards: FormulaCardOutput[] = parsed
        .filter((c) => c && typeof c.title === 'string' && typeof c.content === 'string')
        .slice(0, 4)
        .map((c) => ({
          subject: (validSubjects.has(String(c.subject).toLowerCase())
            ? String(c.subject).toLowerCase()
            : params.subject !== 'all'
              ? params.subject
              : 'quant') as SubjectKey,
          topic: String(c.topic || params.query).trim().slice(0, 60),
          title: String(c.title).trim().slice(0, 120),
          content: String(c.content).trim().slice(0, 800),
          examTip: String(c.examTip || '').trim().slice(0, 400),
          example: String(c.example || '').trim().slice(0, 320),
        }));

      if (cards.length > 0) {
        setCachedAiValue(cacheKey, cards, AI_FORMULA_TTL_MS);
        return { cards, cached: false };
      }
    } catch {
      // Fall back cleanly below
    }

    const fallbackCards = buildOfflineFormulaFallback(params);
    return { cards: fallbackCards, cached: true };
  });
}

export interface TranslationBatchItem {
  index: number;
  questionHi: string;
  optionsHi: string[];
  explanationHi: string;
}

export async function aiTranslateBatch(params: {
  questions: Array<{
    subject: string;
    questionEn: string;
    optionsEn: string[];
    explanationEn?: string;
  }>;
}): Promise<{ translations: TranslationBatchItem[] }> {
  const slice = params.questions.slice(0, 15).map((q, index) => ({
    index,
    subject: q.subject || 'quant',
    questionEn: q.questionEn,
    optionsEn: q.optionsEn,
    explanationEn: q.explanationEn || '',
  }));

  const cachedHits: TranslationBatchItem[] = [];
  const missingSlice: typeof slice = [];

  for (const item of slice) {
    const itemKey = hashCacheKey(`tr|${item.subject}|${item.questionEn}`);
    const hit = getCachedAiValue<Omit<TranslationBatchItem, 'index'>>(itemKey);
    if (hit) {
      cachedHits.push({ index: item.index, ...hit });
    } else {
      missingSlice.push(item);
    }
  }

  if (missingSlice.length === 0) {
    return { translations: cachedHits };
  }

  if (!resolveEffectiveGroqApiKey().key) {
    return { translations: cachedHits };
  }

  const batchKey = hashCacheKey(`tr_batch|${missingSlice.map((s) => s.questionEn).join('||')}`);
  let fetched: TranslationBatchItem[] = [];
  try {
    fetched = await runDeduplicated(batchKey, async () => {
      const response = await callGroqChat({
        messages: [
          {
            role: 'user',
            content:
              'Translate each SSC CGL question into natural exam-grade Hindi (Devanagari). Keep numbers, math formulas, symbols, and proper nouns intact. If subject is "english", translate the instruction and explanation into Hindi while keeping the target English phrase readable. Return exactly 4 items in optionsHi matching optionsEn order. Respond with a JSON object of the exact shape {"translations": [{"index": 0, "questionHi": "...", "optionsHi": ["...", "...", "...", "..."], "explanationHi": "..."}]}.\n\nInput:\n' +
              JSON.stringify(missingSlice),
          },
        ],
        jsonMode: true,
      });

      const parsed = coerceJsonArray(response, ['translations']) as Array<Record<string, unknown>>;
      const sourceByIdx = new Map(missingSlice.map((m) => [m.index, m]));
      const items: TranslationBatchItem[] = [];

      for (const rawItem of parsed) {
        if (!rawItem || typeof rawItem.index !== 'number') continue;
        const idx = Number(rawItem.index);
        const src = sourceByIdx.get(idx);
        if (!src) continue;
        const rawOpts = (Array.isArray(rawItem.optionsHi) ? rawItem.optionsHi : []) as unknown[];
        const normalized: Omit<TranslationBatchItem, 'index'> = {
          questionHi:
            typeof rawItem.questionHi === 'string' && rawItem.questionHi.trim()
              ? rawItem.questionHi.trim()
              : src.questionEn,
          optionsHi: [0, 1, 2, 3].map((i) => {
            const c = typeof rawOpts[i] === 'string' ? (rawOpts[i] as string).trim() : '';
            return c || src.optionsEn[i] || '';
          }),
          explanationHi:
            typeof rawItem.explanationHi === 'string'
              ? rawItem.explanationHi.trim()
              : src.explanationEn || '',
        };
        setCachedAiValue(hashCacheKey(`tr|${src.subject}|${src.questionEn}`), normalized, AI_TRANSLATION_TTL_MS);
        items.push({ index: idx, ...normalized });
      }
      return items;
    });
  } catch {
    // Graceful fallback: return cached translations without crashing live exam UI
    fetched = [];
  }

  const combined = [...cachedHits, ...fetched].sort((a, b) => a.index - b.index);
  return { translations: combined };
}

function buildOfflineMentorFallback(params: {
  message: string;
  studentName: string;
  targetPost: string;
}): string {
  const lower = params.message.toLowerCase();
  const target = params.targetPost || 'SSC CGL Officer';
  if (/xp|rule|80%|pending|leaderboard|rank/.test(lower)) {
    return `Platform Rules (${target}): Complete >80% of questions in a live mock to qualify for XP and Leaderboard rank. Tests submitted under 80% save into your Pending Folder (0 XP) so you can resume or retry without losing progress. Wrong and skipped items auto-sync into Smart Revision Vault 2.0.`;
  }
  if (/quant|math|trig|algebra|geom|percent/.test(lower)) {
    return `Quant Strategy (${target}): Aim for <45s per Quant question. Lock core identities (sin²θ+cos²θ=1, a³+b³=(a+b)(a²−ab+b²), Net %=a+b+ab/100) and clear your Quant micro-topic clusters in Revision Vault 2.0 before your next Tier-I/II mock.`;
  }
  if (/vocab|english|grammar|idiom|cloze/.test(lower)) {
    return `English Strategy: Target 88%+ accuracy in <12 mins total. Review one-word substitutions, fixed prepositions, and error-spotting pairs daily in the Formula & Grammar Pocket Sheet.`;
  }
  return `Offline Mentor Active (${params.studentName} · Target: ${target}): Live AI tutoring activates automatically once configured by your Admin. Meanwhile, use Smart Revision Vault 2.0 micro-topic drills and Formula Pocket Sheet for instant zero-latency prep!`;
}

export async function aiChatMentor(params: {
  message: string;
  history: Array<{ role: string; text: string }>;
  studentName: string;
  targetPost: string;
}): Promise<{ reply: string }> {
  const cleanHistory: GroqChatMessage[] = params.history
    .slice(-12)
    .map((m): GroqChatMessage => ({
      role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.text || '').trim().slice(0, 1500),
    }))
    .filter((m) => m.content.length > 0);

  if (cleanHistory.length === 0) {
    cleanHistory.push({ role: 'user', content: params.message });
  }

  const systemInstruction = [
    `You are the Path to CGL Cohort AI Study Mentor & Platform Guide helping ${params.studentName.slice(0, 60)} (Target Post: ${params.targetPost.slice(0, 60)}).`,
    'Answer concisely, encouragingly, and accurately about SSC CGL Tier-I & Tier-II syllabus, Quant shortcuts, Reasoning, English, GS/GA, and platform rules (>80% attempt rule for XP, Pending/Revision Vault, auto-save, camera proctoring).',
    'Keep responses practical and under 180 words unless solving a step-by-step problem.',
  ].join('\n');

  try {
    const reply = await callGroqChat({
      messages: [{ role: 'system', content: systemInstruction }, ...cleanHistory],
      temperature: 0.7,
      maxTokens: 2048,
    });
    if (reply) return { reply };
  } catch {
    // Graceful fallback below
  }
  return { reply: buildOfflineMentorFallback(params) };
}

export async function aiGenerateQuestions(params: {
  subject: SubjectKey;
  topic: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  count: number;
  timeoutMs?: number;
}): Promise<{ questions: QuestionInput[] }> {
  const safeCount = Math.min(25, Math.max(1, Number(params.count) || 5));
  const safeDiff = params.difficulty ?? 'medium';
  const cleanTopic = String(params.topic || 'General').trim().slice(0, 80);

  // Protect factual accuracy: NEVER invoke Groq AI for General Awareness / GK / History / Polity / Geography / Science
  if (isGeneralAwarenessSubjectOrTopic(params.subject, cleanTopic)) {
    return {
      questions: fetchStaticGKQuestions(cleanTopic || 'General Awareness', safeCount, {
        difficulty: safeDiff,
      }),
    };
  }

  const prompt = [
    `Generate ${safeCount} authentic, exam-grade SSC CGL Tier-I multiple-choice questions strictly from:`,
    `- Subject: ${params.subject}`,
    `- Syllabus Chapter / Topic: ${cleanTopic}`,
    `- Difficulty: ${safeDiff}`,
    'Requirements:',
    '1. Double-check every calculation, grammar rule, reasoning pattern, or factual detail before setting correctIndex (0 to 3).',
    '2. Provide thorough explanationEn and explanationHi, plus shortTrick where helpful.',
    '3. Exactly 4 distinct options per question.',
    'Respond with a JSON object of the exact shape {"questions": [{"topic": "...", "difficulty": "...", "questionEn": "...", "questionHi": "...", "optionsEn": ["a","b","c","d"], "optionsHi": ["a","b","c","d"], "correctIndex": 0, "explanationEn": "...", "explanationHi": "...", "shortTrick": "..."}]}.',
  ].join('\n');

  const response = await callGroqChat({
    messages: [{ role: 'user', content: prompt }],
    jsonMode: true,
    maxTokens: 8192,
  });

  const raw = coerceJsonArray(response, ['questions']) as Array<Record<string, unknown>>;
  const questions: QuestionInput[] = raw.flatMap((item) => {
    if (!item || !item.questionEn || !Array.isArray(item.optionsEn) || item.optionsEn.length !== 4) {
      return [];
    }
    const idx = Number(item.correctIndex);
    const correctIndex = idx >= 0 && idx <= 3 ? (idx as 0 | 1 | 2 | 3) : 0;
    const optionsHi =
      Array.isArray(item.optionsHi) && item.optionsHi.length === 4
        ? (item.optionsHi.map((o: unknown) => String(o).slice(0, 500)) as [
            string,
            string,
            string,
            string,
          ])
        : undefined;
    return [
      {
        subject: params.subject,
        topic: cleanTopic || String(item.topic || 'General').slice(0, 80),
        difficulty: safeDiff,
        yearTag: 'SSC CGL AI Custom',
        source: 'Groq SSC Generator',
        questionEn: String(item.questionEn).slice(0, 2000),
        ...(item.questionHi ? { questionHi: String(item.questionHi).slice(0, 2000) } : {}),
        optionsEn: item.optionsEn.map((o: unknown) => String(o).slice(0, 500)) as [
          string,
          string,
          string,
          string,
        ],
        ...(optionsHi ? { optionsHi } : {}),
        correctIndex,
        ...(item.explanationEn
          ? { explanationEn: String(item.explanationEn).slice(0, 3000) }
          : {}),
        ...(item.explanationHi
          ? { explanationHi: String(item.explanationHi).slice(0, 3000) }
          : {}),
        ...(item.shortTrick ? { shortTrick: String(item.shortTrick).slice(0, 1500) } : {}),
      },
    ];
  });

  return { questions };
}

export async function aiGenerateDailyPack(params: {
  dateKey: string;
  avoidTopics?: string[];
  perSubject?: number;
  timeoutMs?: number;
  env?: AiClientEnvLike;
}): Promise<{ questions: QuestionInput[] }> {
  const safePerSub = Math.min(5, Math.max(1, Number(params.perSubject) || 3));
  // Route GA strictly to the verified static GK bank; Groq generates only Quant, Reasoning, and English
  const totalAiNeeded = safePerSub * 3;
  const avoidStr = Array.isArray(params.avoidTopics)
    ? params.avoidTopics.slice(0, 12).map(String).join(', ')
    : '';

  const staticGaQuestions = fetchStaticGKQuestions('General Awareness', safePerSub);

  const prompt = [
    `Generate exactly ${totalAiNeeded} brand-new, authentic SSC CGL Tier-I & Tier-II multiple-choice questions for today's Daily Live Mock (${params.dateKey || 'Today'}).`,
    `Distribution: exactly ${safePerSub} questions for EACH of these 3 subjects ONLY: "quant", "reasoning", "english". Do NOT generate General Awareness ("ga") questions.`,
    avoidStr ? `Prefer fresh sub-topics and avoid repeating: ${avoidStr}.` : '',
    'Provide natural English AND Hindi (Devanagari) for question, 4 options, and explanation.',
    'Respond with a JSON object of the exact shape {"questions": [{"subject": "quant" | "reasoning" | "english", "topic": "...", "difficulty": "easy" | "medium" | "hard", "questionEn": "...", "questionHi": "...", "optionsEn": ["a","b","c","d"], "optionsHi": ["a","b","c","d"], "correctIndex": 0, "explanationEn": "...", "explanationHi": "..."}]}.',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await callGroqChat({
    messages: [{ role: 'user', content: prompt }],
    jsonMode: true,
    maxTokens: 8192,
    env: params.env,
  });

  const raw = coerceJsonArray(response, ['questions']) as Array<Record<string, unknown>>;
  const aiQuestions: QuestionInput[] = raw.flatMap((item) => {
    if (!item || !item.questionEn || !Array.isArray(item.optionsEn) || item.optionsEn.length !== 4) {
      return [];
    }
    const subRaw = String(item.subject || '').toLowerCase();
    // Filter out any accidental AI-hallucinated GA item; GA comes exclusively from staticGkBank
    if (!['quant', 'reasoning', 'english'].includes(subRaw)) {
      return [];
    }
    const subject = subRaw as SubjectKey;
    const diffRaw = String(item.difficulty || 'medium').toLowerCase();
    const difficulty = ['easy', 'medium', 'hard'].includes(diffRaw)
      ? (diffRaw as 'easy' | 'medium' | 'hard')
      : 'medium';
    const idx = Number(item.correctIndex);
    const correctIndex = idx >= 0 && idx <= 3 ? (idx as 0 | 1 | 2 | 3) : 0;
    const optionsHi =
      Array.isArray(item.optionsHi) && item.optionsHi.length === 4
        ? (item.optionsHi.map((o: unknown) => String(o).slice(0, 500)) as [
            string,
            string,
            string,
            string,
          ])
        : undefined;
    return [
      {
        subject,
        topic: String(item.topic || 'Mixed Daily').slice(0, 80),
        difficulty,
        yearTag: `Daily ${String(params.dateKey || 'Mock').slice(0, 12)}`.slice(0, 40),
        source: 'Auto Daily Engine',
        questionEn: String(item.questionEn).slice(0, 2000),
        ...(item.questionHi ? { questionHi: String(item.questionHi).slice(0, 2000) } : {}),
        optionsEn: item.optionsEn.map((o: unknown) => String(o).slice(0, 500)) as [
          string,
          string,
          string,
          string,
        ],
        ...(optionsHi ? { optionsHi } : {}),
        correctIndex,
        ...(item.explanationEn
          ? { explanationEn: String(item.explanationEn).slice(0, 3000) }
          : {}),
        ...(item.explanationHi
          ? { explanationHi: String(item.explanationHi).slice(0, 3000) }
          : {}),
      },
    ];
  });

  return { questions: [...aiQuestions, ...staticGaQuestions] };
}

export async function aiIngestPdfChunk(params: {
  shiftExamName: string;
  subjectMode: 'auto' | StrictIngestSubjectName;
  chunk: PdfPageChunk;
  timeoutMs?: number;
}): Promise<{
  items: IngestedQuestionDraft[];
  skippedCount: number;
  errors: Array<{ row: number; message: string }>;
}> {
  const textPages = params.chunk.pages.filter((page) => Boolean(page.text && page.text.trim()));
  if (textPages.length === 0) {
    return {
      items: [],
      skippedCount: 0,
      errors: [
        {
          row: 0,
          message: `${params.chunk.pageRangeLabel}: Scanned image-only pages contain no selectable text for AI extraction. Upload a text-searchable PDF or import via Strict JSON.`,
        },
      ],
    };
  }

  const prompt = buildPdfExtractionPrompt({
    shiftExamName: params.shiftExamName,
    subjectMode: params.subjectMode,
    pageRangeLabel: params.chunk.pageRangeLabel,
  });

  const contentParts = [prompt];
  for (const page of textPages) {
    contentParts.push(
      `--- PAGE ${page.pageNumber} TEXT ---\n${page.text.trim().slice(0, 16000)}`
    );
  }
  contentParts.push(
    'Respond with a single JSON object of the exact shape {"questions": [ ... ]} containing every extracted question.'
  );

  const response = await callGroqChat({
    messages: [{ role: 'user', content: contentParts.join('\n\n') }],
    jsonMode: true,
    maxTokens: 8192,
  });

  const extracted = coerceJsonArray(response, ['questions']);
  const payload = extracted.length > 0 ? JSON.stringify(extracted) : response;

  return parseAiPdfQuestionsJson(payload, {
    shiftExamName: params.shiftExamName,
    subjectMode: params.subjectMode,
    pageRangeLabel: params.chunk.pageRangeLabel,
    chunkIndex: params.chunk.chunkIndex,
  });
}

export async function aiExtractQuestionsFromRawPdfText(params: {
  rawTextChunk: string;
  timeoutMs?: number;
}): Promise<{ rows: ExtractedPdfQuestionRow[]; skippedCount: number }> {
  const prompt = buildRawTextMcqExtractionPrompt(params.rawTextChunk);

  const response = await callGroqChat({
    messages: [
      {
        role: 'user',
        content:
          prompt +
          '\nRespond with a single JSON object of the exact shape {"questions": [ ... ]} containing every extracted multiple-choice question.',
      },
    ],
    jsonMode: true,
    maxTokens: 8192,
  });

  const extracted = coerceJsonArray(response, ['questions']);
  return parseExtractedMcqJson(extracted.length > 0 ? JSON.stringify(extracted) : response);
}

export interface SscUpdateFeedItem {
  id: string;
  title: string;
  summary: string;
  category: 'Exam Notice' | 'Calendar' | 'Pattern / Syllabus' | 'Preparation';
  url?: string;
}

const SSC_UPDATES_STORAGE_KEY = 'getcgl_ssc_updates_cache_v1';
const SSC_UPDATES_TTL_MS = 6 * 60 * 60 * 1000;

export async function aiFetchSscUpdates(forceRefresh = false): Promise<{
  updates: SscUpdateFeedItem[];
  source: 'live_grounded' | 'offline';
}> {
  const now = Date.now();
  if (!forceRefresh && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(SSC_UPDATES_STORAGE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as {
          fetchedAtMs?: number;
          updates?: SscUpdateFeedItem[];
        };
        if (
          Array.isArray(cached.updates) &&
          cached.updates.length > 0 &&
          typeof cached.fetchedAtMs === 'number' &&
          now - cached.fetchedAtMs < SSC_UPDATES_TTL_MS
        ) {
          return { updates: cached.updates, source: 'live_grounded' };
        }
      }
    } catch {
      // Ignore malformed cache
    }
  }

  if (!resolveEffectiveGroqApiKey().key) {
    return { updates: [], source: 'offline' };
  }

  try {
    const prompt = [
      'List the most recent genuine SSC CGL notifications, exam calendar updates, Tier-I / Tier-II schedules, admit card / result notices, or pattern/syllabus announcements from the official Staff Selection Commission (ssc.gov.in).',
      'Return 4 to 6 concise updates.',
      'Keep each summary under 160 characters and include exact dates or year numbers where known.',
      'Respond with a JSON object of the exact shape {"updates": [{"title": "...", "summary": "...", "category": "Exam Notice" | "Calendar" | "Pattern / Syllabus" | "Preparation"}]}.',
    ].join('\n');

    const rawText = await callGroqChat({
      messages: [{ role: 'user', content: prompt }],
      jsonMode: true,
    });

    const parsedItems = coerceJsonArray(rawText, ['updates']) as Array<{
      title?: string;
      summary?: string;
      category?: string;
    }>;

    const validCats = new Set(['Exam Notice', 'Calendar', 'Pattern / Syllabus', 'Preparation']);
    const updates: SscUpdateFeedItem[] = parsedItems
      .filter((it) => it && typeof it.title === 'string' && typeof it.summary === 'string')
      .slice(0, 6)
      .map((it, idx) => ({
        id: `ssc_upd_${idx}_${String(it.title).slice(0, 20).replace(/[^a-zA-Z0-9]/g, '')}`,
        title: String(it.title).trim().slice(0, 110),
        summary: String(it.summary).trim().slice(0, 220),
        category: (validCats.has(String(it.category))
          ? String(it.category)
          : 'Exam Notice') as SscUpdateFeedItem['category'],
      }));

    if (updates.length > 0 && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(
          SSC_UPDATES_STORAGE_KEY,
          JSON.stringify({ fetchedAtMs: now, updates })
        );
      } catch {
        // Ignore storage quota errors
      }
    }

    return {
      updates,
      source: updates.length > 0 ? 'live_grounded' : 'offline',
    };
  } catch {
    return { updates: [], source: 'offline' };
  }
}

function decodeHtmlEntitiesClient(text: string): string {
  if (typeof document !== 'undefined') {
    const el = document.createElement('textarea');
    el.innerHTML = text;
    return el.value;
  }
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function shuffleOptionsWithCorrect(
  correct: string,
  wrong: string[]
): { options: [string, string, string, string]; correctIndex: 0 | 1 | 2 | 3 } {
  const tagged = [
    { text: correct, isCorrect: true },
    ...wrong.slice(0, 3).map((w) => ({ text: w, isCorrect: false })),
  ];
  while (tagged.length < 4) {
    tagged.push({ text: 'None of the above', isCorrect: false });
  }
  for (let i = tagged.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
  }
  const idx = tagged.findIndex((t) => t.isCorrect);
  return {
    options: tagged.map((t) => t.text) as [string, string, string, string],
    correctIndex: (idx >= 0 && idx <= 3 ? idx : 0) as 0 | 1 | 2 | 3,
  };
}

export async function fetchExternalQuestionsClient(params: {
  provider: 'opentdb' | 'custom_url';
  amount: number;
  subject: SubjectKey;
  category?: string;
  customUrl?: string;
  customApiKey?: string;
  customHeaderName?: string;
}): Promise<{ questions: QuestionInput[]; fetchedFrom: string }> {
  if (params.provider === 'custom_url') {
    const rawUrl = (params.customUrl || '').trim();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error('Please enter a valid public https:// External Question API URL.');
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error('External Question API URL must use http:// or https://.');
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (params.customApiKey && params.customApiKey.trim()) {
      const hName = (params.customHeaderName || 'Authorization').trim() || 'Authorization';
      const val = params.customApiKey.trim();
      headers[hName] =
        hName.toLowerCase() === 'authorization' && !val.startsWith('Bearer ')
          ? `Bearer ${val}`
          : val;
    }
    const resp = await fetch(parsedUrl.toString(), { headers });
    if (!resp.ok) {
      throw new Error(`External API returned HTTP ${resp.status}`);
    }
    const payload = await resp.json();
    const rawArray: unknown[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.questions)
          ? payload.questions
          : Array.isArray(payload?.data)
            ? payload.data
            : [];

    const normalized: QuestionInput[] = rawArray.slice(0, 50).flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const r = row as Record<string, unknown>;
      const qText = decodeHtmlEntitiesClient(
        String(r.questionEn ?? r.question ?? r.prompt ?? '')
      ).trim();
      if (!qText) return [];

      let opts: string[] = [];
      let correctIdx = 0;

      if (Array.isArray(r.optionsEn) && r.optionsEn.length === 4) {
        opts = r.optionsEn.map((o) => decodeHtmlEntitiesClient(String(o)));
        correctIdx = Number(r.correctIndex ?? 0);
      } else if (Array.isArray(r.options) && r.options.length === 4) {
        opts = r.options.map((o) => decodeHtmlEntitiesClient(String(o)));
        correctIdx = Number(r.correctIndex ?? r.answerIndex ?? 0);
      } else if (
        r.correct_answer &&
        Array.isArray(r.incorrect_answers) &&
        r.incorrect_answers.length >= 3
      ) {
        const correct = decodeHtmlEntitiesClient(String(r.correct_answer));
        const wrong = (r.incorrect_answers as unknown[])
          .slice(0, 3)
          .map((w) => decodeHtmlEntitiesClient(String(w)));
        const shuffled = shuffleOptionsWithCorrect(correct, wrong);
        opts = shuffled.options;
        correctIdx = shuffled.correctIndex;
      } else {
        return [];
      }

      if (correctIdx < 0 || correctIdx > 3) correctIdx = 0;
      const subj = ['quant', 'reasoning', 'english', 'ga'].includes(String(r.subject ?? params.subject))
        ? (String(r.subject ?? params.subject) as SubjectKey)
        : params.subject;

      return [
        {
          subject: subj,
          topic: String(r.topic ?? r.category ?? 'External Feed').slice(0, 80),
          difficulty: ['easy', 'medium', 'hard'].includes(String(r.difficulty))
            ? (String(r.difficulty) as 'easy' | 'medium' | 'hard')
            : 'medium',
          source: parsedUrl.hostname.slice(0, 64),
          questionEn: qText.slice(0, 2000),
          optionsEn: opts.map((o) => o.slice(0, 500)) as [string, string, string, string],
          correctIndex: correctIdx as 0 | 1 | 2 | 3,
          ...(r.questionHi ? { questionHi: String(r.questionHi).slice(0, 2000) } : {}),
          ...(r.explanationEn
            ? { explanationEn: String(r.explanationEn).slice(0, 3000) }
            : {}),
        },
      ];
    });

    return { questions: normalized, fetchedFrom: parsedUrl.hostname };
  }

  // Open Trivia DB direct CORS fetch
  const count = Math.min(25, Math.max(1, Number(params.amount) || 10));
  const catParam =
    params.category && params.category !== 'any'
      ? `&category=${encodeURIComponent(String(params.category))}`
      : '';
  const apiRes = await fetch(`https://opentdb.com/api.php?amount=${count}&type=multiple${catParam}`);
  if (!apiRes.ok) {
    throw new Error(`OpenTDB API returned HTTP ${apiRes.status}`);
  }
  const data = (await apiRes.json()) as {
    response_code: number;
    results?: Array<{
      category: string;
      difficulty: string;
      question: string;
      correct_answer: string;
      incorrect_answers: string[];
    }>;
  };

  if (!data.results || data.results.length === 0) {
    throw new Error('External API returned 0 questions for the selected category.');
  }

  const questions: QuestionInput[] = data.results.map((item) => {
    const correct = decodeHtmlEntitiesClient(item.correct_answer);
    const incorrect = item.incorrect_answers.slice(0, 3).map(decodeHtmlEntitiesClient);
    const { options, correctIndex } = shuffleOptionsWithCorrect(correct, incorrect);
    const diff = ['easy', 'medium', 'hard'].includes(item.difficulty)
      ? (item.difficulty as 'easy' | 'medium' | 'hard')
      : 'medium';

    return {
      subject: params.subject,
      topic: String(item.category || 'General Awareness').slice(0, 80),
      difficulty: diff,
      source: 'OpenTDB Live API',
      questionEn: decodeHtmlEntitiesClient(item.question).slice(0, 2000),
      optionsEn: options.map((o) => o.slice(0, 500)) as [string, string, string, string],
      correctIndex,
      explanationEn: `Verified answer from OpenTDB (${item.category}): ${correct}.`,
    };
  });

  return { questions, fetchedFrom: 'opentdb.com' };
}

export interface ExamPostMortemReport {
  headline: string;
  marksLostToNegative: number;
  potentialBoostMarks: number;
  actionChecklist: string[];
  hindiTakeaway: string;
  source: 'groq_ai' | 'local_diagnostic';
}

export function buildDeterministicPostMortem(params: {
  testTitle: string;
  targetPost: string;
  score: number;
  maxScore: number;
  accuracy: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  negativeMarks: number;
  positiveMarks: number;
  weakTopics: string[];
  slowestSection?: string;
}): ExamPostMortemReport {
  const marksLostToNegative = Math.round(params.wrongCount * params.negativeMarks * 100) / 100;
  const recoverableFromHalfWrong = Math.round(
    (params.wrongCount * 0.5) * (params.positiveMarks + params.negativeMarks) * 100
  ) / 100;
  const weakList = params.weakTopics.slice(0, 3).join(', ') || 'mixed accuracy traps';

  const headline =
    marksLostToNegative >= params.positiveMarks * 4
      ? `Negative-mark leak cost ${marksLostToNegative} marks — tighten elimination before attempting borderline guesses.`
      : params.accuracy >= 85
        ? `Strong ${params.accuracy}% precision on ${params.testTitle} — push attempt speed to climb closer to ${params.targetPost}.`
        : `Prioritize clearing ${weakList} in your Revision Vault to unlock faster clean attempts.`;

  const actionChecklist: string[] = [
    params.wrongCount > 0
      ? `Eliminate negative leakage: ${params.wrongCount} incorrect answers forfeited ${marksLostToNegative} marks (potential +${recoverableFromHalfWrong} swing by skipping pure guesses).`
      : `Zero negative penalty (${params.wrongCount} wrong) — keep defending this discipline while adding +3–5 selective attempts.`,
    params.slowestSection
      ? `Trim ${params.slowestSection} solve time: use 2-pass scanning (attempt <35s sitters first, flag lengthy items for Pass-2).`
      : `Adopt a strict 2-pass timer rule: finish easy GA/English/Reasoning first so Quant gets full clean minutes.`,
    params.weakTopics.length > 0
      ? `Targeted recovery: run a 15-Q Revision Drill on ${weakList} before your next full mock.`
      : `Consolidate gains: re-attempt your skipped items in Revision Vault to push above ${params.targetPost} benchmark.`,
  ];

  const hindiTakeaway =
    marksLostToNegative > 0
      ? `नेगेटिव मार्किंग से ${marksLostToNegative} अंक कम हुए — अगले टेस्ट में केवल पक्के या 50-50 उन्मूलन वाले प्रश्न ही हल करें और ${weakList} का अभ्यास दोहराएँ।`
      : `शानदार सटीकता (${params.accuracy}%)! अब ${params.targetPost} कट-ऑफ पार करने के लिए हल करने की गति और कठिन प्रश्नों का चयन बढ़ाएँ।`;

  return {
    headline,
    marksLostToNegative,
    potentialBoostMarks: recoverableFromHalfWrong,
    actionChecklist,
    hindiTakeaway,
    source: 'local_diagnostic',
  };
}

export async function aiPostMortemAnalysis(params: {
  testTitle: string;
  targetPost: string;
  score: number;
  maxScore: number;
  accuracy: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  negativeMarks: number;
  positiveMarks: number;
  weakTopics: string[];
  slowestSection?: string;
}): Promise<ExamPostMortemReport> {
  const baseline = buildDeterministicPostMortem(params);
  const cacheKey = hashCacheKey(
    `pm|${params.testTitle}|${params.score}|${params.wrongCount}|${params.accuracy}|${params.weakTopics.join(',')}`
  );
  const cached = getCachedAiValue<ExamPostMortemReport>(cacheKey);
  if (cached) {
    return cached;
  }

  return runDeduplicated(cacheKey, async () => {
    if (!resolveEffectiveGroqApiKey().key) {
      return baseline;
    }
    try {
      const prompt = [
        `Analyze this SSC CGL mock test performance for an aspirant targeting "${params.targetPost}":`,
        `Test: ${params.testTitle} | Score: ${params.score}/${params.maxScore} | Accuracy: ${params.accuracy}%`,
        `Breakdown: ${params.correctCount} correct (+${params.positiveMarks}), ${params.wrongCount} wrong (-${params.negativeMarks}, lost ${baseline.marksLostToNegative}), ${params.skippedCount} skipped.`,
        params.slowestSection ? `Slowest section: ${params.slowestSection}.` : '',
        params.weakTopics.length > 0 ? `Weak/error topics: ${params.weakTopics.slice(0, 5).join(', ')}.` : '',
        'Return a JSON object of shape {"headline": "...", "actionChecklist": ["...", "...", "..."], "hindiTakeaway": "..."} with sharp, practical SSC CGL advice (no fluff).',
      ]
        .filter(Boolean)
        .join('\n');

      const rawText = await callGroqChat({
        messages: [{ role: 'user', content: prompt }],
        jsonMode: true,
        maxTokens: 1200,
      });
      const parsed = parseLooseJson(rawText) as Record<string, unknown> | null;
      if (parsed && typeof parsed.headline === 'string' && Array.isArray(parsed.actionChecklist)) {
        const cleanChecklist = parsed.actionChecklist
          .map((item) => String(item).trim().slice(0, 260))
          .filter(Boolean)
          .slice(0, 4);
        const report: ExamPostMortemReport = {
          headline: parsed.headline.trim().slice(0, 220),
          marksLostToNegative: baseline.marksLostToNegative,
          potentialBoostMarks: baseline.potentialBoostMarks,
          actionChecklist: cleanChecklist.length > 0 ? cleanChecklist : baseline.actionChecklist,
          hindiTakeaway:
            typeof parsed.hindiTakeaway === 'string' && parsed.hindiTakeaway.trim()
              ? parsed.hindiTakeaway.trim().slice(0, 300)
              : baseline.hindiTakeaway,
          source: 'groq_ai',
        };
        setCachedAiValue(cacheKey, report, AI_POSTMORTEM_TTL_MS);
        return report;
      }
    } catch {
      // Fall back cleanly to deterministic diagnostic
    }
    return baseline;
  });
}

