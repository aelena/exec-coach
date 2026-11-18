import { describe, expect, it } from 'vitest';
import { liveTurns, userTurns, type SessionRecord, type Turn } from '../src/domain/types';
import { createReplayRecord, createSessionRecord, nextSpeaker, type ControllerDeps } from '../src/engine/sessionController';
import { activeSeconds, actorRequestKey, reduceSession, remainingSeconds, restoreAfterReload } from '../src/engine/sessionMachine';
import type { ActorClient } from '../src/llm/clients';
import { DemoActorClient } from '../src/llm/demo';
import { ProviderError } from '../src/llm/provider';
import { config, harness, MODELS, registry } from './helpers';

const at = (seconds: number) => new Date(Date.parse('2026-11-18T10:00:00Z') + seconds * 1000).toISOString();
const turn = (role: Turn['role'], id: string, text = 'x'): Turn => ({ id, index: 0, role, text, createdAt: at(0), ...(role === 'actor' ? { actorId: 'ceo-impatient' } : {}) });

async function started(overrides = {}): Promise<SessionRecord> {
  let r = await createSessionRecord(config(overrides), registry(), MODELS, at(0));
  r = reduceSession(r, { type: 'PREPARED', at: at(0) });
  return reduceSession(r, { type: 'STARTED', at: at(0) });
}
const actorReplies = (r: SessionRecord, id: string, when: number) =>
  reduceSession(r, { type: 'ACTOR_REPLIED', at: at(when), requestKey: actorRequestKey(r), turn: turn('actor', id), causalEvents: [] });

describe('session state machine', () => {
  it('follows created → ready → actor_turn → user_turn and ignores out-of-order events', async () => {
    const created = await createSessionRecord(config(), registry(), MODELS, at(0));
    expect(created.status).toBe('created');
    expect(reduceSession(created, { type: 'STARTED', at: at(0) })).toBe(created);
    let r = await started();
    expect(r.status).toBe('actor_turn');
    expect(reduceSession(r, { type: 'USER_SUBMITTED', at: at(1), turn: turn('user', 'u0') })).toBe(r);
    r = actorReplies(r, 'a1', 2);
    expect(r.status).toBe('user_turn');
  });

  it('never appends a duplicate turn for a stale or repeated provider response', async () => {
    const r = await started();
    const key = actorRequestKey(r);
    const once = reduceSession(r, { type: 'ACTOR_REPLIED', at: at(2), requestKey: key, turn: turn('actor', 'a1'), causalEvents: [] });
    const twice = reduceSession(once, { type: 'ACTOR_REPLIED', at: at(3), requestKey: key, turn: turn('actor', 'a1-dup'), causalEvents: [] });
    expect(twice).toBe(once);
    expect(once.turns).toHaveLength(1);
    const wrongKey = reduceSession(r, { type: 'ACTOR_REPLIED', at: at(2), requestKey: 'other', turn: turn('actor', 'a1'), causalEvents: [] });
    expect(wrongKey).toBe(r);
  });

  it('counts only active time: pauses and feedback never consume the budget', async () => {
    let r = await started();
    r = actorReplies(r, 'a1', 10);
    r = reduceSession(r, { type: 'PAUSED', at: at(30), reason: 'user' });
    expect(r.status).toBe('paused');
    expect(r.activeElapsedSeconds).toBe(30);
    expect(activeSeconds(r, at(500))).toBe(30);
    r = reduceSession(r, { type: 'RESUMED', at: at(130) });
    expect(r.status).toBe('user_turn');
    expect(r.pausedElapsedSeconds).toBe(100);
    expect(r.pauseEvents).toEqual([{ pausedAt: at(30), resumedAt: at(130), reason: 'user' }]);
    expect(activeSeconds(r, at(140))).toBe(40);
    expect(remainingSeconds(r, at(140))).toBe(260);
  });

  it('time expiry only raises a flag; the current exchange finishes and extension clears it', async () => {
    let r = await started();
    r = actorReplies(r, 'a1', 1);
    r = reduceSession(r, { type: 'TIME_EXPIRED', at: at(301) });
    expect(r.status).toBe('user_turn');
    expect(r.timeExpired).toBe(true);
    const extended = reduceSession(r, { type: 'EXTENDED', at: at(302), extraSeconds: 300 });
    expect(extended.timeExpired).toBe(false);
    expect(extended.plannedDurationSeconds).toBe(600);
    r = reduceSession(r, { type: 'USER_SUBMITTED', at: at(310), turn: turn('user', 'u1') });
    expect(r.status).toBe('actor_turn'); // the actor still gets its closing reply
    r = actorReplies(r, 'a2', 315);
    expect(r.status).toBe('evaluating');
  });

  it('a session interrupted by a reload comes back paused at the last persisted moment', async () => {
    let r = await started();
    r = actorReplies(r, 'a1', 20);
    const restored = restoreAfterReload(r, at(4000));
    expect(restored.status).toBe('paused');
    expect(restored.resumeStatus).toBe('user_turn');
    expect(restored.activeElapsedSeconds).toBe(20);
    expect(restored.pauseEvents.at(-1)?.reason).toBe('reload');
    const resumed = reduceSession(restored, { type: 'RESUMED', at: at(4100) });
    expect(resumed.status).toBe('user_turn');
    expect(activeSeconds(resumed, at(4105))).toBe(25);
    expect(restoreAfterReload(restored, at(5000))).toBe(restored);
  });

  it('errors return to the interrupted state on recovery without losing turns', async () => {
    let r = await started();
    r = actorReplies(r, 'a1', 1);
    r = reduceSession(r, { type: 'USER_SUBMITTED', at: at(5), turn: turn('user', 'u1') });
    const failed = reduceSession(r, { type: 'FAILED', at: at(6), message: 'network' });
    expect(failed.status).toBe('error');
    expect(failed.errorMessage).toBe('network');
    const recovered = reduceSession(failed, { type: 'RECOVERED', at: at(60) });
    expect(recovered.status).toBe('actor_turn');
    expect(recovered.turns).toHaveLength(2);
    expect(recovered.activeElapsedSeconds).toBe(6); // time spent in the error state is not charged
  });

  it('immediate coaching evaluates each turn and supports a retry that keeps the first attempt on record', async () => {
    let r = await started({ coachingMode: 'immediate' });
    r = actorReplies(r, 'a1', 1);
    r = reduceSession(r, { type: 'USER_SUBMITTED', at: at(5), turn: turn('user', 'u1') });
    expect(r.status).toBe('evaluating');
    r = reduceSession(r, { type: 'EVALUATED', at: at(8), evaluations: [], summary: null });
    expect(r.status).toBe('feedback');
    const retried = reduceSession(r, { type: 'RETRY_TURN', at: at(100) });
    expect(retried.status).toBe('user_turn');
    expect(retried.retries).toBe(1);
    expect(retried.turns.find((t) => t.id === 'u1')?.superseded).toBe(true);
    expect(userTurns(retried)).toHaveLength(0);
    expect(retried.activeElapsedSeconds).toBe(8); // reading feedback is untimed
    const continued = reduceSession(r, { type: 'FEEDBACK_ACKNOWLEDGED', at: at(100) });
    expect(continued.status).toBe('actor_turn');
  });
});

