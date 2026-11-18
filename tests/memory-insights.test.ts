import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEURISTICS,
  RUBRIC_VERSION,
  SCHEMA_VERSION,
  type Difficulty,
  type MemoryRecord,
  type SessionRecord,
  type Skill,
} from '../src/domain/types';
import { createSessionRecord } from '../src/engine/sessionController';
import {
  buildSwot,
  compareSessions,
  computeStats,
  detectPlateau,
  fatigueSignal,
  recommendNext,
  swotStage,
  trendOf,
} from '../src/insights/insights';
import { readEnvProviders } from '../src/llm/env';
import { applyProposals, MemoryManager, selectMemories } from '../src/memory/memoryManager';
import { matchVoiceCommand } from '../src/speech/speechAdapter';
import { buildBriefing } from '../src/ui/screens/Driving';
import { config, harness, memoryStore, MODELS, registry } from './helpers';

const day = (n: number) => new Date(Date.parse('2026-10-01T09:00:00Z') + n * 86_400_000).toISOString();
let counter = 0;

async function session(opts: { n: number; scenarioId?: string; difficulty?: Difficulty; scores?: Partial<Record<Skill, number>>; text?: string; replayOf?: string; activeSeconds?: number }): Promise<SessionRecord> {
  const base = await createSessionRecord(config({ scenarioId: opts.scenarioId ?? 'erp-friday-release', difficulty: opts.difficulty ?? 'medium' }), registry(), MODELS, day(opts.n));
  const turnId = `turn-${++counter}`;
  return {
    ...base,
    status: 'completed',
    startedAt: day(opts.n),
    activeElapsedSeconds: opts.activeSeconds ?? 240,
    turns: [{ id: turnId, index: 0, role: 'user', text: opts.text ?? `unique statement number ${counter} about a different topic entirely`, createdAt: day(opts.n) }],
    evaluations: [
      {
        createdAt: day(opts.n),
        droppedQuotes: [],
        evaluation: {
          rubricVersion: RUBRIC_VERSION, turnId, scores: opts.scores ?? { diplomacy: 2 }, strengths: [], risks: [], missedAssumptions: [], evidenceQuotes: [],
          reframe: { needed: false, suggestion: null, rationale: '' }, recommendedAction: '', confidence: 'medium', insufficientContext: false,
        },
      },
    ],
    ...(opts.replayOf ? { replayOf: opts.replayOf } : {}),
  };
}

const many = (count: number, make: (i: number) => Parameters<typeof session>[0]) => Promise.all(Array.from({ length: count }, (_, i) => session(make(i))));
const SCENARIOS = ['erp-friday-release', 'ai-six-week-launch', 'automation-40-percent'];

