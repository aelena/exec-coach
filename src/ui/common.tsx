import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ContentRegistry } from '../content/registry';
import type { AppSettings, Evaluation, SessionRecord, StoredEvaluation } from '../domain/types';
import { SKILLS } from '../domain/types';
import { useT } from '../i18n';

export interface AppState {
  settings: AppSettings;
  registry: ContentRegistry;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  reloadRegistry(): Promise<void>;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext missing');
  return ctx;
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** Loads async data and reloads when `deps` change or `reload()` is called. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): { data: T | undefined; reload(): void } {
  const [data, setData] = useState<T>();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    void load().then((value) => {
      if (alive) setData(value);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return { data, reload: () => setVersion((v) => v + 1) };
}

export function Page({ title, back, children }: { title: string; back?: string; children: ReactNode }) {
  const t = useT();
  return (
    <main className="page" id="main">
      <header className="page-header">
        {back !== undefined && (
          <a className="back" href={`#/${back}`} aria-label={t('action.back')}>
            ←
          </a>
        )}
        <h1>{title}</h1>
      </header>
      {children}
    </main>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange(value: T): void;
}) {
  return (
    <fieldset className="choice">
      <legend>{legend}</legend>
      <div className="choice-options">
        {options.map((o) => (
          <label key={o.value} className={`chip${value === o.value ? ' chip-on' : ''}${o.disabled ? ' chip-off' : ''}`}>
            <input type="radio" name={legend} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ScoreBar({ value, max = 4 }: { value: number | null; max?: number }) {
  const t = useT();
  if (value === null) return <span className="muted">{t('eval.notObserved')}</span>;
  return (
    <span className="scorebar" role="img" aria-label={`${value.toFixed(1)} / ${max}`}>
      <span className="scorebar-track">
        <span className="scorebar-fill" style={{ width: `${(value / max) * 100}%` }} />
      </span>
      <span className="scorebar-value">{value.toFixed(1)}</span>
    </span>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h4>{title}</h4>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function EvaluationCard({ stored, turnText }: { stored: StoredEvaluation; turnText?: string }) {
  const t = useT();
  const e: Evaluation = stored.evaluation;
  const scored = SKILLS.filter((s) => typeof e.scores[s] === 'number');
  return (
    <article className="card evaluation">
      {turnText && <blockquote className="quote">{turnText}</blockquote>}
      {e.insufficientContext && <Notice kind="warn">{t('eval.insufficientContext')}</Notice>}
      {scored.length > 0 && (
        <table className="scores">
          <tbody>
            {scored.map((skill) => (
              <tr key={skill}>
                <th scope="row">{t(`skill.${skill}`)}</th>
                <td>
                  <ScoreBar value={e.scores[skill] as number} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <List title={t('eval.strengths')} items={e.strengths} />
      <List title={t('eval.risks')} items={e.risks} />
      <List title={t('eval.missedAssumptions')} items={e.missedAssumptions} />
      <List title={t('eval.evidence')} items={e.evidenceQuotes.map((q) => `«${q}»`)} />
      <section>
        <h4>{t('eval.reframe')}</h4>
        {e.reframe.needed && e.reframe.suggestion ? <p className="reframe">{e.reframe.suggestion}</p> : <p>{t('eval.noReframeNeeded')}</p>}
        {e.reframe.rationale && <p className="muted">{e.reframe.rationale}</p>}
      </section>
      {e.recommendedAction && (
        <section>
          <h4>{t('eval.nextAction')}</h4>
          <p>{e.recommendedAction}</p>
        </section>
      )}
      <p className="muted small">
        {t('eval.confidence', { level: t(`confidence.${e.confidence}`) })}
        {stored.droppedQuotes.length > 0 && ` · ${t('eval.droppedQuotes', { count: stored.droppedQuotes.length })}`}
      </p>
    </article>
  );
}

export function Transcript({ record, actorName }: { record: SessionRecord; actorName(id: string | undefined): string }) {
  const t = useT();
  return (
    <ol className="transcript" aria-label={t('session.transcript')}>
      {record.turns.map((turn) => (
        <li key={turn.id} className={`turn turn-${turn.role}${turn.superseded ? ' turn-superseded' : ''}`}>
          <span className="turn-speaker">
            {turn.role === 'user' ? t('session.you') : turn.role === 'narrator' ? t('session.narrator') : actorName(turn.actorId)}
            {turn.superseded && ` · ${t('session.retried')}`}
          </span>
          <span className="turn-text">{turn.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function sessionTitle(record: SessionRecord): string {
  const source = record.snapshots.find((s) => s.kind === 'scenario')?.source ?? '';
  return /^#\s+(.+)$/m.exec(source)?.[1] ?? record.scenarioId;
}

export function actorNamer(record: SessionRecord): (id: string | undefined) => string {
  const names = new Map<string, string>();
  for (const s of record.snapshots) {
    if (s.kind === 'actor') names.set(s.id, /^name:\s*(.+)$/m.exec(s.source)?.[1]?.trim() ?? s.id);
  }
  return (id) => names.get(id ?? '') ?? id ?? '';
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
