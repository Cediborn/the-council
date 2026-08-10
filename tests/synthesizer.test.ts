import { describe, expect, it } from "vitest";
import { synthesizeProvisionalVerdict } from "@/lib/council/synthesizer";
import type { AgentAnalysis, CouncilComparison } from "@/lib/council/types";

function analysis(overrides: Partial<AgentAnalysis> & { agent: AgentAnalysis["agent"] }): AgentAnalysis {
  return {
    name: overrides.agent,
    summary: "An analysis.",
    stance: "SUPPORT",
    keyPoints: ["point one", "point two"],
    assumptions: [],
    risks: [],
    missingInformation: [],
    confidence: 70,
    ...overrides,
  };
}

const emptyComparison: CouncilComparison = {
  agreements: [],
  disagreements: [],
  contradictions: [],
  sharedAssumptions: [],
  missingInformation: [],
  risks: [],
  uniqueInsights: [],
  strongestArgument: "",
  weakestArgument: "",
  stanceCounts: { SUPPORT: 0, OPPOSE: 0, CONDITIONAL: 0, NEUTRAL: 0, INSUFFICIENT: 0 },
};

describe("synthesizeProvisionalVerdict — deterministic rules", () => {
  it("returns degraded INSUFFICIENT_INFORMATION when nothing succeeded", () => {
    const v = synthesizeProvisionalVerdict({
      question: "Q?",
      questionType: "business",
      analyses: [
        analysis({ agent: "reasoner", failed: true, error: "boom" }),
        analysis({ agent: "skeptic", failed: true, error: "boom" }),
      ],
      comparison: null,
    });
    expect(v.verdict).toBe("INSUFFICIENT_INFORMATION");
    expect(v.degraded).toBe(true);
    expect(v.provisional).toBe(true);
  });

  it("is labelled degraded + provisional and is deterministic", () => {
    const input = {
      question: "Should I build this?",
      questionType: "business" as const,
      analyses: [analysis({ agent: "reasoner" })],
      comparison: emptyComparison,
    };
    const a = synthesizeProvisionalVerdict(input);
    const b = synthesizeProvisionalVerdict(input);
    expect(a).toEqual(b); // pure + deterministic
    expect(a.degraded).toBe(true);
    expect(a.provisional).toBe(true);
    expect(a.summary).toMatch(/provisional/i);
    expect(a.reasoning).toMatch(/degraded/i);
    expect(a.confidence).toBeLessThanOrEqual(45); // never overconfident
  });

  it("never emits a full BUILD from a broken Judge — positive case caps at BUILD_MVP/VALIDATE", () => {
    // Strong support, zero risks, no unknowns.
    const v = synthesizeProvisionalVerdict({
      question: "Is this app worth building?",
      questionType: "business",
      analyses: [
        analysis({ agent: "reasoner" }),
        analysis({ agent: "skeptic", stance: "SUPPORT" }),
        analysis({ agent: "practicalist", stance: "CONDITIONAL" }),
      ],
      comparison: emptyComparison,
    });
    expect(v.verdict).toBe("BUILD_MVP");
    expect(v.verdict).not.toBe("BUILD");
  });

  it("uses reasoning content, not stance counts — heavy risks defeat unanimous support (product set)", () => {
    // Every member SUPPORTS, but each lists several serious risks + contradictions.
    const risky = analysis({
      agent: "reasoner",
      stance: "SUPPORT",
      keyPoints: ["I like it"],
      risks: ["market is saturated", "users churn", "unit economics fail", "competitors are entrenched"],
    });
    const v = synthesizeProvisionalVerdict({
      question: "Should I build this startup?",
      questionType: "business",
      analyses: [risky, risky, risky],
      comparison: { ...emptyComparison, contradictions: [{ topic: "demand", summary: "conflicting" }] },
    });
    expect(v.verdict).toBe("DO_NOT_BUILD");
    expect(v.verdict).not.toBe("BUILD_MVP");
  });

  it("maps the general set for non-product question types", () => {
    const v = synthesizeProvisionalVerdict({
      question: "Why is the sky blue?",
      questionType: "explanation",
      analyses: [analysis({ agent: "reasoner" })],
      comparison: emptyComparison,
    });
    // General set: the positive provisional ceiling is VALIDATE (no BUILD_MVP/PIVOT).
    expect(["VALIDATE", "BUILD", "REFINE"].includes(v.verdict)).toBe(true);
    expect(["BUILD_MVP", "PIVOT", "DO_NOT_BUILD"].includes(v.verdict)).toBe(false);
  });

  it("mixed evidence produces PIVOT/RECONSIDER", () => {
    // riskPressure 2/(2+3) = 0.4 → RECONSIDER → PIVOT (product set).
    const v = synthesizeProvisionalVerdict({
      question: "Should I pivot my product?",
      questionType: "business",
      analyses: [
        analysis({ agent: "reasoner", keyPoints: ["works", "cheap to test"], risks: ["costly"] }),
        analysis({ agent: "skeptic", stance: "OPPOSE", keyPoints: ["risky"], risks: ["regulation"] }),
      ],
      comparison: emptyComparison,
    });
    expect(v.verdict).toBe("PIVOT");
  });

  it("surfaces critical unknowns and what would change the verdict", () => {
    const v = synthesizeProvisionalVerdict({
      question: "Should I buy this phone?",
      questionType: "decision",
      analyses: [
        analysis({
          agent: "reasoner",
          missingInformation: ["battery health", "repair history"],
        }),
      ],
      comparison: { ...emptyComparison, missingInformation: ["warranty coverage"] },
    });
    expect(v.criticalUnknowns).toContain("battery health");
    expect(v.criticalUnknowns).toContain("warranty coverage");
    expect(v.whatWouldChangeVerdict.some((w) => /battery health|warranty/i.test(w))).toBe(true);
  });

  it("preserves key reasons from the surviving analyses", () => {
    const v = synthesizeProvisionalVerdict({
      question: "Q?",
      questionType: "business",
      analyses: [
        analysis({ agent: "reasoner", keyPoints: ["real problem", "cheap to test"] }),
        analysis({ agent: "skeptic", keyPoints: ["strong demand signal"] }),
      ],
      comparison: emptyComparison,
    });
    expect(v.keyReasons).toContain("real problem");
  });
});
