import {
  DRILLS,
  liveTurns,
  userTurns,
  type CausalEvent,
  type PauseEvent,
  type SessionRecord,
  type SessionStatus,
  type SessionSummary,
  type StoredEvaluation,
  type Turn,
} from '../domain/types';

// Deterministic session state machine (SPECS §5, §17). The reducer is pure: every transition takes
// an explicit timestamp, so timing, pause accounting and provider-failure handling are testable.
//
// Flow, end_of_kata / socratic_review:
//   created → ready → actor_turn ⇄ user_turn … → actor_turn (closing) → evaluating → feedback → completed
// Flow, immediate:
//   … user_turn → evaluating → feedback → actor_turn … → completed

export type SessionEvent =
  | { type: 'PREPARED'; at: string }
  | { type: 'STARTED'; at: string }
  | { type: 'ACTOR_REPLIED'; at: string; requestKey: string; turn: Turn; causalEvents: CausalEvent[] }
  | { type: 'USER_SUBMITTED'; at: string; turn: Turn }
  | { type: 'END_REQUESTED'; at: string }
  | { type: 'TIME_EXPIRED'; at: string }
  | { type: 'EXTENDED'; at: string; extraSeconds: number }
  | { type: 'EVALUATED'; at: string; evaluations: StoredEvaluation[]; summary: SessionSummary | null }
  | { type: 'SOCRATIC_ASKED'; at: string; question: string }
  | { type: 'SOCRATIC_ANSWERED'; at: string; answer: string | null }
  | { type: 'FEEDBACK_ACKNOWLEDGED'; at: string }
  | { type: 'RETRY_TURN'; at: string }
  | { type: 'PAUSED'; at: string; reason: PauseEvent['reason'] }
  | { type: 'RESUMED'; at: string }
  | { type: 'FAILED'; at: string; message: string }
  | { type: 'RECOVERED'; at: string }
  | { type: 'ABORTED'; at: string };

/** States in which the training clock runs. Feedback and Coach Dialogue never consume time. */
const TIMED: SessionStatus[] = ['actor_turn', 'user_turn', 'evaluating'];
const TERMINAL: SessionStatus[] = ['completed', 'aborted'];

export function isTerminal(status: SessionStatus): boolean {
  return TERMINAL.includes(status);
}

function secondsBetween(from: string, to: string): number {
  return Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000);
}

/** Active seconds including the currently running segment. */
export function activeSeconds(record: SessionRecord, now: string): number {
  return record.activeElapsedSeconds + (record.activeSince ? secondsBetween(record.activeSince, now) : 0);
}

export function remainingSeconds(record: SessionRecord, now: string): number {
  return Math.max(0, record.plannedDurationSeconds - activeSeconds(record, now));
}

/** Stable key for the actor request owed in the current state; replies with another key are ignored. */
export function actorRequestKey(record: SessionRecord): string {
  return `${record.id}:${liveTurns(record).length}:${record.retries}`;
}

export function isFinishing(record: SessionRecord): boolean {
  return record.endRequested || record.timeExpired || userTurns(record).length >= record.maxUserTurns;
}

/** The Socratic question is waiting for the trainee: reflection time is never charged to the kata. */
function awaitingReflection(record: SessionRecord): boolean {
  return record.socratic !== undefined && record.socratic.answer === null;
}

function enter(record: SessionRecord, status: SessionStatus, at: string): SessionRecord {
  const wasTimed = TIMED.includes(record.status);
  const willBeTimed = TIMED.includes(status);
  let { activeElapsedSeconds, activeSince } = record;
  if (wasTimed && activeSince && !willBeTimed) {
    activeElapsedSeconds += secondsBetween(activeSince, at);
    activeSince = null;
  } else if (willBeTimed && !activeSince && !(status === 'evaluating' && awaitingReflection(record))) {
    activeSince = at;
  }
  return {
    ...record,
    status,
    activeElapsedSeconds,
    activeSince,
    endedAt: isTerminal(status) ? at : record.endedAt,
    updatedAt: at,
  };
}

function closePause(record: SessionRecord, at: string): SessionRecord {
  const last = record.pauseEvents[record.pauseEvents.length - 1];
  if (!last || last.resumedAt) return record;
  return {
    ...record,
    pausedElapsedSeconds: record.pausedElapsedSeconds + secondsBetween(last.pausedAt, at),
    pauseEvents: [...record.pauseEvents.slice(0, -1), { ...last, resumedAt: at }],
  };
}

