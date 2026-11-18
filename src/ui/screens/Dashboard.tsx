import { useState } from 'react';
import { memory, nowIso, USER_GOALS_ID, USER_PROFILE_ID } from '../../app/services';
import { USER_TEXT_LIMITS } from '../../domain/types';
import type { Difficulty, InteractionMode, MemoryRecord, MemoryScope, SourceRef, SwotItem } from '../../domain/types';
import { formatDateTime, useT } from '../../i18n';
import { buildSwot, computeStats, detectPlateau, filterSessions, isEvaluable } from '../../insights/insights';
import { repo } from '../../storage/db';
import { Notice, Page, ScoreBar, useApp, useAsync } from '../common';

function Refs({ refs }: { refs: SourceRef[] }) {
  const ids = [...new Set(refs.map((r) => r.sessionId))];
  if (ids.length === 0) return null;
  return (
    <span className="small">
      {ids.map((id, i) => (
        <a key={id} href={`#/history/${id}`} className="ref">
          [{i + 1}]
        </a>
      ))}
    </span>
  );
}

export function Dashboard() {
  const t = useT();
  const { settings, registry } = useApp();
  const { data: sessions, reload } = useAsync(() => repo.all('sessions'), []);
  const { data: snapshots, reload: reloadSwot } = useAsync(() => repo.all('swot'), []);
  const [actorId, setActorId] = useState('');
  const [mode, setMode] = useState<InteractionMode | ''>('');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  if (!sessions) return <Page title={t('nav.dashboard')}>{null}</Page>;

  const h = settings.heuristics;
  const filtered = filterSessions(sessions, { actorId: actorId || undefined, mode: mode || undefined, difficulty: difficulty || undefined });
  const stats = computeStats(filtered, h);
  const signals = detectPlateau(sessions);
  const swot = buildSwot(sessions, h, nowIso());
  const lastSaved = [...(snapshots ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const evaluable = sessions.filter(isEvaluable).length;
  const quadrants: Array<SwotItem['quadrant']> = ['strength', 'weakness', 'opportunity', 'threat'];

  const saveSwot = async () => {
    // Revisions are retained: each saved snapshot is kept alongside earlier ones.
    await repo.put('swot', swot);
    reloadSwot();
    reload();
  };

  return (
    <Page title={t('nav.dashboard')}>
      <div className="row wrap">
        <select value={actorId} onChange={(e) => setActorId(e.target.value)} aria-label={t('filter.actor')}>
          <option value="">{t('filter.allActors')}</option>
          {registry.list('actor', settings.contentLocale).map((a) => (
            <option key={a.doc.id} value={a.doc.id}>
              {a.doc.title}
            </option>
          ))}
        </select>
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

      <dl className="tiles">
        <div className="tile">
          <dt>{t('dashboard.sessions')}</dt>
          <dd>{stats.sessionCount}</dd>
        </div>
        <div className="tile">
          <dt>{t('dashboard.activeMinutes')}</dt>
          <dd>{stats.activeMinutes}</dd>
        </div>
        <div className="tile">
          <dt>{t('dashboard.oralRatio')}</dt>
          <dd>{stats.oralRatio === null ? '–' : `${Math.round(stats.oralRatio * 100)}%`}</dd>
          <span className="muted small">{t('dashboard.oralTarget', { target: Math.round(h.oralTargetRatio * 100) })}</span>
        </div>
        <div className="tile">
          <dt>{t('dashboard.retries')}</dt>
          <dd>{stats.retries + stats.replays}</dd>
        </div>
      </dl>

      <section className="card">
        <h2>{t('dashboard.skills')}</h2>
        {stats.evaluableCount < h.sampleWarningBelow && <Notice kind="warn">{t('dashboard.sparse', { count: stats.evaluableCount, min: h.sampleWarningBelow })}</Notice>}
        <table className="scores">
          <thead>
            <tr>
              <th scope="col">{t('dashboard.skill')}</th>
              <th scope="col">{t('dashboard.mean')}</th>
              <th scope="col">{t('dashboard.evidence')}</th>
              <th scope="col">{t('dashboard.trend')}</th>
            </tr>
          </thead>
          <tbody>
            {stats.skills.map((s) => (
              <tr key={s.skill} className={s.lowEvidence ? 'low-evidence' : ''}>
                <th scope="row">{t(`skill.${s.skill}`)}</th>
                <td>
                  <ScoreBar value={s.mean} />
                </td>
                <td className="small">
                  {t('dashboard.observations', { turns: s.n, sessions: s.sessions })}
                  {s.lowEvidence && s.n > 0 && ` · ${t('dashboard.lowEvidence')}`}
                </td>
                <td className="small">{t(`trend.${s.trend}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">{t('dashboard.scoreNote')}</p>
      </section>

      {signals.length > 0 && (
        <section className="card">
          <h2>{t('dashboard.signals')}</h2>
          <ul>
            {signals.map((s) => (
              <li key={s.key}>
                {t(s.key, s.params)} <Refs refs={s.refs} />
              </li>
            ))}
          </ul>
          <p className="muted small">{t('dashboard.signalsNote')}</p>
        </section>
      )}

      <section className="card">
        <h2>{t('swot.title')}</h2>
        <p>{t(`swot.stage.${swot.stage}`, { count: evaluable, hypothesize: h.swotHypothesizeAt, provisional: h.swotProvisionalAt })}</p>
        <p className="muted small">{t('swot.disclaimer')}</p>
        {swot.stage !== 'observe' &&
          quadrants.map((q) => {
            const items = swot.items.filter((i) => i.quadrant === q);
            if (items.length === 0) return null;
            return (
              <div key={q}>
                <h3>{t(`swot.quadrant.${q}`)}</h3>
                <ul>
                  {items.map((item) => (
                    <li key={item.id}>
                      {t(item.claimKey, { ...item.claimParams, skill: item.claimParams.skill ? t(`skill.${item.claimParams.skill}`) : '' })}{' '}
                      <span className="muted small">
                        ({t(`swot.status.${item.status}`)}, {t(`confidence.${item.confidence}`)}, {t(`trend.${item.trend}`)})
                      </span>{' '}
                      <Refs refs={item.behavioralEvidence} />
                      {item.counterEvidence.length > 0 && (
                        <span className="small">
                          {' '}
                          · {t('swot.counterexamples')} <Refs refs={item.counterEvidence} />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        {swot.stage !== 'observe' && (
          <div className="row wrap">
            <button type="button" className="btn" onClick={() => void saveSwot()}>
              {t('swot.saveSnapshot')}
            </button>
            {lastSaved && (
              <span className="muted small">
                {t('swot.lastSaved', { date: formatDateTime(settings.uiLocale, lastSaved.createdAt), count: snapshots?.length ?? 0 })}
              </span>
            )}
          </div>
        )}
      </section>

      <a className="btn" href="#/memory">
        {t('memory.title')}
      </a>
    </Page>
  );
}

const SCOPES: MemoryScope[] = ['user', 'coach', 'long_term', 'entity'];

/** Memory inspection: everything the app remembers, with provenance. Facts are editable; coaching is challenged in dialogue. */
export function MemoryScreen() {
  const t = useT();
  const { settings, updateSettings } = useApp();
  const { data: records, reload } = useAsync(() => memory.inspect(), []);
  const [profile, setProfile] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const byScope = (scope: MemoryScope) =>
    (records ?? []).filter((m) => m.scope === scope).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const profileRecord = records?.find((m) => m.id === USER_PROFILE_ID);
  const profileText = profile ?? profileRecord?.content ?? '';

  const saveProfile = async () => {
    await memory.setUserFact(USER_PROFILE_ID, 'profile', profileText, settings.uiLocale, nowIso());
    setProfile(null);
    reload();
  };
  const rebuild = async () => {
    const result = await memory.rebuildReferences(new Set((await repo.all('sessions')).map((s) => s.id)));
    setMessage(t('memory.rebuilt', result));
    reload();
  };
  const row = (m: MemoryRecord) => (
    <li key={m.id} className={m.status === 'superseded' ? 'superseded' : ''}>
      <p>{m.content}</p>
      <p className="muted small">
        {m.kind} · {t(`memory.status.${m.status}`)} · {t(`memory.visibility.${m.visibility}`)}
        {m.confidence !== undefined && ` · ${t('memory.confidence', { value: m.confidence.toFixed(2) })}`} ·{' '}
        {formatDateTime(settings.uiLocale, m.updatedAt)} <Refs refs={m.sourceRefs} />
        {m.supersedes.length > 0 && ` · ${t('memory.supersedes', { count: m.supersedes.length })}`}
      </p>
      {m.id !== USER_PROFILE_ID && m.id !== USER_GOALS_ID && (
        <button type="button" className="btn btn-small" onClick={() => void memory.delete(m.id).then(reload)}>
          {t('memory.delete')}
        </button>
      )}
    </li>
  );

  return (
    <Page title={t('memory.title')} back="dashboard">
      <p className="lead">{t('memory.lead')}</p>
      <label className="check">
        <input type="checkbox" checked={settings.personalizationEnabled} onChange={(e) => void updateSettings({ personalizationEnabled: e.target.checked })} />
        {t('memory.personalization')}
      </label>
      <p className="muted small">{t('memory.shortTermNote')}</p>
      {message && <Notice>{message}</Notice>}

      <section className="card stack">
        <h2>{t('scope.user')}</h2>
        <p className="muted small">{t('memory.userHint')}</p>
        <textarea rows={8} maxLength={USER_TEXT_LIMITS.profile} value={profileText} aria-label={t('onboarding.profile')} onChange={(e) => setProfile(e.target.value)} />
        <button type="button" className="btn" disabled={profile === null} onClick={() => void saveProfile()}>
          {t('action.save')}
        </button>
        <ul className="memory-list">{byScope('user').filter((m) => m.id !== USER_PROFILE_ID).map(row)}</ul>
      </section>

      {SCOPES.filter((s) => s !== 'user').map((scope) => (
        <section className="card" key={scope}>
          <h2>{t(`scope.${scope}`)}</h2>
          <p className="muted small">{t(`scopeHint.${scope}`)}</p>
          {byScope(scope).length === 0 ? <p className="muted">{t('memory.empty')}</p> : <ul className="memory-list">{byScope(scope).map(row)}</ul>}
        </section>
      ))}
      <button type="button" className="btn" onClick={() => void rebuild()}>
        {t('memory.rebuild')}
      </button>
    </Page>
  );
}
