import { useState } from 'react';
import { nowIso } from '../../app/services';
import { DEFAULT_HEURISTICS, LOCALES, type AppLocale, type HeuristicSettings } from '../../domain/types';
import { useT } from '../../i18n';
import { keyVault } from '../../llm/keyVault';
import { speech, speechCapabilities } from '../../speech/speechAdapter';
import { buildBackup, downloadBlob, importBackup, importSessionJson, type CollisionPolicy, type ImportReport } from '../../storage/backup';
import { requestPersistentStorage, secretStore, wipeAllData } from '../../storage/db';
import { Choice, Field, Notice, Page, readFileBytes, useApp, useAsync } from '../common';
import { ProviderForm } from '../ProviderForm';

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

export function Settings() {
  const t = useT();
  const { settings, updateSettings, reloadRegistry } = useApp();
  const caps = speechCapabilities();
  const [policy, setPolicy] = useState<CollisionPolicy>('skip');
  const [restoreSettings, setRestoreSettings] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState('');
  const [confirmWipe, setConfirmWipe] = useState(false);
  const { data: persisted, reload } = useAsync(async () => (navigator.storage?.persisted ? navigator.storage.persisted() : null), []);

  const locale = (key: 'uiLocale' | 'spokenLocale' | 'contentLocale', legend: string) => (
    <Choice<AppLocale>
      legend={legend}
      value={settings[key]}
      options={LOCALES.map((l) => ({ value: l, label: t(`locale.${l}`) }))}
      onChange={(value) => void updateSettings({ [key]: value })}
    />
  );
  const heuristic = (key: keyof HeuristicSettings, step = 1, max = 100) => (
    <Field label={t(`settings.heuristic.${key}`)}>
      <input
        type="number"
        min={step}
        max={max}
        step={step}
        value={settings.heuristics[key]}
        onChange={(e) => void updateSettings({ heuristics: { ...settings.heuristics, [key]: Number(e.target.value) || DEFAULT_HEURISTICS[key] } })}
      />
    </Field>
  );

  const exportBackup = async () => {
    const now = nowIso();
    downloadBlob(await buildBackup(now), `executive-reflexes-backup-${now.slice(0, 10)}.zip`, 'application/zip');
    await updateSettings({ lastBackupAt: now });
  };
  const importFile = async (file: File) => {
    setError('');
    setReport(null);
    try {
      const result = file.name.toLowerCase().endsWith('.json')
        ? await importSessionJson(await file.text(), policy)
        : await importBackup(await readFileBytes(file), policy, { restoreSettings });
      setReport(result);
      await reloadRegistry();
      if (result.settingsRestored) window.location.reload();
    } catch (e) {
      setError(t(`error.${(e as Error).message}`));
    }
  };
  const wipe = async () => {
    keyVault.clear();
    await wipeAllData();
    window.location.hash = '';
    window.location.reload();
  };

  return (
    <Page title={t('nav.settings')}>
      <section className="card stack">
        <h2>{t('settings.languages')}</h2>
        {locale('uiLocale', t('settings.uiLocale'))}
        {locale('spokenLocale', t('settings.spokenLocale'))}
        {locale('contentLocale', t('settings.contentLocale'))}
      </section>

      <section className="card stack">
        <h2>{t('onboarding.provider')}</h2>
        <ProviderForm
          provider={settings.provider}
          persistApiKey={settings.persistApiKey}
          onChange={(provider) => void updateSettings({ provider })}
          onPersistChange={(persistApiKey) => void updateSettings({ persistApiKey })}
        />
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            keyVault.clear();
            void secretStore.clear();
            void updateSettings({ persistApiKey: false });
          }}
        >
          {t('settings.forgetKeys')}
        </button>
      </section>

      <section className="card stack">
        <h2>{t('settings.voice')}</h2>
        <ul className="small">
          <li>{t(caps.tts ? 'speech.ttsYes' : 'speech.ttsNo')}</li>
          <li>{t(caps.stt ? 'speech.sttYes' : 'speech.sttNo')}</li>
          <li>{t(caps.wakeLock ? 'speech.wakeLockYes' : 'speech.noWakeLock')}</li>
        </ul>
        <p className="muted small">{t('speech.backgroundLimit')}</p>
        <Field label={t('settings.speechRate', { rate: settings.speechRate.toFixed(1) })}>
          <input type="range" min={0.7} max={1.4} step={0.1} value={settings.speechRate} onChange={(e) => void updateSettings({ speechRate: Number(e.target.value) })} />
        </Field>
        {caps.tts && (
          <Field label={t('settings.voiceChoice')}>
            <select value={settings.voiceURI ?? ''} onChange={(e) => void updateSettings({ voiceURI: e.target.value || null })}>
              <option value="">{t('settings.voiceDefault')}</option>
              {speech.voices(settings.spokenLocale).map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </Field>
        )}
        <label className="check">
          <input type="checkbox" checked={settings.speakFeedback} onChange={(e) => void updateSettings({ speakFeedback: e.target.checked })} />
          {t('settings.speakFeedback')}
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.wakeLock} onChange={(e) => void updateSettings({ wakeLock: e.target.checked })} />
          {t('settings.wakeLock')}
        </label>
      </section>

      <section className="card stack">
        <h2>{t('settings.backup')}</h2>
        <p className="muted small">{t('privacy.eviction')}</p>
        <p className="small">
          {persisted === null || persisted === undefined ? t('settings.persistUnknown') : persisted ? t('settings.persistGranted') : t('settings.persistNotGranted')}{' '}
          {persisted === false && (
            <button type="button" className="btn btn-small" onClick={() => void requestPersistentStorage().then(reload)}>
              {t('settings.requestPersist')}
            </button>
          )}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => void exportBackup()}>
          {t('settings.exportBackup')}
        </button>
        <p className="muted small">{t('settings.backupNoSecrets')}</p>
        <Choice<CollisionPolicy>
          legend={t('settings.collisions')}
          value={policy}
          options={[
            { value: 'skip', label: t('settings.collisionSkip') },
            { value: 'replace', label: t('settings.collisionReplace') },
          ]}
          onChange={setPolicy}
        />
        <label className="check">
          <input type="checkbox" checked={restoreSettings} onChange={(e) => setRestoreSettings(e.target.checked)} />
          {t('settings.restoreSettings')}
        </label>
        <label className="btn">
          {t('settings.importBackup')}
          <input type="file" accept=".zip,.json,application/zip,application/json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </label>
        {error && <Notice kind="error">{error}</Notice>}
        {report && (
          <Notice>
            {t('settings.importReport', { imported: sum(report.imported), skipped: sum(report.skipped), replaced: sum(report.replaced), invalid: report.invalid.length })}
          </Notice>
        )}
      </section>

      <section className="card stack">
        <h2>{t('settings.heuristics')}</h2>
        <p className="muted small">{t('settings.heuristicsNote')}</p>
        {heuristic('swotHypothesizeAt')}
        {heuristic('swotProvisionalAt')}
        {heuristic('minScenarioVariety', 1, 10)}
        {heuristic('sampleWarningBelow', 1, 30)}
        {heuristic('oralTargetRatio', 0.05, 1)}
      </section>

      <section className="card stack">
        <h2>{t('onboarding.privacy')}</h2>
        <ul className="small">
          <li>{t('privacy.local')}</li>
          <li>{t('privacy.provider')}</li>
          <li>{t('privacy.keys')}</li>
          <li>{t('privacy.speech')}</li>
          <li>{t('privacy.noSync')}</li>
          <li>{t('privacy.notTherapy')}</li>
        </ul>
        {confirmWipe ? (
          <div className="row">
            <button type="button" className="btn btn-danger" onClick={() => void wipe()}>
              {t('settings.confirmWipe')}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmWipe(false)}>
              {t('action.cancel')}
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-link" onClick={() => setConfirmWipe(true)}>
            {t('settings.wipe')}
          </button>
        )}
      </section>
      <p className="muted small">Executive Reflexes v{__APP_VERSION__}</p>
    </Page>
  );
}