describe('memory manager', () => {
  const ctx = { sessionId: 's1', validTurnIds: new Set(['t1', 't2']), locale: 'en' as const, tags: ['erp-friday-release'], now: day(1) };
  const proposal = { scope: 'coach' as const, kind: 'hypothesis', content: 'Frames risks categorically.', turnIds: ['t1', 'ghost'], confidence: 0.6 };

  it('persists model proposals as provisional, coach-private records with validated provenance', () => {
    const [record] = applyProposals([], [proposal], ctx);
    expect(record).toMatchObject({ scope: 'coach', status: 'provisional', visibility: 'coach_private', confidence: 0.6 });
    expect(record!.sourceRefs).toEqual([{ sessionId: 's1', turnId: 't1' }]);
  });

  it('merges a repeated observation instead of duplicating it, accumulating evidence', () => {
    const first = applyProposals([], [proposal], ctx);
    const second = applyProposals(first, [{ ...proposal, content: 'frames risks categorically', turnIds: ['t2'] }], { ...ctx, sessionId: 's2' });
    expect(second).toHaveLength(1);
    expect(second[0]!.id).toBe(first[0]!.id);
    expect(second[0]!.sourceRefs).toEqual([{ sessionId: 's1', turnId: 't1' }, { sessionId: 's2', turnId: 't2' }]);
  });

  it('a revision supersedes the earlier hypothesis and keeps it for provenance', () => {
    const first = applyProposals([], [proposal], ctx);
    const changed = applyProposals(first, [{ ...proposal, content: 'Categorical framing appears only under time pressure.', supersedes: [first[0]!.id, 'unknown'] }], ctx);
    const old = changed.find((m) => m.id === first[0]!.id)!;
    const fresh = changed.find((m) => m.id !== first[0]!.id)!;
    expect(old.status).toBe('superseded');
    expect(old.content).toBe('Frames risks categorically.');
    expect(fresh.supersedes).toEqual([first[0]!.id]);
  });

  it('promotes a hypothesis to supported only after three distinct sessions agree', async () => {
    const store = memoryStore();
    const manager = new MemoryManager(store);
    const s = await session({ n: 1 });
    for (const sessionId of ['s1', 's2']) await manager.propose([proposal], { ...ctx, sessionId });
    await manager.consolidate(s, 'ERP', day(2));
    expect([...store.records.values()].find((m) => m.scope === 'coach')!.status).toBe('provisional');
    await manager.propose([proposal], { ...ctx, sessionId: 's3' });
    await manager.consolidate(s, 'ERP', day(3));
    expect([...store.records.values()].find((m) => m.scope === 'coach')!.status).toBe('supported');
  });

  it('actors retrieve only observable history about themselves; coach notes never leak', async () => {
    const { controller, store, deps } = await harness();
    await controller.start();
    await controller.submitUserTurn('What evidence do we have on failure tests?', 'text');
    await controller.requestEnd();
    await controller.acknowledgeFeedback();
    await deps.memory.propose([proposal], { ...ctx, sessionId: controller.record.id });
    const all = [...store.records.values()];
    const forCeo = selectMemories(all, { audience: 'actor', entityId: 'ceo-impatient', now: day(5) });
    expect(forCeo.map((m) => m.kind)).toEqual(['prior_interaction']);
    expect(forCeo[0]!.content).toContain('What evidence do we have on failure tests?');
    expect(forCeo[0]!.content).not.toMatch(/\/4|stance|score/);
    expect(selectMemories(all, { audience: 'actor', entityId: 'cfo-skeptical', now: day(5) })).toEqual([]);
    // Not about the session currently being played: that would be the present, not a memory.
    expect(selectMemories(all, { audience: 'actor', entityId: 'ceo-impatient', excludeSessionId: controller.record.id, now: day(5) })).toEqual([]);
    const forCoach = selectMemories(all, { audience: 'coach', now: day(5) });
    expect(forCoach.map((m) => m.scope).sort()).toEqual(['coach', 'long_term']);
  });

  it('retrieval respects the token budget and skips superseded records', () => {
    const make = (id: string, patch: Partial<MemoryRecord>): MemoryRecord => ({
      id, schemaVersion: SCHEMA_VERSION, scope: 'coach', kind: 'h', content: 'x'.repeat(400), sourceRefs: [], counterEvidenceRefs: [], status: 'provisional',
      createdAt: day(0), updatedAt: day(0), lastUsedAt: null, locale: 'en', visibility: 'coach_private', supersedes: [], ...patch,
    });
    const all = [make('a', { status: 'supported' }), make('b', {}), make('c', { status: 'superseded' }), make('d', { tags: ['erp'] })];
    const picked = selectMemories(all, { audience: 'coach', tags: ['erp'], tokenBudget: 200, now: day(1) });
    expect(picked.map((m) => m.id)).toEqual(['d', 'a']);
  });

  it('rebuilds references after a session is deleted and removes evidence-less derived records', async () => {
    const store = memoryStore();
    const manager = new MemoryManager(store);
    await manager.propose([proposal], { ...ctx, sessionId: 's1' });
    await manager.propose([proposal], { ...ctx, sessionId: 's2' });
    await manager.propose([{ ...proposal, content: 'Only seen once.' }], { ...ctx, sessionId: 's1' });
    await manager.setUserFact('mem-user-profile', 'profile', 'CTO', 'en', day(1));
    expect(await manager.rebuildReferences(new Set(['s2']))).toEqual({ updated: 1, removed: 1 });
    const left = await manager.inspect();
    expect(left.map((m) => m.scope).sort()).toEqual(['coach', 'user']);
    expect(left.find((m) => m.scope === 'coach')!.sourceRefs).toEqual([{ sessionId: 's2', turnId: 't1' }]);
  });
});

