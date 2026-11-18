import type { ParsedDoc } from '../content/markdown';
import { docFromSnapshot, snapshotOf, type ContentRegistry } from '../content/registry';
import {
  DRILLS,
  liveTurns,
  newId,
  SCHEMA_VERSION,
  userTurns,
  type AppLocale,
  type CoachingMode,
  type Difficulty,
  type DrillType,
  type InteractionMode,
  type LearningPointer,
  type ModelSnapshot,
  type PauseEvent,
  type SessionRecord,
  type Turn,
} from '../domain/types';
import type { ActorClient, CoachClient } from '../llm/clients';
import type { MemoryManager } from '../memory/memoryManager';
import { buildScenarioModel, deriveCausalEvents, type ActorSignal, type ScenarioModel } from '../scenario/scenarioEngine';
import { actorRequestKey, isFinishing, isTerminal, reduceSession, remainingSeconds, type SessionEvent } from './sessionMachine';

export interface SessionConfig {
  scenarioId: string;
  interactionMode: InteractionMode;
  difficulty: Difficulty;
  coachingMode: CoachingMode;
  drillType: DrillType;
  plannedDurationSeconds: number;
  locale: AppLocale;
  spokenLocale: AppLocale;
  contentLocale: AppLocale;
  coachId?: string;
}

export const DEFAULT_COACH_ID = 'executive-coach';

