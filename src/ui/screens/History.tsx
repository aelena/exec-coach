import { useState } from 'react';
import { deleteSession } from '../../app/services';
import type { Difficulty, InteractionMode, SessionRecord } from '../../domain/types';
import { formatDateTime, formatDuration, useT } from '../../i18n';
import { compareSessions } from '../../insights/insights';
import { repo } from '../../storage/db';
import { actorNamer, navigate, Notice, Page, ScoreBar, sessionTitle, Transcript, useApp, useAsync } from '../common';
import { CompletedActions, SessionResults } from './Session';

export function History() {
  const t = useT();
  const { settings } = useApp();
  const { data: sessions } = useAsync(() => repo.all('sessions'), []);
  const [mode, setMode] = useState<InteractionMode | ''>('');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  const list = (sessions ?? [])
    .filter((s) => s.status !== 'created' && (!mode || s.interactionMode === mode) && (!difficulty || s.difficulty === difficulty))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <Page title={t('nav.history')}>
      <div className="row wrap">
        <select value={mode} onChange={(e) => setMode(e.target.value as InteractionMode | '')} aria-label={t('setup.mode')}>
          <option value="">{t('filter.allModes')}</option>
          <option value="walk">{t('mode.walk')}</option>
          <option value="desktop">{t('mode.desktop')}</option>
        </select>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | '')} aria-label={t('setup.difficulty')}>
          <option value="">{t('filter.allDifficulties')}</option>
          {(['easy', 'medium', 'hard'] as const).map((d) => (
            <option key={d} value={d}>
              {t(`difficulty.${d}`)}
            </option>
          ))}
        </select>
      </div>
      {sessions && list.length === 0 && <p className="muted">{t('history.empty')}</p>}
      <ul className="list">
        {list.map((s) => (
          <li key={s.id}>
            <a className="list-item" href={`#/history/${s.id}`}>
              <strong>{sessionTitle(s)}</strong>
              <span className="muted small">
                {formatDateTime(settings.uiLocale, s.createdAt)} · {t(`mode.${s.interactionMode}`)} · {t(`difficulty.${s.difficulty}`)} · {t(`status.${s.status}`)}
                {s.replayOf ? ` · ${t('history.replay')}` : ''}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Page>
  );
}

export function SessionDetail({ id }: { id: string }) {
  const t = useT();
  const { settings } = useApp();
  const { data } = useAsync(async () => {
    const all = await repo.all('sessions');
    const record = all.find((s) => s.id === id);
    const root = record?.replayOf ?? id;
    return { record, family: all.filter((s) => s.id !== id && (s.id === root || s.replayOf === root) && s.status === 'completed') };
  }, [id]);
  const [confirming, setConfirming] = useState(false);
  if (!data) return <Page title={t('nav.history')} back="history">{null}</Page>;
  const { record, family } = data;
  if (!record) return <Page title={t('session.notFound')} back="history">{null}</Page>;
  const turnIndex = (turnId: string) => (record.turns.find((x) => x.id === turnId)?.index ?? 0) + 1;

  return (
    <Page title={sessionTitle(record)} back="history">
      <p className="muted">
        {formatDateTime(settings.uiLocale, record.createdAt)} · {t(`mode.${record.interactionMode}`)} · {t(`difficulty.${record.difficulty}`)} ·{' '}
        {t(`coaching.${record.coachingMode}`)} · {t('history.activeTime', { time: formatDuration(record.activeElapsedSeconds) })} ·{' '}
        {t('history.pausedTime', { time: formatDuration(record.pausedElapsedSeconds) })}
      </p>
      <p className="muted small">
        {t('history.models', { provider: record.models.provider, actor: record.models.actorModel, coach: record.models.coachModel })}
      </p>
      {record.status !== 'completed' && record.status !== 'aborted' && (
        <a className="btn btn-primary" href={`#/session/${record.id}`}>
          {t('home.resume')}
        </a>
      )}
      <section className="card">
        <h3>{t('session.transcript')}</h3>
        <Transcript record={record} actorName={actorNamer(record)} />
      </section>
      {record.socratic && (
        <section className="card">
          <h3>{t('coaching.socratic_review')}</h3>
          <p>{record.socratic.question}</p>
          {record.socratic.answer && <blockquote className="quote">{record.socratic.answer}</blockquote>}
        </section>
      )}
      <SessionResults record={record} />
      {record.causalEvents.length > 0 && (
        <section className="card">
          <h3>{t('history.causalEvents')}</h3>
          <p className="muted small">{t('history.causalNote')}</p>
          <ul>
            {record.causalEvents.map((e) => (
              <li key={e.id}>
                <span className={`tag tag-${e.epistemicStatus}`}>{t(`epistemic.${e.epistemicStatus}`)}</span> {t(`eventType.${e.eventType}`)} ·{' '}
                {t('dialogue.turns')} #{turnIndex(e.turnId)}
                {e.scenarioFactRefs.length > 0 && ` · ${e.scenarioFactRefs.join(', ')}`}
                {e.explanationFactors.length > 0 && ` · ${e.explanationFactors.map((f) => t(`factor.${f}`)).join(', ')}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {family.length > 0 && (
        <section className="card">
          <h3>{t('history.compareWith')}</h3>
          <ul>
            {family.map((other) => (
              <li key={other.id}>
                <a href={`#/compare/${record.id}/${other.id}`}>{formatDateTime(settings.uiLocale, other.createdAt)}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {record.status === 'completed' && <CompletedActions record={record} />}
      <div className="row">
        {confirming ? (
          <>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void deleteSession(record.id).then(() => navigate('history'))}
            >
              {t('history.confirmDelete')}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              {t('action.cancel')}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-link" onClick={() => setConfirming(true)}>
            {t('history.delete')}
          </button>
        )}
      </div>
    </Page>
  );
}

export function Compare({ a, b }: { a: string; b: string }) {
  const t = useT();
  const { settings } = useApp();
  const { data } = useAsync(async () => [await repo.get('sessions', a), await repo.get('sessions', b)] as const, [a, b]);
  if (!data) return <Page title={t('compare.title')} back="history">{null}</Page>;
  const [first, second] = [...data].sort((x, y) => (x?.createdAt ?? '').localeCompare(y?.createdAt ?? '')) as [SessionRecord | undefined, SessionRecord | undefined];
  if (!first || !second) return <Page title={t('session.notFound')} back="history">{null}</Page>;
  const { rows, sameFacts } = compareSessions(first, second);
  const label = (s: SessionRecord) => formatDateTime(settings.uiLocale, s.createdAt);
  return (
    <Page title={t('compare.title')} back={`history/${a}`}>
      <p>{sessionTitle(first)}</p>
      <Notice kind={sameFacts ? 'info' : 'warn'}>{sameFacts ? t('compare.sameFacts') : t('compare.differentFacts')}</Notice>
      <Notice kind="warn">{t('compare.caveat')}</Notice>
      <table className="scores compare">
        <thead>
          <tr>
            <th scope="col">{t('dashboard.skill')}</th>
            <th scope="col">A · {label(first)}</th>
            <th scope="col">B · {label(second)}</th>
            <th scope="col">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .filter((r) => r.a !== null || r.b !== null)
            .map((r) => (
              <tr key={r.skill}>
                <th scope="row">{t(`skill.${r.skill}`)}</th>
                <td>
                  <ScoreBar value={r.a} />
                </td>
                <td>
                  <ScoreBar value={r.b} />
                </td>
                <td>{r.delta === null ? '–' : `${r.delta > 0 ? '+' : ''}${r.delta.toFixed(1)}`}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="two-col">
        {[first, second].map((s, i) => (
          <section key={s.id} className="card">
            <h3>
              {i === 0 ? 'A' : 'B'} · <a href={`#/history/${s.id}`}>{label(s)}</a>
            </h3>
            <p className="muted small">
              {t('session.finalStance')}: {s.outcome.finalStance ? t(`stance.${s.outcome.finalStance}`) : '–'}
            </p>
            <Transcript record={s} actorName={actorNamer(s)} />
          </section>
        ))}
      </div>
    </Page>
  );
}
