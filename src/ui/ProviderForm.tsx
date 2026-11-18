import { useState } from 'react';
import { PROVIDER_KINDS, type ProviderKind, type ProviderSettings } from '../domain/types';
import { useT } from '../i18n';
import { checkConnection } from '../llm/clients';
import { ENV, isEnvKey, PROVIDER_DEFAULTS, providerSettingsFor } from '../llm/env';
import { keyVault } from '../llm/keyVault';
import { ProviderError } from '../llm/provider';
import { secretStore } from '../storage/db';
import { Field, Notice } from './common';

interface Props {
  provider: ProviderSettings;
  persistApiKey: boolean;
  onChange(provider: ProviderSettings): void;
  onPersistChange(persist: boolean): void;
}

type CheckState = { state: 'idle' | 'checking' | 'ok' } | { state: 'failed'; code: string; detail: string };

/** BYOK provider configuration shared by onboarding and settings. Keys never leave this device except to the chosen provider. */
export function ProviderForm({ provider, persistApiKey, onChange, onPersistChange }: Props) {
  const t = useT();
  const defaults = PROVIDER_DEFAULTS[provider.kind];
  const [key, setKey] = useState(() => keyVault.get(provider.kind));
  const [check, setCheck] = useState<CheckState>({ state: 'idle' });
  const fromEnv = isEnvKey(provider.kind);

  const selectKind = (kind: ProviderKind) => {
    onChange(providerSettingsFor(kind));
    setKey(keyVault.get(kind));
    setCheck({ state: 'idle' });
  };

  const applyKey = async (value: string, persist: boolean) => {
    setKey(value);
    keyVault.set(provider.kind, value);
    if (persist && value.trim()) await secretStore.set(provider.kind, value.trim());
    else await secretStore.set(provider.kind, '');
  };

  const runCheck = async () => {
    setCheck({ state: 'checking' });
    try {
      await checkConnection(provider, keyVault.get(provider.kind));
      setCheck({ state: 'ok' });
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : 'network';
      setCheck({ state: 'failed', code, detail: (error as Error).message });
    }
  };

  return (
    <div className="stack">
      <Field label={t('provider.kind')}>
        <select value={provider.kind} onChange={(e) => selectKind(e.target.value as ProviderKind)}>
          {PROVIDER_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`provider.${kind}`)}
              {ENV.providers.some((p) => p.kind === kind) ? ` · ${t('provider.inEnv')}` : ''}
            </option>
          ))}
        </select>
      </Field>

      {provider.kind === 'demo' ? (
        <Notice kind="warn">{t('provider.demoNotice')}</Notice>
      ) : (
        <>
          <Notice>{t('provider.dataLeavesDevice')}</Notice>
          {fromEnv ? (
            <Notice>{t('provider.keyFromEnv')}</Notice>
          ) : (
            <>
              <Field label={t('provider.apiKey')} hint={t('provider.apiKeyHint')}>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  placeholder={defaults.keyHint}
                  onChange={(e) => void applyKey(e.target.value, persistApiKey)}
                />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={persistApiKey}
                  onChange={(e) => {
                    onPersistChange(e.target.checked);
                    void applyKey(key, e.target.checked);
                  }}
                />
                {t('provider.persistKey')}
              </label>
              {persistApiKey && <Notice kind="warn">{t('provider.persistWarning')}</Notice>}
            </>
          )}
          {(provider.kind === 'openai_compatible' || provider.baseUrl) && (
            <Field label={t('provider.baseUrl')} hint={t('provider.baseUrlHint')}>
              <input
                type="url"
                value={provider.baseUrl}
                placeholder={defaults.baseUrl || 'https://…/v1'}
                onChange={(e) => onChange({ ...provider, baseUrl: e.target.value.trim() })}
              />
            </Field>
          )}
          <datalist id="model-suggestions">
            {defaults.modelSuggestions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <Field label={t('provider.actorModel')} hint={t('provider.actorModelHint')}>
            <input
              list="model-suggestions"
              value={provider.actorModel}
              placeholder={defaults.model}
              onChange={(e) => onChange({ ...provider, actorModel: e.target.value.trim() })}
            />
          </Field>
          <Field label={t('provider.coachModel')} hint={t('provider.coachModelHint')}>
            <input
              list="model-suggestions"
              value={provider.coachModel}
              placeholder={provider.actorModel || defaults.model}
              onChange={(e) => onChange({ ...provider, coachModel: e.target.value.trim() })}
            />
          </Field>
          <div className="row">
            <button type="button" className="btn" onClick={() => void runCheck()} disabled={check.state === 'checking'}>
              {check.state === 'checking' ? t('provider.checking') : t('provider.check')}
            </button>
          </div>
          {check.state === 'ok' && <Notice>{t('provider.checkOk')}</Notice>}
          {check.state === 'failed' && (
            <Notice kind="error">
              {t(`error.${check.code}`)}
              <br />
              <span className="small">{check.detail}</span>
            </Notice>
          )}
        </>
      )}
    </div>
  );
}
