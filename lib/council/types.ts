/**
 * COUNCIL V0.1 — core domain types.
 * These types are the contract between the orchestrator, the providers and
 * the API layer. Keep them framework-agnostic.
 */

export type CouncilMode = "QUICK" | "FULL" | "DEEP";

export type AgentKey =
  | "reasoner"
  | "skeptic"
  | "practicalist"
  | "perspective"
  | "devils_advocate"
  | "comparer"
  | "judge";

export type VerdictCategory =
  | "BUILD"
  | "REFINE"
  | "VALIDATE"
  | "RECONSIDER"
  | "REJECT"
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
  /** True when the model output could not be parsed and raw text was kept. */
  degraded?: boolean;
  /** Set when the model call itself failed (agent failure — not a response). */
  failed?: boolean;
  error?: string;
  /** How many retries were used. */
  retries?: number;
}

/** Output of the comparison stage (FULL + DEEP). */
export interface CouncilComparison {
  agreements: { topic: string; agents: string[]; summary: string }[];
  disagreements: { topic: string; positions: { agent: string; position: string }[]; summary: string }[];
  sharedAssumptions: string[];
  stanceCounts: Record<Stance, number>;
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

/** The Judge's structured verdict (strict schema — see schemas.ts). */
export interface CouncilVerdict {
  verdict: VerdictCategory;
  score: number; // 0-10
  confidence: number; // 0-100
  summary: string;
  strongestArgumentFor: string;
  strongestArgumentAgainst: string;
  keyAgreements: string[];
  keyDisagreements: string[];
  criticalAssumptions: string[];
  criticalRisks: string[];
  recommendedAction: string;
  whatWouldChangeTheVerdict: string[];
  reasoning: string;
  /** True when the model could not produce a valid verdict and we returned a safe fallback. */
  degraded?: boolean;
}

export interface CouncilUsage {
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
  | "analyzing"
  | "comparing"
  | "devils_advocate"
  | "judging"
  | "complete"
  | "failed";

/** SSE events pushed to the client. */
export type CouncilEvent =
  | { type: "convened"; mode: CouncilMode; agents: AgentKey[]; stage: CouncilStage }
  | { type: "agent:start"; agent: AgentKey; name: string; stage: "analyzing" }
  | { type: "agent:done"; analysis: AgentAnalysis; stage: "analyzing" }
  | { type: "stage"; stage: "comparing" | "devils_advocate" | "judging" }
  | { type: "comparison"; comparison: CouncilComparison; stage: "comparing" }
  | { type: "da:done"; analysis: DevilAdvocateAnalysis; stage: "devils_advocate" }
  | { type: "verdict"; verdict: CouncilVerdict; usage: CouncilUsage; stage: "complete" }
  | {
      type: "error";
      message: string;
      stage: "failed";
      analyses: AgentAnalysis[];
      devilsAdvocate?: DevilAdvocateAnalysis | null;
    };

export const VERDICT_CATEGORIES: VerdictCategory[] = [
  "BUILD",
  "REFINE",
  "VALIDATE",
  "RECONSIDER",
  "REJECT",
  "INSUFFICIENT_INFORMATION",
];

export const MODES: { value: CouncilMode; label: string; blurb: string }[] = [
  { value: "QUICK", label: "Quick", blurb: "3 agents · fastest · everyday questions" },
  { value: "FULL", label: "Full", blurb: "4 agents + comparison · the standard Council" },
  { value: "DEEP", label: "Deep", blurb: "4 agents + Devil's Advocate · consequential questions" },
];
