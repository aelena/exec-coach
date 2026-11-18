import { useState } from 'react';
import { memory, nowIso, USER_GOALS_ID, USER_PROFILE_ID } from '../../app/services';
import { LOCALES, USER_TEXT_LIMITS, type AppLocale } from '../../domain/types';
import { useT } from '../../i18n';
import { requestPersistentStorage } from '../../storage/db';
import { Choice, Field, navigate, Notice, Page, useApp } from '../common';
import { ProviderForm } from '../ProviderForm';

/** Onboarding: locale, role, objectives, BYOK provider with connection check, privacy consent, optional profile. */
export function Onboarding() {
  const t = useT();
  const { settings, updateSettings } = useApp();
  const [role, setRole] = useState(settings.role);
  const [objectives, setObjectives] = useState(settings.objectives);
  const [profile, setProfile] = useState('');
  const [consent, setConsent] = useState(false);

  const finish = async () => {
    const now = nowIso();
    await memory.setUserFact(USER_GOALS_ID, 'goals', [role && `Role: ${role}`, objectives && `Objectives: ${objectives}`].filter(Boolean).join('\n'), settings.uiLocale, now);
    await memory.setUserFact(USER_PROFILE_ID, 'profile', profile, settings.uiLocale, now);
    await requestPersistentStorage();
    await updateSettings({ role, objectives, onboarded: true, privacyConsentAt: now });
    navigate('');
  };

  return (
    <Page title={t('onboarding.title')}>
      <p className="lead">{t('onboarding.lead')}</p>

      <section className="card stack">
        <h2>{t('onboarding.language')}</h2>
        <Choice<AppLocale>
          legend={t('settings.uiLocale')}
          value={settings.uiLocale}
          options={LOCALES.map((l) => ({ value: l, label: t(`locale.${l}`) }))}
          onChange={(l) => void updateSettings({ uiLocale: l, spokenLocale: l, contentLocale: l })}
        />
      </section>

      <section className="card stack">
        <h2>{t('onboarding.you')}</h2>
        <Field label={t('onboarding.role')} hint={t('onboarding.roleHint')}>
          <input value={role} onChange={(e) => setRole(e.target.value)} maxLength={USER_TEXT_LIMITS.role} />
        </Field>
        <Field label={t('onboarding.objectives')} hint={t('onboarding.objectivesHint')}>
          <textarea rows={5} value={objectives} onChange={(e) => setObjectives(e.target.value)} maxLength={USER_TEXT_LIMITS.objectives} />
        </Field>
        <Field label={t('onboarding.profile')} hint={t('onboarding.profileHint')}>
          <textarea rows={8} value={profile} onChange={(e) => setProfile(e.target.value)} maxLength={USER_TEXT_LIMITS.profile} />
        </Field>
      </section>

      <section className="card stack">
        <h2>{t('onboarding.provider')}</h2>
        <ProviderForm
          provider={settings.provider}
          persistApiKey={settings.persistApiKey}
          onChange={(provider) => void updateSettings({ provider })}
          onPersistChange={(persistApiKey) => void updateSettings({ persistApiKey })}
        />
      </section>

      <section className="card stack">
        <h2>{t('onboarding.privacy')}</h2>
        <ul>
          <li>{t('privacy.local')}</li>
          <li>{t('privacy.provider')}</li>
          <li>{t('privacy.keys')}</li>
          <li>{t('privacy.speech')}</li>
          <li>{t('privacy.eviction')}</li>
          <li>{t('privacy.notTherapy')}</li>
        </ul>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          {t('onboarding.consent')}
        </label>
      </section>

      {!consent && <Notice>{t('onboarding.consentRequired')}</Notice>}
      <button type="button" className="btn btn-primary btn-large" disabled={!consent} onClick={() => void finish()}>
        {t('onboarding.finish')}
      </button>
    </Page>
  );
}