describe('session creation, difficulty and replay', () => {
  it('difficulty changes who is in the room, never the actor definition', async () => {
    const reg = registry();
    const easy = await createSessionRecord(config({ scenarioId: 'automation-40-percent', difficulty: 'easy' }), reg, MODELS, at(0));
    const hard = await createSessionRecord(config({ scenarioId: 'automation-40-percent', difficulty: 'hard' }), reg, MODELS, at(0));
    expect(easy.actorIds).toEqual(['ceo-impatient']);
    expect(hard.actorIds).toEqual(['ceo-impatient', 'cfo-skeptical', 'board-sponsor']);
    const ceo = (r: SessionRecord) => r.snapshots.find((s) => s.kind === 'actor' && s.id === 'ceo-impatient')!;
    expect(ceo(easy).hash).toBe(ceo(hard).hash);
    expect(ceo(easy).source).toBe(ceo(hard).source);
  });

  it('refuses to create a simulation in driving mode', async () => {
    await expect(createSessionRecord(config({ interactionMode: 'driving' }), registry(), MODELS, at(0))).rejects.toThrow('driving_has_no_simulation');
  });

  it('stores content hashes, model ids and no secrets', async () => {
    const r = await createSessionRecord(config(), registry(), MODELS, at(0));
    expect(r.snapshots.map((s) => s.kind).sort()).toEqual(['actor', 'coach', 'scenario']);
    for (const s of r.snapshots) expect(s.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r)).not.toMatch(/api[_-]?key|sk-/i);
  });

  it('replay freezes world facts from the original snapshots and links to it', async () => {
    const { controller } = await harness();
    await controller.start();
    await controller.submitUserTurn('What evidence do we have on failure tests?', 'text');
    const original = controller.record;
    const replay = createReplayRecord(original, MODELS, at(999));
    expect(replay.id).not.toBe(original.id);
    expect(replay.replayOf).toBe(original.id);
    expect(replay.snapshots).toEqual(original.snapshots);
    expect(replay.turns).toEqual([]);
    expect(replay.causalEvents).toEqual([]);
    expect(replay.status).toBe('created');
    expect(createReplayRecord(replay, MODELS, at(1000)).replayOf).toBe(original.id);
  });

  it('turn-taking is deterministic: the primary leads and closes, others interject', async () => {
    const r = await createSessionRecord(config({ scenarioId: 'automation-40-percent' }), registry(), MODELS, at(0));
    const withActorTurns = (n: number) => ({ ...r, turns: Array.from({ length: n }, (_, i) => turn('actor', `a${i}`)) });
    expect(nextSpeaker(withActorTurns(0), false)).toBe('ceo-impatient');
    expect(nextSpeaker(withActorTurns(1), false)).toBe('cfo-skeptical');
    expect(nextSpeaker(withActorTurns(2), false)).toBe('ceo-impatient');
    expect(nextSpeaker(withActorTurns(3), false)).toBe('board-sponsor');
    expect(nextSpeaker(withActorTurns(3), true)).toBe('ceo-impatient');
  });
});