export function reduceSession(record: SessionRecord, event: SessionEvent): SessionRecord {
  const { status } = record;
  const drill = DRILLS[record.drillType];
  switch (event.type) {
    case 'PREPARED':
      return status === 'created' ? enter(record, 'ready', event.at) : record;

    case 'STARTED':
      if (status !== 'ready') return record;
      return enter({ ...record, startedAt: event.at }, 'actor_turn', event.at);

    case 'ACTOR_REPLIED': {
      // Stale or duplicated provider responses must never append a second turn.
      if (status !== 'actor_turn' || event.requestKey !== actorRequestKey(record)) return record;
      const withTurn: SessionRecord = {
        ...record,
        turns: [...record.turns, event.turn],
        causalEvents: [...record.causalEvents, ...event.causalEvents],
        outcome: {
          finalStance: event.turn.stance ?? record.outcome.finalStance,
          revealedTwistIds: [
            ...new Set([
              ...record.outcome.revealedTwistIds,
              ...event.causalEvents.filter((e) => e.eventType === 'revelation').flatMap((e) => e.scenarioFactRefs),
            ]),
          ],
        },
      };
      if (!isFinishing(withTurn)) return enter(withTurn, 'user_turn', event.at);
      return enter(withTurn, record.coachingMode === 'immediate' ? 'completed' : 'evaluating', event.at);
    }

    case 'USER_SUBMITTED': {
      if (status !== 'user_turn') return record;
      const withTurn = { ...record, turns: [...record.turns, event.turn] };
      if (record.coachingMode === 'immediate' || !drill.actorReplies) return enter(withTurn, 'evaluating', event.at);
      return enter(withTurn, 'actor_turn', event.at);
    }

    case 'END_REQUESTED': {
      if (isTerminal(status)) return record;
      const flagged = { ...record, endRequested: true, updatedAt: event.at };
      // Ending while it is the trainee's turn: nothing more to say, go straight to evaluation.
      if (status !== 'user_turn') return flagged;
      if (userTurns(record).length === 0) return enter(flagged, 'aborted', event.at);
      return enter(flagged, record.coachingMode === 'immediate' ? 'completed' : 'evaluating', event.at);
    }

    case 'TIME_EXPIRED':
      // Expiry only raises a flag: the current turn always finishes first (SPECS §17).
      return isTerminal(status) || record.timeExpired ? record : { ...record, timeExpired: true, updatedAt: event.at };

    case 'EXTENDED':
      return {
        ...record,
        plannedDurationSeconds: record.plannedDurationSeconds + event.extraSeconds,
        timeExpired: false,
        updatedAt: event.at,
      };

    case 'SOCRATIC_ASKED':
      if (status !== 'evaluating') return record;
      return {
        ...record,
        socratic: { question: event.question, answer: null },
        activeElapsedSeconds: record.activeElapsedSeconds + (record.activeSince ? secondsBetween(record.activeSince, event.at) : 0),
        activeSince: null,
        updatedAt: event.at,
      };

    case 'SOCRATIC_ANSWERED':
      if (!record.socratic || record.socratic.answer !== null) return record;
      return {
        ...record,
        socratic: { ...record.socratic, answer: event.answer ?? '' },
        activeSince: status === 'evaluating' ? event.at : record.activeSince,
        updatedAt: event.at,
      };

    case 'EVALUATED': {
      if (status !== 'evaluating') return record;
      const known = new Set(record.evaluations.map((e) => e.evaluation.turnId));
      const fresh = event.evaluations.filter((e) => !known.has(e.evaluation.turnId));
      return enter(
        { ...record, evaluations: [...record.evaluations, ...fresh], summary: event.summary ?? record.summary },
        'feedback',
        event.at,
      );
    }

    case 'FEEDBACK_ACKNOWLEDGED': {
      if (status !== 'feedback') return record;
      const continues = record.coachingMode === 'immediate' && drill.actorReplies;
      const last = liveTurns(record).at(-1);
      // Immediate mode: the actor still owes a reply (possibly the closing one) to the last user turn.
      if (continues && last?.role === 'user') return enter(record, 'actor_turn', event.at);
      return enter(record, 'completed', event.at);
    }

    case 'RETRY_TURN': {
      // Coach retry prompt: same pressure, same facts, a second attempt. The first stays on record.
      if (status !== 'feedback' || record.coachingMode !== 'immediate') return record;
      const last = liveTurns(record).at(-1);
      if (!last || last.role !== 'user') return record;
      return enter(
        {
          ...record,
          retries: record.retries + 1,
          turns: record.turns.map((t) => (t.id === last.id ? { ...t, superseded: true } : t)),
        },
        'user_turn',
        event.at,
      );
    }

    case 'PAUSED': {
      if (isTerminal(status) || status === 'paused' || status === 'error' || status === 'created') return record;
      if (status === 'feedback' || status === 'ready') return record; // untimed states need no pause
      const paused = enter({ ...record, resumeStatus: status }, 'paused', event.at);
      return { ...paused, pauseEvents: [...record.pauseEvents, { pausedAt: event.at, reason: event.reason }] };
    }

    case 'RESUMED': {
      if (status !== 'paused') return record;
      const target = record.resumeStatus ?? 'user_turn';
      return enter({ ...closePause(record, event.at), resumeStatus: undefined }, target, event.at);
    }

    case 'FAILED':
      if (isTerminal(status) || status === 'error') return record;
      return enter(
        { ...record, resumeStatus: status === 'paused' ? record.resumeStatus : status, errorMessage: event.message },
        'error',
        event.at,
      );

    case 'RECOVERED': {
      if (status !== 'error') return record;
      const target = record.resumeStatus ?? 'ready';
      return enter({ ...record, resumeStatus: undefined, errorMessage: undefined }, target, event.at);
    }

    case 'ABORTED':
      return isTerminal(status) ? record : enter(closePause(record, event.at), 'aborted', event.at);
  }
}

/**
 * Normalizes a record loaded after a page reload: a running clock cannot be trusted across a
 * reload, so an in-flight session comes back paused at the moment it was last persisted.
 */
export function restoreAfterReload(record: SessionRecord, now: string): SessionRecord {
  if (!TIMED.includes(record.status)) return record;
  const frozenAt = record.updatedAt;
  const paused = reduceSession(record, { type: 'PAUSED', at: frozenAt, reason: 'reload' });
  return { ...paused, updatedAt: now };
}
