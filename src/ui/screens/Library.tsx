import { useState } from 'react';
import { nowIso } from '../../app/services';
import { templateFor } from '../../content/builtin';
import type { ContentKind, Issue } from '../../content/markdown';
import { readPack, type PackEntryResult } from '../../content/pack';
import { newId, QUESTION_CATEGORIES, SCHEMA_VERSION, type PowerQuestion, type QuestionCategory } from '../../domain/types';
import { useT } from '../../i18n';
import { downloadBlob } from '../../storage/backup';
import { repo } from '../../storage/db';
import { Field, Notice, Page, readFileBytes, useApp, useAsync } from '../common';

const KINDS: ContentKind[] = ['actor', 'scenario', 'coach', 'profile'];

function isQuestion(value: unknown): value is PowerQuestion {
  const q = value as PowerQuestion;
  return Boolean(q) && typeof q.text === 'string' && q.text.trim() !== '' && (QUESTION_CATEGORIES as readonly string[]).includes(q.category);
}

function Questions() {
  const t = useT();
  const { settings } = useApp();
  const { data: all, reload } = useAsync(() => repo.all('questions'), []);
  const [category, setCategory] = useState<QuestionCategory | ''>('');
  const [editing, setEditing] = useState<PowerQuestion | null>(null);
  const [message, setMessage] = useState('');
  const locale = settings.contentLocale;
  const list = (all ?? []).filter((q) => q.locale === locale && (!category || q.category === category)).sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));

  const blank = (): PowerQuestion => ({
    id: newId('pq'),
    schemaVersion: SCHEMA_VERSION,
    category: category || 'assumptions',
    locale,
    text: '',
    whenToUse: '',
    whenNotToUse: '',
    skills: [],
    builtin: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  const save = async () => {
    if (!editing || !editing.text.trim()) return;
    await repo.put('questions', { ...editing, text: editing.text.trim(), updatedAt: nowIso() });
    setEditing(null);
    reload();
  };
  const importFile = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const candidates = (Array.isArray(parsed) ? parsed : []).filter(isQuestion);
      const existing = new Set((all ?? []).map((q) => q.id));
      // Imported questions never overwrite existing ones: colliding ids get a fresh id.
      const records = candidates.map((q) => ({
        ...q,
        id: typeof q.id === 'string' && !existing.has(q.id) ? q.id : newId('pq'),
        schemaVersion: SCHEMA_VERSION,
        builtin: false,
        skills: Array.isArray(q.skills) ? q.skills : [],
        whenToUse: String(q.whenToUse ?? ''),
        whenNotToUse: String(q.whenNotToUse ?? ''),
        locale: q.locale === 'en' || q.locale === 'es-ES' ? q.locale : locale,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }));
      await repo.putMany('questions', records);
      setMessage(t('library.imported', { count: records.length }));
      reload();
    } catch {
      setMessage(t('error.backup_unreadable'));
    }
  };

  return (
    <section className="stack">
      <div className="row wrap">
        <select value={category} onChange={(e) => setCategory(e.target.value as QuestionCategory | '')} aria-label={t('library.category')}>
          <option value="">{t('library.allCategories')}</option>
          {QUESTION_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={() => setEditing(blank())}>
          {t('library.addQuestion')}
        </button>
        <button type="button" className="btn" onClick={() => downloadBlob(JSON.stringify(all ?? [], null, 2), 'power-questions.json', 'application/json')}>
          {t('library.exportQuestions')}
        </button>
        <label className="btn">
          {t('library.importQuestions')}
          <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </label>
      </div>
      {message && <Notice>{message}</Notice>}
      {editing && (
        <div className="card stack">
          <Field label={t('library.question')}>
            <textarea rows={2} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
          </Field>
          <Field label={t('library.category')}>
            <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as QuestionCategory })}>
              {QUESTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`category.${c}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('library.whenToUse')}>
            <textarea rows={2} value={editing.whenToUse} onChange={(e) => setEditing({ ...editing, whenToUse: e.target.value })} />
          </Field>
          <Field label={t('library.whenNotToUse')}>
            <textarea rows={2} value={editing.whenNotToUse} onChange={(e) => setEditing({ ...editing, whenNotToUse: e.target.value })} />
          </Field>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!editing.text.trim()}>
              {t('action.save')}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              {t('action.cancel')}
            </button>
          </div>
        </div>
      )}
      <ul className="list">
        {list.map((q) => (
          <li key={q.id} className="card">
            <p>
              <span className="tag">{t(`category.${q.category}`)}</span> <strong>{q.text}</strong>
            </p>
            {q.whenToUse && (
              <p className="small">
                <em>{t('library.whenToUse')}:</em> {q.whenToUse}
              </p>
            )}
            {q.whenNotToUse && (
              <p className="small">
                <em>{t('library.whenNotToUse')}:</em> {q.whenNotToUse}
              </p>
            )}
            <div className="row">
              <button type="button" className="btn btn-small" onClick={() => setEditing(q)}>
                {t('action.edit')}
              </button>
              <button type="button" className="btn btn-small" onClick={() => void repo.delete('questions', q.id).then(reload)}>
                {t('action.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Issues({ issues }: { issues: Issue[] }) {
  const t = useT();
  return (
    <ul className="small">
      {issues.map((issue, i) => (
        <li key={i}>{t(`validation.${issue.code}`, issue.params)}</li>
      ))}
    </ul>
  );
}

function Content() {
  const t = useT();
  const { settings, registry, reloadRegistry } = useApp();
  const [results, setResults] = useState<PackEntryResult[]>([]);
  const [open, setOpen] = useState('');
  const locale = settings.contentLocale;

  const importFiles = async (files: FileList) => {
    const collected: PackEntryResult[] = [];
    for (const file of Array.from(files)) collected.push(...readPack(file.name, await readFileBytes(file), nowIso()));
    // Imported packs are stored exactly as provided: no automatic translation, no silent fixes.
    await repo.putMany('customContent', collected.flatMap((r) => (r.record ? [r.record] : [])));
    setResults(collected);
    await reloadRegistry();
  };
  const remove = async (key: string) => {
    await repo.delete('customContent', key);
    await reloadRegistry();
  };

  return (
    <section className="stack">
      <p className="muted">{t('library.contentLead')}</p>
      <div className="row wrap">
        <label className="btn btn-primary">
          {t('library.importContent')}
          <input type="file" accept=".md,.zip,text/markdown,application/zip" multiple hidden onChange={(e) => e.target.files && void importFiles(e.target.files)} />
        </label>
        {KINDS.map((kind) => (
          <button key={kind} type="button" className="btn btn-small" onClick={() => downloadBlob(templateFor(kind, locale), `${kind}.template.md`, 'text/markdown')}>
            {t('library.template', { kind: t(`kind.${kind}`) })}
          </button>
        ))}
      </div>
      {results.map((r) => (
        <Notice key={r.name} kind={r.ok ? 'info' : 'error'}>
          <strong>{r.name}</strong>: {r.ok ? t('library.importOk', { id: r.record!.id, language: r.record!.language }) : t('library.importFailed')}
          {!r.ok && <Issues issues={r.errors} />}
          {r.warnings.length > 0 && <Issues issues={r.warnings} />}
        </Notice>
      ))}
      {registry.problems.length > 0 && (
        <Notice kind="error">
          {t('library.invalidContent')}
          <ul className="small">
            {registry.problems.map((p) => (
              <li key={p.path}>
                {p.path}: {p.errors.map((e) => t(`validation.${e.code}`, e.params)).join('; ')}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {KINDS.map((kind) => (
        <div key={kind} className="card">
          <h3>{t(`kind.${kind}`)}</h3>
          <ul className="list">
            {registry.list(kind, locale).map((r) => {
              const key = `${kind}:${r.doc.id}`;
              return (
                <li key={key}>
                  <button type="button" className="list-item" aria-expanded={open === key} onClick={() => setOpen(open === key ? '' : key)}>
                    <strong>{r.doc.title}</strong>
                    <span className="muted small">
                      {r.doc.id} · v{r.doc.version} · {registry.languagesOf(kind, r.doc.id).join(', ')}
                      {r.custom ? ` · ${t('library.custom')}` : ''}
                      {r.fallbackFrom ? ` · ${t('content.fallback', { language: r.fallbackFrom })}` : ''}
                    </span>
                  </button>
                  {open === key && (
                    <div className="stack">
                      <pre className="source">{r.doc.source}</pre>
                      <div className="row">
                        <button type="button" className="btn btn-small" onClick={() => downloadBlob(r.doc.source, `${r.doc.id}.${r.doc.language}.md`, 'text/markdown')}>
                          {t('action.download')}
                        </button>
                        {r.custom && (
                          <button type="button" className="btn btn-small" onClick={() => void remove(`${kind}:${r.doc.id}:${r.doc.language}`)}>
                            {t('action.delete')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function Library() {
  const t = useT();
  const [tab, setTab] = useState<'questions' | 'content'>('questions');
  return (
    <Page title={t('nav.library')}>
      <div className="tabs" role="tablist">
        {(['questions', 'content'] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' tab-on' : ''}`} onClick={() => setTab(id)}>
            {t(`library.tab.${id}`)}
          </button>
        ))}
      </div>
      {tab === 'questions' ? <Questions /> : <Content />}
    </Page>
  );
}
