import { useEffect, useRef, useState } from 'react';
import { createDebrief } from '../../app/services';
import type { DebriefService } from '../../debrief/debriefService';
import type { CoachDialogue, SessionRecord } from '../../domain/types';
import { useT } from '../../i18n';
import { ProviderError } from '../../llm/provider';
import { repo } from '../../storage/db';
import { actorNamer, Notice, Page, sessionTitle, Transcript, useApp } from '../common';

/** Untimed post-training dialogue with the coach: causal questions, labelled answers, turn citations. */
export function DialogueScreen({ sessionId }: { sessionId: string }) {
  const t = useT();
  const { settings } = useApp();
  const [record, setRecord] = useState<SessionRecord | null>(null);
  const [dialogue, setDialogue] = useState<CoachDialogue | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [actorId, setActorId] = useState('');
  const serviceRef = useRef<DebriefService | null>(null);

  useEffect(() => {
    void (async () => {
      const session = await repo.get('sessions', sessionId);
      if (!session) return;
      setRecord(session);
      setActorId(session.actorIds[0] ?? '');
      const existing = (await repo.all('dialogues'))
        .filter((d) => d.relatedSessionIds.includes(sessionId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      try {
        const service = await createDebrief(settings);
        serviceRef.current = service;
        setDialogue(existing ?? service.create(session));
      } catch (e) {
        setDialogue(existing ?? null);
        setError(e instanceof ProviderError ? t(`error.${e.code}`) : (e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (!record) return <Page title={t('dialogue.title')} back="history">{null}</Page>;
  const actorName = actorNamer(record);
  const turnLabel = (id: string) => {
    const turn = record.turns.find((x) => x.id === id);
    return turn ? `#${turn.index + 1}` : id;
  };

  const run = async (work: (service: DebriefService, current: CoachDialogue) => Promise<CoachDialogue>) => {
    const service = serviceRef.current;
    if (!service || !dialogue || busy) return;
    setBusy(true);
    setError('');
    try {
      setDialogue(await work(service, dialogue));
    } catch (e) {
      setError(e instanceof ProviderError ? t(`error.${e.code}`) : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const askCoach = () => {
    const question = text.trim();
    if (!question) return;
    setText('');
    void run(async (service, current) => {
      const withQuestion = await service.addUserMessage(current, question);
      setDialogue(withQuestion);
      return service.coachReply(withQuestion, record);
    });
  };

  // A stored question without an answer (for example after a failed call) can be retried as-is.
  const unanswered = dialogue?.messages.at(-1)?.role === 'user';

  return (
    <Page title={t('dialogue.title')} back={`history/${record.id}`}>
      <p className="muted">
        {sessionTitle(record)} · {t('dialogue.untimed')}
      </p>
      <details className="card">
        <summary>{t('session.transcript')}</summary>
        <Transcript record={record} actorName={actorName} />
      </details>

      <ol className="dialogue" aria-live="polite">
        {dialogue?.messages.map((m) => (
          <li key={m.id} className={`msg msg-${m.role}`}>
            <span className="turn-speaker">
              {m.role === 'user' ? t('session.you') : m.role === 'coach' ? t('dialogue.coach') : t('dialogue.actorOoc')}
            </span>
            {m.segments ? (
              m.segments.map((s, i) => (
                <p key={i}>
                  {s.epistemicStatus && <span className={`tag tag-${s.epistemicStatus}`}>{t(`epistemic.${s.epistemicStatus}`)}</span>} {s.text}
                  {s.turnRefs.length > 0 && <span className="muted small"> ({t('dialogue.turns')} {s.turnRefs.map(turnLabel).join(', ')})</span>}
                </p>
              ))
            ) : (
              <p>
                {m.epistemicStatus && <span className={`tag tag-${m.epistemicStatus}`}>{t(`epistemic.${m.epistemicStatus}`)}</span>} {m.text}
              </p>
            )}
            {m.role === 'actor_ooc' && <p className="muted small">{t('dialogue.oocDisclaimer')}</p>}
          </li>
        ))}
      </ol>
      {busy && <p className="status-line">{t('session.coachThinking')}</p>}
      {error && <Notice kind="error">{error}</Notice>}
      {unanswered && !busy && (
        <button type="button" className="btn" onClick={() => void run((service, current) => service.coachReply(current, record))}>
          {t('action.retry')}
        </button>
      )}

      <section className="card stack">
        <textarea rows={3} value={text} placeholder={t('dialogue.placeholder')} aria-label={t('dialogue.placeholder')} onChange={(e) => setText(e.target.value)} />
        <div className="row wrap">
          <button type="button" className="btn btn-primary" onClick={askCoach} disabled={busy || !text.trim() || !serviceRef.current}>
            {t('dialogue.askCoach')}
          </button>
          <select value={actorId} onChange={(e) => setActorId(e.target.value)} aria-label={t('dialogue.actorOoc')}>
            {record.actorIds.map((a) => (
              <option key={a} value={a}>
                {actorName(a)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={busy || !text.trim() || !serviceRef.current}
            onClick={() => {
              const question = text.trim();
              setText('');
              void run(async (service, current) => service.actorExplanation(await service.addUserMessage(current, question), record, actorId, question));
            }}
          >
            {t('dialogue.askActor')}
          </button>
        </div>
        <p className="muted small">{t('dialogue.rules')}</p>
      </section>
    </Page>
  );
}