describe('dashboard statistics and evidence discipline', () => {
  it('flags sparse evidence instead of overclaiming', async () => {
    const stats = computeStats(await many(2, (i) => ({ n: i, scores: { diplomacy: 4 } })), DEFAULT_HEURISTICS);
    const diplomacy = stats.skills.find((s) => s.skill === 'diplomacy')!;
    expect(diplomacy).toMatchObject({ mean: 4, n: 2, sessions: 2, lowEvidence: true, trend: 'unknown' });
    expect(stats.skills.find((s) => s.skill === 'assertiveness')).toMatchObject({ mean: null, n: 0 });
    expect(stats.oralRatio).toBe(0);
  });

  it('computes trends only from enough points', () => {
    expect(trendOf([1, 4])).toBe('unknown');
    expect(trendOf([1, 1, 3, 3])).toBe('improving');
    expect(trendOf([3, 3, 1, 1])).toBe('declining');
    expect(trendOf([2, 2, 2, 2.2])).toBe('stable');
  });

  it('SWOT stages: observe below 5, hypothesize below 10, provisional only with varied evidence', async () => {
    const h = DEFAULT_HEURISTICS;
    const strong = { diplomacy: 4 };
    expect(buildSwot(await many(4, (i) => ({ n: i, scores: strong })), h, day(50))).toMatchObject({ stage: 'observe', items: [] });
    const seven = await many(7, (i) => ({ n: i, scores: strong, scenarioId: SCENARIOS[i % 3] }));
    const hypothesis = buildSwot(seven, h, day(50));
    expect(hypothesis.stage).toBe('hypothesize');
    expect(hypothesis.items.find((x) => x.quadrant === 'strength')).toMatchObject({ status: 'candidate', confidence: 'low', claimKey: 'swot.consistentlyStrong' });
    // Twelve sessions on one scenario and one difficulty are numerous but not diverse.
    expect(swotStage(await many(12, (i) => ({ n: i, scores: strong })), h)).toBe('hypothesize');
    const varied = await many(12, (i) => ({ n: i, scores: strong, scenarioId: SCENARIOS[i % 3], difficulty: i % 2 ? 'hard' : 'medium' }));
    const provisional = buildSwot(varied, h, day(50));
    expect(provisional.stage).toBe('provisional');
    expect(provisional.items.find((x) => x.quadrant === 'strength')).toMatchObject({ status: 'provisional', confidence: 'medium' });
  });

  it('a SWOT item cites its evidence and its counterexamples, and one bad session creates no weakness', async () => {
    const sessions = [
      ...(await many(6, (i) => ({ n: i, scores: { diplomacy: 4 }, scenarioId: SCENARIOS[i % 3] }))),
      await session({ n: 7, scores: { diplomacy: 0 }, scenarioId: 'ai-six-week-launch' }),
    ];
    const swot = buildSwot(sessions, DEFAULT_HEURISTICS, day(50));
    expect(swot.items.some((x) => x.quadrant === 'weakness')).toBe(false);
    const strength = swot.items.find((x) => x.quadrant === 'strength')!;
    expect(strength.behavioralEvidence).toHaveLength(6);
    expect(strength.counterEvidence).toEqual([{ sessionId: sessions[6]!.id }]);
  });

  it('detects low scenario diversity and near-identical phrasing as tentative signals only', async () => {
    const same = await many(5, (i) => ({ n: i, text: 'I cannot commit to Friday without evidence on retries and reconciliation' }));
    expect(detectPlateau(same).map((s) => s.key).sort()).toEqual(['signal.lowDiversity', 'signal.repeatedPhrasing']);
    const varied = await many(5, (i) => ({ n: i, scenarioId: SCENARIOS[i % 3], difficulty: i % 2 ? 'easy' : 'hard' }));
    expect(detectPlateau(varied)).toEqual([]);
    expect(detectPlateau(same.slice(0, 3))).toEqual([]);
  });

  it('flags replays that outscore fresh attempts, and a comfortable level', async () => {
    const fresh = await many(3, (i) => ({ n: i, scores: { diplomacy: 1 }, scenarioId: SCENARIOS[i % 3], difficulty: i % 2 ? 'easy' : 'hard' }));
    const replays = await many(2, (i) => ({ n: 5 + i, scores: { diplomacy: 4 }, scenarioId: SCENARIOS[i], replayOf: fresh[0]!.id, difficulty: i ? 'easy' : 'hard' }));
    expect(detectPlateau([...fresh, ...replays]).map((s) => s.key)).toContain('signal.replayNotTransferring');
    const comfy = await many(5, (i) => ({ n: i, scores: { diplomacy: 3 }, scenarioId: SCENARIOS[i % 3], difficulty: 'easy' }));
    expect(detectPlateau(comfy).map((s) => s.key)).toEqual(['signal.comfortableLevel']);
  });

  it('suggests rest after a long training day without penalising anything', async () => {
    const today = await many(2, () => ({ n: 3, activeSeconds: 50 * 60 }));
    expect(fatigueSignal(today, day(3))?.params.minutes).toBe(100);
    expect(fatigueSignal(today, day(4))).toBeNull();
    expect(computeStats(today, DEFAULT_HEURISTICS).skills.find((s) => s.skill === 'diplomacy')!.mean).toBe(2);
  });

  it('recommends deterministically, targets weak or unpractised skills and enforces scenario variety', async () => {
    const scenarios = [
      { id: 'erp-friday-release', primarySkills: ['evidence_accountability', 'diplomacy'] as Skill[] },
      { id: 'ai-six-week-launch', primarySkills: ['assertiveness', 'diplomacy'] as Skill[] },
      { id: 'automation-40-percent', primarySkills: ['business_framing'] as Skill[] },
    ];
    expect(recommendNext([], scenarios, DEFAULT_HEURISTICS)).toMatchObject({ scenarioId: 'ai-six-week-launch', skill: 'assertiveness', reasonKey: 'recommend.underPracticed', mode: 'walk' });
    const practised = [
      ...(await many(2, (i) => ({ n: i, scores: { evidence_accountability: 3, diplomacy: 1, assertiveness: 3, business_framing: 3 }, scenarioId: 'automation-40-percent' }))),
      ...(await many(2, (i) => ({ n: 3 + i, scores: { evidence_accountability: 3, diplomacy: 1, assertiveness: 3, business_framing: 3 }, scenarioId: 'erp-friday-release' }))),
    ];
    const next = recommendNext(practised, scenarios, DEFAULT_HEURISTICS);
    expect(next).toMatchObject({ skill: 'diplomacy', reasonKey: 'recommend.weakest', scenarioId: 'ai-six-week-launch' });
    expect(recommendNext(practised, scenarios, DEFAULT_HEURISTICS)).toEqual(next);
  });

  it('A/B comparison reports per-skill deltas and whether the facts were identical', async () => {
    const a = await session({ n: 1, scores: { diplomacy: 1, conciseness: 3 } });
    const b = await session({ n: 2, scores: { diplomacy: 3 } });
    const { rows, sameFacts } = compareSessions(a, b);
    expect(sameFacts).toBe(true);
    expect(rows.find((r) => r.skill === 'diplomacy')).toMatchObject({ a: 1, b: 3, delta: 2 });
    expect(rows.find((r) => r.skill === 'conciseness')).toMatchObject({ a: 3, b: null, delta: null });
    const other = await session({ n: 3, scenarioId: 'ai-six-week-launch' });
    expect(compareSessions(a, other).sameFacts).toBe(false);
  });
});

