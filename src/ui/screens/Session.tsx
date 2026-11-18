import { useEffect, useMemo, useRef, useState } from 'react';
import { createController, loadSessionForResume, modelSnapshot, nowIso } from '../../app/services';
import { liveTurns, type PowerQuestion, type SessionRecord } from '../../domain/types';
import { createReplayRecord, type SessionController } from '../../engine/sessionController';
import { isTerminal, remainingSeconds } from '../../engine/sessionMachine';
import { formatDuration, useT } from '../../i18n';
import { ProviderError } from '../../llm/provider';
import { matchVoiceCommand, speech, speechCapabilities, WakeLockManager, type ListenHandle } from '../../speech/speechAdapter';
import { downloadBlob, sessionToJson } from '../../storage/backup';
import { repo } from '../../storage/db';
import { actorNamer, EvaluationCard, navigate, Notice, Page, sessionTitle, Transcript, useApp } from '../common';

const TIMED = ['actor_turn', 'user_turn', 'evaluating'];

export function replaySession(record: SessionRecord, settings: Parameters<typeof modelSnapshot>[0]): Promise<void> {
  const replay = createReplayRecord(record, modelSnapshot(settings), nowIso());
  return repo.put('sessions', replay).then(() => navigate(`session/${replay.id}`));
}

export function CompletedActions({ record }: { record: SessionRecord }) {
  const t = useT();
  const { settings } = useApp();
  return (
    <div className="row wrap">
      <a className="btn btn-primary" href={`#/dialogue/${record.id}`}>
        {t('session.openDialogue')}
      </a>
      <button type="button" className="btn" onClick={() => void replaySession(record, settings)}>
        {t('session.replay')}
      </button>
      <button type="button" className="btn" onClick={() => downloadBlob(sessionToJson(record), `${record.id}.json`, 'application/json')}>
        {t('action.export')}
      </button>
      <a className="btn" href="#/">
        {t('nav.train')}
      </a>
    </div>
  );
}

export function SessionResults({ record }: { record: SessionRecord }) {
  const t = useT();
  const turnText = (id: string) => record.turns.find((x) => x.id === id)?.text;
  return (
    <>
      {record.summary?.text && (
        <section className="card">
          <h3>{t('session.summary')}</h3>
          <p>{record.summary.text}</p>
        </section>
      )}
      {record.summary?.restSuggestion && <Notice>{record.summary.restSuggestion}</Notice>}
      <section className="card">
        <h3>{t('session.outcome')}</h3>
        <p>
          {t('session.finalStance')}: <strong>{record.outcome.finalStance ? t(`stance.${record.outcome.finalStance}`) : t('eval.notObserved')}</strong>
          <br />
          {t('session.revelations', { count: record.outcome.revealedTwistIds.length })}
        </p>
        <p className="muted small">{t('session.outcomeNote')}</p>
      </section>
      {record.evaluations.map((e) => (
        <EvaluationCard key={`${e.evaluation.turnId}-${e.createdAt}`} stored={e} turnText={turnText(e.evaluation.turnId)} />
      ))}
    </>
  );
}

