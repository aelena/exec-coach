import {
  liveTurns,
  RUBRIC_VERSION,
  SKILLS,
  type Evaluation,
  type SessionRecord,
  type Skill,
  type StoredEvaluation,
} from '../domain/types';

// Model output is untrusted. This validator mirrors schemas/evaluation.schema.json by hand (a
// compiled JSON-Schema validator would need `unsafe-eval`, which the CSP forbids); a unit test
// cross-checks both against the same fixtures. Evidence checks then tie claims to the transcript.

const TOP_LEVEL_KEYS = [
  'rubricVersion',
  'turnId',
  'scores',
  'strengths',
  'risks',
  'missedAssumptions',
  'evidenceQuotes',
  'reframe',
  'recommendedAction',
  'confidence',
  'insufficientContext',
] as const;

const MAX_TEXT = 1200;
const MAX_ITEMS = 8;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function validateEvaluationShape(value: unknown): { ok: true; evaluation: Evaluation } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['not an object'] };
  const v = value as Record<string, unknown>;
  for (const key of TOP_LEVEL_KEYS) if (!(key in v)) errors.push(`missing ${key}`);
  for (const key of Object.keys(v)) {
    if (!(TOP_LEVEL_KEYS as readonly string[]).includes(key)) errors.push(`unexpected ${key}`);
  }
  if (errors.length) return { ok: false, errors };

  if (typeof v.rubricVersion !== 'string') errors.push('rubricVersion must be a string');
  if (typeof v.turnId !== 'string') errors.push('turnId must be a string');
  if (!v.scores || typeof v.scores !== 'object' || Array.isArray(v.scores)) {
    errors.push('scores must be an object');
  } else {
    for (const [skill, score] of Object.entries(v.scores as Record<string, unknown>)) {
      if (!(SKILLS as readonly string[]).includes(skill)) errors.push(`unknown skill ${skill}`);
      else if (score !== null && !(Number.isInteger(score) && (score as number) >= 0 && (score as number) <= 4)) {
        errors.push(`score for ${skill} must be an integer 0-4 or null`);
      }
    }
  }
  for (const key of ['strengths', 'risks', 'missedAssumptions', 'evidenceQuotes'] as const) {
    if (!isStringArray(v[key])) errors.push(`${key} must be an array of strings`);
  }
  const reframe = v.reframe as Record<string, unknown> | null;
  if (!reframe || typeof reframe !== 'object' || Array.isArray(reframe)) {
    errors.push('reframe must be an object');
  } else {
    const keys = Object.keys(reframe).sort().join(',');
    if (keys !== 'needed,rationale,suggestion') errors.push('reframe must have exactly needed, suggestion, rationale');
    if (typeof reframe.needed !== 'boolean') errors.push('reframe.needed must be boolean');
    if (reframe.suggestion !== null && typeof reframe.suggestion !== 'string') errors.push('reframe.suggestion must be string or null');
    if (typeof reframe.rationale !== 'string') errors.push('reframe.rationale must be a string');
  }
  if (typeof v.recommendedAction !== 'string') errors.push('recommendedAction must be a string');
  if (v.confidence !== 'low' && v.confidence !== 'medium' && v.confidence !== 'high') errors.push('confidence must be low|medium|high');
  if (typeof v.insufficientContext !== 'boolean') errors.push('insufficientContext must be boolean');

  return errors.length ? { ok: false, errors } : { ok: true, evaluation: v as unknown as Evaluation };
}

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[«»"“”'‘’`.,;:!?¡¿()[\]…—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);
const clipList = (items: string[]) => items.slice(0, MAX_ITEMS).map(clip);

/**
 * Applies evidence discipline to a shape-valid evaluation:
 * - it must target a live trainee turn of this session;
 * - every quote must literally occur in the transcript, otherwise it is dropped and reported;
 * - a reframe is only kept when the coach says one is needed (no cosmetic rewrites).
 */
export function groundEvaluation(evaluation: Evaluation, record: SessionRecord, now: string): StoredEvaluation | null {
  const turns = liveTurns(record);
  const target = turns.find((t) => t.id === evaluation.turnId && t.role === 'user');
  if (!target) return null;
  const haystack = normalizeForMatch(turns.map((t) => t.text).join(' \n '));
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const quote of evaluation.evidenceQuotes) {
    const needle = normalizeForMatch(quote);
    if (needle.length >= 3 && haystack.includes(needle)) kept.push(quote);
    else dropped.push(quote);
  }
  const scores: Partial<Record<Skill, number | null>> = {};
  for (const skill of SKILLS) {
    const score = evaluation.scores[skill];
    if (score !== undefined) scores[skill] = evaluation.insufficientContext ? null : score;
  }
  const needed = evaluation.reframe.needed && Boolean(evaluation.reframe.suggestion?.trim());
  return {
    evaluation: {
      rubricVersion: RUBRIC_VERSION,
      turnId: evaluation.turnId,
      scores,
      strengths: clipList(evaluation.strengths),
      risks: clipList(evaluation.risks),
      missedAssumptions: clipList(evaluation.missedAssumptions),
      evidenceQuotes: clipList(kept),
      reframe: {
        needed,
        suggestion: needed ? clip(evaluation.reframe.suggestion!.trim()) : null,
        rationale: clip(evaluation.reframe.rationale),
      },
      recommendedAction: clip(evaluation.recommendedAction),
      // Claims without any verifiable quote cannot carry more than low confidence.
      confidence: kept.length === 0 ? 'low' : evaluation.confidence,
      insufficientContext: evaluation.insufficientContext,
    },
    createdAt: now,
    droppedQuotes: dropped,
  };
}

