import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newId, SKILLS, type ProviderKind, type SessionRecord, type Skill, type Turn } from '../src/domain/types';
import { createSessionRecord, worldOf } from '../src/engine/sessionController';
import { createClients } from '../src/llm/clients';
import { config, MODELS, registry, ROOT } from './helpers';

// Coach calibration on curated fixtures (SPECS §8). The fixture format is always checked. The live
// run needs a real key and spends tokens, so it only executes when asked for explicitly:
//
//   CALIBRATION_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run calibrate
//   CALIBRATION_PROVIDER=openai    OPENAI_API_KEY=...    npm run calibrate
//   CALIBRATION_PROVIDER=gemini    GEMINI_API_KEY=...    npm run calibrate
//
// Optional: CALIBRATION_MODEL to override the provider's default coach model.

interface Fixture {
  id: string;
  scenarioId: string;
  note: string;
  userTurns: string[];
  expect: { scores?: Partial<Record<Skill, { min?: number; max?: number }>>; reframeNeeded?: boolean };
}

const fixtures = JSON.parse(readFileSync(join(ROOT, 'fixtures/calibration/fixtures.json'), 'utf8')) as Fixture[];
const provider = process.env.CALIBRATION_PROVIDER as ProviderKind | undefined;
const KEY_ENV: Partial<Record<ProviderKind, string>> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
const apiKey = provider ? (process.env[KEY_ENV[provider] ?? ''] ?? '') : '';

async function sessionFor(fixture: Fixture): Promise<SessionRecord> {
  const record = await createSessionRecord(config({ scenarioId: fixture.scenarioId }), registry(), MODELS, '2026-11-18T10:00:00Z');
  const { scenario } = worldOf(record);
  const turns: Turn[] = [{ id: newId('turn'), index: 0, role: 'actor', actorId: record.actorIds[0]!, text: scenario.opening, createdAt: record.createdAt }];
  for (const text of fixture.userTurns) turns.push({ id: newId('turn'), index: turns.length, role: 'user', text, createdAt: record.createdAt });
  return { ...record, turns };
}

describe('calibration fixtures', () => {
  it('are well-formed: six to ten cases over known scenarios and skills', async () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
    expect(fixtures.length).toBeLessThanOrEqual(10);
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length);
    for (const fixture of fixtures) {
      await sessionFor(fixture);
      for (const [skill, range] of Object.entries(fixture.expect.scores ?? {})) {
        expect(SKILLS, fixture.id).toContain(skill);
        expect((range.min ?? 0) <= (range.max ?? 4), fixture.id).toBe(true);
      }
    }
    // The set must include cases where no reframe is needed, so a coach that always rewrites fails.
    expect(fixtures.some((f) => f.expect.reframeNeeded === false)).toBe(true);
    expect(fixtures.some((f) => f.expect.reframeNeeded === true)).toBe(true);
  });
});

describe.skipIf(!provider || !apiKey)('live coach calibration', () => {
  for (const fixture of fixtures) {
    it(`${fixture.id}: ${fixture.note}`, { timeout: 180_000 }, async () => {
      const model = process.env.CALIBRATION_MODEL ?? '';
      const { coach } = createClients({ kind: provider!, baseUrl: '', actorModel: model, coachModel: model }, apiKey);
      const record = await sessionFor(fixture);
      const world = worldOf(record);
      const turnId = record.turns.at(-1)!.id;
      const result = await coach.evaluate(
        { coach: world.coach, scenario: world.scenario, record, actors: world.actors, profile: '', memories: [], turnIds: [turnId] },
        new Date().toISOString(),
      );
      const evaluation = result.evaluations.find((e) => e.evaluation.turnId === turnId)!.evaluation;
      expect(evaluation.evidenceQuotes.length, 'at least one verifiable quote').toBeGreaterThan(0);
      for (const [skill, range] of Object.entries(fixture.expect.scores ?? {}) as Array<[Skill, { min?: number; max?: number }]>) {
        const score = evaluation.scores[skill];
        expect(typeof score, `${skill} should be scored`).toBe('number');
        if (range.min !== undefined) expect(score as number, `${skill} >= ${range.min}`).toBeGreaterThanOrEqual(range.min);
        if (range.max !== undefined) expect(score as number, `${skill} <= ${range.max}`).toBeLessThanOrEqual(range.max);
      }
      if (fixture.expect.reframeNeeded !== undefined) expect(evaluation.reframe.needed).toBe(fixture.expect.reframeNeeded);
    });
  }
});
