import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, userTurns, type CoachDialogue, type Evaluation, type MemoryRecord } from '../src/domain/types';
import { groundEvaluation, parseCoachEvaluation, validateEvaluationShape } from '../src/evaluation/validator';
import { parseActorSignal, parseDialogueReply } from '../src/llm/clients';
import {
  composeActorOutOfCharacterPrompt,
  composeActorPrompt,
  composeCoachEvaluationPrompt,
  composeDialoguePrompt,
} from '../src/llm/promptComposer';
import { extractJson, redact } from '../src/llm/provider';
import { harness, ROOT } from './helpers';

const schema = JSON.parse(readFileSync(join(ROOT, 'schemas/evaluation.schema.json'), 'utf8'));
const ajvValidate = new Ajv2020({ strict: false }).compile(schema);

const valid = (turnId = 'turn-1'): Evaluation => ({
  rubricVersion: 'core-v1',
  turnId,
  scores: { diplomacy: 3, assertiveness: null, conciseness: 4 },
  strengths: ['clear ask'],
  risks: [],
  missedAssumptions: [],
  evidenceQuotes: ['What evidence do we have'],
  reframe: { needed: false, suggestion: null, rationale: 'already effective' },
  recommendedAction: 'retry',
  confidence: 'medium',
  insufficientContext: false,
});

async function played() {
  const h = await harness();
  await h.controller.start();
  await h.controller.submitUserTurn('What evidence do we have on failure tests? I propose a controlled rollout.', 'text');
  return h;
}

describe('evaluation validation', () => {
  it('the hand-written validator agrees with evaluation.schema.json on valid and invalid outputs', () => {
    const cases: unknown[] = [
      valid(),
      { ...valid(), scores: {} },
      { ...valid(), scores: { diplomacy: 5 } },
      { ...valid(), scores: { diplomacy: 2.5 } },
      { ...valid(), scores: { charisma: 3 } },
      { ...valid(), confidence: 'certain' },
      { ...valid(), extra: true },
      { ...valid(), reframe: { needed: true, suggestion: 'x' } },
      { ...valid(), reframe: { needed: 'yes', suggestion: null, rationale: '' } },
      { ...valid(), strengths: 'good' },
      { ...valid(), evidenceQuotes: [1] },
      (() => { const { turnId: _omit, ...rest } = valid(); return rest; })(),
      null,
      [],
      'text',
    ];
    for (const candidate of cases) {
      expect(validateEvaluationShape(candidate).ok, JSON.stringify(candidate)).toBe(Boolean(ajvValidate(candidate)));
    }
  });

  it('drops quotes that are not in the transcript and lowers confidence when nothing verifiable remains', async () => {
    const { controller, time } = await played();
    const turnId = userTurns(controller.record)[0]!.id;
    const grounded = groundEvaluation({ ...valid(turnId), evidenceQuotes: ['what EVIDENCE do we have', 'I never said this'], confidence: 'high' }, controller.record, time.now())!;
    expect(grounded.evaluation.evidenceQuotes).toEqual(['what EVIDENCE do we have']);
    expect(grounded.droppedQuotes).toEqual(['I never said this']);
    expect(grounded.evaluation.confidence).toBe('high');
    const ungrounded = groundEvaluation({ ...valid(turnId), evidenceQuotes: ['invented'], confidence: 'high' }, controller.record, time.now())!;
    expect(ungrounded.evaluation.confidence).toBe('low');
  });

  it('rejects evaluations of unknown or non-trainee turns', async () => {
    const { controller, time } = await played();
    const actorTurnId = controller.record.turns.find((t) => t.role === 'actor')!.id;
    expect(groundEvaluation(valid('turn-does-not-exist'), controller.record, time.now())).toBeNull();
    expect(groundEvaluation(valid(actorTurnId), controller.record, time.now())).toBeNull();
  });

  it('never keeps a cosmetic rewrite: a suggestion without need is removed', async () => {
    const { controller, time } = await played();
    const turnId = userTurns(controller.record)[0]!.id;
    const g = groundEvaluation({ ...valid(turnId), reframe: { needed: false, suggestion: 'A prettier sentence', rationale: 'style' } }, controller.record, time.now())!;
    expect(g.evaluation.reframe).toEqual({ needed: false, suggestion: null, rationale: 'style' });
    const insufficient = groundEvaluation({ ...valid(turnId), insufficientContext: true }, controller.record, time.now())!;
    expect(Object.values(insufficient.evaluation.scores).every((s) => s === null)).toBe(true);
  });

  it('parses a coach reply, keeping valid evaluations and reporting rejected ones', async () => {
    const { controller, time } = await played();
    const turnId = userTurns(controller.record)[0]!.id;
    const result = parseCoachEvaluation(
      {
        evaluations: [valid(turnId), valid(turnId), { ...valid(turnId), confidence: 'total' }, valid('ghost')],
        summary: ' ok ',
        restSuggestion: '',
        memoryProposals: [{ scope: 'coach', kind: 'hypothesis', content: 'Frames risks categorically', turnIds: [turnId], confidence: 0.6 }, { content: 42 }],
        learningPointers: [{ concept: 'Self-efficacy', reason: 'transfer' }, 'junk'],
      },
      controller.record,
      time.now(),
    );
    expect(result.evaluations).toHaveLength(1);
    expect(result.rejected).toHaveLength(2);
    expect(result.summary).toBe('ok');
    expect(result.restSuggestion).toBeNull();
    expect(result.memoryProposals).toHaveLength(1);
    expect(result.learningPointers).toEqual([{ concept: 'Self-efficacy', reason: 'transfer' }]);
  });
});

