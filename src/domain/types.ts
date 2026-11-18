// Core domain contracts. All keys are English and versioned; see SPECS §9, §17, §23, §25.

export const SCHEMA_VERSION = 1;
export const RUBRIC_VERSION = 'core-v1';

export const SKILLS = [
  'assumption_detection',
  'strategic_breadth',
  'executive_questioning',
  'assertiveness',
  'diplomacy',
  'decision_orientation',
  'political_judgment',
  'conciseness',
  'business_framing',
  'evidence_accountability',
] as const;
export type Skill = (typeof SKILLS)[number];

/** Lenient aliases accepted in imported content; shipped content uses canonical names. */
export const SKILL_ALIASES: Record<string, Skill> = {
  evidence: 'evidence_accountability',
  evidence_discipline: 'evidence_accountability',
  strategic_insight: 'strategic_breadth',
  brevity: 'conciseness',
};

export type AppLocale = 'en' | 'es-ES';
export const LOCALES: AppLocale[] = ['es-ES', 'en'];

export type InteractionMode = 'walk' | 'desktop' | 'driving';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type CoachingMode = 'immediate' | 'end_of_kata' | 'socratic_review';
export type DrillType =
  | 'quick_kata'
  | 'full_simulation'
  | 'power_question'
  | 'reframing'
  | 'executive_pressure'
  | 'replay'
  | 'review';

export type SessionStatus =
  | 'created'
  | 'ready'
  | 'actor_turn'
  | 'user_turn'
  | 'evaluating'
  | 'feedback'
  | 'completed'
  | 'paused'
  | 'aborted'
  | 'error';

export type ActorStance = 'resisting' | 'neutral' | 'opening';
export type ReactionType = 'objection' | 'pressure' | 'concession' | 'question' | 'neutral';

export const EXPLANATION_FACTORS = [
  'reputational_exposure',
  'commitment_pressure',
  'evidence_gap',
  'incentive_conflict',
  'mandate_boundary',
  'tone_threat',
  'time_pressure',
  'financial_exposure',
  'governance_concern',
  'credible_alternative',
] as const;
export type ExplanationFactor = (typeof EXPLANATION_FACTORS)[number];

export interface Turn {
  id: string;
  index: number;
  role: 'actor' | 'user' | 'narrator';
  actorId?: string;
  text: string;
  inputMode?: 'voice' | 'text';
  createdAt: string;
  /** A retried user turn stays in the record but is excluded from the live transcript. */
  superseded?: boolean;
  closing?: boolean;
  stance?: ActorStance;
}

export interface Evaluation {
  rubricVersion: string;
  turnId: string;
  scores: Partial<Record<Skill, number | null>>;
  strengths: string[];
  risks: string[];
  missedAssumptions: string[];
  evidenceQuotes: string[];
  reframe: { needed: boolean; suggestion: string | null; rationale: string };
  recommendedAction: string;
  confidence: 'low' | 'medium' | 'high';
  insufficientContext: boolean;
}

/** Evaluation plus app-side provenance that is not part of the model contract. */
export interface StoredEvaluation {
  evaluation: Evaluation;
  createdAt: string;
  /** Quotes the model cited that could not be found in the transcript; they were removed. */
  droppedQuotes: string[];
}

export type EpistemicStatus = 'scenario_fact' | 'model_interpretation' | 'counterfactual';

export interface CausalEvent {
  id: string;
  schemaVersion: number;
  sessionId: string;
  turnId: string;
  eventType: 'revelation' | 'actor_objection' | 'actor_pressure' | 'actor_concession';
  scenarioFactRefs: string[];
  triggerRefs: string[];
  observedActorResponse: string;
  explanationFactors: string[];
  epistemicStatus: EpistemicStatus;
  createdAt: string;
}

export interface PauseEvent {
  pausedAt: string;
  resumedAt?: string;
  reason: 'user' | 'voice_command' | 'visibility' | 'audio' | 'permission' | 'reload';
}

export interface ContentSnapshot {
  kind: 'actor' | 'scenario' | 'coach' | 'profile';
  id: string;
  language: string;
  version: number;
  hash: string;
  /** Frozen source so replays keep facts and initial conditions (SPECS §7.3). */
  source: string;
  fallbackFrom?: string;
}