describe('providers from .env, voice commands and driving', () => {
  it('offers exactly the providers whose keys are present and honours the preferred one', () => {
    expect(readEnvProviders({})).toEqual({ providers: [], preferred: null });
    const env = readEnvProviders({
      VITE_OPENAI_API_KEY: ' sk-o ', VITE_OPENAI_MODEL: 'gpt-x', VITE_GEMINI_API_KEY: 'g-key', VITE_GEMINI_COACH_MODEL: 'gemini-pro',
      VITE_ANTHROPIC_API_KEY: '', VITE_DEFAULT_PROVIDER: 'gemini',
    });
    expect(env.providers.map((p) => p.kind)).toEqual(['openai', 'gemini']);
    expect(env.providers[0]).toMatchObject({ apiKey: 'sk-o', actorModel: 'gpt-x', coachModel: 'gpt-x' });
    expect(env.providers[1]).toMatchObject({ actorModel: '', coachModel: 'gemini-pro' });
    expect(env.preferred).toBe('gemini');
    expect(readEnvProviders({ VITE_ANTHROPIC_API_KEY: 'k' }).preferred).toBe('anthropic');
    expect(readEnvProviders({ VITE_CUSTOM_BASE_URL: 'http://localhost:11434/v1' }).providers[0]).toMatchObject({ kind: 'openai_compatible', apiKey: '' });
  });

  it('matches voice commands only as whole utterances, in the spoken language', () => {
    expect(matchVoiceCommand('Pausa.', 'es-ES')).toBe('pause');
    expect(matchVoiceCommand('Terminar sesión', 'es-ES')).toBe('end');
    expect(matchVoiceCommand('end session', 'en')).toBe('end');
    expect(matchVoiceCommand('I would not pause the project', 'en')).toBeNull();
    expect(matchVoiceCommand('pausa', 'en')).toBeNull();
  });

  it('builds a listening-only driving briefing from local data with reflection pauses', async () => {
    const last = { ...(await session({ n: 1 })), summary: { text: 'You asked for evidence.', restSuggestion: null } };
    const segments = buildBriefing({
      locale: 'en', lastSession: last, pointers: [],
      questions: [1, 2, 3, 4].map((i) => ({ id: `q${i}`, schemaVersion: 1, category: 'evidence' as const, locale: 'en' as const, text: `Question ${i}?`, whenToUse: '', whenNotToUse: '', skills: [], builtin: true, createdAt: '', updatedAt: '' })),
      reflectionSeconds: 30,
    });
    const texts = segments.map((s) => s.text);
    expect(texts[0]).toMatch(/Keep your attention on the road/);
    expect(texts).toContain('You asked for evidence.');
    expect(texts.filter((t) => /^Question \d\?$/.test(t))).toHaveLength(3);
    expect(segments.filter((s) => s.pauseSeconds === 30)).toHaveLength(3);
    expect(buildBriefing({ locale: 'es-ES', lastSession: undefined, pointers: [], questions: [], reflectionSeconds: 15 }).map((s) => s.text).join(' ')).toMatch(/carretera/);
  });
});
