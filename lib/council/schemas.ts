import { z } from "zod";
import { ALL_VERDICTS, type VerdictCategory } from "./types";

/**
 * All model output is treated as untrusted data. Every structured response
 * passes through these schemas; anything that fails validation is handled by
 * the graceful fallback path in parse.ts (retry once, then degrade safely).
 */

const nonEmptyString = z.string().min(1).max(8000);
const point = z.string().min(1).max(600);

/**
 * Accept a string, an array of strings, or an object of key→string values;
 * normalize everything into an array of strings. Small local models emit
 * plain strings or key→value objects where arrays are required — coercing
 * keeps the Council working instead of degrading every response (spec:
 * graceful fallback for malformed output).
 */
const stringList = (max: number) =>
  z.preprocess((v) => {
    if (v === null || v === undefined) return [];
    if (typeof v === "string") return v.trim().length > 0 ? [v] : [];
    if (isPlainRecord(v)) {
      const values = Object.values(v)
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim());
      return values;
    }
    return v;
  }, z.array(point).max(max).default([]));

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export const stanceSchema = z.enum([
  "SUPPORT",
  "OPPOSE",
  "CONDITIONAL",
  "NEUTRAL",
  "INSUFFICIENT",
]);

/** Analytical agents (Reasoner, Skeptic, Practicalist, Perspective). */
export const agentAnalysisSchema = z.object({
  summary: nonEmptyString,
  // Small models frequently omit stance; NEUTRAL is the honest default.
  stance: stanceSchema.default("NEUTRAL"),
  keyPoints: stringList(8),
  assumptions: stringList(6),
  risks: stringList(6),
  missingInformation: stringList(6),
  confidence: z.number().min(0).max(100).default(50),
  // V0.2.1 (Part 11): how strong the evidence behind the analysis is. `.catch`
  // keeps a garbage enum value from degrading the whole analysis.
  evidenceQuality: z
    .enum(["STRONG", "MODERATE", "WEAK", "UNKNOWN"])
    .catch("UNKNOWN")
    .default("UNKNOWN"),
});

/** Comparison stage (FULL + DEEP) — V0.2 is richer (Part 13). */
export const comparisonSchema = z.object({
  agreements: z
    .array(
      z.object({
        topic: point,
        agents: z.array(z.string().min(1).max(60)).max(6).default([]),
        summary: point,
      }),
    )
    .max(6)
    .default([]),
  disagreements: z
    .array(
      z.object({
        topic: point,
        positions: z
          .array(z.object({ agent: z.string().min(1).max(60), position: point }))
          .max(6)
          .default([]),
        summary: point,
        // V0.2.1 (Part 13): FUNDAMENTAL vs SUPERFICIAL disagreement.
        nature: z
          .enum(["SUPERFICIAL", "FUNDAMENTAL"])
          .catch("FUNDAMENTAL")
          .default("FUNDAMENTAL"),
      }),
    )
    .max(6)
    .default([]),
  contradictions: z
    .array(z.object({ topic: point, summary: point }))
    .max(6)
    .default([]),
  sharedAssumptions: stringList(6),
  missingInformation: stringList(6),
  risks: stringList(6),
  uniqueInsights: stringList(6),
  // V0.2.1 (Part 12): the strongest and weakest argument on the table. `.catch`
  // tolerates omission so a missing field never degrades the whole comparison.
  strongestArgument: z.string().min(1).max(600).catch(""),
  weakestArgument: z.string().min(1).max(600).catch(""),
  stanceCounts: z
    .object({
      SUPPORT: z.number().int().min(0).default(0),
      OPPOSE: z.number().int().min(0).default(0),
      CONDITIONAL: z.number().int().min(0).default(0),
      NEUTRAL: z.number().int().min(0).default(0),
      INSUFFICIENT: z.number().int().min(0).default(0),
    })
    .partial()
    .default({}),
});

/** Reassessment (DEEP only, after Devil's Advocate) — V0.2.1 (Parts 12, 21). */
export const reassessmentSchema = z.object({
  summary: nonEmptyString,
  // V0.2.1 (Part 21): what the stress-test did to the emerging conclusion.
  shift: z
    .enum(["UNCHANGED", "STRENGTHENED", "WEAKENED", "REVERSED"])
    .catch("UNCHANGED")
    .default("UNCHANGED"),
  hardened: stringList(6),
  weakened: stringList(6),
  positionChanges: z
    .array(
      z.object({
        agent: z.string().min(1).max(60),
        from: z.string().min(1).max(30),
        to: z.string().min(1).max(30),
      }),
    )
    .max(6)
    .default([]),
  judgeGuidance: nonEmptyString,
});

/** Devil's Advocate (DEEP). */
export const devilsAdvocateSchema = z.object({
  summary: nonEmptyString,
  strongestArgument: nonEmptyString,
  attemptToBreakIt: nonEmptyString,
  unsupportedAssumptions: stringList(6),
  convergenceWarning: z.string().max(1000).default(""),
  minorityPoint: z.string().max(1000).default(""),
  evidenceThatWouldResolve: stringList(6),
});

