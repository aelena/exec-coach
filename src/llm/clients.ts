import type { ParsedDoc } from '../content/markdown';
import type { CoachDialogue, DialogueSegment, EpistemicStatus, ProviderSettings, SessionRecord } from '../domain/types';
import {
  parseCoachEvaluation,
  parseMemoryProposals,
  type CoachEvaluationResult,
  type MemoryProposal,
} from '../evaluation/validator';
import type { ActorSignal, ScenarioModel } from '../scenario/scenarioEngine';
import { AnthropicAdapter } from './anthropic';
import { PROVIDER_DEFAULTS } from './env';
import { GeminiAdapter } from './gemini';
import { DemoActorClient, DemoCoachClient } from './demo';
import { OpenAiCompatibleAdapter } from './openaiCompatible';
import {
  composeActorOutOfCharacterPrompt,
  composeActorPrompt,
  composeCoachEvaluationPrompt,
  composeDialoguePrompt,
  composeSocraticPrompt,
  type ActorPromptInput,
  type CoachContextInput,
} from './promptComposer';
import { extractJson, ProviderError, type ProviderAdapter } from './provider';

export interface DialogueReply {
  segments: DialogueSegment[];
  memoryProposals: MemoryProposal[];
}

export interface OutOfCharacterInput {
  actor: ParsedDoc;
  scenario: ScenarioModel;
  record: SessionRecord;
  actors: Map<string, ParsedDoc>;
  question: string;
}

/** Actor and coach are separate clients with separate prompt contexts; they never share state. */
export interface ActorClient {
  reply(input: ActorPromptInput, signal?: AbortSignal): Promise<ActorSignal>;
  outOfCharacter(input: OutOfCharacterInput, signal?: AbortSignal): Promise<string>;
}

export interface CoachClient {
  evaluate(input: CoachContextInput & { turnIds: string[] }, now: string, signal?: AbortSignal): Promise<CoachEvaluationResult>;
  socraticQuestion(input: CoachContextInput, signal?: AbortSignal): Promise<string>;
  dialogue(input: CoachContextInput & { dialogue: CoachDialogue }, signal?: AbortSignal): Promise<DialogueReply>;
}

const STANCES = ['resisting', 'neutral', 'opening'];
const REACTIONS = ['objection', 'pressure', 'concession', 'question', 'neutral'];
const STATUSES = ['scenario_fact', 'model_interpretation', 'counterfactual'];

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, max) : [];
}

export function parseActorSignal(text: string): ActorSignal {
  let raw: Record<string, unknown> | null = null;
  try {
    raw = extractJson(text) as Record<string, unknown>;
  } catch {
    raw = null;
  }
  // A model that ignores the format still produced a usable line; keep it and log no causal claims.
  const utterance = (typeof raw?.utterance === 'string' ? raw.utterance : raw ? '' : text).trim().slice(0, 1500);
  if (!utterance) throw new ProviderError('invalid_output', 'The actor returned an empty reply.', true);
  const reaction = (raw?.reaction ?? {}) as Record<string, unknown>;
  return {
    utterance,
    firedTwistIds: strings(raw?.firedTwistIds, 6),
    reaction: {
      type: (REACTIONS.includes(String(reaction.type)) ? reaction.type : 'neutral') as ActorSignal['reaction']['type'],
      factors: strings(reaction.factors, 2),
    },
    stance: (STANCES.includes(String(raw?.stance)) ? raw!.stance : 'neutral') as ActorSignal['stance'],
  };
}

export function parseDialogueReply(text: string, record: SessionRecord): DialogueReply {
  let raw: Record<string, unknown>;
  try {
    raw = extractJson(text) as Record<string, unknown>;
  } catch {
    const plain = text.trim();
    if (!plain) throw new ProviderError('invalid_output', 'The coach returned an empty reply.', true);
    return { segments: [{ text: plain, epistemicStatus: null, turnRefs: [], causalEventRefs: [] }], memoryProposals: [] };
  }
  const turnIds = new Set(record.turns.map((t) => t.id));
  const eventIds = new Set(record.causalEvents.map((e) => e.id));
  const segments: DialogueSegment[] = [];
  for (const item of Array.isArray(raw.segments) ? raw.segments.slice(0, 12) : []) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    if (typeof s.text !== 'string' || !s.text.trim()) continue;
    const causalEventRefs = strings(s.causalEventRefs, 8).filter((id) => eventIds.has(id));
    let status = (STATUSES.includes(String(s.epistemicStatus)) ? s.epistemicStatus : null) as EpistemicStatus | null;
    // A "fact" must be traceable. Without any valid reference it is downgraded to an interpretation.
    const turnRefs = strings(s.turnRefs, 8).filter((id) => turnIds.has(id));
    if (status === 'scenario_fact' && causalEventRefs.length === 0 && turnRefs.length === 0) status = 'model_interpretation';
    segments.push({ text: s.text.trim().slice(0, 2000), epistemicStatus: status, turnRefs, causalEventRefs });
  }
  if (segments.length === 0) throw new ProviderError('invalid_output', 'The coach reply had no usable content.', true);
  return { segments, memoryProposals: parseMemoryProposals(raw.memoryProposals) };
}

