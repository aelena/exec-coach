import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANONICAL_ACTOR_HEADINGS, normalizeSkill, validateContent } from '../src/content/markdown';
import { readPack } from '../src/content/pack';
import { ContentRegistry } from '../src/content/registry';
import {
  EXPLANATION_FACTORS,
  PROVIDER_KINDS,
  QUESTION_CATEGORIES,
  SKILLS,
} from '../src/domain/types';
import { CATALOGS } from '../src/i18n';
import { seedQuestions } from '../src/questions/seed';
import { buildScenarioModel } from '../src/scenario/scenarioEngine';
import { strToU8, zipSync } from 'fflate';
// @ts-expect-error plain ESM helper script without types
import { collectKeys } from '../scripts/i18n-keys.mjs';
import { builtinContent, LANG_DIRS, readDir, registry, ROOT } from './helpers';

const manifest = JSON.parse(readFileSync(join(ROOT, 'content-manifest.json'), 'utf8')) as {
  pairs: Record<string, string[]>;
  canonicalActorHeadings: string[];
};
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const parse = (path: string) => {
  const result = validateContent(read(path));
  expect(result.errors, path).toEqual([]);
  return result.doc!;
};

describe('bilingual content parity (SPECS §27)', () => {
  it('every manifest file exists in both locales', () => {
    for (const [dir, files] of Object.entries(manifest.pairs)) {
      for (const file of files) for (const lang of Object.values(LANG_DIRS)) expect(existsSync(join(ROOT, dir, lang, file)), `${dir}/${lang}/${file}`).toBe(true);
    }
  });

  it('no content file exists outside the manifest', () => {
    for (const [dir, files] of Object.entries(manifest.pairs)) {
      for (const lang of Object.values(LANG_DIRS)) {
        expect(readDir(`${dir}/${lang}`).map((f) => f.path.split('/').pop()).sort()).toEqual([...files].sort());
      }
    }
  });

  it('all shipped content and templates validate', () => {
    expect(registry().problems).toEqual([]);
    for (const file of manifest.pairs.templates!) for (const lang of Object.values(LANG_DIRS)) parse(`templates/${lang}/${file}`);
  });

  it('paired files share id, type, versions and semantic keys; only language and prose differ', () => {
    const shared = ['id', 'type', 'schema_version', 'version', 'role', 'pressure_level', 'actor_ids', 'user_role', 'primary_skills', 'rubric'];
    for (const [dir, files] of Object.entries(manifest.pairs)) {
      for (const file of files) {
        const en = parse(`${dir}/en/${file}`);
        const es = parse(`${dir}/es/${file}`);
        expect(en.language).toBe('en');
        expect(es.language).toBe('es-ES');
        for (const key of shared) expect(es.meta[key], `${dir}/${file}:${key}`).toEqual(en.meta[key]);
        expect(Object.keys(es.meta).sort(), `${dir}/${file} frontmatter keys`).toEqual(Object.keys(en.meta).sort());
      }
    }
  });

  it('actors use exactly the canonical English headings in both locales', () => {
    expect(manifest.canonicalActorHeadings).toEqual([...CANONICAL_ACTOR_HEADINGS]);
    for (const file of manifest.pairs.voices!) {
      for (const lang of Object.values(LANG_DIRS)) {
        const doc = parse(`voices/${lang}/${file}`);
        expect(doc.sections.map((s) => `${'#'.repeat(s.level)} ${s.heading}`)).toEqual([...CANONICAL_ACTOR_HEADINGS]);
      }
    }
  });

  it('scenarios, coaches, profiles and templates have identical section structure across locales', () => {
    for (const dir of ['scenarios', 'coaches', 'profiles', 'templates']) {
      for (const file of manifest.pairs[dir]!) {
        const headings = (lang: string) => parse(`${dir}/${lang}/${file}`).sections.filter((s) => s.level === 2).map((s) => s.heading);
        expect(headings('es'), `${dir}/${file}`).toEqual(headings('en'));
      }
    }
  });

  it('scenarios use canonical skill names, known actors, and declare the same number of facts and rules per locale', () => {
    const reg = registry();
    for (const file of manifest.pairs.scenarios!) {
      const models = Object.values(LANG_DIRS).map((lang) => buildScenarioModel(parse(`scenarios/${lang}/${file}`)));
      for (const model of models) {
        for (const actorId of model.actorIds) expect(reg.ids('actor')).toContain(actorId);
        expect(model.opening.length).toBeGreaterThan(10);
        expect(model.opening).not.toMatch(/[«»]/); // speaker label and quotation marks stripped
        expect(model.twists.length).toBeGreaterThanOrEqual(2);
        expect(model.reframingSeeds.length).toBeGreaterThanOrEqual(1);
        for (const twist of model.twists) expect(twist.trigger, twist.id).not.toBe(twist.effect);
      }
      const doc = parse(`scenarios/en/${file}`);
      for (const skill of doc.meta.primary_skills as string[]) expect(normalizeSkill(skill)).toBe(skill);
      expect(models[1]!.twists.length).toBe(models[0]!.twists.length);
      expect(models[1]!.hiddenFacts.length).toBe(models[0]!.hiddenFacts.length);
    }
  });

  it('distributed docs exist in both languages and the root copies match docs/', () => {
    for (const [en, es] of [['DECISIONS.md', 'DECISIONES.md'], ['CONTENT.md', 'CONTENIDO.md'], ['README.md', 'README.md'], ['CONTEXT.md', 'CONTEXT.md']]) {
      expect(existsSync(join(ROOT, 'docs/en', en!))).toBe(true);
      expect(existsSync(join(ROOT, 'docs/es', es!))).toBe(true);
    }
    expect(read('docs/en/CONTEXT.md')).toBe(read('CONTEXT.en.md'));
    expect(read('docs/es/CONTEXT.md')).toBe(read('CONTEXT.md'));
    expect(existsSync(join(ROOT, 'README.md')) && existsSync(join(ROOT, 'README.en.md'))).toBe(true);
  });
});

