import {
  newId,
  SCHEMA_VERSION,
  SKILLS,
  userTurns,
  type Difficulty,
  type HeuristicSettings,
  type InteractionMode,
  type SessionRecord,
  type Skill,
  type SourceRef,
  type SwotItem,
  type SwotSnapshot,
} from '../domain/types';
import { meanScore, normalizeForMatch } from '../evaluation/validator';

// Deterministic, explainable longitudinal analysis (SPECS §10, §19, §20, §24). No model is
// involved: every number shown on the dashboard can be traced to stored evaluations, and every
// threshold is a named, configurable heuristic rather than a statistical claim.

export interface SessionFilter {
  actorId?: string;
  mode?: InteractionMode;
  difficulty?: Difficulty;
}

export const isEvaluable = (s: SessionRecord) => s.status === 'completed' && s.evaluations.length > 0;

export function filterSessions(sessions: SessionRecord[], filter: SessionFilter): SessionRecord[] {
  return sessions
    .filter(
      (s) =>
        s.status === 'completed' &&
        (!filter.actorId || s.actorIds.includes(filter.actorId)) &&
        (!filter.mode || s.interactionMode === filter.mode) &&
        (!filter.difficulty || s.difficulty === filter.difficulty),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type Trend = 'improving' | 'declining' | 'stable' | 'unknown';

/** Compares the later half of a series with the earlier half; needs at least four points. */
export function trendOf(series: number[]): Trend {
  if (series.length < 4) return 'unknown';
  const half = Math.floor(series.length / 2);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const delta = avg(series.slice(-half)) - avg(series.slice(0, half));
  return delta >= 0.5 ? 'improving' : delta <= -0.5 ? 'declining' : 'stable';
}

export interface SkillStat {
  skill: Skill;
  mean: number | null;
  /** Number of scored turns. */
  n: number;
  sessions: number;
  series: number[];
  trend: Trend;
  lowEvidence: boolean;
}

export interface DashboardStats {
  sessionCount: number;
  evaluableCount: number;
  activeMinutes: number;
  oralCount: number;
  writtenCount: number;
  oralRatio: number | null;
  retries: number;
  replays: number;
  skills: SkillStat[];
}

export function computeStats(sessions: SessionRecord[], heuristics: HeuristicSettings): DashboardStats {
  const evaluable = sessions.filter(isEvaluable);
  const oralCount = sessions.filter((s) => s.interactionMode === 'walk').length;
  const writtenCount = sessions.filter((s) => s.interactionMode === 'desktop').length;
  const skills = SKILLS.map((skill): SkillStat => {
    const perSession = evaluable.map((s) => meanScore(s.evaluations, skill)).filter((x) => x !== null);
    const n = perSession.reduce((a, x) => a + x.n, 0);
    const series = perSession.map((x) => x.mean);
    return {
      skill,
      mean: n ? perSession.reduce((a, x) => a + x.mean * x.n, 0) / n : null,
      n,
      sessions: perSession.length,
      series,
      trend: trendOf(series),
      lowEvidence: perSession.length < heuristics.sampleWarningBelow,
    };
  });
  return {
    sessionCount: sessions.length,
    evaluableCount: evaluable.length,
    activeMinutes: Math.round(sessions.reduce((a, s) => a + s.activeElapsedSeconds, 0) / 60),
    oralCount,
    writtenCount,
    oralRatio: oralCount + writtenCount > 0 ? oralCount / (oralCount + writtenCount) : null,
    retries: sessions.reduce((a, s) => a + s.retries, 0),
    replays: sessions.filter((s) => s.replayOf).length,
    skills,
  };
}

export interface Signal {
  key: string;
  params: Record<string, string | number>;
  refs: SourceRef[];
}

function trigrams(text: string): Set<string> {
  const words = normalizeForMatch(text).split(' ').filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) grams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return grams;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

export const PLATEAU = { window: 6, minSessions: 4, similarity: 0.5, minRepeatedPairs: 2, flatRange: 0.3, replayGap: 0.8 };

const overallMean = (s: SessionRecord): number | null => {
  const values = s.evaluations.flatMap((e) => Object.values(e.evaluation.scores)).filter((x): x is number => typeof x === 'number');
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
};

/**
 * Tentative plateau and overfitting signals with explainable thresholds. These are prompts to vary
 * practice, never judgments: repeating a valid unresolved risk is not treated as a flaw.
 */
export function detectPlateau(sessions: SessionRecord[]): Signal[] {
  const recent = sessions.filter(isEvaluable).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-PLATEAU.window);
  const signals: Signal[] = [];
  if (recent.length < PLATEAU.minSessions) return signals;
  const refs = recent.map((s) => ({ sessionId: s.id }));

  const scenarios = new Set(recent.map((s) => s.scenarioId));
  if (scenarios.size === 1) signals.push({ key: 'signal.lowDiversity', params: { count: recent.length }, refs });

  let repeatedPairs = 0;
  const turns = recent.flatMap((s) => userTurns(s).map((t) => ({ sessionId: s.id, grams: trigrams(t.text) })));
  for (let i = 0; i < turns.length; i++) {
    for (let j = i + 1; j < turns.length; j++) {
      if (turns[i]!.sessionId !== turns[j]!.sessionId && jaccard(turns[i]!.grams, turns[j]!.grams) >= PLATEAU.similarity) repeatedPairs++;
    }
  }
  if (repeatedPairs >= PLATEAU.minRepeatedPairs) signals.push({ key: 'signal.repeatedPhrasing', params: { count: repeatedPairs }, refs });

  const means = recent.map(overallMean).filter((x): x is number => x !== null);
  const difficulties = new Set(recent.map((s) => s.difficulty));
  if (difficulties.size === 1 && !difficulties.has('hard') && means.length >= PLATEAU.minSessions) {
    const range = Math.max(...means) - Math.min(...means);
    const avg = means.reduce((a, b) => a + b, 0) / means.length;
    if (range <= PLATEAU.flatRange && avg >= 2.5) {
      signals.push({ key: 'signal.comfortableLevel', params: { difficulty: [...difficulties][0]! }, refs });
    }
  }

  const avgOf = (xs: SessionRecord[]) => {
    const ms = xs.map(overallMean).filter((x): x is number => x !== null);
    return ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
  };
  const replayAvg = avgOf(recent.filter((s) => s.replayOf));
  const freshAvg = avgOf(recent.filter((s) => !s.replayOf));
  if (replayAvg !== null && freshAvg !== null && replayAvg - freshAvg >= PLATEAU.replayGap) {
    signals.push({ key: 'signal.replayNotTransferring', params: {}, refs });
  }
  return signals;
}

export const FATIGUE_MINUTES = 90;

/** Tentative behavioural signal only: a long training day. Never a diagnosis, never a penalty. */
export function fatigueSignal(sessions: SessionRecord[], now: string): Signal | null {
  const today = now.slice(0, 10);
  const todays = sessions.filter((s) => (s.startedAt ?? s.createdAt).slice(0, 10) === today);
  const minutes = Math.round(todays.reduce((a, s) => a + s.activeElapsedSeconds, 0) / 60);
  return minutes >= FATIGUE_MINUTES
    ? { key: 'signal.longTrainingDay', params: { minutes }, refs: todays.map((s) => ({ sessionId: s.id })) }
    : null;
}

export function swotStage(evaluable: SessionRecord[], h: HeuristicSettings): SwotSnapshot['stage'] {
  const n = evaluable.length;
  if (n < h.swotHypothesizeAt) return 'observe';
  const varied = new Set(evaluable.map((s) => s.scenarioId)).size >= h.minScenarioVariety && new Set(evaluable.map((s) => s.difficulty)).size >= 2;
  return n >= h.swotProvisionalAt && varied ? 'provisional' : 'hypothesize';
}

const MIN_OBSERVATIONS = 4;

/**
 * Provisional longitudinal SWOT (SPECS §19, §23). Sessions 1–4 only observe; 5–9 produce candidate
 * hypotheses; a provisional SWOT needs 10+ evaluable sessions that are also varied. Every item
 * carries its evidence and its counterexamples, and nothing is derived from a single session.
 */
export function buildSwot(sessions: SessionRecord[], h: HeuristicSettings, now: string): SwotSnapshot {
  const evaluable = sessions.filter(isEvaluable).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const stage = swotStage(evaluable, h);
  const items: SwotItem[] = [];
  const status = stage === 'provisional' ? 'provisional' : 'candidate';
  const confidence = stage === 'provisional' ? 'medium' : 'low';
  if (stage !== 'observe') {
    const stats = computeStats(evaluable, h);
    for (const stat of stats.skills) {
      const withSkill = evaluable
        .map((s) => ({ s, m: meanScore(s.evaluations, stat.skill) }))
        .filter((x): x is { s: SessionRecord; m: { mean: number; n: number } } => x.m !== null);
      const scenarioSpread = new Set(withSkill.map((x) => x.s.scenarioId)).size;
      const push = (quadrant: SwotItem['quadrant'], claimKey: string, evidence: SourceRef[], counter: SourceRef[]) =>
        items.push({
          id: newId('swot'),
          quadrant,
          claimKey,
          claimParams: { skill: stat.skill, mean: Number((stat.mean ?? 0).toFixed(1)), sessions: withSkill.length },
          behavioralEvidence: evidence,
          counterEvidence: counter,
          confidence,
          trend: stat.trend,
          status,
        });
      const refsWhere = (pred: (mean: number) => boolean) => withSkill.filter((x) => pred(x.m.mean)).map((x) => ({ sessionId: x.s.id }));
      if (withSkill.length < 3) {
        push('opportunity', 'swot.underPracticed', withSkill.map((x) => ({ sessionId: x.s.id })), []);
      } else if (stat.mean !== null && withSkill.length >= MIN_OBSERVATIONS && scenarioSpread >= 2) {
        if (stat.mean >= 3) push('strength', 'swot.consistentlyStrong', refsWhere((m) => m >= 3), refsWhere((m) => m <= 1.5));
        else if (stat.mean <= 1.5) push('weakness', 'swot.consistentlyWeak', refsWhere((m) => m <= 1.5), refsWhere((m) => m >= 3));
        if (stat.trend === 'declining') push('threat', 'swot.declining', withSkill.slice(-3).map((x) => ({ sessionId: x.s.id })), []);
      }
    }
    for (const signal of detectPlateau(evaluable)) {
      items.push({
        id: newId('swot'),
        quadrant: 'threat',
        claimKey: signal.key,
        claimParams: signal.params,
        behavioralEvidence: signal.refs,
        counterEvidence: [],
        confidence,
        trend: 'unknown',
        status,
      });
    }
  }
  return { id: newId('swotsnap'), schemaVersion: SCHEMA_VERSION, createdAt: now, stage, evaluableSessions: evaluable.length, items };
}

export interface Recommendation {
  scenarioId: string;
  skill: Skill | null;
  reasonKey: 'recommend.underPracticed' | 'recommend.weakest' | 'recommend.variety';
  mode: InteractionMode;
}

/** Deterministic next-kata suggestion: weakest or least-practised skill, with enforced scenario variety. */
export function recommendNext(
  sessions: SessionRecord[],
  scenarios: Array<{ id: string; primarySkills: Skill[] }>,
  h: HeuristicSettings,
): Recommendation | null {
  if (scenarios.length === 0) return null;
  const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const stats = computeStats(completed, h);
  const trainable = stats.skills.filter((s) => scenarios.some((sc) => sc.primarySkills.includes(s.skill)));
  const under = [...trainable].sort((a, b) => a.sessions - b.sessions || SKILLS.indexOf(a.skill) - SKILLS.indexOf(b.skill))[0];
  const weakest = trainable
    .filter((s) => s.mean !== null && s.sessions >= 2)
    .sort((a, b) => a.mean! - b.mean! || SKILLS.indexOf(a.skill) - SKILLS.indexOf(b.skill))[0];
  const target = under && under.sessions < 2 ? under : (weakest ?? under);
  const reasonKey: Recommendation['reasonKey'] = !target ? 'recommend.variety' : target === weakest ? 'recommend.weakest' : 'recommend.underPracticed';

  const lastUsed = new Map<string, number>();
  completed.forEach((s, i) => lastUsed.set(s.scenarioId, i));
  const lastScenario = completed.at(-1)?.scenarioId;
  let pool = target ? scenarios.filter((sc) => sc.primarySkills.includes(target.skill)) : scenarios;
  if (pool.length === 0) pool = scenarios;
  const varied = pool.filter((sc) => sc.id !== lastScenario);
  const chosen = [...(varied.length ? varied : pool)].sort(
    (a, b) => (lastUsed.get(a.id) ?? -1) - (lastUsed.get(b.id) ?? -1) || a.id.localeCompare(b.id),
  )[0]!;
  const mode: InteractionMode = stats.oralRatio !== null && stats.oralRatio > h.oralTargetRatio + 0.1 ? 'desktop' : 'walk';
  return { scenarioId: chosen.id, skill: target?.skill ?? null, reasonKey, mode };
}

export interface Comparison {
  skill: Skill;
  a: number | null;
  b: number | null;
  delta: number | null;
}

/** A/B comparison on the same facts and rubric. A score difference from one run is not statistical proof. */
export function compareSessions(a: SessionRecord, b: SessionRecord): { rows: Comparison[]; sameFacts: boolean } {
  const hashOf = (s: SessionRecord) => s.snapshots.find((x) => x.kind === 'scenario')?.hash;
  const rows = SKILLS.map((skill) => {
    const ma = meanScore(a.evaluations, skill)?.mean ?? null;
    const mb = meanScore(b.evaluations, skill)?.mean ?? null;
    return { skill, a: ma, b: mb, delta: ma !== null && mb !== null ? mb - ma : null };
  });
  return { rows, sameFacts: hashOf(a) !== undefined && hashOf(a) === hashOf(b) };
}
