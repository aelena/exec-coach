import { sectionBody, normalizeSkill, type ParsedDoc } from '../content/markdown';
import {
  EXPLANATION_FACTORS,
  newId,
  SCHEMA_VERSION,
  type ActorStance,
  type CausalEvent,
  type ReactionType,
  type SessionRecord,
  type Skill,
} from '../domain/types';

// The scenario world is declared in Markdown and frozen per session. Hidden facts and revelation
// rules get stable ids so every twist the actor plays is traceable to a declared rule (SPECS §25).

export interface HiddenFact {
  id: string;
  text: string;
}

export interface Twist {
  id: string;
  trigger: string;
  preconditions: string[];
  effect: string;
  revealPolicy: 'once';
  causalFactors: string[];
}

export interface ScenarioModel {
  id: string;
  title: string;
  actorIds: string[];
  userRole: string;
  primarySkills: Skill[];
  setting: string;
  userMandate: string;
  publicContext: string;
  opening: string;
  escalation: string;
  learningObjectives: string;
  nuance: string;
  hiddenFacts: HiddenFact[];
  twists: Twist[];
  causalNotes: string;
  reframingSeeds: string[];
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡«"“'])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Removes a leading "Speaker:" label and surrounding quotation marks from a scripted line. */
export function cleanSpokenLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^[\p{L} .]{2,40}:\s*(?=[«"“'¿¡\p{Lu}])/u, '')
    .replace(/^[«"“']+|[»"”']+\.?$/gu, '')
    .trim();
}

function parseTwist(sentence: string, id: string): Twist {
  const match = /^(?:If|When|Si|Cuando)\s+(.+?),\s+(.+)$/i.exec(sentence);
  return {
    id,
    trigger: match ? match[1]! : sentence,
    preconditions: [],
    effect: match ? match[2]!.replace(/\.$/, '') : sentence,
    revealPolicy: 'once',
    causalFactors: [],
  };
}

export function buildScenarioModel(doc: ParsedDoc): ScenarioModel {
  const meta = doc.meta;
  const skills = (Array.isArray(meta.primary_skills) ? meta.primary_skills : [])
    .map((s) => normalizeSkill(String(s)))
    .filter((s): s is Skill => s !== null);
  return {
    id: doc.id,
    title: doc.title,
    actorIds: (meta.actor_ids as string[]).slice(),
    userRole: String(meta.user_role),
    primarySkills: [...new Set(skills)],
    setting: sectionBody(doc, 'Setting'),
    userMandate: sectionBody(doc, 'User mandate'),
    publicContext: sectionBody(doc, 'Public Context'),
    opening: cleanSpokenLine(sectionBody(doc, 'Opening')),
    escalation: sectionBody(doc, 'Escalation'),
    learningObjectives: sectionBody(doc, 'Learning objectives'),
    nuance: sectionBody(doc, 'Important nuance'),
    hiddenFacts: splitSentences(sectionBody(doc, 'Hidden World State')).map((text, i) => ({
      id: `${doc.id}#fact-${i + 1}`,
      text,
    })),
    twists: splitSentences(sectionBody(doc, 'Revelation Rules')).map((s, i) => parseTwist(s, `${doc.id}#rev-${i + 1}`)),
    causalNotes: sectionBody(doc, 'Causal Debrief Notes'),
    reframingSeeds: sectionBody(doc, 'Reframing Seeds')
      .split('\n')
      .map(cleanSpokenLine)
      .filter((s) => s.length > 0),
  };
}

export function revealedTwistIds(record: Pick<SessionRecord, 'causalEvents'>): string[] {
  const ids = new Set<string>();
  for (const e of record.causalEvents) {
    if (e.eventType === 'revelation') for (const ref of e.scenarioFactRefs) ids.add(ref);
  }
  return [...ids];
}

export interface ActorSignal {
  utterance: string;
  firedTwistIds: string[];
  reaction: { type: ReactionType; factors: string[] };
  stance: ActorStance;
}

const REACTION_EVENT: Partial<Record<ReactionType, CausalEvent['eventType']>> = {
  objection: 'actor_objection',
  pressure: 'actor_pressure',
  concession: 'actor_concession',
};

/**
 * Turns what the actor did in one turn into causal events. Only declared, not-yet-revealed twists
 * become `scenario_fact` revelations; the actor's own account of why it reacted is recorded as a
 * `model_interpretation` over a closed vocabulary — an observable-event explanation, never hidden reasoning.
 */
export function deriveCausalEvents(input: {
  scenario: ScenarioModel;
  record: SessionRecord;
  actorTurnId: string;
  triggerTurnId: string | null;
  signal: ActorSignal;
  now: string;
}): CausalEvent[] {
  const { scenario, record, actorTurnId, triggerTurnId, signal, now } = input;
  const already = new Set(revealedTwistIds(record));
  const declared = new Set(scenario.twists.map((t) => t.id));
  const events: CausalEvent[] = [];
  const base = {
    schemaVersion: SCHEMA_VERSION,
    sessionId: record.id,
    turnId: actorTurnId,
    triggerRefs: triggerTurnId ? [triggerTurnId] : [],
    observedActorResponse: signal.utterance,
    createdAt: now,
  };
  for (const twistId of new Set(signal.firedTwistIds)) {
    if (!declared.has(twistId) || already.has(twistId)) continue;
    events.push({
      ...base,
      id: newId('causal'),
      eventType: 'revelation',
      scenarioFactRefs: [twistId],
      explanationFactors: [],
      epistemicStatus: 'scenario_fact',
    });
  }
  const eventType = REACTION_EVENT[signal.reaction.type];
  if (eventType) {
    const factors = signal.reaction.factors.filter((f) => (EXPLANATION_FACTORS as readonly string[]).includes(f));
    events.push({
      ...base,
      id: newId('causal'),
      eventType,
      scenarioFactRefs: [],
      explanationFactors: factors,
      epistemicStatus: 'model_interpretation',
    });
  }
  return events;
}
