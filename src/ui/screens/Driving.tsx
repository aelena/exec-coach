import { useEffect, useRef, useState } from 'react';
import type { AppLocale, LearningPointer, PowerQuestion, SessionRecord } from '../../domain/types';
import { translate, useT } from '../../i18n';
import { speech, speechCapabilities } from '../../speech/speechAdapter';
import { repo } from '../../storage/db';
import { Choice, Notice, Page, sessionTitle, useApp, useAsync } from '../common';

export interface BriefingSegment {
  text: string;
  /** Silence after the segment, for unhurried reflection. */
  pauseSeconds: number;
}

/**
 * Builds the Driving briefing entirely from local data, before the drive starts: a recap of the last
 * kata and a few questions to think about. No simulation, no timed confrontation, no microphone,
 * and nothing that asks for a response (SPECS §3.1, principle 6).
 */
export function buildBriefing(input: {
  locale: AppLocale;
  lastSession: SessionRecord | undefined;
  pointers: LearningPointer[];
  questions: PowerQuestion[];
  reflectionSeconds: number;
}): BriefingSegment[] {
  const t = (key: string, params?: Record<string, string | number>) => translate(input.locale, key, params);
  const segments: BriefingSegment[] = [{ text: t('driving.intro'), pauseSeconds: 2 }];
  const last = input.lastSession;
  if (last) {
    segments.push({ text: t('driving.recap', { title: sessionTitle(last) }), pauseSeconds: 1 });
    if (last.summary?.text) segments.push({ text: last.summary.text, pauseSeconds: 3 });
    const evaluation = last.evaluations.at(-1)?.evaluation;
    if (evaluation?.reframe.needed && evaluation.reframe.suggestion) {
      segments.push({ text: t('driving.reframe', { suggestion: evaluation.reframe.suggestion }), pauseSeconds: 4 });
    }
    if (evaluation?.recommendedAction) segments.push({ text: evaluation.recommendedAction, pauseSeconds: 4 });
  }
  for (const pointer of input.pointers.slice(0, 2)) {
    segments.push({ text: t('driving.pointer', { concept: pointer.concept, reason: pointer.reason }), pauseSeconds: 4 });
  }
  if (input.questions.length > 0) segments.push({ text: t('driving.questionsIntro'), pauseSeconds: 1 });
  for (const question of input.questions.slice(0, 3)) segments.push({ text: question.text, pauseSeconds: input.reflectionSeconds });
  segments.push({ text: t('driving.outro'), pauseSeconds: 0 });
  return segments;
}

export function Driving() {
  const t = useT();
  const { settings } = useApp();
  const caps = speechCapabilities();
  const [reflection, setReflection] = useState<'15' | '30' | '60'>('30');
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const cancelled = useRef(false);
  const { data } = useAsync(async () => {
    const sessions = (await repo.all('sessions')).filter((s) => s.status === 'completed').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const questions = (await repo.all('questions')).filter((q) => q.locale === settings.spokenLocale).sort((a, b) => a.id.localeCompare(b.id));
    // Rotate the questions by day so repeated drives do not always hear the same three.
    const offset = questions.length ? Math.floor(Date.now() / 86_400_000) % questions.length : 0;
    return {
      lastSession: sessions[0],
      pointers: (await repo.all('learningPointers')).filter((p) => p.status === 'pending'),
      questions: [...questions.slice(offset), ...questions.slice(0, offset)],
    };
  }, [settings.spokenLocale]);

  useEffect(
    () => () => {
      cancelled.current = true;
      speech.cancelSpeech();
    },
    [],
  );

  const stop = () => {
    cancelled.current = true;
    speech.cancelSpeech();
    setPlaying(false);
  };

  const play = async () => {
    if (!data) return;
    const segments = buildBriefing({ locale: settings.spokenLocale, ...data, reflectionSeconds: Number(reflection) });
    cancelled.current = false;
    setDone(false);
    setPlaying(true);
    for (const segment of segments) {
      if (cancelled.current) return;
      await speech.speak(segment.text, settings.spokenLocale, { rate: settings.speechRate, voiceURI: settings.voiceURI });
      if (cancelled.current) return;
      await new Promise((resolve) => window.setTimeout(resolve, segment.pauseSeconds * 1000));
    }
    setPlaying(false);
    setDone(true);
  };

  if (playing) {
    // While playing there is exactly one control. Nothing to read, nothing to answer.
    return (
      <main className="page driving-live" id="main">
        <p className="driving-notice">{t('notice.driving')}</p>
        <button type="button" className="btn-stop" onClick={stop}>
          {t('driving.stop')}
        </button>
      </main>
    );
  }

  return (
    <Page title={t('mode.driving')} back="">
      <Notice kind="warn">{t('notice.driving')}</Notice>
      <p>{t('driving.lead')}</p>
      <ul className="small">
        <li>{t('driving.rule.prepare')}</li>
        <li>{t('driving.rule.noInteraction')}</li>
        <li>{t('driving.rule.noPressure')}</li>
        <li>{t('speech.backgroundLimit')}</li>
      </ul>
      {!caps.tts && <Notice kind="error">{t('speech.ttsNo')}</Notice>}
      <Choice<'15' | '30' | '60'>
        legend={t('driving.reflection')}
        value={reflection}
        options={(['15', '30', '60'] as const).map((s) => ({ value: s, label: t('driving.seconds', { seconds: s }) }))}
        onChange={setReflection}
      />
      {done && <Notice>{t('driving.finished')}</Notice>}
      <button type="button" className="btn btn-primary btn-large" disabled={!caps.tts || !data} onClick={() => void play()}>
        {t('driving.start')}
      </button>
    </Page>
  );
}