export function SessionScreen({ id }: { id: string }) {
  const t = useT();
  const { settings } = useApp();
  const [record, setRecord] = useState<SessionRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const [setupError, setSetupError] = useState('');
  const controllerRef = useRef<SessionController | null>(null);
  const [now, setNow] = useState(nowIso);
  const [draft, setDraft] = useState('');
  const [drafts, setDrafts] = useState<string[]>([]);
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [sttError, setSttError] = useState('');
  const [typing, setTyping] = useState(false);
  const [reflection, setReflection] = useState('');
  const [hint, setHint] = useState<PowerQuestion | null>(null);
  const listenRef = useRef<ListenHandle | null>(null);
  const spokenRef = useRef(new Set<string>());
  const wakeLock = useMemo(() => new WakeLockManager(), []);
  const caps = useMemo(speechCapabilities, []);

  // Load the record (an in-flight session comes back paused) and build its controller.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const loaded = await loadSessionForResume(id);
      if (disposed) return;
      if (!loaded) return setMissing(true);
      // Turns that existed before this page load are not read aloud again.
      for (const turn of loaded.turns) spokenRef.current.add(turn.id);
      setRecord(loaded);
      try {
        const controller = await createController(loaded, settings);
        if (disposed) return controller.dispose();
        controllerRef.current = controller;
        controller.subscribe(setRecord);
      } catch (error) {
        setSetupError(error instanceof ProviderError ? t(`error.${error.code}`) : (error as Error).message);
      }
    })();
    return () => {
      disposed = true;
      listenRef.current?.cancel();
      speech.cancelSpeech();
      controllerRef.current?.dispose();
      controllerRef.current = null;
      void wakeLock.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const status = record?.status;
  const walk = record?.interactionMode === 'walk';
  const voiceInput = walk && caps.stt && !typing && !sttError;

  // Clock: only active training consumes the budget; expiry never cuts a turn short.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(nowIso());
      void controllerRef.current?.tick();
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Auto-pause when the app loses focus; the pause is persisted and survives a reload.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && controllerRef.current && TIMED.includes(controllerRef.current.record.status)) {
        listenRef.current?.cancel();
        setListening(false);
        speech.cancelSpeech();
        void controllerRef.current.pause('visibility');
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHidden);
    };
  }, []);

  // Walk mode: read each new actor line aloud. Half-duplex — the microphone stays closed meanwhile.
  const lastTurn = record ? liveTurns(record).at(-1) : undefined;
  useEffect(() => {
    if (!record || !walk || !lastTurn || lastTurn.role === 'user' || spokenRef.current.has(lastTurn.id)) return;
    if (status === 'paused' || status === 'created') return;
    spokenRef.current.add(lastTurn.id);
    setSpeaking(true);
    void speech.speak(lastTurn.text, record.spokenLocale, { rate: settings.speechRate, voiceURI: settings.voiceURI }).then(() => setSpeaking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTurn?.id, status]);

  // Spoken feedback (optional), kept short: the written evaluation is always on screen as well.
  const lastEvaluation = record?.evaluations.at(-1);
  useEffect(() => {
    if (!record || !walk || !settings.speakFeedback || !lastEvaluation || spokenRef.current.has(lastEvaluation.createdAt)) return;
    if (status !== 'feedback') return;
    spokenRef.current.add(lastEvaluation.createdAt);
    const e = lastEvaluation.evaluation;
    const text = [record.summary?.text ?? e.strengths[0], e.reframe.needed ? e.reframe.suggestion : null].filter(Boolean).join(' ');
    void speech.speak(text, record.spokenLocale, { rate: settings.speechRate, voiceURI: settings.voiceURI });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvaluation?.createdAt, status]);

  useEffect(() => {
    if (!record || !walk || !settings.wakeLock) return;
    if (isTerminal(record.status) || record.status === 'created') void wakeLock.disable();
    else if (!wakeLock.active) void wakeLock.enable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (missing) return <Page title={t('session.notFound')} back="history">{null}</Page>;
  if (!record) return <Page title={t('app.title')}>{null}</Page>;
  const controller = controllerRef.current;
  const actorName = actorNamer(record);
  const remaining = remainingSeconds(record, now);

  const stopSpeech = () => {
    speech.cancelSpeech();
    setSpeaking(false);
  };

  const handleSpoken = (text: string) => {
    setListening(false);
    setInterim('');
    if (!text) return;
    const command = matchVoiceCommand(text, record.spokenLocale);
    if (command === 'pause') return void controller?.pause('voice_command');
    if (command === 'end') return void controller?.requestEnd();
    if (command === 'resume') return;
    void controller?.submitUserTurn(text, 'voice');
  };

  const toggleMic = () => {
    if (listening) return listenRef.current?.stop();
    stopSpeech();
    setSttError('');
    setListening(true);
    listenRef.current = speech.listen(record.spokenLocale, {
      onInterim: setInterim,
      onFinal: handleSpoken,
      onError: (error) => {
        setListening(false);
        setInterim('');
        // Honest fallback: say what failed and switch to typing instead of pretending to listen.
        setSttError(t(`speech.error.${error}`));
      },
    });
  };

  const sendText = () => {
    const text = draft;
    setDraft('');
    setDrafts([]);
    void controller?.submitUserTurn(text, 'text');
  };

  const showHint = async () => {
    const skills = new Set(controller?.world.scenario.primarySkills ?? []);
    const questions = (await repo.all('questions'))
      .filter((q) => q.locale === record.spokenLocale && q.skills.some((s) => skills.has(s)))
      .sort((a, b) => a.id.localeCompare(b.id));
    setHint(questions[liveTurns(record).length % Math.max(1, questions.length)] ?? null);
  };

  const header = (
    <div className="session-meta" aria-live="off">
      <span>{t(`mode.${record.interactionMode}`)}</span>
      <span>{t(`difficulty.${record.difficulty}`)}</span>
      <span>{t(`drill.${record.drillType}`)}</span>
      <span className="timer" aria-label={t('session.remaining')}>
        ⏱ {formatDuration(remaining)}
      </span>
    </div>
  );

  return (
    <Page title={sessionTitle(record)} back="">
      {header}
      {record.replayOf && <Notice>{t('session.replayNotice')}</Notice>}
      {setupError && (
        <Notice kind="error">
          {setupError} <a href="#/settings">{t('nav.settings')}</a>
        </Notice>
      )}
      {record.models.provider === 'demo' && <Notice kind="warn">{t('provider.demoNotice')}</Notice>}

      {status === 'created' && (
        <section className="card stack">
          <p>{controller?.world.scenario.setting}</p>
          <p>
            <strong>{t('session.mandate')}:</strong> {controller?.world.scenario.userMandate}
          </p>
          {walk && (caps.stt && caps.tts ? <Notice>{t('privacy.speech')}</Notice> : <Notice kind="warn">{t('speech.unsupported')}</Notice>)}
          {walk && !caps.wakeLock && <p className="muted small">{t('speech.noWakeLock')}</p>}
          <button type="button" className="btn btn-primary btn-large" disabled={!controller} onClick={() => void controller?.start()}>
            {t('action.start')}
          </button>
        </section>
      )}

      {status !== 'created' && <Transcript record={record} actorName={actorName} />}
      <div aria-live="polite" className="status-line">
        {status === 'actor_turn' && t('session.actorThinking')}
        {status === 'evaluating' && !(record.socratic && record.socratic.answer === null) && t('session.coachThinking')}
        {speaking && t('session.speaking')}
      </div>

      {record.timeExpired && !isTerminal(record.status) && (
        <Notice kind="warn">
          {t('session.timeExpired')}{' '}
          <button type="button" className="btn btn-small" onClick={() => void controller?.extend(5 * 60)}>
            {t('session.extend')}
          </button>
        </Notice>
      )}

      {status === 'user_turn' && (
        <section className="card stack turn-input">
          {record.turns.at(-1)?.role === 'narrator' && <p>{t('session.reframeInstruction')}</p>}
          {voiceInput ? (
            <>
              <button
                type="button"
                className={`btn-mic${listening ? ' btn-mic-on' : ''}`}
                onClick={toggleMic}
                disabled={speaking && !listening}
                aria-pressed={listening}
              >
                {listening ? t('session.micStop') : t('session.micStart')}
              </button>
              {listening && (
                <p className="mic-indicator" role="status">
                  <span className="dot" aria-hidden="true" /> {t('session.micOn')}
                </p>
              )}
              {interim && <p className="caption">{interim}</p>}
              <button type="button" className="btn btn-small" onClick={() => setTyping(true)}>
                {t('session.typeInstead')}
              </button>
            </>
          ) : (
            <>
              {sttError && <Notice kind="warn">{sttError}</Notice>}
              <textarea
                rows={record.interactionMode === 'desktop' ? 7 : 3}
                value={draft}
                placeholder={t('session.yourResponse')}
                aria-label={t('session.yourResponse')}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="row wrap">
                <button type="button" className="btn btn-primary" onClick={sendText} disabled={!draft.trim()}>
                  {t('action.send')}
                </button>
                {record.interactionMode === 'desktop' && (
                  <button type="button" className="btn" disabled={!draft.trim()} onClick={() => setDrafts((d) => [...d, draft])}>
                    {t('session.saveDraft')}
                  </button>
                )}
                {walk && caps.stt && (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => {
                      setTyping(false);
                      setSttError('');
                    }}
                  >
                    {t('session.speakInstead')}
                  </button>
                )}
              </div>
              {drafts.length > 0 && (
                <div className="drafts">
                  <h4>{t('session.drafts')}</h4>
                  {drafts.map((d, i) => (
                    <div key={i} className="draft">
                      <p>{d}</p>
                      <button type="button" className="btn btn-small" onClick={() => setDraft(d)}>
                        {t('session.restoreDraft', { n: i + 1 })}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {record.difficulty === 'easy' && (
            <button type="button" className="btn btn-small" onClick={() => void showHint()}>
              {t('session.hint')}
            </button>
          )}
          {hint && (
            <p className="hint">
              {hint.text} <span className="muted small">— {hint.whenNotToUse}</span>
            </p>
          )}
        </section>
      )}

      {status === 'evaluating' && record.socratic && record.socratic.answer === null && (
        <section className="card stack">
          <h3>{t('coaching.socratic_review')}</h3>
          <p>{record.socratic.question}</p>
          <p className="muted small">{t('session.untimedReflection')}</p>
          <textarea rows={4} value={reflection} aria-label={t('session.yourReflection')} onChange={(e) => setReflection(e.target.value)} />
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void controller?.answerSocratic(reflection)} disabled={!reflection.trim()}>
              {t('action.send')}
            </button>
            <button type="button" className="btn" onClick={() => void controller?.answerSocratic(null)}>
              {t('session.skipReflection')}
            </button>
          </div>
        </section>
      )}

      {status === 'feedback' && (
        <section className="stack">
          <h2>{t('session.feedback')}</h2>
          {record.coachingMode === 'immediate' ? (
            lastEvaluation && <EvaluationCard stored={lastEvaluation} />
          ) : (
            <SessionResults record={record} />
          )}
          <div className="row wrap">
            <button type="button" className="btn btn-primary" onClick={() => void controller?.acknowledgeFeedback()}>
              {record.coachingMode === 'immediate' ? t('session.continue') : t('session.finish')}
            </button>
            {record.coachingMode === 'immediate' && (
              <button type="button" className="btn" onClick={() => void controller?.retryTurn()}>
                {t('action.retry')}
              </button>
            )}
          </div>
        </section>
      )}

      {status === 'paused' && (
        <section className="card stack">
          <p>{t('session.paused')}</p>
          <button type="button" className="btn btn-primary btn-large" onClick={() => void controller?.resume()} disabled={!controller}>
            {t('session.resume')}
          </button>
        </section>
      )}

      {status === 'error' && (
        <section className="card stack">
          <Notice kind="error">
            {t('session.providerFailed')}
            <br />
            <span className="small">{record.errorMessage}</span>
          </Notice>
          <p className="muted small">{t('session.noDuplicateTurns')}</p>
          <button type="button" className="btn btn-primary" onClick={() => void controller?.retryAfterError()} disabled={!controller}>
            {t('action.retry')}
          </button>
        </section>
      )}

      {status === 'completed' && (
        <section className="stack">
          <h2>{t('session.completed')}</h2>
          <SessionResults record={record} />
          <CompletedActions record={record} />
        </section>
      )}
      {status === 'aborted' && <Notice>{t('session.aborted')}</Notice>}

      {status && TIMED.includes(status) && (
        <div className="row wrap session-controls">
          <button type="button" className="btn" onClick={() => { stopSpeech(); void controller?.pause('user'); }}>
            {t('session.pause')}
          </button>
          <button type="button" className="btn" onClick={() => void controller?.requestEnd()} disabled={record.endRequested}>
            {t('session.end')}
          </button>
          {speaking && (
            <button type="button" className="btn" onClick={stopSpeech}>
              {t('session.stopSpeaking')}
            </button>
          )}
        </div>
      )}
      {!isTerminal(record.status) && status !== 'created' && (
        <button type="button" className="btn btn-link" onClick={() => void controller?.abort()}>
          {t('session.abort')}
        </button>
      )}
    </Page>
  );
}
