/**
 * COUNCIL V0.1 — core domain types.
 * These types are the contract between the orchestrator, the providers and
 * the API layer. Keep them framework-agnostic.
 */

export type CouncilMode = "QUICK" | "FULL" | "DEEP";

/**
 * COUNCIL V0.2 — question taxonomy (Part 7).
 * The classifier maps a question to ONE primary type plus an ordered list of
 * capabilities the Council should emphasize. Capability-based, not
 * character-based: premium characters later map onto the same capabilities.
 */
export type QuestionType =
  | "decision"
  | "explanation"
  | "comparison"
  | "technical"
  | "mathematical"
  | "educational"
  | "business"
  | "planning"
  | "creative"
  | "argumentative"
  | "troubleshooting"
  | "general";

/**
 * COUNCIL V0.2.1 — capability taxonomy (Part 3).
 * The Council picks the reasoning capabilities a question needs; agents map
 * onto capabilities, never the other way around.
 */
export type Capability =
  | "logical_reasoning"
  | "skepticism"
  | "practical_analysis"
  | "technical_analysis"
  | "mathematical_reasoning"
  | "educational_explanation"
  | "strategic_reasoning"
  | "risk_analysis"
  | "comparison"
  | "alternative_perspectives"
  | "assumption_testing"
  | "creativity";

/** How strongly the available evidence supports an analysis (Part 11). */
export type EvidenceQuality = "STRONG" | "MODERATE" | "WEAK" | "UNKNOWN";

/** V0.2.2.2: how complete/reliable the available information is (Part 1). */
export type InformationSufficiency = "HIGH" | "MEDIUM" | "LOW";

/** V0.2.2.2: per-member outcome attribution (Part 10 — never invent results). */
export type AgentOutcome = "COMPLETED" | "FAILED" | "TIMED_OUT" | "NOT_STARTED";

export interface QuestionClassification {
  type: QuestionType;
  label: string;
  /** Ordered by relevance — the first entries matter most. */
  capabilities: Capability[];
}

export type AgentKey =
  | "reasoner"
  | "skeptic"
  | "practicalist"
  | "perspective"
  | "devils_advocate"
  | "comparer"
  | "reassessor"
  | "judge";

export type VerdictCategory =
  // Product / proposal set (business, decision, planning, comparison, creative)
  | "BUILD"
  | "BUILD_MVP"
  | "PIVOT"
  | "DO_NOT_BUILD"
  // General set (general)
  | "AGREE"
  | "REFINE"
  | "VALIDATE"
  | "RECONSIDER"
  | "REJECT"
  // Mathematical set
  | "CORRECT"
  | "INCORRECT"
  | "PARTIALLY_CORRECT"
  | "UNVERIFIABLE"
  // Explanation / educational set
  | "CONFIRMED"
  | "REFUTED"
  | "PARTIALLY_SUPPORTED"
  | "UNRESOLVED"
  // Argumentative set
  | "SUPPORTED"
  | "UNSUPPORTED"
  | "MIXED"
  | "UNDETERMINED"
  // Technical set
  | "SOUND"
  | "FLAWED"
  | "RISKY"
  | "UNVERIFIED"
  // Troubleshooting set
  | "FIXED"
  | "DIRECTION_FOUND"
  | "PARTIAL"
  | "STILL_UNRESOLVED"
  // System-reserved
  | "INSUFFICIENT_INFORMATION";

export type Stance = "SUPPORT" | "OPPOSE" | "CONDITIONAL" | "NEUTRAL" | "INSUFFICIENT";

/** Structured output of the four analytical agents + Devil's Advocate. */
export interface AgentAnalysis {
  agent: AgentKey;
  /** Human-readable name for display. */
  name: string;
  /** Free-form analysis body. */
  summary: string;
  stance: Stance;
  keyPoints: string[];
  assumptions: string[];
  risks: string[];
  missingInformation: string[];
  confidence: number; // 0-100
  /** V0.2.2.2: explicit outcome — COMPLETED / FAILED / TIMED_OUT / NOT_STARTED. */
  outcome?: AgentOutcome;
  /** V0.2.1: how strong the evidence behind this analysis is (Part 11). */
  evidenceQuality?: EvidenceQuality;
  /** True when the model output could not be parsed and raw text was kept. */
  degraded?: boolean;
  /** Set when the model call itself failed (agent failure — not a response). */
  failed?: boolean;
  error?: string;
  /** How many retries were used. */
  retries?: number;
}