class LlmActorClient implements ActorClient {
  constructor(
    private readonly adapter: ProviderAdapter,
    private readonly model: string,
  ) {}

  async reply(input: ActorPromptInput, signal?: AbortSignal): Promise<ActorSignal> {
    const { system, user } = composeActorPrompt(input);
    const text = await this.adapter.complete({
      model: this.model,
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 4000,
      effort: 'low',
      signal,
    });
    return parseActorSignal(text);
  }

  async outOfCharacter(input: OutOfCharacterInput, signal?: AbortSignal): Promise<string> {
    const { system, user } = composeActorOutOfCharacterPrompt(input);
    const text = await this.adapter.complete({
      model: this.model,
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 4000,
      effort: 'low',
      signal,
    });
    return text.trim().slice(0, 2000);
  }
}

class LlmCoachClient implements CoachClient {
  constructor(
    private readonly adapter: ProviderAdapter,
    private readonly model: string,
  ) {}

  async evaluate(input: CoachContextInput & { turnIds: string[] }, now: string, signal?: AbortSignal): Promise<CoachEvaluationResult> {
    const { system, user } = composeCoachEvaluationPrompt(input);
    const text = await this.adapter.complete({
      model: this.model,
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 16000,
      effort: 'medium',
      signal,
    });
    const result = parseCoachEvaluation(extractJson(text), input.record, now);
    if (result.evaluations.length === 0) {
      throw new ProviderError('invalid_output', `The coach output failed validation: ${result.rejected.join(' | ') || 'no evaluations'}`, true);
    }
    return result;
  }

  async socraticQuestion(input: CoachContextInput, signal?: AbortSignal): Promise<string> {
    const { system, user } = composeSocraticPrompt(input);
    const text = await this.adapter.complete({
      model: this.model,
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 4000,
      effort: 'low',
      signal,
    });
    const question = text.trim().slice(0, 600);
    if (!question) throw new ProviderError('invalid_output', 'The coach returned an empty question.', true);
    return question;
  }

  async dialogue(input: CoachContextInput & { dialogue: CoachDialogue }, signal?: AbortSignal): Promise<DialogueReply> {
    const { system, messages } = composeDialoguePrompt(input);
    const text = await this.adapter.complete({ model: this.model, system, messages, maxTokens: 16000, effort: 'medium', signal });
    return parseDialogueReply(text, input.record);
  }
}

export function resolveModels(provider: ProviderSettings): { actorModel: string; coachModel: string } {
  if (provider.kind === 'demo') return { actorModel: 'demo-scripted', coachModel: 'demo-heuristic' };
  const fallback = PROVIDER_DEFAULTS[provider.kind].model;
  return { actorModel: provider.actorModel || fallback, coachModel: provider.coachModel || provider.actorModel || fallback };
}

export function createAdapter(provider: ProviderSettings, apiKey: string): ProviderAdapter {
  const defaults = PROVIDER_DEFAULTS[provider.kind];
  if (defaults.needsKey && !apiKey) throw new ProviderError('no_key', 'No API key is loaded for this provider.');
  const baseUrl = provider.baseUrl || defaults.baseUrl;
  switch (provider.kind) {
    case 'anthropic':
      return new AnthropicAdapter(apiKey, baseUrl || undefined);
    case 'gemini':
      return new GeminiAdapter(apiKey, baseUrl);
    case 'openai':
    case 'openai_compatible':
      if (!baseUrl) throw new ProviderError('bad_request', 'No endpoint URL is configured.');
      return new OpenAiCompatibleAdapter(apiKey, baseUrl);
    case 'demo':
      throw new ProviderError('bad_request', 'The demo provider has no network adapter.');
  }
}

export function createClients(provider: ProviderSettings, apiKey: string): { actor: ActorClient; coach: CoachClient } {
  if (provider.kind === 'demo') return { actor: new DemoActorClient(), coach: new DemoCoachClient() };
  const adapter = createAdapter(provider, apiKey);
  const { actorModel, coachModel } = resolveModels(provider);
  if (!actorModel || !coachModel) throw new ProviderError('bad_request', 'No model is configured.');
  return { actor: new LlmActorClient(adapter, actorModel), coach: new LlmCoachClient(adapter, coachModel) };
}

export async function checkConnection(provider: ProviderSettings, apiKey: string): Promise<void> {
  if (provider.kind === 'demo') return;
  const adapter = createAdapter(provider, apiKey);
  const { actorModel } = resolveModels(provider);
  if (!actorModel) throw new ProviderError('bad_request', 'No model is configured.');
  await adapter.complete({
    model: actorModel,
    system: 'Connection check.',
    messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    maxTokens: 1024,
    effort: 'low',
  });
}