export interface MemoryProposal {
  scope: 'coach' | 'long_term';
  kind: string;
  content: string;
  turnIds: string[];
  confidence?: number;
  supersedes?: string[];
}

export interface CoachEvaluationResult {
  evaluations: StoredEvaluation[];
  summary: string;
  restSuggestion: string | null;
  memoryProposals: MemoryProposal[];
  learningPointers: Array<{ concept: string; reason: string }>;
  rejected: string[];
}

export function parseMemoryProposals(value: unknown): MemoryProposal[] {
  if (!Array.isArray(value)) return [];
  const proposals: MemoryProposal[] = [];
  for (const item of value.slice(0, 5)) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (typeof p.content !== 'string' || p.content.trim() === '' || typeof p.kind !== 'string') continue;
    proposals.push({
      scope: p.scope === 'long_term' ? 'long_term' : 'coach',
      kind: p.kind.slice(0, 60),
      content: p.content.trim().slice(0, 500),
      turnIds: isStringArray(p.turnIds) ? p.turnIds.slice(0, 10) : [],
      ...(typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1 ? { confidence: p.confidence } : {}),
      ...(isStringArray(p.supersedes) ? { supersedes: p.supersedes.slice(0, 5) } : {}),
    });
  }
  return proposals;
}

export function parseCoachEvaluation(raw: unknown, record: SessionRecord, now: string): CoachEvaluationResult {
  const result: CoachEvaluationResult = {
    evaluations: [],
    summary: '',
    restSuggestion: null,
    memoryProposals: [],
    learningPointers: [],
    rejected: [],
  };
  if (!raw || typeof raw !== 'object') {
    result.rejected.push('output is not an object');
    return result;
  }
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  for (const candidate of Array.isArray(r.evaluations) ? r.evaluations : []) {
    const shape = validateEvaluationShape(candidate);
    if (!shape.ok) {
      result.rejected.push(shape.errors.join('; '));
      continue;
    }
    const grounded = groundEvaluation(shape.evaluation, record, now);
    if (!grounded) {
      result.rejected.push(`unknown turn ${shape.evaluation.turnId}`);
      continue;
    }
    if (seen.has(grounded.evaluation.turnId)) continue;
    seen.add(grounded.evaluation.turnId);
    result.evaluations.push(grounded);
  }
  if (typeof r.summary === 'string') result.summary = clip(r.summary.trim());
  if (typeof r.restSuggestion === 'string' && r.restSuggestion.trim()) result.restSuggestion = clip(r.restSuggestion.trim());
  result.memoryProposals = parseMemoryProposals(r.memoryProposals);
  if (Array.isArray(r.learningPointers)) {
    for (const lp of r.learningPointers.slice(0, 3)) {
      if (lp && typeof lp === 'object' && typeof (lp as any).concept === 'string' && typeof (lp as any).reason === 'string') {
        result.learningPointers.push({ concept: (lp as any).concept.slice(0, 120), reason: (lp as any).reason.slice(0, 400) });
      }
    }
  }
  return result;
}

export function meanScore(evaluations: StoredEvaluation[], skill: Skill): { mean: number; n: number } | null {
  const values = evaluations
    .map((e) => e.evaluation.scores[skill])
    .filter((s): s is number => typeof s === 'number');
  if (values.length === 0) return null;
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, n: values.length };
}