/** Output of the comparison stage (FULL + DEEP) — V0.2.1 (Parts 12-13). */
export interface CouncilComparison {
  agreements: { topic: string; agents: string[]; summary: string }[];
  disagreements: {
    topic: string;
    positions: { agent: string; position: string }[];
    summary: string;
    /** V0.2.1: FUNDAMENTAL (incompatible claims/different questions) vs SUPERFICIAL (same position, different words) — Part 13. */
    nature?: "SUPERFICIAL" | "FUNDAMENTAL";
  }[];
  /** V0.2: where analyses directly contradict each other. */
  contradictions: { topic: string; summary: string }[];
  sharedAssumptions: string[];
  /** V0.2: what the analyses still need to know. */
  missingInformation: string[];
  /** V0.2: risks identified across analyses. */
  risks: string[];
  /** V0.2: insights only one agent surfaced. */
  uniqueInsights: string[];
  /** V0.2.1: the single strongest argument across all analyses (Part 12). */
  strongestArgument: string;
  /** V0.2.1: the single weakest argument across all analyses (Part 12). */
  weakestArgument: string;
  stanceCounts: Record<Stance, number>;
}

/** Output of the Reassessment stage (DEEP only) — V0.2 (Part 12). */
export interface ReassessmentAnalysis {
  /** Short narrative of what the Devil's Advocate changed. */
  summary: string;
  /** V0.2.1: what the stress-test did to the emerging conclusion (Part 21). */
  shift?: "UNCHANGED" | "STRENGTHENED" | "WEAKENED" | "REVERSED";
  /** Arguments that hardened after the stress-test. */
  hardened: string[];
  /** Arguments that weakened or collapsed. */
  weakened: string[];
  /** Positions that actually changed (agent → old → new). */
  positionChanges: { agent: string; from: string; to: string }[];
  /** What the Judge should weigh more heavily now. */
  judgeGuidance: string;
  failed?: boolean;
  error?: string;
  degraded?: boolean;
  retries?: number;
}

/** Output of the Devil's Advocate stage (DEEP). */
export interface DevilAdvocateAnalysis {
  agent: AgentKey;
  name: string;
  summary: string;
  strongestArgument: string;
  attemptToBreakIt: string;
  unsupportedAssumptions: string[];
  convergenceWarning: string;
  minorityPoint: string;
  evidenceThatWouldResolve: string[];
  failed?: boolean;
  error?: string;
  degraded?: boolean;
  retries?: number;
}

/**
 * The Judge's structured verdict (strict schema — see schemas.ts).
 *
 * V0.2.2.2: fields were renamed/adapted onto the fixed output contract
 * (agreements/disagreements/assumptions/risks/whatWouldChangeVerdict) and
 * extended with informationSufficiency, keyReasons and criticalUnknowns so
 * the Judge can give provisional verdicts instead of escaping into
 * INSUFFICIENT_INFORMATION. `score` (0-10) is retained.
 */
export interface CouncilVerdict {
  verdict: VerdictCategory;
  score: number; // 0-10
  confidence: number; // 0-100
  /** V0.2.2.2: information sufficiency (Part 1A). */
  informationSufficiency: InformationSufficiency;
  summary: string;
  /** V0.2.2.2: the deciding reasons (Part 8 — main deciding factors). */
  keyReasons: string[];
  /** Renamed from keyAgreements (V0.2.2.2 contract). */
  agreements: string[];
  /** Renamed from keyDisagreements (V0.2.2.2 contract). */
  disagreements: string[];
  /** V0.2.2.2: what is still unknown and would matter (Part 1). */
  criticalUnknowns: string[];
  /** Renamed from criticalAssumptions (V0.2.2.2 contract). */
  assumptions: string[];
  /** Renamed from criticalRisks (V0.2.2.2 contract). */
  risks: string[];
  recommendedAction: string;
  /** Renamed from whatWouldChangeTheVerdict (V0.2.2.2 contract). */
  whatWouldChangeVerdict: string[];
  reasoning: string;
  /** V0.2: the explicit "why this verdict won" statement (Part 14). */
  whyThisVerdictWon: string;
  strongestArgumentFor: string;
  strongestArgumentAgainst: string;
  /** True when the model could not produce a valid verdict and we returned a safe fallback. */
  degraded?: boolean;
  /** V0.2.2.2: true when the deterministic synthesizer produced this because the Judge failed. */
  provisional?: boolean;
}

