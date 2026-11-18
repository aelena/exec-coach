import type { ProviderKind, ProviderSettings } from '../domain/types';
import { keyVault } from './keyVault';

// BYOK from `.env` for local development and personal self-hosted builds. Vite inlines VITE_*
// variables into the bundle, so a build made with keys present must never be published; the
// build refuses to do that unless explicitly allowed (see vite.config.ts and DECISIONS ADR 13).

export interface ProviderDefaults {
  label: string;
  baseUrl: string;
  model: string;
  modelSuggestions: string[];
  needsKey: boolean;
  keyHint: string;
}

export const PROVIDER_DEFAULTS: Record<ProviderKind, ProviderDefaults> = {
  demo: { label: 'Demo', baseUrl: '', model: 'demo-scripted', modelSuggestions: [], needsKey: false, keyHint: '' },
  anthropic: {
    label: 'Anthropic (Claude)',
    baseUrl: '',
    model: 'claude-opus-5-5',
    modelSuggestions: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'],
    needsKey: true,
    keyHint: 'sk-ant-…',
  },
  openai: {
    label: 'OpenAI (ChatGPT models)',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.6-sol',
    modelSuggestions: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'chat-latest'],
    needsKey: true,
    keyHint: 'sk-…',
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.6-flash',
    modelSuggestions: ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview'],
    needsKey: true,
    keyHint: 'AIza…',
  },
  openai_compatible: {
    label: 'OpenAI-compatible endpoint',
    baseUrl: '',
    model: '',
    modelSuggestions: [],
    needsKey: false,
    keyHint: '',
  },
};

type EnvRecord = Record<string, string | undefined>;

const ENV_PREFIX: Partial<Record<ProviderKind, string>> = {
  anthropic: 'ANTHROPIC',
  openai: 'OPENAI',
  gemini: 'GEMINI',
  openai_compatible: 'CUSTOM',
};

export interface EnvProvider {
  kind: ProviderKind;
  apiKey: string;
  baseUrl: string;
  actorModel: string;
  coachModel: string;
}

export function readEnvProviders(env: EnvRecord): { providers: EnvProvider[]; preferred: ProviderKind | null } {
  const providers: EnvProvider[] = [];
  for (const [kind, prefix] of Object.entries(ENV_PREFIX) as Array<[ProviderKind, string]>) {
    const apiKey = (env[`VITE_${prefix}_API_KEY`] ?? '').trim();
    const baseUrl = (env[`VITE_${prefix}_BASE_URL`] ?? '').trim();
    // A custom endpoint (for example a local model server) may legitimately need no key.
    if (!apiKey && !(kind === 'openai_compatible' && baseUrl)) continue;
    const model = (env[`VITE_${prefix}_MODEL`] ?? '').trim();
    providers.push({
      kind,
      apiKey,
      baseUrl,
      actorModel: (env[`VITE_${prefix}_ACTOR_MODEL`] ?? '').trim() || model,
      coachModel: (env[`VITE_${prefix}_COACH_MODEL`] ?? '').trim() || model,
    });
  }
  const wanted = (env.VITE_DEFAULT_PROVIDER ?? '').trim().toLowerCase();
  const preferred = providers.find((p) => p.kind === wanted || ENV_PREFIX[p.kind]?.toLowerCase() === wanted)?.kind ?? providers[0]?.kind ?? null;
  return { providers, preferred };
}

export const ENV = readEnvProviders(import.meta.env as unknown as EnvRecord);

/** Loads `.env` keys into volatile memory. They are never written to storage, exports or logs. */
export function loadEnvKeys(): void {
  for (const p of ENV.providers) if (p.apiKey) keyVault.set(p.kind, p.apiKey);
}

export function isEnvKey(kind: ProviderKind): boolean {
  return ENV.providers.some((p) => p.kind === kind && p.apiKey !== '');
}

/** Provider settings for a kind: `.env` overrides first, then built-in defaults. */
export function providerSettingsFor(kind: ProviderKind): ProviderSettings {
  const fromEnv = ENV.providers.find((p) => p.kind === kind);
  return {
    kind,
    baseUrl: fromEnv?.baseUrl ?? '',
    actorModel: fromEnv?.actorModel ?? '',
    coachModel: fromEnv?.coachModel ?? '',
  };
}