describe('content validation of untrusted imports', () => {
  const actor = read('templates/en/actor.template.md');

  it('accepts a valid actor and rejects structural deviations', () => {
    expect(validateContent(actor).ok).toBe(true);
    expect(validateContent(actor.replace('## Objectives', '## Goals')).errors[0]?.code).toBe('actor_headings');
    expect(validateContent(actor.replace('pressure_level: medium', 'pressure_level: extreme')).errors[0]?.code).toBe('bad_pressure_level');
    expect(validateContent(actor.replace('id: custom-actor', 'id: Bad Id!')).errors[0]?.code).toBe('bad_id');
    expect(validateContent('no frontmatter').errors[0]?.code).toBe('bad_frontmatter');
    expect(validateContent(actor + 'x'.repeat(30_000)).errors[0]?.code).toBe('too_large');
  });

  it('accepts skill aliases in imports with a warning, rejects unknown skills', () => {
    const scenario = read('templates/en/scenario.template.md');
    const aliased = validateContent(scenario.replace('[assertiveness, assumption_detection]', '[evidence, brevity]'));
    expect(aliased.ok).toBe(true);
    expect(aliased.warnings.map((w) => w.code)).toEqual(['skill_alias', 'skill_alias']);
    expect(validateContent(scenario.replace('assumption_detection]', 'charisma]')).errors[0]?.code).toBe('unknown_skill');
    expect(validateContent(scenario.replace('## Hidden World State', '## Secrets')).errors[0]?.code).toBe('missing_section');
  });

  it('imports Markdown and ZIP packs at runtime, and user content overrides built-ins without a rebuild', () => {
    const custom = actor.replace('id: custom-actor', 'id: ceo-impatient').replace('name: Custom Executive', 'name: My CEO');
    const zip = zipSync({ 'pack/voices/en/ceo.md': strToU8(custom), 'pack/README.md': strToU8('# readme'), 'pack/bad.md': strToU8('nope') });
    const results = readPack('pack.zip', zip, '2026-11-18T00:00:00Z');
    expect(results.map((r) => [r.name, r.ok])).toEqual([['pack/voices/en/ceo.md', true], ['pack/bad.md', false]]);
    const reg = ContentRegistryWith(results[0]!.record!.source);
    expect(reg.resolve('actor', 'ceo-impatient', 'en')?.doc.title).toBe('My CEO');
    expect(reg.resolve('actor', 'ceo-impatient', 'en')?.custom).toBe(true);
    // The Spanish built-in is untouched: nothing is translated automatically.
    expect(reg.resolve('actor', 'ceo-impatient', 'es-ES')?.custom).toBe(false);
  });

  it('reports a fallback explicitly when a language variant is missing', () => {
    const onlyEn = actor.replace('id: custom-actor', 'id: only-english');
    const reg = ContentRegistryWith(onlyEn);
    const resolved = reg.resolve('actor', 'only-english', 'es-ES');
    expect(resolved?.doc.language).toBe('en');
    expect(resolved?.fallbackFrom).toBe('en');
    expect(reg.resolve('actor', 'ceo-impatient', 'es-ES')?.fallbackFrom).toBeUndefined();
  });
});