export interface CouncilUsage {
  /** V0.2: stable id for this Council session (Part 18). */
  sessionId: string;
  mode: CouncilMode;
  agentCalls: number;
  failedAgentCalls: number;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  success: boolean;
  questionLength: number;
  startedAt: string;
  /** V0.2.2.2: per-stage wall-clock durations (ms) — performance audit (Part 9). */
  stageDurations: {
    analysisMs: number;
    comparisonMs: number;
    devilsAdvocateMs: number;
    reassessmentMs: number;
    judgeMs: number;
    /** V0.3: LLM understander call (only when the heuristic gate flags it). */
    understandingMs: number;
    /** V0.3: direct-answer call for explanation follow-ups. */
    directAnswerMs: number;
  };
  /** V0.2.2.2: per-analyst wall-clock durations (ms), keyed by agent key. */
  agentDurations: Record<string, number>;
  /**
   * V0.2.2.4: per-call telemetry for performance forensics (Part 9). One entry
   * per provider call (successful or not), so a slow run can be attributed to
   * an exact stage/call/retry. Never contains question text or secrets.
   */
  calls?: CouncilCallTelemetry[];
}

/**
 * V0.2.2.4: a single provider call's telemetry — stage, model, outcome,
 * retries, duration and token counts. Recorded by the orchestrator so the
 * performance audit is exact rather than inferred (Part 9).
 */