export interface ModelSnapshot {
  provider: string;
  actorModel: string;
  coachModel: string;
  params: Record<string, string | number | boolean>;
}

export interface SessionOutcome {
  finalStance: ActorStance | null;
  revealedTwistIds: string[];
}

export interface SessionSummary {
  text: string;
  restSuggestion: string | null;
}

export interface SessionRecord {
  id: string;
  schemaVersion: number;
  locale: AppLocale;
  spokenLocale: AppLocale;
  contentLocale: AppLocale;
  interactionMode: InteractionMode;
  difficulty: Difficulty;
  coachingMode: CoachingMode;
  drillType: DrillType;
  scenarioId: string;
  actorIds: string[];
  coachId: string;
  status: SessionStatus;
  /** Status to return to after pause or error. */
  resumeStatus?: SessionStatus;
  errorMessage?: string;
  // Timing (SPECS §17)
  plannedDurationSeconds: number;
  activeElapsedSeconds: number;
  pausedElapsedSeconds: number;
  /** Start of the currently running active segment; null while not running. */
  activeSince: string | null;
  startedAt: string | null;
  endedAt: string | null;
  pauseEvents: PauseEvent[];
  timeExpired: boolean;
  endRequested: boolean;
  maxUserTurns: number;
  // Content
  turns: Turn[];
  snapshots: ContentSnapshot[];
  models: ModelSnapshot;
  evaluations: StoredEvaluation[];
  summary: SessionSummary | null;
  retries: number;
  causalEvents: CausalEvent[];
  outcome: SessionOutcome;
  socratic?: { question: string; answer: string | null };
  tags: string[];
  /** A/B replay links: the session this one replays. */
  replayOf?: string;
  campaignId?: string;
  createdAt: string;
  updatedAt: string;
}

export type MemoryScope = 'short_term' | 'long_term' | 'entity' | 'user' | 'coach';
export type MemoryStatus = 'provisional' | 'supported' | 'superseded';
export type MemoryVisibility = 'coach_private' | 'user_visible' | 'actor_observable';

export interface SourceRef {
  sessionId: string;
  turnId?: string;
  dialogueId?: string;
}

export interface MemoryRecord {
  id: string;
  schemaVersion: number;
  scope: MemoryScope;
  kind: string;
  content: string;
  sourceRefs: SourceRef[];
  counterEvidenceRefs: SourceRef[];
  confidence?: number;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  locale: AppLocale;
  visibility: MemoryVisibility;
  supersedes: string[];
  tags?: string[];
  /** Entity scope: the simulated stakeholder this record is about. */
  entityId?: string;
}

export interface DialogueSegment {
  text: string;
  epistemicStatus: EpistemicStatus | null;
  turnRefs: string[];
  causalEventRefs: string[];
}

export interface DialogueMessage {
  id: string;
  role: 'user' | 'coach' | 'actor_ooc';
  text: string;
  timestamp: string;
  segments?: DialogueSegment[];
  causalEventRefs?: string[];
  epistemicStatus?: EpistemicStatus;
}

export interface CoachDialogue {
  id: string;
  schemaVersion: number;
  relatedSessionIds: string[];
  createdAt: string;
  updatedAt: string;
  messages: DialogueMessage[];
}

export interface LearningPointer {
  schemaVersion: number;
  id: string;
  concept: string;
  reason: string;
  evidenceRefs: SourceRef[];
  action: 'save_for_next_session';
  status: 'pending' | 'done' | 'dismissed';
  locale: AppLocale;
  createdAt: string;
}

