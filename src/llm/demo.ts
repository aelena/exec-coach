import { sectionBody } from '../content/markdown';
import {
  liveTurns,
  RUBRIC_VERSION,
  userTurns,
  type AppLocale,
  type CoachDialogue,
  type DialogueSegment,
  type Skill,
} from '../domain/types';
import { groundEvaluation, type CoachEvaluationResult } from '../evaluation/validator';
import { revealedTwistIds, splitSentences, type ActorSignal } from '../scenario/scenarioEngine';
import type { ActorClient, CoachClient, DialogueReply, OutOfCharacterInput } from './clients';
import type { ActorPromptInput, CoachContextInput } from './promptComposer';

// Offline demo clients: scripted, deterministic stand-ins used for onboarding without a key and
// for automated tests. They exercise the full pipeline but are NOT real coaching; the UI says so.

const TEXT: Record<AppLocale, Record<string, string>> = {
  en: {
    closingOpen: 'All right. Put that in writing with owners and dates, and I will take it forward.',
    closingResist: 'I still do not have a commitment I can take to the business. We will come back to this.',
    generic: 'What exactly are you asking me to decide today?',
    strengthQuestion: 'You asked a question instead of asserting a conclusion.',
    strengthBrief: 'The intervention was brief enough to be heard.',
    strengthBoundary: 'You stated a clear boundary.',
    riskLong: 'A long intervention is easy to interrupt; lead with the decision you need.',
    action: 'Repeat the kata and open with the decision you need in one sentence.',
    rationale: 'Demo mode never proposes reframes.',
    summary: 'Demo mode: these scores come from scripted heuristics (length, questions, explicit boundaries), not from a coach. Connect a provider for real evaluation.',
    socratic: 'Which assumption in this conversation did nobody state out loud?',
    dialogueFact: 'Logged in this session: {events}.',
    dialogueNone: 'No causal events were logged in this session.',
    dialogueNote: 'Demo mode can list what was logged, but it cannot interpret it. Connect a provider for a real debrief.',
    ooc: 'Demo mode: this character follows the scripted lines and revelation rules of the scenario; no model is interpreting your words.',
  },
  'es-ES': {
    closingOpen: 'De acuerdo. Ponlo por escrito con responsables y fechas, y lo llevo adelante.',
    closingResist: 'Sigo sin un compromiso que pueda trasladar al negocio. Volveremos sobre esto.',
    generic: '¿Qué decisión me estás pidiendo exactamente que tome hoy?',
    strengthQuestion: 'Has formulado una pregunta en lugar de afirmar una conclusión.',
    strengthBrief: 'La intervención fue lo bastante breve como para ser escuchada.',
    strengthBoundary: 'Has marcado un límite claro.',
    riskLong: 'Una intervención larga es fácil de interrumpir; empieza por la decisión que necesitas.',
    action: 'Repite el kata y abre con la decisión que necesitas en una sola frase.',
    rationale: 'El modo demo nunca propone reformulaciones.',
    summary: 'Modo demo: estas puntuaciones salen de heurísticas fijas (longitud, preguntas, límites explícitos), no de un coach. Conecta un proveedor para una evaluación real.',
    socratic: '¿Qué premisa de esta conversación no ha dicho nadie en voz alta?',
    dialogueFact: 'Registrado en esta sesión: {events}.',
    dialogueNone: 'No se registraron eventos causales en esta sesión.',
    dialogueNote: 'El modo demo puede enumerar lo registrado, pero no interpretarlo. Conecta un proveedor para un postmortem real.',
    ooc: 'Modo demo: este personaje sigue las frases y reglas de revelación del escenario; ningún modelo interpreta tus palabras.',
  },
};

const significantWords = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 4),
  );

const PROPOSAL = /\b(propose|recommend|suggest|propongo|recomiendo|sugiero|proponer)\b/i;
const BOUNDARY = /\b(cannot|can't|won't|would not|no puedo|no podemos|no recomendar|no garantiz)/i;