export async function createSessionRecord(
  config: SessionConfig,
  registry: ContentRegistry,
  models: ModelSnapshot,
  now: string,
): Promise<SessionRecord> {
  // Driving is listening and reflection only; simulations under pressure are never offered there.
  if (config.interactionMode === 'driving') throw new Error('driving_has_no_simulation');
  const scenario = registry.resolve('scenario', config.scenarioId, config.contentLocale);
  if (!scenario) throw new Error('scenario_not_found');
  const declared = (scenario.doc.meta.actor_ids as string[]).slice();
  // Difficulty changes the conditions: on easy only the primary stakeholder is in the room.
  const wanted = config.difficulty === 'easy' ? declared.slice(0, 1) : declared;
  const actors = wanted.map((id) => registry.resolve('actor', id, config.contentLocale)).filter((a) => a !== undefined);
  if (actors.length === 0 || actors[0]!.doc.id !== declared[0]) throw new Error('actor_not_found');
  const coach =
    registry.resolve('coach', config.coachId ?? DEFAULT_COACH_ID, config.contentLocale) ?? registry.list('coach', config.contentLocale)[0];
  if (!coach) throw new Error('coach_not_found');
  const snapshots = await Promise.all([scenario, ...actors, coach].map(snapshotOf));
  return {
    id: newId('session'),
    schemaVersion: SCHEMA_VERSION,
    locale: config.locale,
    spokenLocale: config.spokenLocale,
    contentLocale: config.contentLocale,
    interactionMode: config.interactionMode,
    difficulty: config.difficulty,
    coachingMode: config.coachingMode,
    drillType: config.drillType,
    scenarioId: scenario.doc.id,
    actorIds: actors.map((a) => a.doc.id),
    coachId: coach.doc.id,
    status: 'created',
    plannedDurationSeconds: config.plannedDurationSeconds,
    activeElapsedSeconds: 0,
    pausedElapsedSeconds: 0,
    activeSince: null,
    startedAt: null,
    endedAt: null,
    pauseEvents: [],
    timeExpired: false,
    endRequested: false,
    maxUserTurns: DRILLS[config.drillType].maxUserTurns,
    turns: [],
    snapshots,
    models,
    evaluations: [],
    summary: null,
    retries: 0,
    causalEvents: [],
    outcome: { finalStance: null, revealedTwistIds: [] },
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A/B replay: same scenario facts, actors, coach and rubric, frozen from the original snapshots
 * even if the content was edited since. Generated wording will differ; the world does not.
 */
export function createReplayRecord(original: SessionRecord, models: ModelSnapshot, now: string): SessionRecord {
  return {
    ...original,
    id: newId('session'),
    status: 'created',
    resumeStatus: undefined,
    errorMessage: undefined,
    activeElapsedSeconds: 0,
    pausedElapsedSeconds: 0,
    activeSince: null,
    startedAt: null,
    endedAt: null,
    pauseEvents: [],
    timeExpired: false,
    endRequested: false,
    turns: [],
    models,
    evaluations: [],
    summary: null,
    retries: 0,
    causalEvents: [],
    outcome: { finalStance: null, revealedTwistIds: [] },
    socratic: undefined,
    replayOf: original.replayOf ?? original.id,
    createdAt: now,
    updatedAt: now,
  };
}

export interface SessionWorld {
  scenario: ScenarioModel;
  actors: Map<string, ParsedDoc>;
  coach: ParsedDoc;
}

export function worldOf(record: SessionRecord): SessionWorld {
  const scenarioSnap = record.snapshots.find((s) => s.kind === 'scenario');
  const coachSnap = record.snapshots.find((s) => s.kind === 'coach');
  if (!scenarioSnap || !coachSnap) throw new Error('session_snapshot_missing');
  const actors = new Map<string, ParsedDoc>();
  for (const s of record.snapshots) if (s.kind === 'actor') actors.set(s.id, docFromSnapshot(s));
  return { scenario: buildScenarioModel(docFromSnapshot(scenarioSnap)), actors, coach: docFromSnapshot(coachSnap) };
}

/** Deterministic turn-taking: the primary stakeholder leads; others interject on alternate turns. */
export function nextSpeaker(record: SessionRecord, closing: boolean): string {
  const [primary, ...others] = record.actorIds;
  const spoken = liveTurns(record).filter((t) => t.role === 'actor').length;
  if (closing || others.length === 0 || spoken % 2 === 0) return primary!;
  return others[Math.floor(spoken / 2) % others.length]!;
}

export interface ControllerDeps {
  actor: ActorClient;
  coach: CoachClient;
  memory: MemoryManager;
  save(record: SessionRecord): Promise<void>;
  saveLearningPointers(pointers: LearningPointer[]): Promise<void>;
  now(): string;
  personalization: boolean;
  profileText: string;
}

type Listener = (record: SessionRecord) => void;

/**
 * Orchestrates one session around the pure state machine: it runs whatever side effect the
 * current state owes (an actor reply, an evaluation), persists every transition, and makes sure a
 * failed or cancelled provider call can be retried without ever producing a duplicate turn.
 */
export class SessionController {
  private listeners = new Set<Listener>();
  private inflight: AbortController | null = null;
  private finalized = false;
  readonly world: SessionWorld;

  constructor(
    public record: SessionRecord,
    private readonly deps: ControllerDeps,
  ) {
    this.world = worldOf(record);
    this.finalized = isTerminal(record.status);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get busy(): boolean {
    return this.inflight !== null;
  }

  private async dispatch(event: SessionEvent): Promise<void> {
    const next = reduceSession(this.record, event);
    if (next === this.record) return;
    this.record = next;
    await this.deps.save(next);
    for (const listener of this.listeners) listener(next);
  }

  /** Runs the side effect owed by the current state, if any. Safe to call repeatedly. */
  async advance(): Promise<void> {
    if (this.inflight) return;
    const { status } = this.record;
    if (status === 'actor_turn') await this.runActorTurn();
    else if (status === 'evaluating') await this.runEvaluation();
    else if (status === 'completed' && !this.finalized) {
      this.finalized = true;
      await this.deps.memory.consolidate(this.record, this.world.scenario.title, this.deps.now());
    }
  }

  private async guarded(work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController();
    this.inflight = controller;
    try {
      await work(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        await this.dispatch({ type: 'FAILED', at: this.deps.now(), message: (error as Error)?.message ?? 'unknown error' });
      }
    } finally {
      if (this.inflight === controller) this.inflight = null;
    }
    if (!controller.signal.aborted) await this.advance();
  }

  private async runActorTurn(): Promise<void> {
    await this.guarded(async (signal) => {
      const record = this.record;
      const requestKey = actorRequestKey(record);
      const { scenario, actors } = this.world;
      const live = liveTurns(record);
      const drill = DRILLS[record.drillType];
      const base = { id: newId('turn'), index: record.turns.length, createdAt: '' };
      let turn: Turn;
      let signalOut: ActorSignal | null = null;

      if (!drill.actorReplies) {
        // Reframing: the narrator hands over a blunt-but-true statement to rework. No generation.
        const seeds = scenario.reframingSeeds.length ? scenario.reframingSeeds : [scenario.opening];
        turn = { ...base, role: 'narrator', text: seeds[record.retries % seeds.length]! };
      } else if (live.length === 0) {
        // The opening line is scripted by the scenario, so every run starts from the same pressure.
        turn = { ...base, role: 'actor', actorId: record.actorIds[0]!, text: scenario.opening, stance: 'resisting' };
      } else {
        const closing = isFinishing(record);
        const actorId = nextSpeaker(record, closing);
        const actor = actors.get(actorId);
        if (!actor) throw new Error('actor_not_found');
        const observableHistory = this.deps.personalization
          ? await this.deps.memory.retrieve({ audience: 'actor', entityId: actorId, excludeSessionId: record.id, now: this.deps.now() })
          : [];
        signalOut = await this.deps.actor.reply({ actor, scenario, record, actors, closing, observableHistory }, signal);
        turn = { ...base, role: 'actor', actorId, text: signalOut.utterance, stance: signalOut.stance, ...(closing ? { closing: true } : {}) };
      }
      if (signal.aborted) return;
      const at = this.deps.now();
      turn.createdAt = at;
      const causalEvents = signalOut
        ? deriveCausalEvents({
            scenario,
            record,
            actorTurnId: turn.id,
            triggerTurnId: userTurns(record).at(-1)?.id ?? null,
            signal: signalOut,
            now: at,
          })
        : [];
      await this.dispatch({ type: 'ACTOR_REPLIED', at, requestKey, turn, causalEvents });
    });
  }

  private coachContext() {
    return {
      coach: this.world.coach,
      scenario: this.world.scenario,
      record: this.record,
      actors: this.world.actors,
      profile: this.deps.personalization ? this.deps.profileText : '',
    };
  }

  private async runEvaluation(): Promise<void> {
    const record = this.record;
    if (record.coachingMode === 'socratic_review' && record.socratic && record.socratic.answer === null) return; // waiting for the trainee
    await this.guarded(async (signal) => {
      const memories = this.deps.personalization
        ? await this.deps.memory.retrieve({ audience: 'coach', tags: [record.scenarioId, record.difficulty], now: this.deps.now() })
        : [];
      if (record.coachingMode === 'socratic_review' && !record.socratic) {
        const question = await this.deps.coach.socraticQuestion({ ...this.coachContext(), memories }, signal);
        if (!signal.aborted) await this.dispatch({ type: 'SOCRATIC_ASKED', at: this.deps.now(), question });
        return;
      }
      const evaluated = new Set(record.evaluations.map((e) => e.evaluation.turnId));
      const pending = userTurns(record).filter((t) => !evaluated.has(t.id));
      const turnIds = (record.coachingMode === 'immediate' ? pending.slice(-1) : pending).map((t) => t.id);
      if (turnIds.length === 0) {
        await this.dispatch({ type: 'EVALUATED', at: this.deps.now(), evaluations: [], summary: null });
        return;
      }
      const result = await this.deps.coach.evaluate({ ...this.coachContext(), memories, turnIds }, this.deps.now(), signal);
      if (signal.aborted) return;
      const at = this.deps.now();
      await this.dispatch({
        type: 'EVALUATED',
        at,
        evaluations: result.evaluations,
        summary: result.summary || result.restSuggestion ? { text: result.summary, restSuggestion: result.restSuggestion } : null,
      });
      if (this.deps.personalization) {
        await this.deps.memory.propose(result.memoryProposals, {
          sessionId: record.id,
          validTurnIds: new Set(record.turns.map((t) => t.id)),
          locale: record.spokenLocale,
          tags: [record.scenarioId, record.difficulty],
          now: at,
        });
      }
      await this.deps.saveLearningPointers(
        result.learningPointers.map((lp) => ({
          schemaVersion: SCHEMA_VERSION,
          id: newId('learning'),
          concept: lp.concept,
          reason: lp.reason,
          evidenceRefs: [{ sessionId: record.id }],
          action: 'save_for_next_session',
          status: 'pending',
          locale: record.spokenLocale,
          createdAt: at,
        })),
      );
    });
  }

  private cancelInflight(): void {
    this.inflight?.abort();
    this.inflight = null;
  }

  async start(): Promise<void> {
    await this.dispatch({ type: 'PREPARED', at: this.deps.now() });
    await this.dispatch({ type: 'STARTED', at: this.deps.now() });
    await this.advance();
  }

  async submitUserTurn(text: string, inputMode: 'voice' | 'text'): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.record.status !== 'user_turn') return;
    const at = this.deps.now();
    const turn: Turn = { id: newId('turn'), index: this.record.turns.length, role: 'user', text: trimmed.slice(0, 6000), inputMode, createdAt: at };
    await this.dispatch({ type: 'USER_SUBMITTED', at, turn });
    await this.advance();
  }

  async answerSocratic(answer: string | null): Promise<void> {
    await this.dispatch({ type: 'SOCRATIC_ANSWERED', at: this.deps.now(), answer: answer?.trim().slice(0, 4000) ?? null });
    await this.advance();
  }

  async requestEnd(): Promise<void> {
    await this.dispatch({ type: 'END_REQUESTED', at: this.deps.now() });
    await this.advance();
  }

  async acknowledgeFeedback(): Promise<void> {
    await this.dispatch({ type: 'FEEDBACK_ACKNOWLEDGED', at: this.deps.now() });
    await this.advance();
  }

  async retryTurn(): Promise<void> {
    await this.dispatch({ type: 'RETRY_TURN', at: this.deps.now() });
  }

  /** Pausing cancels any in-flight provider call; resuming re-issues it under the same request key. */
  async pause(reason: PauseEvent['reason']): Promise<void> {
    this.cancelInflight();
    await this.dispatch({ type: 'PAUSED', at: this.deps.now(), reason });
  }

  async resume(): Promise<void> {
    await this.dispatch({ type: 'RESUMED', at: this.deps.now() });
    await this.advance();
  }

  async retryAfterError(): Promise<void> {
    await this.dispatch({ type: 'RECOVERED', at: this.deps.now() });
    await this.advance();
  }

  async extend(extraSeconds: number): Promise<void> {
    await this.dispatch({ type: 'EXTENDED', at: this.deps.now(), extraSeconds });
  }

  async abort(): Promise<void> {
    this.cancelInflight();
    await this.dispatch({ type: 'ABORTED', at: this.deps.now() });
  }

  /** Called periodically by the UI. Expiry only raises a flag; the current turn always finishes. */
  async tick(): Promise<void> {
    if (!this.record.timeExpired && this.record.activeSince && remainingSeconds(this.record, this.deps.now()) <= 0) {
      await this.dispatch({ type: 'TIME_EXPIRED', at: this.deps.now() });
    }
  }

  dispose(): void {
    this.cancelInflight();
    this.listeners.clear();
  }
}