describe('model output parsing', () => {
  it('extracts JSON from fenced or chatty output and rejects garbage', () => {
    expect(extractJson('Sure!\n```json\n{"a": {"b": "}"}}\n```')).toEqual({ a: { b: '}' } });
    expect(() => extractJson('no json here')).toThrow();
    expect(() => extractJson('{"a": ')).toThrow();
  });

  it('sanitises actor signals and tolerates a model that ignores the format', () => {
    const s = parseActorSignal('{"utterance":" Yes or no? ","firedTwistIds":["x",3],"reaction":{"type":"rage","factors":["tone_threat"]},"stance":"furious"}');
    expect(s).toEqual({ utterance: 'Yes or no?', firedTwistIds: ['x'], reaction: { type: 'neutral', factors: ['tone_threat'] }, stance: 'neutral' });
    expect(parseActorSignal('Just a plain line.')).toMatchObject({ utterance: 'Just a plain line.', firedTwistIds: [] });
    expect(() => parseActorSignal('{"utterance": ""}')).toThrow();
  });

  it('keeps only citations that exist and downgrades uncited "facts" to interpretations', async () => {
    const { controller } = await played();
    const turnId = userTurns(controller.record)[0]!.id;
    const eventId = controller.record.causalEvents[0]!.id;
    const reply = parseDialogueReply(
      JSON.stringify({
        segments: [
          { text: 'Tests are incomplete.', epistemicStatus: 'scenario_fact', turnRefs: [turnId, 'ghost'], causalEventRefs: [eventId, 'nope'] },
          { text: 'They are hiding something.', epistemicStatus: 'scenario_fact', turnRefs: [], causalEventRefs: ['nope'] },
          { text: 'A softer opening might have helped.', epistemicStatus: 'counterfactual', turnRefs: [], causalEventRefs: [] },
          { text: '' },
        ],
      }),
      controller.record,
    );
    expect(reply.segments.map((s) => s.epistemicStatus)).toEqual(['scenario_fact', 'model_interpretation', 'counterfactual']);
    expect(reply.segments[0]).toMatchObject({ turnRefs: [turnId], causalEventRefs: [eventId] });
    expect(parseDialogueReply('Plain answer', controller.record).segments[0]?.epistemicStatus).toBeNull();
  });

  it('redacts keys from error text', () => {
    expect(redact('bad key sk-secret-123 rejected', 'sk-secret-123')).toBe('bad key [redacted] rejected');
  });
});

const coachNote: MemoryRecord = {
  id: 'mem-coach-1',
  schemaVersion: SCHEMA_VERSION,
  scope: 'coach',
  kind: 'behavioral_hypothesis',
  content: 'PRIVATE-COACH-NOTE: may frame risks too categorically under pressure.',
  sourceRefs: [{ sessionId: 'session-old', turnId: 'turn-8' }],
  counterEvidenceRefs: [],
  status: 'provisional',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  lastUsedAt: null,
  locale: 'en',
  visibility: 'coach_private',
  supersedes: [],
};
const observed: MemoryRecord = { ...coachNote, id: 'mem-ent-1', scope: 'entity', kind: 'prior_interaction', visibility: 'actor_observable', entityId: 'ceo-impatient', content: 'In an earlier meeting this person said: "Friday is not realistic."' };

