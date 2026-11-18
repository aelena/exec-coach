import { parse as parseYaml } from 'yaml';
import { SKILLS, SKILL_ALIASES, type Skill } from '../domain/types';

// Imported Markdown is untrusted input: sizes are bounded, frontmatter is parsed as plain data,
// and nothing here is ever rendered as HTML.

export const MAX_SOURCE_CHARS = 24_000;
export const MAX_SECTION_CHARS = 8_000;

export type ContentKind = 'actor' | 'scenario' | 'coach' | 'profile';

export const CANONICAL_ACTOR_HEADINGS = [
  '# Identity',
  '## Objectives',
  '## Communication Style',
  '## Behavior and Pressure Tactics',
  '## Adaptation to Trainee',
  '## Knowledge Boundaries',
  '## Interaction Rules',
  '## Scenario Hooks',
] as const;

/** Required level-2 sections of scenario-v1, compared case-insensitively. Headings stay English in all locales. */
export const SCENARIO_REQUIRED_SECTIONS = [
  'setting',
  'user mandate',
  'opening',
  'learning objectives',
  'public context',
  'hidden world state',
  'revelation rules',
  'causal debrief notes',
] as const;

export interface Issue {
  code: string;
  params?: Record<string, string | number>;
}

export interface Section {
  level: number;
  heading: string;
  body: string;
}

export interface ParsedDoc {
  kind: ContentKind;
  id: string;
  language: string;
  version: number;
  meta: Record<string, unknown>;
  title: string;
  sections: Section[];
  source: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  doc?: ParsedDoc;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
const LANGUAGES = ['en', 'es-ES'];
const PRESSURE_LEVELS = ['low', 'medium', 'high'];

export function splitFrontmatter(source: string): { meta: Record<string, unknown>; body: string } | null {
  const normalized = source.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) return null;
  let meta: unknown;
  try {
    meta = parseYaml(match[1] ?? '', { schema: 'core', maxAliasCount: 0 });
  } catch {
    return null;
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  return { meta: meta as Record<string, unknown>, body: match[2] ?? '' };
}

export function parseSections(body: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of body.split('\n')) {
    const heading = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = { level: heading[1]!.length, heading: heading[2]!, body: '' };
      sections.push(current);
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  for (const s of sections) s.body = s.body.trim();
  return sections;
}

export function sectionBody(doc: ParsedDoc, heading: string): string {
  const wanted = heading.toLowerCase();
  return doc.sections.find((s) => s.heading.toLowerCase() === wanted)?.body ?? '';
}

export function normalizeSkill(name: string): Skill | null {
  if ((SKILLS as readonly string[]).includes(name)) return name as Skill;
  return SKILL_ALIASES[name] ?? null;
}

function requireString(meta: Record<string, unknown>, key: string, errors: Issue[]): string {
  const value = meta[key];
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push({ code: 'missing_field', params: { field: key } });
    return '';
  }
  return value;
}

export function validateContent(source: string, expectedKind?: ContentKind): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (source.length > MAX_SOURCE_CHARS) {
    return { ok: false, errors: [{ code: 'too_large', params: { max: MAX_SOURCE_CHARS } }], warnings };
  }
  const split = splitFrontmatter(source);
  if (!split) return { ok: false, errors: [{ code: 'bad_frontmatter' }], warnings };
  const { meta, body } = split;

  const kind = meta.type;
  if (kind !== 'actor' && kind !== 'scenario' && kind !== 'coach' && kind !== 'profile') {
    return { ok: false, errors: [{ code: 'unknown_type', params: { type: String(kind) } }], warnings };
  }
  if (expectedKind && kind !== expectedKind) {
    errors.push({ code: 'wrong_type', params: { expected: expectedKind, actual: kind } });
  }
  const id = requireString(meta, 'id', errors);
  if (id && !ID_PATTERN.test(id)) errors.push({ code: 'bad_id', params: { id } });
  if (meta.schema_version !== 1) errors.push({ code: 'bad_schema_version' });
  if (typeof meta.version !== 'number' || !Number.isInteger(meta.version) || meta.version < 1) {
    errors.push({ code: 'missing_field', params: { field: 'version' } });
  }
  const language = requireString(meta, 'language', errors);
  if (language && !LANGUAGES.includes(language)) errors.push({ code: 'bad_language', params: { language } });

  const sections = parseSections(body);
  for (const s of sections) {
    if (s.body.length > MAX_SECTION_CHARS) {
      errors.push({ code: 'section_too_large', params: { heading: s.heading, max: MAX_SECTION_CHARS } });
    }
  }
  let title = sections.find((s) => s.level === 1)?.heading ?? id;

  if (kind === 'actor') {
    title = requireString(meta, 'name', errors) || title;
    requireString(meta, 'role', errors);
    if (!PRESSURE_LEVELS.includes(String(meta.pressure_level))) {
      errors.push({ code: 'bad_pressure_level' });
    }
    const actual = sections.map((s) => `${'#'.repeat(s.level)} ${s.heading}`);
    const expected = [...CANONICAL_ACTOR_HEADINGS];
    if (actual.length !== expected.length || actual.some((h, i) => h !== expected[i])) {
      const missing = expected.filter((h) => !actual.includes(h));
      const extra = actual.filter((h) => !(expected as string[]).includes(h));
      errors.push({
        code: 'actor_headings',
        params: { missing: missing.join(', ') || '-', extra: extra.join(', ') || '-' },
      });
    }
    for (const s of sections) {
      if (s.body === '') errors.push({ code: 'empty_section', params: { heading: s.heading } });
    }
  } else if (kind === 'scenario') {
    const actorIds = meta.actor_ids;
    if (!Array.isArray(actorIds) || actorIds.length === 0 || actorIds.some((a) => typeof a !== 'string')) {
      errors.push({ code: 'missing_field', params: { field: 'actor_ids' } });
    }
    requireString(meta, 'user_role', errors);
    const skills = meta.primary_skills;
    if (!Array.isArray(skills) || skills.length === 0) {
      errors.push({ code: 'missing_field', params: { field: 'primary_skills' } });
    } else {
      for (const s of skills) {
        const normalized = normalizeSkill(String(s));
        if (!normalized) errors.push({ code: 'unknown_skill', params: { skill: String(s) } });
        else if (normalized !== s) warnings.push({ code: 'skill_alias', params: { skill: String(s), canonical: normalized } });
      }
    }
    const present = sections.filter((s) => s.level === 2).map((s) => s.heading.toLowerCase());
    for (const required of SCENARIO_REQUIRED_SECTIONS) {
      if (!present.includes(required)) errors.push({ code: 'missing_section', params: { heading: required } });
      else if (sections.find((s) => s.heading.toLowerCase() === required)?.body === '') {
        errors.push({ code: 'empty_section', params: { heading: required } });
      }
    }
  } else if (kind === 'coach') {
    title = requireString(meta, 'name', errors) || title;
    requireString(meta, 'rubric', errors);
    if (body.trim().length < 40) errors.push({ code: 'empty_body' });
  } else {
    requireString(meta, 'role', errors);
    if (body.trim().length < 20) errors.push({ code: 'empty_body' });
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return {
    ok: true,
    errors,
    warnings,
    doc: { kind, id, language, version: meta.version as number, meta, title, sections, source },
  };
}

export async function contentHash(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source.replace(/\r\n/g, '\n'));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