describe('session controller (full flows with the scripted demo clients)', () => {
  it('runs a complete kata: opening, turns, closing reply, evaluation, memory consolidation', async () => {
    const { controller, store, saved } = await harness();
    await controller.start();
    expect(controller.record.status).toBe('user_turn');
    expect(liveTurns(controller.record)[0]?.text).toContain('Only four endpoints left');
    await controller.submitUserTurn('What evidence do we have today on failure tests and retries?', 'text');
    await controller.submitUserTurn('I propose a controlled rollout with explicit criteria.', 'text');
    await controller.submitUserTurn('I recommend we confirm reconciliation before Friday. Which scope is safe?', 'text');
    const r = controller.record;
    expect(r.status).toBe('feedback');
    expect(userTurns(r)).toHaveLength(3);
    expect(liveTurns(r).at(-1)).toMatchObject({ role: 'actor', closing: true });
    expect(r.evaluations.map((e) => e.evaluation.turnId)).toEqual(userTurns(r).map((t) => t.id));
    expect(r.outcome.finalStance).toBe('opening');
    await controller.acknowledgeFeedback();
    expect(controller.record.status).toBe('completed');
    expect(controller.record.endedAt).not.toBeNull();
    expect(saved.at(-1)?.status).toBe('completed');
    // Consolidation wrote observable history for the actor and an outcome record.
    const kinds = [...store.records.values()].map((m) => `${m.scope}/${m.kind}/${m.visibility}`).sort();
    expect(kinds).toEqual(['entity/prior_interaction/actor_observable', 'long_term/session_outcome/user_visible']);
  });

  it('reveals a hidden fact only through a declared trigger and logs a traceable causal event', async () => {
    const { controller } = await harness();
    await controller.start();
    await controller.submitUserTurn('Good morning.', 'text');
    expect(controller.record.causalEvents.filter((e) => e.eventType === 'revelation')).toEqual([]);
    await controller.submitUserTurn('What do the failure tests show?', 'text');
    const revelations = controller.record.causalEvents.filter((e) => e.eventType === 'revelation');
    expect(revelations).toHaveLength(1);
    const event = revelations[0]!;
    expect(event.scenarioFactRefs).toEqual(['erp-friday-release#rev-1']);
    expect(event.epistemicStatus).toBe('scenario_fact');
    expect(event.triggerRefs).toEqual([userTurns(controller.record)[1]!.id]);
    expect(controller.world.scenario.twists.map((t) => t.id)).toContain(event.scenarioFactRefs[0]);
    expect(controller.record.outcome.revealedTwistIds).toEqual(['erp-friday-release#rev-1']);
  });

  it('ignores twist ids the scenario never declared, and never reveals the same twist twice', async () => {
    const inventing: ActorClient = {
      reply: async () => ({ utterance: 'Fine.', firedTwistIds: ['made-up#rev-9', 'erp-friday-release#rev-2'], reaction: { type: 'objection', factors: ['tone_threat', 'invented_factor'] }, stance: 'resisting' }),
      outOfCharacter: async () => '',
    };
    const { controller } = await harness({}, { actor: inventing });
    await controller.start();
    await controller.submitUserTurn('first', 'text');
    await controller.submitUserTurn('second', 'text');
    const events = controller.record.causalEvents;
    expect(events.filter((e) => e.eventType === 'revelation').map((e) => e.scenarioFactRefs[0])).toEqual(['erp-friday-release#rev-2']);
    const objection = events.find((e) => e.eventType === 'actor_objection')!;
    expect(objection.epistemicStatus).toBe('model_interpretation');
    expect(objection.explanationFactors).toEqual(['tone_threat']);
  });

  it('a provider failure adds no turn, and retrying completes the same step exactly once', async () => {
    let calls = 0;
    const demo = new DemoActorClient();
    const flaky: ActorClient = {
      reply: async (input) => {
        if (++calls === 1) throw new ProviderError('network', 'offline', true);
        return demo.reply(input);
      },
      outOfCharacter: demo.outOfCharacter.bind(demo),
    };
    const { controller } = await harness({}, { actor: flaky });
    await controller.start();
    await controller.submitUserTurn('What evidence do we have?', 'text');
    expect(controller.record.status).toBe('error');
    expect(controller.record.errorMessage).toBe('offline');
    expect(controller.record.turns).toHaveLength(2);
    await controller.retryAfterError();
    expect(controller.record.status).toBe('user_turn');
    expect(controller.record.turns).toHaveLength(3);
    expect(calls).toBe(2);
  });

  it('pausing cancels an in-flight reply; resuming re-issues it without duplicates', async () => {
    let release: (() => void) | undefined;
    const demo = new DemoActorClient();
    let calls = 0;
    const slow: ActorClient = {
      reply: async (input, signal) => {
        calls++;
        if (calls === 1) await new Promise<void>((resolve) => { release = resolve; signal?.addEventListener('abort', () => resolve()); });
        return demo.reply(input);
      },
      outOfCharacter: demo.outOfCharacter.bind(demo),
    };
    const { controller } = await harness({}, { actor: slow });
    await controller.start();
    const pending = controller.submitUserTurn('What evidence do we have?', 'text');
    await new Promise((r) => setTimeout(r, 5));
    expect(controller.record.status).toBe('actor_turn');
    await controller.pause('user');
    release?.();
    await pending;
    expect(controller.record.status).toBe('paused');
    expect(controller.record.turns).toHaveLength(2);
    await controller.resume();
    expect(controller.record.status).toBe('user_turn');
    expect(controller.record.turns).toHaveLength(3);
  });

  it('socratic review asks first, waits untimed, then evaluates', async () => {
    const { controller, time } = await harness({ coachingMode: 'socratic_review', drillType: 'power_question' });
    await controller.start();
    await controller.submitUserTurn('What evidence do we need to ship Friday at an acceptable risk?', 'text');
    expect(controller.record.status).toBe('evaluating');
    expect(controller.record.socratic?.answer).toBeNull();
    expect(controller.record.evaluations).toEqual([]);
    const before = activeSeconds(controller.record, time.peek());
    time.advance(900); // fifteen minutes of reflection
    expect(activeSeconds(controller.record, time.peek())).toBe(before);
    await controller.answerSocratic('Nobody said who accepts the risk.');
    expect(controller.record.status).toBe('feedback');
    expect(controller.record.socratic?.answer).toBe('Nobody said who accepts the risk.');
    expect(controller.record.evaluations).toHaveLength(1);
    expect(activeSeconds(controller.record, time.peek())).toBeLessThan(before + 30);
  });

  it('reframing drill needs no generated actor turn and evaluates the single reframe', async () => {
    let actorCalls = 0;
    const counting: ActorClient = { reply: async () => { actorCalls++; throw new Error('should not be called'); }, outOfCharacter: async () => '' };
    const { controller } = await harness({ drillType: 'reframing' }, { actor: counting });
    await controller.start();
    const seed = liveTurns(controller.record)[0]!;
    expect(seed.role).toBe('narrator');
    expect(controller.world.scenario.reframingSeeds).toContain(seed.text);
    await controller.submitUserTurn('What evidence do we need to release on Friday at an acceptable risk?', 'text');
    expect(controller.record.status).toBe('feedback');
    expect(actorCalls).toBe(0);
  });

  it('ending early evaluates what was said; ending before saying anything abandons the session', async () => {
    const first = await harness();
    await first.controller.start();
    await first.controller.requestEnd();
    expect(first.controller.record.status).toBe('aborted');

    const second = await harness({ drillType: 'full_simulation' });
    await second.controller.start();
    await second.controller.submitUserTurn('What evidence do we have?', 'text');
    await second.controller.requestEnd();
    expect(second.controller.record.status).toBe('feedback');
    expect(second.controller.record.evaluations).toHaveLength(1);
  });

  it('with personalization off, no memory is read or proposed', async () => {
    const { controller, store } = await harness({}, { personalization: false } as Partial<ControllerDeps>);
    await controller.start();
    await controller.submitUserTurn('What evidence do we have?', 'text');
    await controller.requestEnd();
    // Deterministic consolidation still records the outcome locally, but nothing was marked as used.
    await controller.acknowledgeFeedback();
    expect([...store.records.values()].every((m) => m.lastUsedAt === null)).toBe(true);
  });
});