export class DemoActorClient implements ActorClient {
  async reply(input: ActorPromptInput): Promise<ActorSignal> {
    const { scenario, record, actor } = input;
    const t = TEXT[record.spokenLocale];
    const lastUser = userTurns(record).at(-1)?.text ?? '';
    if (input.closing) {
      const opening = PROPOSAL.test(lastUser) || lastUser.includes('?');
      return {
        utterance: opening ? t.closingOpen! : t.closingResist!,
        firedTwistIds: [],
        reaction: opening ? { type: 'concession', factors: ['credible_alternative'] } : { type: 'objection', factors: ['commitment_pressure'] },
        stance: opening ? 'opening' : 'resisting',
      };
    }
    const revealed = new Set(revealedTwistIds(record));
    const words = significantWords(lastUser);
    const fired = scenario.twists.find(
      (tw) => !revealed.has(tw.id) && [...significantWords(tw.trigger)].filter((w) => words.has(w)).length >= 1,
    );
    if (fired) {
      const effect = fired.effect.charAt(0).toUpperCase() + fired.effect.slice(1);
      return { utterance: `${effect}.`, firedTwistIds: [fired.id], reaction: { type: 'neutral', factors: [] }, stance: 'neutral' };
    }
    // Only literal example lines (inside « ») are spoken; instructions to the model never are.
    const scripted = `${sectionBody(actor, 'Behavior and Pressure Tactics')}
${sectionBody(actor, 'Communication Style')}`;
    const tactics = [...scripted.matchAll(/«([^»]{8,160})»/g)].map((m) => m[1]!.trim());
    const spoken = liveTurns(record).filter((turn) => turn.role === 'actor').length;
    const utterance = tactics.length > 0 ? tactics[spoken % tactics.length]! : t.generic!;
    return { utterance, firedTwistIds: [], reaction: { type: 'pressure', factors: ['commitment_pressure'] }, stance: 'resisting' };
  }

  async outOfCharacter(input: OutOfCharacterInput): Promise<string> {
    return TEXT[input.record.spokenLocale].ooc!;
  }
}

export class DemoCoachClient implements CoachClient {
  async evaluate(input: CoachContextInput & { turnIds: string[] }, now: string): Promise<CoachEvaluationResult> {
    const { record } = input;
    const t = TEXT[record.spokenLocale];
    const evaluations = [];
    for (const turn of userTurns(record).filter((u) => input.turnIds.includes(u.id))) {
      const wordCount = turn.text.trim().split(/\s+/).length;
      const scores: Partial<Record<Skill, number | null>> = {
        conciseness: wordCount <= 40 ? 3 : wordCount <= 80 ? 2 : 1,
        executive_questioning: turn.text.includes('?') ? 3 : null,
        assertiveness: BOUNDARY.test(turn.text) ? 3 : null,
        decision_orientation: PROPOSAL.test(turn.text) ? 3 : null,
      };
      const strengths = [
        ...(turn.text.includes('?') ? [t.strengthQuestion!] : []),
        ...(BOUNDARY.test(turn.text) ? [t.strengthBoundary!] : []),
        ...(wordCount <= 40 ? [t.strengthBrief!] : []),
      ];
      const grounded = groundEvaluation(
        {
          rubricVersion: RUBRIC_VERSION,
          turnId: turn.id,
          scores,
          strengths,
          risks: wordCount > 80 ? [t.riskLong!] : [],
          missedAssumptions: [],
          evidenceQuotes: [splitSentences(turn.text)[0] ?? turn.text],
          reframe: { needed: false, suggestion: null, rationale: t.rationale! },
          recommendedAction: t.action!,
          confidence: 'low',
          insufficientContext: false,
        },
        record,
        now,
      );
      if (grounded) evaluations.push(grounded);
    }
    return { evaluations, summary: t.summary!, restSuggestion: null, memoryProposals: [], learningPointers: [], rejected: [] };
  }

  async socraticQuestion(input: CoachContextInput): Promise<string> {
    return TEXT[input.record.spokenLocale].socratic!;
  }

  async dialogue(input: CoachContextInput & { dialogue: CoachDialogue }): Promise<DialogueReply> {
    const { record } = input;
    const t = TEXT[record.spokenLocale];
    const segments: DialogueSegment[] = [];
    if (record.causalEvents.length > 0) {
      segments.push({
        text: t.dialogueFact!.replace('{events}', record.causalEvents.map((e) => `${e.eventType} (${e.turnId})`).join(', ')),
        epistemicStatus: 'scenario_fact',
        turnRefs: [...new Set(record.causalEvents.map((e) => e.turnId))],
        causalEventRefs: record.causalEvents.map((e) => e.id),
      });
    } else {
      segments.push({ text: t.dialogueNone!, epistemicStatus: null, turnRefs: [], causalEventRefs: [] });
    }
    segments.push({ text: t.dialogueNote!, epistemicStatus: null, turnRefs: [], causalEventRefs: [] });
    return { segments, memoryProposals: [] };
  }
}
