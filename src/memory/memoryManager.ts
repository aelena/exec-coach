import {
  newId,
  SCHEMA_VERSION,
  SKILLS,
  USER_TEXT_LIMITS,
  userTurns,
  type AppLocale,
  type MemoryRecord,
  type MemoryScope,
  type SessionRecord,
  type SourceRef,
} from '../domain/types';
import { meanScore, normalizeForMatch, type MemoryProposal } from '../evaluation/validator';

// Local Memory Manager (SPECS §23). Five logical scopes; plain records in IndexedDB; no vector
// store and no agent framework. Models only *propose* memories — this code validates, merges and
// persists them. `short_term` is the live transcript of the current session and is never stored.

export interface MemoryStore {
  all(): Promise<MemoryRecord[]>;
  putMany(records: MemoryRecord[]): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface RetrieveQuery {
  audience: 'coach' | 'actor';
  /** Required for actors: only history with this simulated stakeholder is plausible to recall. */
  entityId?: string;
  tags?: string[];
  tokenBudget?: number;
  excludeSessionId?: string;
  now: string;
}

const COACH_SCOPES: MemoryScope[] = ['coach', 'long_term', 'user'];
const PROMOTE_AT_SESSIONS = 3;
const approxTokens = (text: string) => Math.ceil(text.length / 4);

const distinctSessions = (refs: SourceRef[]) => new Set(refs.map((r) => r.sessionId)).size;

function mergeRefs(a: SourceRef[], b: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((r) => {
    const key = `${r.sessionId}|${r.turnId ?? ''}|${r.dialogueId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Deterministic, explainable selection: scope and visibility first, then status, tags and recency. */
export function selectMemories(all: MemoryRecord[], query: RetrieveQuery): MemoryRecord[] {
  const candidates = all.filter((m) => {
    if (m.status === 'superseded') return false;
    if (query.audience === 'actor') {
      // Actors never see coach notes, SWOT or scores: only what they could have observed themselves.
      return m.scope === 'entity' && m.visibility === 'actor_observable' && m.entityId === query.entityId &&
        !m.sourceRefs.some((r) => r.sessionId === query.excludeSessionId);
    }
    return COACH_SCOPES.includes(m.scope);
  });
  const tags = new Set(query.tags ?? []);
  const nowMs = Date.parse(query.now);
  const score = (m: MemoryRecord) => {
    const ageDays = Math.max(0, (nowMs - Date.parse(m.updatedAt)) / 86_400_000);
    const overlap = (m.tags ?? []).filter((t) => tags.has(t)).length;
    return (m.status === 'supported' ? 2 : 1) + (m.scope === 'user' ? 3 : 0) + overlap * 2 + 1 / (1 + ageDays / 30);
  };
  const ranked = candidates
    .map((m) => ({ m, s: score(m) }))
    .sort((a, b) => b.s - a.s || a.m.id.localeCompare(b.m.id));
  const budget = query.tokenBudget ?? (query.audience === 'actor' ? 250 : 700);
  const selected: MemoryRecord[] = [];
  let used = 0;
  for (const { m } of ranked) {
    const cost = approxTokens(m.content);
    if (used + cost > budget) continue;
    selected.push(m);
    used += cost;
  }
  return selected;
}

export interface ProposalContext {
  sessionId: string;
  dialogueId?: string;
  validTurnIds: Set<string>;
  locale: AppLocale;
  tags: string[];
  now: string;
}

/** Applies validated proposals to the record set and returns only the records that changed. */
export function applyProposals(all: MemoryRecord[], proposals: MemoryProposal[], ctx: ProposalContext): MemoryRecord[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  const changed = new Map<string, MemoryRecord>();
  for (const proposal of proposals) {
    const turnRefs = proposal.turnIds.filter((id) => ctx.validTurnIds.has(id));
    const refs: SourceRef[] = (turnRefs.length ? turnRefs : [undefined]).map((turnId) => ({
      sessionId: ctx.sessionId,
      ...(turnId ? { turnId } : {}),
      ...(ctx.dialogueId ? { dialogueId: ctx.dialogueId } : {}),
    }));
    const needle = normalizeForMatch(proposal.content);
    const current = [...byId.values()].map((m) => changed.get(m.id) ?? m);
    const duplicate = current.find(
      (m) => m.status !== 'superseded' && m.scope === proposal.scope && m.kind === proposal.kind && normalizeForMatch(m.content) === needle,
    );
    if (duplicate) {
      changed.set(duplicate.id, { ...duplicate, sourceRefs: mergeRefs(duplicate.sourceRefs, refs), updatedAt: ctx.now });
      continue;
    }
    // A revision keeps the prior version for provenance and marks it superseded; nothing is erased.
    const supersedes = (proposal.supersedes ?? []).filter((id) => {
      const old = byId.get(id);
      return old && (old.scope === 'coach' || old.scope === 'long_term') && old.status !== 'superseded';
    });
    for (const id of supersedes) changed.set(id, { ...byId.get(id)!, status: 'superseded', updatedAt: ctx.now });
    const record: MemoryRecord = {
      id: newId('mem'),
      schemaVersion: SCHEMA_VERSION,
      scope: proposal.scope,
      kind: proposal.kind,
      content: proposal.content,
      sourceRefs: refs,
      counterEvidenceRefs: [],
      ...(proposal.confidence !== undefined ? { confidence: proposal.confidence } : {}),
      status: 'provisional',
      createdAt: ctx.now,
      updatedAt: ctx.now,
      lastUsedAt: null,
      locale: ctx.locale,
      visibility: 'coach_private',
      supersedes,
      tags: ctx.tags,
    };
    byId.set(record.id, record);
    changed.set(record.id, record);
  }
  return [...changed.values()];
}

const OBSERVED: Record<AppLocale, (title: string, date: string, quotes: string) => string> = {
  en: (title, date, quotes) => `In an earlier meeting ("${title}", ${date}) this person said: ${quotes}`,
  'es-ES': (title, date, quotes) => `En una reunión anterior («${title}», ${date}) esta persona dijo: ${quotes}`,
};

/** Deterministic records derived from a finished session; ids are stable so re-running is idempotent. */
export function deriveSessionMemories(record: SessionRecord, scenarioTitle: string, now: string): MemoryRecord[] {
  const turns = userTurns(record);
  if (turns.length === 0) return [];
  const base = {
    schemaVersion: SCHEMA_VERSION,
    counterEvidenceRefs: [],
    status: 'supported' as const,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    locale: record.spokenLocale,
    supersedes: [],
    tags: [record.scenarioId, record.difficulty],
  };
  const date = (record.startedAt ?? record.createdAt).slice(0, 10);
  const quotes = turns.map((t) => `"${t.text.length > 220 ? `${t.text.slice(0, 220)}…` : t.text}"`).join(' / ');
  const records: MemoryRecord[] = record.actorIds.map((actorId) => ({
    ...base,
    id: `mem-ent-${record.id}-${actorId}`,
    scope: 'entity',
    kind: 'prior_interaction',
    // Only the trainee's own words: something the stakeholder plausibly witnessed.
    content: OBSERVED[record.spokenLocale](scenarioTitle, date, quotes),
    sourceRefs: turns.map((t) => ({ sessionId: record.id, turnId: t.id })),
    visibility: 'actor_observable',
    entityId: actorId,
  }));
  const scored = SKILLS.map((skill) => ({ skill, stat: meanScore(record.evaluations, skill) })).filter((s) => s.stat);
  if (scored.length > 0) {
    records.push({
      ...base,
      id: `mem-out-${record.id}`,
      scope: 'long_term',
      kind: 'session_outcome',
      content: `${scenarioTitle} [${record.difficulty}, ${record.interactionMode}, ${record.drillType}] — ${scored
        .map((s) => `${s.skill} ${s.stat!.mean.toFixed(1)}/4`)
        .join(', ')}; final stance: ${record.outcome.finalStance ?? 'n/a'}; retries: ${record.retries}`,
      sourceRefs: [{ sessionId: record.id }],
      visibility: 'user_visible',
    });
  }
  return records;
}

export class MemoryManager {
  constructor(private readonly store: MemoryStore) {}

  async retrieve(query: RetrieveQuery): Promise<MemoryRecord[]> {
    const selected = selectMemories(await this.store.all(), query);
    if (selected.length > 0) await this.store.putMany(selected.map((m) => ({ ...m, lastUsedAt: query.now })));
    return selected;
  }

  async propose(proposals: MemoryProposal[], ctx: ProposalContext): Promise<MemoryRecord[]> {
    if (proposals.length === 0) return [];
    const changed = applyProposals(await this.store.all(), proposals, ctx);
    await this.store.putMany(changed);
    return changed;
  }

  /** After a session: derive observable history and outcomes, then promote well-supported hypotheses. */
  async consolidate(record: SessionRecord, scenarioTitle: string, now: string): Promise<void> {
    await this.store.putMany(deriveSessionMemories(record, scenarioTitle, now));
    const promoted = (await this.store.all())
      .filter(
        (m) =>
          m.status === 'provisional' && m.scope === 'coach' &&
          distinctSessions(m.sourceRefs) >= PROMOTE_AT_SESSIONS && m.counterEvidenceRefs.length === 0,
      )
      .map((m) => ({ ...m, status: 'supported' as const, updatedAt: now }));
    await this.store.putMany(promoted);
  }

  inspect(): Promise<MemoryRecord[]> {
    return this.store.all();
  }

  export(): Promise<MemoryRecord[]> {
    return this.store.all();
  }

  delete(id: string): Promise<void> {
    return this.store.delete(id);
  }

  /** Facts the user supplies about themselves. Users correct facts here; coaching is challenged in dialogue. */
  async setUserFact(id: string, kind: string, content: string, locale: AppLocale, now: string): Promise<void> {
    if (!content.trim()) return this.store.delete(id);
    const existing = (await this.store.all()).find((m) => m.id === id);
    await this.store.putMany([
      {
        id,
        schemaVersion: SCHEMA_VERSION,
        scope: 'user',
        kind,
        content: content.trim().slice(0, USER_TEXT_LIMITS.profile),
        sourceRefs: [],
        counterEvidenceRefs: [],
        status: 'supported',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: existing?.lastUsedAt ?? null,
        locale,
        visibility: 'user_visible',
        supersedes: [],
      },
    ]);
  }

  /** Drops references to sessions that no longer exist and removes derived records left without evidence. */
  async rebuildReferences(existingSessionIds: Set<string>): Promise<{ updated: number; removed: number }> {
    let updated = 0;
    let removed = 0;
    for (const m of await this.store.all()) {
      const keep = (r: SourceRef) => existingSessionIds.has(r.sessionId);
      const sourceRefs = m.sourceRefs.filter(keep);
      const counterEvidenceRefs = m.counterEvidenceRefs.filter(keep);
      if (sourceRefs.length === m.sourceRefs.length && counterEvidenceRefs.length === m.counterEvidenceRefs.length) continue;
      if (sourceRefs.length === 0 && m.scope !== 'user') {
        await this.store.delete(m.id);
        removed++;
      } else {
        await this.store.putMany([{ ...m, sourceRefs, counterEvidenceRefs }]);
        updated++;
      }
    }
    return { updated, removed };
  }
}
