import { useState } from 'react';
import { findUnfinishedSession, modelSnapshot, nowIso } from '../../app/services';
import { normalizeSkill } from '../../content/markdown';
import {
  DURATION_PRESETS_MINUTES,
  type CoachingMode,
  type Difficulty,
  type DrillType,
  type InteractionMode,
  type Skill,
} from '../../domain/types';
import { createSessionRecord, type SessionConfig } from '../../engine/sessionController';
import { useT } from '../../i18n';
import { fatigueSignal, recommendNext } from '../../insights/insights';
import { repo } from '../../storage/db';
import { speechCapabilities } from '../../speech/speechAdapter';
import { Choice, Field, navigate, Notice, Page, sessionTitle, useApp, useAsync, type AppState } from '../common';

const BACKUP_REMINDER_DAYS = 14;

export async function startSession(app: AppState, config: Omit<SessionConfig, 'locale' | 'spokenLocale' | 'contentLocale'>): Promise<void> {
  const { settings, registry } = app;
  const record = await createSessionRecord(
    { ...config, locale: settings.uiLocale, spokenLocale: settings.spokenLocale, contentLocale: settings.contentLocale },
    registry,
    modelSnapshot(settings),
    nowIso(),
  );
  await repo.put('sessions', record);
  navigate(`session/${record.id}`);
}

function scenarioSkills(app: AppState): Array<{ id: string; title: string; primarySkills: Skill[] }> {
  return app.registry.list('scenario', app.settings.contentLocale).map((s) => ({
    id: s.doc.id,
    title: s.doc.title,
    primarySkills: ((s.doc.meta.primary_skills as string[]) ?? []).map(normalizeSkill).filter((x): x is Skill => x !== null),
  }));
}

