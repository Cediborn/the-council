import { z } from "zod";
import { VERDICT_CATEGORIES, type CouncilVerdict } from "./types";

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
    if (typeof v === "string") return v.trim().length > 0 ? [v] : v;
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
});

/** Comparison stage (FULL + DEEP). */
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
      }),
    )
    .max(6)
    .default([]),
  sharedAssumptions: stringList(6),
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

/** The Judge's strict verdict schema — mirrors the spec section 11. */
export const verdictSchema = z.object({
  verdict: z.enum(VERDICT_CATEGORIES as [CouncilVerdict["verdict"], ...CouncilVerdict["verdict"][]]),
  score: z.number().min(0).max(10),
  confidence: z.number().min(0).max(100),
  summary: nonEmptyString,
  strongestArgumentFor: nonEmptyString,
  strongestArgumentAgainst: nonEmptyString,
  keyAgreements: stringList(8),
  keyDisagreements: stringList(8),
  criticalAssumptions: stringList(8),
  criticalRisks: stringList(8),
  recommendedAction: nonEmptyString,
  whatWouldChangeTheVerdict: stringList(8),
  reasoning: nonEmptyString,
});

/** Incoming API request body. */
export const councilRequestSchema = z.object({
  question: z.string().trim().min(1, "Ask the Council something.").max(6000, "Question too long (max 6000 characters)."),
  mode: z.enum(["QUICK", "FULL", "DEEP"]),
});

export type ParsedVerdict = z.infer<typeof verdictSchema>;
export type ParsedAgentAnalysis = z.infer<typeof agentAnalysisSchema>;
export type ParsedComparison = z.infer<typeof comparisonSchema>;
export type ParsedDevilsAdvocate = z.infer<typeof devilsAdvocateSchema>;