export const QUESTION_CATEGORIES = [
  'assumptions',
  'economics',
  'incentives',
  'value',
  'governance',
  'evidence',
  'risks',
  'politics',
  'adoption',
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export interface PowerQuestion {
  id: string;
  schemaVersion: number;
  category: QuestionCategory;
  locale: AppLocale;
  text: string;
  whenToUse: string;
  whenNotToUse: string;
  skills: Skill[];
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SwotItem {
  id: string;
  quadrant: 'strength' | 'weakness' | 'opportunity' | 'threat';
  claimKey: string;
  claimParams: Record<string, string | number>;
  behavioralEvidence: SourceRef[];
  counterEvidence: SourceRef[];
  confidence: 'low' | 'medium';
  trend: 'improving' | 'declining' | 'stable' | 'unknown';
  status: 'candidate' | 'provisional';
}

export interface SwotSnapshot {
  id: string;
  schemaVersion: number;
  createdAt: string;
  stage: 'observe' | 'hypothesize' | 'provisional';
  evaluableSessions: number;
  items: SwotItem[];
}

export interface CustomContentRecord {
  /** `${kind}:${id}:${language}` */
  key: string;
  kind: 'actor' | 'scenario' | 'coach' | 'profile';
  id: string;
  language: string;
  source: string;
  importedAt: string;
}

export type ProviderKind = 'demo' | 'anthropic' | 'openai' | 'gemini' | 'openai_compatible';
export const PROVIDER_KINDS: ProviderKind[] = ['demo', 'anthropic', 'openai', 'gemini', 'openai_compatible'];

export interface ProviderSettings {
  kind: ProviderKind;
  baseUrl: string;
  actorModel: string;
  coachModel: string;
}

export interface HeuristicSettings {
  swotHypothesizeAt: number;
  swotProvisionalAt: number;
  minScenarioVariety: number;
  sampleWarningBelow: number;
  oralTargetRatio: number;
}

export interface AppSettings {
  schemaVersion: number;
  onboarded: boolean;
  uiLocale: AppLocale;
  spokenLocale: AppLocale;
  contentLocale: AppLocale;
  role: string;
  objectives: string;
  privacyConsentAt: string | null;
  provider: ProviderSettings;
  persistApiKey: boolean;
  personalizationEnabled: boolean;
  speakFeedback: boolean;
  wakeLock: boolean;
  speechRate: number;
  voiceURI: string | null;
  heuristics: HeuristicSettings;
  lastBackupAt: string | null;
}

export const DEFAULT_HEURISTICS: HeuristicSettings = {
  swotHypothesizeAt: 5,
  swotProvisionalAt: 10,
  minScenarioVariety: 3,
  sampleWarningBelow: 5,
  oralTargetRatio: 0.7,
};

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: SCHEMA_VERSION,
  onboarded: false,
  uiLocale: 'es-ES',
  spokenLocale: 'es-ES',
  contentLocale: 'es-ES',
  role: '',
  objectives: '',
  privacyConsentAt: null,
  provider: { kind: 'demo', baseUrl: '', actorModel: '', coachModel: '' },
  persistApiKey: false,
  personalizationEnabled: true,
  speakFeedback: true,
  wakeLock: true,
  speechRate: 1,
  voiceURI: null,
  heuristics: DEFAULT_HEURISTICS,
  lastBackupAt: null,
};

export interface DrillConfig {
  maxUserTurns: number;
  /** When false the drill has no generative actor replies (e.g. reframing). */
  actorReplies: boolean;
}

export const DRILLS: Record<DrillType, DrillConfig> = {
  quick_kata: { maxUserTurns: 3, actorReplies: true },
  full_simulation: { maxUserTurns: 10, actorReplies: true },
  power_question: { maxUserTurns: 1, actorReplies: true },
  reframing: { maxUserTurns: 1, actorReplies: false },
  executive_pressure: { maxUserTurns: 4, actorReplies: true },
  replay: { maxUserTurns: 3, actorReplies: true },
  review: { maxUserTurns: 0, actorReplies: false },
};

/** Generous limits for what trainees write about themselves; the whole text is sent to the coach. */
export const USER_TEXT_LIMITS = { role: 500, objectives: 20_000, profile: 50_000 };

export const DURATION_PRESETS_MINUTES = [5, 15, 30, 60, 300];

export function newId(prefix: string): string {
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `${prefix}-${rand}`;
}

export function liveTurns(record: Pick<SessionRecord, 'turns'>): Turn[] {
  return record.turns.filter((t) => !t.superseded);
}

export function userTurns(record: Pick<SessionRecord, 'turns'>): Turn[] {
  return liveTurns(record).filter((t) => t.role === 'user');
}