export function Home() {
  const t = useT();
  const app = useApp();
  const { settings } = app;
  const { data } = useAsync(async () => {
    const sessions = await repo.all('sessions');
    return {
      sessions,
      unfinished: await findUnfinishedSession(),
      pointers: (await repo.all('learningPointers')).filter((p) => p.status === 'pending').slice(-3),
    };
  }, []);
  const [error, setError] = useState('');
  if (!data) return <Page title={t('app.title')}>{null}</Page>;

  const scenarios = scenarioSkills(app);
  const recommendation = recommendNext(data.sessions, scenarios, settings.heuristics);
  const fatigue = fatigueSignal(data.sessions, nowIso());
  const voice = speechCapabilities();
  const completed = data.sessions.filter((s) => s.status === 'completed').length;
  const backupAgeDays = settings.lastBackupAt ? (Date.now() - Date.parse(settings.lastBackupAt)) / 86_400_000 : Infinity;
  const recommended = scenarios.find((s) => s.id === recommendation?.scenarioId);

  const quickKata = async () => {
    if (!recommendation) return;
    try {
      await startSession(app, {
        scenarioId: recommendation.scenarioId,
        interactionMode: recommendation.mode === 'walk' && voice.stt && voice.tts ? 'walk' : recommendation.mode,
        difficulty: 'medium',
        coachingMode: 'end_of_kata',
        drillType: 'quick_kata',
        plannedDurationSeconds: 5 * 60,
      });
    } catch (e) {
      setError(t(`error.${(e as Error).message}`));
    }
  };

  return (
    <Page title={t('app.title')}>
      <p className="lead">{t('home.tagline')}</p>
      {settings.provider.kind === 'demo' && (
        <Notice kind="warn">
          {t('provider.demoNotice')} <a href="#/settings">{t('nav.settings')}</a>
        </Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {fatigue && <Notice>{t(fatigue.key, fatigue.params)}</Notice>}

      {data.unfinished && (
        <section className="card stack">
          <h2>{t('home.continue')}</h2>
          <p>
            {sessionTitle(data.unfinished)} · {t(`status.${data.unfinished.status}`)}
          </p>
          <a className="btn btn-primary" href={`#/session/${data.unfinished.id}`}>
            {t('home.resume')}
          </a>
        </section>
      )}

      <section className="card stack">
        <h2>{t('home.quickKata')}</h2>
        {recommended && recommendation && (
          <p>
            <strong>{recommended.title}</strong>
            <br />
            <span className="muted">
              {t(recommendation.reasonKey, { skill: recommendation.skill ? t(`skill.${recommendation.skill}`) : '' })}
            </span>
          </p>
        )}
        <div className="row">
          <button type="button" className="btn btn-primary btn-large" onClick={() => void quickKata()} disabled={!recommendation}>
            {t('action.start')}
          </button>
          <a className="btn" href="#/setup">
            {t('home.customKata')}
          </a>
        </div>
      </section>

      {data.pointers.length > 0 && (
        <section className="card stack">
          <h2>{t('home.learningPointers')}</h2>
          <ul>
            {data.pointers.map((p) => (
              <li key={p.id}>
                <strong>{p.concept}</strong> — {p.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card stack">
        <h2>{t('mode.driving')}</h2>
        <p className="muted">{t('home.drivingHint')}</p>
        <a className="btn" href="#/driving">
          {t('home.prepareDriving')}
        </a>
      </section>

      {completed >= 3 && backupAgeDays > BACKUP_REMINDER_DAYS && (
        <Notice kind="warn">
          {t('home.backupReminder')} <a href="#/settings">{t('settings.backup')}</a>
        </Notice>
      )}
    </Page>
  );
}

const DRILL_OPTIONS: DrillType[] = ['quick_kata', 'power_question', 'reframing', 'executive_pressure', 'full_simulation'];

export function Setup() {
  const t = useT();
  const app = useApp();
  const scenarios = app.registry.list('scenario', app.settings.contentLocale);
  const voice = speechCapabilities();
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.doc.id ?? '');
  const [mode, setMode] = useState<InteractionMode>('walk');
  const [drill, setDrill] = useState<DrillType>('quick_kata');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [coaching, setCoaching] = useState<CoachingMode>('end_of_kata');
  const [minutes, setMinutes] = useState(15);
  const [error, setError] = useState('');
  const scenario = scenarios.find((s) => s.doc.id === scenarioId);

  const start = async () => {
    try {
      await startSession(app, {
        scenarioId,
        interactionMode: mode,
        difficulty,
        coachingMode: coaching,
        drillType: drill,
        plannedDurationSeconds: Math.max(1, minutes) * 60,
      });
    } catch (e) {
      setError(t(`error.${(e as Error).message}`));
    }
  };

  return (
    <Page title={t('setup.title')} back="">
      {error && <Notice kind="error">{error}</Notice>}
      <section className="card stack">
        <Field label={t('setup.scenario')}>
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            {scenarios.map((s) => (
              <option key={s.doc.id} value={s.doc.id}>
                {s.doc.title}
              </option>
            ))}
          </select>
        </Field>
        {scenario && <p className="muted">{scenario.doc.sections.find((s) => s.heading.toLowerCase() === 'setting')?.body}</p>}
        {scenario?.fallbackFrom && <Notice kind="warn">{t('content.fallback', { language: scenario.fallbackFrom })}</Notice>}

        <Choice<InteractionMode>
          legend={t('setup.mode')}
          value={mode}
          options={[
            { value: 'walk', label: t('mode.walk') },
            { value: 'desktop', label: t('mode.desktop') },
          ]}
          onChange={setMode}
        />
        {mode === 'walk' && !(voice.stt && voice.tts) && <Notice kind="warn">{t('speech.unsupported')}</Notice>}
        <Choice<DrillType> legend={t('setup.drill')} value={drill} options={DRILL_OPTIONS.map((d) => ({ value: d, label: t(`drill.${d}`) }))} onChange={setDrill} />
        <p className="muted small">{t(`drillHint.${drill}`)}</p>
        <Choice<Difficulty>
          legend={t('setup.difficulty')}
          value={difficulty}
          options={(['easy', 'medium', 'hard'] as const).map((d) => ({ value: d, label: t(`difficulty.${d}`) }))}
          onChange={setDifficulty}
        />
        <p className="muted small">{t(`difficultyHint.${difficulty}`)}</p>
        <Choice<CoachingMode>
          legend={t('setup.coaching')}
          value={coaching}
          options={(['immediate', 'end_of_kata', 'socratic_review'] as const).map((c) => ({ value: c, label: t(`coaching.${c}`) }))}
          onChange={setCoaching}
        />
        <fieldset className="choice">
          <legend>{t('setup.duration')}</legend>
          <div className="choice-options">
            {DURATION_PRESETS_MINUTES.map((m) => (
              <button type="button" key={m} className={`chip${minutes === m ? ' chip-on' : ''}`} onClick={() => setMinutes(m)}>
                {t('setup.minutes', { minutes: m })}
              </button>
            ))}
            <input
              className="chip-input"
              type="number"
              min={1}
              max={600}
              value={minutes}
              aria-label={t('setup.customMinutes')}
              onChange={(e) => setMinutes(Number(e.target.value) || 1)}
            />
          </div>
          {minutes >= 120 && <p className="muted small">{t('setup.longBudget')}</p>}
        </fieldset>
      </section>
      <button type="button" className="btn btn-primary btn-large" onClick={() => void start()} disabled={!scenarioId}>
        {t('action.start')}
      </button>
    </Page>
  );
}