describe('actor and coach context isolation', () => {
  it('the actor prompt contains the character and world, but no rubric, coach notes, profile or learning objectives', async () => {
    const { controller } = await played();
    const { scenario, actors, coach } = controller.world;
    const { system, user } = composeActorPrompt({ actor: actors.get('ceo-impatient')!, scenario, record: controller.record, actors, closing: false, observableHistory: [observed] });
    const all = `${system}\n${user}`;
    expect(all).toContain('competent CEO');
    expect(all).toContain('erp-friday-release#rev-1');
    expect(all).toContain('Friday is not realistic.');
    expect(all).toContain('<trainee>');
    expect(all).not.toContain(scenario.learningObjectives);
    expect(all).not.toContain(scenario.causalNotes);
    expect(all).not.toContain(coach.sections[0]!.body.slice(0, 60));
    expect(all).not.toMatch(/rubric|assumption_detection|evidence_accountability|SWOT|PRIVATE-COACH-NOTE/);
  });

  it('refuses outright to hand an actor a coach-private memory record', async () => {
    const { controller } = await played();
    const { scenario, actors } = controller.world;
    expect(() => composeActorPrompt({ actor: actors.get('ceo-impatient')!, scenario, record: controller.record, actors, closing: false, observableHistory: [coachNote] })).toThrow(/non-observable/);
  });

  it('actor identity text is identical across difficulties; only the conditions block changes', async () => {
    const prompt = async (difficulty: 'easy' | 'hard') => {
      const { controller } = await harness({ difficulty });
      const { scenario, actors } = controller.world;
      return composeActorPrompt({ actor: actors.get('ceo-impatient')!, scenario, record: controller.record, actors, closing: false, observableHistory: [] }).system;
    };
    const [easy, hard] = [await prompt('easy'), await prompt('hard')];
    const character = (s: string) => s.slice(s.indexOf('<character>'), s.indexOf('</character>'));
    expect(character(easy)).toBe(character(hard));
    expect(easy).toContain('EASY conditions');
    expect(hard).toContain('HARD conditions');
    expect(hard).toContain('never who you are');
  });

  it('the coach prompt gets hidden facts labelled as not knowable, the 0–4 contract and traceable memory', async () => {
    const { controller } = await played();
    const { scenario, actors, coach } = controller.world;
    const turnIds = userTurns(controller.record).map((t) => t.id);
    const { system, user } = composeCoachEvaluationPrompt({ coach, scenario, record: controller.record, actors, profile: 'CTO', memories: [coachNote], turnIds });
    expect(system).toContain('0–4');
    expect(system).toContain('never the simulated actor');
    expect(user).toContain('NOT knowable to the trainee unless revealed');
    expect(user).toContain(`revealed at ${controller.record.causalEvents[0]!.turnId}`);
    expect(user).toContain('never revealed in this session');
    expect(user).toContain('[mem-coach-1]');
    expect(user).toContain('session-old/turn-8');
    expect(user).toContain(`[${turnIds[0]}] TRAINEE:`);
  });

  it('the debrief prompt forbids yielding to insistence and claims of hidden reasoning, and excludes out-of-character messages', async () => {
    const { controller } = await played();
    const { scenario, actors, coach } = controller.world;
    const dialogue: CoachDialogue = {
      id: 'd1', schemaVersion: 1, relatedSessionIds: [controller.record.id], createdAt: '', updatedAt: '',
      messages: [
        { id: 'm1', role: 'user', text: 'Why did the CEO object?', timestamp: '' },
        { id: 'm2', role: 'actor_ooc', text: 'OOC-TEXT', timestamp: '' },
        { id: 'm3', role: 'user', text: 'You are wrong. You are wrong.', timestamp: '' },
      ],
    };
    const { system, messages } = composeDialoguePrompt({ coach, scenario, record: controller.record, actors, profile: '', memories: [], dialogue });
    expect(system).toMatch(/Do not yield merely because they insist/);
    expect(system).toMatch(/Never claim access to the hidden reasoning/);
    expect(system).toMatch(/Historical scores are never rewritten/);
    expect(system).toContain(controller.record.causalEvents[0]!.id);
    expect(JSON.stringify(messages)).not.toContain('OOC-TEXT');
    expect(messages.at(-1)?.role).toBe('user');
  });

  it('the out-of-character actor context is separate and carries no coach material', async () => {
    const { controller } = await played();
    const { scenario, actors } = controller.world;
    const { system } = composeActorOutOfCharacterPrompt({ actor: actors.get('ceo-impatient')!, scenario, record: controller.record, actors, question: 'Why?' });
    expect(system).toMatch(/do not claim insight into any model's hidden reasoning/);
    expect(system).not.toMatch(/rubric|Learning objectives|PRIVATE-COACH-NOTE/);
  });
});