/**
 * The Judge's strict verdict schema — mirrors the V0.2.2.2 output contract.
 *
 * Accepts any category from the shared union (the orchestrator then enforces
 * the question-type-specific set: a category outside the allowed set is
 * treated as malformed and falls back to the deterministic synthesizer).
 * Missing fields coerce gracefully so malformed output never crashes the UI.
 *
 * V0.2.2.3: INSUFFICIENT_INFORMATION intentionally remains in the union even
 * though no question type offers it — the orchestrator's per-type enforcement
 * routes any attempt to the synthesizer (a provisional verdict), while the
 * synthesizer itself is the only producer of the reserved no-verdict state
 * (zero completed analyses). The schema validates *model output*; it does not
 * define what the model may choose.
 */
export const verdictSchema = z.object({
  verdict: z.enum(ALL_VERDICTS as [VerdictCategory, ...VerdictCategory[]]),
  score: z.number().min(0).max(10),
  confidence: z.number().min(0).max(100),
  // V0.2.2.2 (Part 1A): how complete/reliable the available information is.
  informationSufficiency: z
    .enum(["HIGH", "MEDIUM", "LOW"])
    .catch("LOW")
    .default("LOW"),
  summary: nonEmptyString,
  // V0.2.2.2 (Part 6): the deciding reasons.
  keyReasons: stringList(8),
  // Renamed from keyAgreements (V0.2.2.2 contract).
  agreements: stringList(8),
  // Renamed from keyDisagreements (V0.2.2.2 contract).
  disagreements: stringList(8),
  // V0.2.2.2 (Part 1): what is still unknown and would matter.
  criticalUnknowns: stringList(8),
  // Renamed from criticalAssumptions (V0.2.2.2 contract).
  assumptions: stringList(8),
  // Renamed from criticalRisks (V0.2.2.2 contract).
  risks: stringList(8),
  recommendedAction: nonEmptyString,
  // Renamed from whatWouldChangeTheVerdict (V0.2.2.2 contract).
  whatWouldChangeVerdict: stringList(8),
  reasoning: nonEmptyString,
  // Small models sometimes omit this; fall back to the reasoning text so the
  // verdict stays complete and honest.
  whyThisVerdictWon: z.string().max(1200).default(""),
  strongestArgumentFor: nonEmptyString,
  strongestArgumentAgainst: nonEmptyString,
});

/** Agent keys for resume validation (must match types.AgentKey). */
const AGENT_KEY_ENUM = [
  "reasoner",
  "skeptic",
  "practicalist",
  "perspective",
  "devils_advocate",
  "comparer",
  "reassessor",
  "judge",
] as const;

/**
 * Analyses carried in a resume payload. agentAnalysisSchema covers the model
 * output fields; agent/name (assigned by the orchestrator) and the failure
 * markers must be preserved so a resumed session can rebuild the exact map.
 *
 * `summary` is RELAXED to allow empty: a failed analysis keeps `summary: ""`
 * (the orchestrator's catch only sets failed/error/outcome), and the exact
 * member the retry feature exists for must round-trip or the resume POST 400s.
 */
export const resumeAnalysisSchema = agentAnalysisSchema
  .extend({
    agent: z.enum(AGENT_KEY_ENUM),
    name: z.string().min(1),
    summary: z.string().max(8000),
    failed: z.boolean().optional(),
    error: z.string().optional(),
    degraded: z.boolean().optional(),
    outcome: z
      .enum(["COMPLETED", "FAILED", "TIMED_OUT", "NOT_STARTED"])
      .optional(),
    retries: z.number().int().min(0).optional(),
  })
  .superRefine((v, ctx) => {
    // A failed analysis must carry its failure markers; a successful one must
    // have content. Anything else is a malformed resume payload.
    if (!v.failed && v.summary.trim().length === 0) {
      ctx.addIssue({ code: "custom", message: "successful analyses need a summary" });
    }
  });

/**
 * V0.2.2.2 (Part 5): resumable-session payload — the client re-submits the
 * question/mode/sessionId with its completed analyses and the failed member
 * to re-run. Optional on every request so normal runs are unaffected.
 */
export const resumeSchema = z.object({
  agents: z.array(z.enum(AGENT_KEY_ENUM)).min(1).max(8),
  analyses: z.array(resumeAnalysisSchema).max(8).default([]),
  retryAgent: z.enum(AGENT_KEY_ENUM),
});

/** Incoming API request body. */
export const councilRequestSchema = z.object({
  question: z.string().trim().min(1, "Ask the Council something.").max(6000, "Question too long (max 6000 characters)."),
  mode: z.enum(["QUICK", "FULL", "DEEP"]),
  sessionId: z.string().min(1).max(120).optional(),
  resume: resumeSchema.optional(),
});

export type ParsedVerdict = z.infer<typeof verdictSchema>;
export type ParsedAgentAnalysis = z.infer<typeof agentAnalysisSchema>;
export type ParsedComparison = z.infer<typeof comparisonSchema>;
export type ParsedDevilsAdvocate = z.infer<typeof devilsAdvocateSchema>;
export type ParsedReassessment = z.infer<typeof reassessmentSchema>;
