import { newId, SCHEMA_VERSION, type CoachDialogue, type DialogueMessage, type SessionRecord } from '../domain/types';
import { worldOf } from '../engine/sessionController';
import type { ActorClient, CoachClient } from '../llm/clients';
import type { MemoryManager } from '../memory/memoryManager';

export interface DebriefDeps {
  coach: CoachClient;
  actor: ActorClient;
  memory: MemoryManager;
  saveDialogue(dialogue: CoachDialogue): Promise<void>;
  now(): string;
  personalization: boolean;
  profileText: string;
}

/**
 * Untimed conversational causal postmortem (SPECS §18, §26). The dialogue is its own record: it
 * never touches the session clock and never rewrites stored evaluations. When the coach's view
 * changes, that is captured as a new memory proposal that supersedes the old one, with provenance.
 */
export class DebriefService {
  constructor(private readonly deps: DebriefDeps) {}

  create(record: SessionRecord): CoachDialogue {
    const now = this.deps.now();
    return { id: newId('dialogue'), schemaVersion: SCHEMA_VERSION, relatedSessionIds: [record.id], createdAt: now, updatedAt: now, messages: [] };
  }

  private async append(dialogue: CoachDialogue, message: Omit<DialogueMessage, 'id' | 'timestamp'>): Promise<CoachDialogue> {
    const now = this.deps.now();
    const next = { ...dialogue, updatedAt: now, messages: [...dialogue.messages, { ...message, id: newId('msg'), timestamp: now }] };
    await this.deps.saveDialogue(next);
    return next;
  }

  /** Stores the trainee's question first, so it survives a reload even if the provider call fails. */
  async addUserMessage(dialogue: CoachDialogue, text: string): Promise<CoachDialogue> {
    return this.append(dialogue, { role: 'user', text: text.trim().slice(0, 4000) });
  }

  async coachReply(dialogue: CoachDialogue, record: SessionRecord, signal?: AbortSignal): Promise<CoachDialogue> {
    const world = worldOf(record);
    const memories = this.deps.personalization
      ? await this.deps.memory.retrieve({ audience: 'coach', tags: [record.scenarioId, record.difficulty], now: this.deps.now() })
      : [];
    const reply = await this.deps.coach.dialogue(
      {
        coach: world.coach,
        scenario: world.scenario,
        record,
        actors: world.actors,
        profile: this.deps.personalization ? this.deps.profileText : '',
        memories,
        dialogue,
      },
      signal,
    );
    const next = await this.append(dialogue, {
      role: 'coach',
      text: reply.segments.map((s) => s.text).join('\n\n'),
      segments: reply.segments,
      causalEventRefs: [...new Set(reply.segments.flatMap((s) => s.causalEventRefs))],
    });
    if (this.deps.personalization) {
      await this.deps.memory.propose(reply.memoryProposals, {
        sessionId: record.id,
        dialogueId: dialogue.id,
        validTurnIds: new Set(record.turns.map((t) => t.id)),
        locale: record.spokenLocale,
        tags: [record.scenarioId],
        now: this.deps.now(),
      });
    }
    return next;
  }

  /** Optional out-of-character explanation from the scenario rules, in a context separate from the coach. */
  async actorExplanation(dialogue: CoachDialogue, record: SessionRecord, actorId: string, question: string, signal?: AbortSignal): Promise<CoachDialogue> {
    const world = worldOf(record);
    const actor = world.actors.get(actorId);
    if (!actor) throw new Error('actor_not_found');
    const text = await this.deps.actor.outOfCharacter({ actor, scenario: world.scenario, record, actors: world.actors, question }, signal);
    return this.append(dialogue, { role: 'actor_ooc', text, epistemicStatus: 'model_interpretation' });
  }
}