function ContentRegistryWith(source: string) {
  return new ContentRegistry([...builtinContent(), { path: 'custom/x', source, custom: true }]);
}

describe('i18n catalogs', () => {
  const en = CATALOGS.en;
  const es = CATALOGS['es-ES'];

  it('have identical keys and no empty values', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const catalog of [en, es]) for (const [key, value] of Object.entries(catalog)) expect(value.trim(), key).not.toBe('');
  });

  it('use the same placeholders in both languages', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en)) expect(placeholders(es[key]!), key).toEqual(placeholders(en[key]!));
  });

  it('define every key referenced in the source, including templated families', () => {
    const { literal, dynamic } = collectKeys(join(ROOT, 'src')) as { literal: string[]; dynamic: string[] };
    for (const key of literal) expect(en[key], key).toBeDefined();
    const families: Record<string, readonly string[]> = {
      'skill.': SKILLS,
      'category.': QUESTION_CATEGORIES,
      'factor.': EXPLANATION_FACTORS,
      'provider.': PROVIDER_KINDS,
      'difficulty.': ['easy', 'medium', 'hard'],
      'difficultyHint.': ['easy', 'medium', 'hard'],
      'coaching.': ['immediate', 'end_of_kata', 'socratic_review'],
      'drill.': ['quick_kata', 'full_simulation', 'power_question', 'reframing', 'executive_pressure', 'replay', 'review'],
      'drillHint.': ['quick_kata', 'full_simulation', 'power_question', 'reframing', 'executive_pressure'],
      'mode.': ['walk', 'desktop', 'driving'],
      'status.': ['created', 'ready', 'actor_turn', 'user_turn', 'evaluating', 'feedback', 'completed', 'paused', 'aborted', 'error'],
      'confidence.': ['low', 'medium', 'high'],
      'trend.': ['improving', 'declining', 'stable', 'unknown'],
      'stance.': ['resisting', 'neutral', 'opening'],
      'epistemic.': ['scenario_fact', 'model_interpretation', 'counterfactual'],
      'eventType.': ['revelation', 'actor_objection', 'actor_pressure', 'actor_concession'],
      'kind.': ['actor', 'scenario', 'coach', 'profile'],
      'locale.': ['en', 'es-ES'],
      'scope.': ['user', 'coach', 'long_term', 'entity'],
      'scopeHint.': ['coach', 'long_term', 'entity'],
      'memory.status.': ['provisional', 'supported', 'superseded'],
      'memory.visibility.': ['coach_private', 'user_visible', 'actor_observable'],
      'library.tab.': ['questions', 'content'],
      'swot.quadrant.': ['strength', 'weakness', 'opportunity', 'threat'],
      'swot.stage.': ['observe', 'hypothesize', 'provisional'],
      'swot.status.': ['candidate', 'provisional'],
      'speech.error.': ['not_supported', 'permission', 'no_speech', 'network', 'aborted', 'unknown'],
      'settings.heuristic.': ['swotHypothesizeAt', 'swotProvisionalAt', 'minScenarioVariety', 'sampleWarningBelow', 'oralTargetRatio'],
      'error.': ['auth', 'rate_limit', 'network', 'refusal', 'bad_request', 'server', 'truncated', 'no_key', 'invalid_output', 'scenario_not_found', 'actor_not_found', 'coach_not_found', 'driving_has_no_simulation', 'backup_too_large', 'backup_unreadable', 'backup_not_recognized', 'backup_newer_version'],
      'validation.': ['too_large', 'bad_frontmatter', 'unknown_type', 'wrong_type', 'missing_field', 'bad_id', 'bad_schema_version', 'bad_language', 'section_too_large', 'bad_pressure_level', 'actor_headings', 'empty_section', 'unknown_skill', 'skill_alias', 'missing_section', 'empty_body', 'bad_archive'],
    };
    for (const prefix of dynamic) {
      expect(families[prefix], `no declared family for templated key "${prefix}"`).toBeDefined();
      for (const member of families[prefix]!) expect(en[`${prefix}${member}`], `${prefix}${member}`).toBeDefined();
    }
  });

  it('ships the power-question library in both languages, one pair per seed', () => {
    const questions = seedQuestions('2026-11-18T00:00:00Z');
    const byLocale = (locale: string) => questions.filter((q) => q.locale === locale);
    expect(byLocale('en').length).toBe(byLocale('es-ES').length);
    for (const category of QUESTION_CATEGORIES) expect(byLocale('es-ES').some((q) => q.category === category), category).toBe(true);
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    for (const q of questions) expect(q.whenNotToUse.length, q.id).toBeGreaterThan(10);
  });
});