export interface CouncilCallTelemetry {
  stage: "analysis" | "comparison" | "devils_advocate" | "reassessment" | "judge" | "understanding" | "direct_answer";
  /** Agent key (or stage name for pipeline stages). */
  agent: string;
  model: string;
  status: "COMPLETED" | "FAILED" | "TIMED_OUT";
  retries: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

// ── V0.3 conversational interaction ──────────────────────────────────────────

/** How the Council should treat a reply that follows a verdict (V0.3 Part 8). */
export type FollowUpIntent =
  | "SMALL_TALK" // quick chat reply, no Council
  | "EXPLANATION_REQUEST" // direct answer, no Council
  | "CORRECTION" // re-deliberate (targeted re-analysis)
  | "NEW_INFORMATION" // re-deliberate (targeted re-analysis)
  | "CHALLENGE" // explicit challenge — wired, delivered in a later version
  | "NEW_QUESTION"; // fresh thread

/** A single clarification question asked before convening (V0.3 Part 7). */
export interface ClarificationQuestion {
  id: string;
  question: string;
  /** Why this question matters — shown so the user is not interrogated blindly. */
  why: string;
}

/**
 * V0.3 (Part 3 / §5): what changed between two verdicts in one conversation.
 * Computed deterministically by the server and attached to revision verdicts.
 */
export interface VerdictDiff {
  changed: boolean;
  /** The verdict category itself changed. */
  verdictChanged: boolean;
  /** new score − old score (0 when no previous verdict). */
  scoreDelta: number;
  /** new confidence − old confidence. */
  confidenceDelta: number;
  /** Key reasons present in the new verdict but not the old. */
  reasonsAdded: string[];
  /** Key reasons present in the old verdict but not the new. */
  reasonsRemoved: string[];
  /** One short sentence summarising what changed. */
  summaryNote: string;
}

/**
 * V0.3 — a conversation thread: the accumulated turns around one original
 * question. Owned by the client; the server only ever receives the minimal
 * pieces it needs (stateless, serverless-safe).
 */
export interface ConversationThread {
  id: string;
  mode: CouncilMode;
  question: string;
  startedAt: number;
  /** Accumulated user corrections / new information across turns. */
  mergedContext: string[];
  /** Explicit assumptions the Council is working under. */
  explicitAssumptions: string[];
  turns: ConversationTurn[];
}

export interface ConversationTurn {
  id: string;
  kind: "user" | "assistant";
  type:
    | "question"
    | "clarification" // Council asked; user answered
    | "verdict" // a verdict card (with diff vs previous)
    | "revision" // re-deliberated verdict
    | "direct_reply" // explanation answer
    | "chat_reply" // small-talk reply
    | "challenge_note"; // challenge intent, honest future note
  /** User text or assistant reply text (for non-verdict turns). */
  text?: string;
  verdict?: CouncilVerdict;
  usage?: CouncilUsage;
  diff?: VerdictDiff;
  intent?: FollowUpIntent;
  /** The clarification questions asked (and the user's answers, keyed by id). */
  clarifications?: ClarificationQuestion[];
  answers?: { id: string; answer: string }[];
  /**
   * In-memory SSE events of a verdict turn (client only). Stripped from
   * persistence — restored turns render summarized.
   */
  events?: CouncilEvent[];
  startedAt: number;
}

/** Raw request body for POST /api/council. */
export interface CouncilRequest {
  question: string;
  mode: CouncilMode;
}

/** Raw model provider message. */
export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelCallResult {
  content: string;
  usage: ModelUsage;
}

/** Abstraction implemented by every provider (Ollama, OpenAI-compatible, …). */
export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  /**
   * One completion. `system` and `user` are kept separate so providers can
   * map them onto their own message formats.
   */
  chat(opts: {
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<ModelCallResult>;
}

/** Stage names surfaced to the UI as the deliberation progresses. */
export type CouncilStage =
  | "convened"
  | "understanding"
  | "analyzing"
  | "comparing"
  | "devils_advocate"
  | "reassessing"
  | "judging"
  | "complete"
  | "failed";

/** SSE events pushed to the client. */
export type CouncilEvent =
  | {
      type: "convened";
      sessionId: string;
      mode: CouncilMode;
      agents: AgentKey[];
      classification: QuestionClassification;
      stage: CouncilStage;
    }
  | { type: "agent:start"; agent: AgentKey; name: string; stage: "analyzing" }
  | { type: "agent:done"; analysis: AgentAnalysis; stage: "analyzing" }
  | { type: "stage"; stage: "understanding" | "comparing" | "devils_advocate" | "reassessing" | "judging" }
  | { type: "comparison"; comparison: CouncilComparison; stage: "comparing" }
  | { type: "da:done"; analysis: DevilAdvocateAnalysis; stage: "devils_advocate" }
  | { type: "reassessment:done"; analysis: ReassessmentAnalysis; stage: "reassessing" }
  | { type: "verdict"; verdict: CouncilVerdict; usage: CouncilUsage; stage: "complete"; diff?: VerdictDiff }
  | { type: "followup:intent"; intent: FollowUpIntent; stage: "complete" }
  | {
      type: "direct:reply";
      reply: string;
      intent: FollowUpIntent;
      /** True when the client should start a fresh thread with `reply` as the new question. */
      newQuestion?: boolean;
      stage: "complete";
    }
  | {
      type: "error";
      message: string;
      stage: "failed";
      analyses: AgentAnalysis[];
      devilsAdvocate?: DevilAdvocateAnalysis | null;
    };

/**
 * V0.3 — per-question-type verdict sets (user decision #7).
 *
 * The product set is for proposal/decision flavoured questions; every other
 * question type now has a natural set of its own (a maths question is not
 * "BUILD"-judged; an argument is not "PIVOT"-judged).
 *
 * V0.2.2.3 rule carried forward: INSUFFICIENT_INFORMATION is deliberately NOT
 * in ANY model-facing set. The Judge must always produce a decision and
 * report its uncertainty via informationSufficiency + criticalUnknowns; the
 * no-verdict state is reserved exclusively for the deterministic
 * synthesizer's genuinely-impossible case (zero completed analyses).
 */
export const PRODUCT_VERDICTS: VerdictCategory[] = [
  "BUILD",
  "BUILD_MVP",
  "PIVOT",
  "DO_NOT_BUILD",
];

/** Verdicts offered for general questions. AGREE replaces BUILD (V0.3). */
export const GENERAL_VERDICTS: VerdictCategory[] = [
  "AGREE",
  "REFINE",
  "VALIDATE",
  "RECONSIDER",
  "REJECT",
];

/** Verdicts for mathematical questions (V0.3). */
export const MATHEMATICAL_VERDICTS: VerdictCategory[] = [
  "CORRECT",
  "INCORRECT",
  "PARTIALLY_CORRECT",
  "UNVERIFIABLE",
];

/** Verdicts for explanation + educational questions (V0.3). */
export const EXPLANATION_VERDICTS: VerdictCategory[] = [
  "CONFIRMED",
  "REFUTED",
  "PARTIALLY_SUPPORTED",
  "UNRESOLVED",
];

/** Verdicts for argumentative questions (V0.3). */
export const ARGUMENTATIVE_VERDICTS: VerdictCategory[] = [
  "SUPPORTED",
  "UNSUPPORTED",
  "MIXED",
  "UNDETERMINED",
];

/** Verdicts for technical questions (V0.3). */
export const TECHNICAL_VERDICTS: VerdictCategory[] = [
  "SOUND",
  "FLAWED",
  "RISKY",
  "UNVERIFIED",
];

/** Verdicts for troubleshooting questions (V0.3). */
export const TROUBLESHOOTING_VERDICTS: VerdictCategory[] = [
  "FIXED",
  "DIRECTION_FOUND",
  "PARTIAL",
  "STILL_UNRESOLVED",
];

/** Every category across all sets — used by the shared verdict schema. */
export const ALL_VERDICTS: VerdictCategory[] = [
  ...PRODUCT_VERDICTS,
  ...GENERAL_VERDICTS,
  ...MATHEMATICAL_VERDICTS,
  ...EXPLANATION_VERDICTS,
  ...ARGUMENTATIVE_VERDICTS,
  ...TECHNICAL_VERDICTS,
  ...TROUBLESHOOTING_VERDICTS,
  "INSUFFICIENT_INFORMATION",
];

/** Question types judged with the product verdict set (proposal evaluation). */
export const PRODUCT_TYPES: QuestionType[] = [
  "business",
  "decision",
  "planning",
  "comparison",
  "creative",
];

/**
 * V0.3: which verdict categories a question may receive, by its type.
 * Each type gets the set that matches the kind of judgment it asks for.
 *
 * V0.2.2.3 rule carried forward: INSUFFICIENT_INFORMATION is NOT offered for
 * ANY type — the orchestrator's set-enforcement routes any attempt to the
 * deterministic synthesizer (a provisional verdict), never a dead end.
 */
export function verdictsForType(type: QuestionType): VerdictCategory[] {
  switch (type) {
    case "business":
    case "decision":
    case "planning":
    case "comparison":
    case "creative":
      return PRODUCT_VERDICTS;
    case "mathematical":
      return MATHEMATICAL_VERDICTS;
    case "explanation":
    case "educational":
      return EXPLANATION_VERDICTS;
    case "argumentative":
      return ARGUMENTATIVE_VERDICTS;
    case "technical":
      return TECHNICAL_VERDICTS;
    case "troubleshooting":
      return TROUBLESHOOTING_VERDICTS;
    case "general":
      return GENERAL_VERDICTS;
  }
}

export function isProductType(type: QuestionType): boolean {
  return PRODUCT_TYPES.includes(type);
}

export const MODES: { value: CouncilMode; label: string; blurb: string }[] = [
  { value: "QUICK", label: "Quick", blurb: "3 agents · fastest · everyday questions" },
  { value: "FULL", label: "Full", blurb: "4 agents + comparison · the standard Council" },
  { value: "DEEP", label: "Deep", blurb: "4 agents + Devil's Advocate · consequential questions" },
];
