import { describe, expect, it } from "vitest";
import { parseJsonObject, validate, isPlainObject, unwrapNestedObject } from "@/lib/council/parse";
import {
  verdictSchema,
  agentAnalysisSchema,
  comparisonSchema,
  reassessmentSchema,
  resumeAnalysisSchema,
} from "@/lib/council/schemas";

describe("parseJsonObject", () => {
  it("parses exact JSON", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a JSON-encoded string wrapping an object", () => {
    // Small models sometimes return "{\"summary\":...}" — a string containing
    // the object — instead of a raw object. Must unwrap to the object.
    const wrapped = JSON.stringify(JSON.stringify({ summary: "hi", keyPoints: ["a"] }));
    expect(parseJsonObject(wrapped)).toEqual({ summary: "hi", keyPoints: ["a"] });
  });

  it("keeps a plain JSON string as a string when it is not itself JSON", () => {
    expect(parseJsonObject('"just a string"')).toBe("just a string");
  });

  it("parses JSON wrapped in markdown fences", () => {
    const raw = 'Here you go:\n```json\n{"a":1,"b":[1,2]}\n```\nHope that helps';
    expect(parseJsonObject(raw)).toEqual({ a: 1, b: [1, 2] });
  });

  it("parses JSON with leading prose", () => {
    const raw = 'Sure! The analysis is:\n{"verdict":"BUILD","score":7}';
    expect(parseJsonObject(raw)).toEqual({ verdict: "BUILD", score: 7 });
  });

  it("recovers truncated JSON by closing braces", () => {
    const raw = '{"a":1,"b":{"c":[1,2], "d":"x"';
    expect(parseJsonObject(raw)).toEqual({ a: 1, b: { c: [1, 2], d: "x" } });
  });

  it("recovers truncated JSON inside an array (closes with ] not }", () => {
    const raw = '{"keyPoints":["one","two"';
    expect(parseJsonObject(raw)).toEqual({ keyPoints: ["one", "two"] });
  });

  it("recovers truncated nested array+object by closing in reverse order", () => {
    const raw = '{"a":[{"b":1';
    expect(parseJsonObject(raw)).toEqual({ a: [{ b: 1 }] });
  });

  it("returns null for non-JSON prose", () => {
    expect(parseJsonObject("I think the idea is good because it is.")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseJsonObject("")).toBeNull();
  });
});

describe("unwrapNestedObject", () => {
  const keys = ["summary", "keyPoints", "stance", "confidence"];

  it("merges a double-encoded object inside summary up to the top level", () => {
    const raw = {
      summary: '{"summary":"Real analysis text.","keyPoints":["A","B"],"stance":"OPPOSE","confidence":70}',
      stance: "NEUTRAL",
      keyPoints: [],
    };
    const result = unwrapNestedObject(raw, "summary", keys) as Record<string, unknown>;
    expect(result.summary).toBe("Real analysis text.");
    expect(result.keyPoints).toEqual(["A", "B"]);
    expect(result.stance).toBe("OPPOSE");
    expect(result.confidence).toBe(70);
  });

  it("leaves plain summaries untouched", () => {
    const raw = { summary: "Plain prose, not JSON.", keyPoints: ["x"] };
    expect(unwrapNestedObject(raw, "summary", keys)).toEqual(raw);
  });

  it("leaves non-object values untouched", () => {
    expect(unwrapNestedObject("string", "summary", keys)).toBe("string");
    expect(unwrapNestedObject(null, "summary", keys)).toBeNull();
  });

  it("ignores JSON in summary that is not an analysis object", () => {
    const raw = { summary: '{"a":1,"b":2}', keyPoints: [] };
    expect(unwrapNestedObject(raw, "summary", keys)).toEqual(raw);
  });
});

describe("isPlainObject", () => {
  it("distinguishes objects from arrays and null", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("x")).toBe(false);
  });
});

describe("validate", () => {
  it("accepts valid verdicts (V0.2.2.2 contract)", () => {
    const good = {
      verdict: "BUILD_MVP",
      score: 6.5,
      confidence: 61,
      informationSufficiency: "LOW",
      summary: "Worth validating.",
      keyReasons: ["Real problem", "Cheap to test"],
      agreements: ["a"],
      disagreements: ["b"],
      criticalUnknowns: ["Will users pay?"],
      assumptions: ["c"],
      risks: ["d"],
      recommendedAction: "Build a small MVP.",
      whatWouldChangeVerdict: ["new data"],
      reasoning: "Because.",
      strongestArgumentFor: "Fits the market.",
      strongestArgumentAgainst: "Competition.",
    };
    const result = validate(verdictSchema, good);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.verdict).toBe("BUILD_MVP");
  });

  it("rejects invalid verdict categories", () => {
    const bad = {
      verdict: "YES",
      score: 7,
      confidence: 80,
      summary: "x",
      strongestArgumentFor: "x",
      strongestArgumentAgainst: "x",
      recommendedAction: "x",
      reasoning: "x",
    };
    const result = validate(verdictSchema, bad);
    expect(result.ok).toBe(false);
  });

  it("rejects non-numeric score", () => {
    const bad = {
      verdict: "BUILD",
      score: "high",
      confidence: 80,
      summary: "x",
      strongestArgumentFor: "x",
      strongestArgumentAgainst: "x",
      recommendedAction: "x",
      reasoning: "x",
    };
    const result = validate(verdictSchema, bad);
    expect(result.ok).toBe(false);
  });

  it("accepts a FAILED analysis with an empty summary in a resume payload (V0.2.2.2 Part 5)", () => {
    const failed = {
      agent: "skeptic",
      name: "Skeptic",
      summary: "",
      stance: "NEUTRAL",
      confidence: 50,
      failed: true,
      error: "timeout after 60s",
      outcome: "TIMED_OUT",
    };
    const result = resumeAnalysisSchema.safeParse(failed);
    expect(result.success).toBe(true);
  });

  it("rejects a successful analysis with an empty summary in a resume payload", () => {
    const bad = {
      agent: "reasoner",
      name: "Reasoner",
      summary: "",
      stance: "SUPPORT",
      confidence: 70,
    };
    const result = resumeAnalysisSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects scores out of range", () => {
    const bad = {
      verdict: "BUILD",
      score: 11,
      confidence: 80,
      summary: "x",
      strongestArgumentFor: "x",
      strongestArgumentAgainst: "x",
      recommendedAction: "x",
      reasoning: "x",
    };
    const result = validate(verdictSchema, bad);
    expect(result.ok).toBe(false);
  });

  it("rejects missing summary", () => {
    const bad = {
      verdict: "BUILD",
      score: 7,
      confidence: 80,
      strongestArgumentFor: "x",
      strongestArgumentAgainst: "x",
      recommendedAction: "x",
      reasoning: "x",
    };
    const result = validate(verdictSchema, bad);
    expect(result.ok).toBe(false);
  });

  it("accepts agent analysis with defaults for missing arrays", () => {
    const minimal = {
      summary: "An analysis.",
      stance: "CONDITIONAL",
      confidence: 60,
    };
    const result = validate(agentAnalysisSchema, minimal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.keyPoints).toEqual([]);
      expect(result.data.assumptions).toEqual([]);
    }
  });

  it("rejects agent analysis with unknown stance", () => {
    const bad = { summary: "x", stance: "MAYBE", confidence: 50 };
    const result = validate(agentAnalysisSchema, bad);
    expect(result.ok).toBe(false);
  });

  it("defaults stance to NEUTRAL when the model omits it", () => {
    // With grammar-constrained JSON, small models often skip optional-looking
    // fields like stance entirely.
    const noStance = {
      summary: "An analysis without a stance.",
      keyPoints: ["A point"],
      confidence: 75,
    };
    const result = validate(agentAnalysisSchema, noStance);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.stance).toBe("NEUTRAL");
  });

  it("coerces null list fields into empty arrays", () => {
    const messy = {
      summary: "An analysis.",
      stance: "SUPPORT",
      keyPoints: null,
      assumptions: null,
      risks: ["a"],
      confidence: 60,
    };
    const result = validate(agentAnalysisSchema, messy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.keyPoints).toEqual([]);
      expect(result.data.assumptions).toEqual([]);
      expect(result.data.risks).toEqual(["a"]);
    }
  });

  it("coerces empty-string list fields into empty arrays (V0.2 regression)", () => {
    // Small models frequently emit "" where a list is expected; this must NOT
    // fail validation (previously the raw "" bypassed the default and broke
    // the whole analysis, degrading every agent that did it).
    const messy = {
      summary: "An analysis.",
      stance: "SUPPORT",
      keyPoints: ["A point"],
      assumptions: "",
      risks: [],
      missingInformation: "",
      confidence: 60,
    };
    const result = validate(agentAnalysisSchema, messy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.assumptions).toEqual([]);
      expect(result.data.missingInformation).toEqual([]);
    }
  });

  it("coerces scalar string list fields into single-element arrays", () => {
    // Small local models often emit a plain string where an array is expected.
    const messy = {
      summary: "An analysis.",
      stance: "NEUTRAL",
      keyPoints: "Consider a newer model.",
      assumptions: "Assume you have a reliable source.",
      risks: "Risk of receiving a non-functional unit.",
      missingInformation: "Unknown condition of the laptop.",
      confidence: 0,
    };
    const result = validate(agentAnalysisSchema, messy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.keyPoints).toEqual(["Consider a newer model."]);
      expect(result.data.assumptions).toEqual(["Assume you have a reliable source."]);
      expect(result.data.risks).toHaveLength(1);
      expect(result.data.missingInformation).toHaveLength(1);
    }
  });

  it("coerces object-valued list fields into arrays of their string values", () => {
    // Models sometimes emit key→string objects where arrays are expected.
    const messy = {
      summary: "An analysis.",
      stance: "OPPOSE",
      keyPoints: ["One.", "Two."],
      assumptions: { technologicalAssumption: "Tech has moved on." },
      risks: { financialRisk: "$200 is a real cost.", performanceRisk: "Old hardware." },
      confidence: 60,
    };
    const result = validate(agentAnalysisSchema, messy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.assumptions).toEqual(["Tech has moved on."]);
      expect(result.data.risks).toEqual(["$200 is a real cost.", "Old hardware."]);
    }
  });

  it("accepts the richer V0.2 comparison with contradictions/risks/insights", () => {
    const rich = {
      agreements: [{ topic: "topic", agents: ["Reasoner"], summary: "agree" }],
      disagreements: [],
      contradictions: [{ topic: "feasibility", summary: "Reasoner says cheap, Practicalist says costly" }],
      sharedAssumptions: ["assume budget"],
      missingInformation: ["actual market size"],
      risks: ["cost overrun"],
      uniqueInsights: ["only Skeptic noted X"],
      stanceCounts: { SUPPORT: 2, OPPOSE: 1 },
    };
    const result = validate(comparisonSchema, rich);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.contradictions).toHaveLength(1);
      expect(result.data.missingInformation).toContain("actual market size");
      expect(result.data.risks).toContain("cost overrun");
      expect(result.data.uniqueInsights).toContain("only Skeptic noted X");
      expect(result.data.stanceCounts.SUPPORT).toBe(2);
    }
  });

  it("accepts the V0.2.1 comparison fields and disagreement nature", () => {
    const rich = {
      agreements: [],
      disagreements: [
        {
          topic: "feasibility",
          positions: [{ agent: "Reasoner", position: "cheap" }, { agent: "Practicalist", position: "costly" }],
          summary: "they answer different questions",
          nature: "SUPERFICIAL",
        },
      ],
      strongestArgument: "demand is real",
      weakestArgument: "the brand comparison",
      stanceCounts: { SUPPORT: 2 },
    };
    const result = validate(comparisonSchema, rich);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.disagreements[0].nature).toBe("SUPERFICIAL");
      expect(result.data.strongestArgument).toBe("demand is real");
      expect(result.data.weakestArgument).toBe("the brand comparison");
    }
  });

  it("defaults new comparison fields safely when omitted", () => {
    const result = validate(comparisonSchema, { disagreements: [], stanceCounts: {} });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.strongestArgument).toBe("");
      expect(result.data.weakestArgument).toBe("");
    }
  });

  it("catches invalid disagreement nature and strongest/weakest values", () => {
    const messy = {
      disagreements: [{ topic: "x", positions: [], summary: "y", nature: "SOMETIMES" }],
      strongestArgument: "",
      weakestArgument: 42,
      stanceCounts: {},
    };
    const result = validate(comparisonSchema, messy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.disagreements[0].nature).toBe("FUNDAMENTAL");
      expect(result.data.strongestArgument).toBe("");
      expect(result.data.weakestArgument).toBe("");
    }
  });

  it("accepts a valid reassessment with the V0.2.1 shift", () => {
    const good = {
      summary: "the stress test hardened the core argument",
      shift: "WEAKENED",
      hardened: ["feasibility"],
      weakened: ["demand assumption"],
      positionChanges: [{ agent: "Skeptic", from: "OPPOSE", to: "CONDITIONAL" }],
      judgeGuidance: "weigh feasibility more heavily",
    };
    const result = validate(reassessmentSchema, good);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.positionChanges[0].to).toBe("CONDITIONAL");
      expect(result.data.shift).toBe("WEAKENED");
    }
  });

  it("defaults the reassessment shift to UNCHANGED and catches invalid values", () => {
    const omitted = { summary: "nothing changed", judgeGuidance: "as before" };
    const result = validate(reassessmentSchema, omitted);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.shift).toBe("UNCHANGED");

    const invalid = { summary: "x", shift: "MAYBE", judgeGuidance: "y" };
    const result2 = validate(reassessmentSchema, invalid);
    expect(result2.ok).toBe(true);
    if (result2.ok) expect(result2.data.shift).toBe("UNCHANGED");
  });

  it("defaults evidenceQuality to UNKNOWN and catches invalid values", () => {
    const minimal = { summary: "An analysis.", stance: "SUPPORT", confidence: 60 };
    const result = validate(agentAnalysisSchema, minimal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.evidenceQuality).toBe("UNKNOWN");

    const strong = { summary: "x", stance: "OPPOSE", confidence: 40, evidenceQuality: "STRONG" };
    const result2 = validate(agentAnalysisSchema, strong);
    expect(result2.ok).toBe(true);
    if (result2.ok) expect(result2.data.evidenceQuality).toBe("STRONG");

    const garbage = { summary: "x", stance: "NEUTRAL", confidence: 40, evidenceQuality: "TOTALLY" };
    const result3 = validate(agentAnalysisSchema, garbage);
    expect(result3.ok).toBe(true);
    if (result3.ok) expect(result3.data.evidenceQuality).toBe("UNKNOWN");
  });

  it("defaults the missing whyThisVerdictWon field", () => {
    const result = validate(verdictSchema, {
      verdict: "BUILD",
      score: 7,
      confidence: 80,
      summary: "x",
      strongestArgumentFor: "x",
      strongestArgumentAgainst: "x",
      recommendedAction: "x",
      reasoning: "x",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.whyThisVerdictWon).toBe("");
  });

  it("coerces scalar string lists in verdicts", () => {
    const messyVerdict = {
      verdict: "REFINE",
      score: 6,
      confidence: 70,
      summary: "Promising but needs work.",
      strongestArgumentFor: "Good fit.",
      strongestArgumentAgainst: "Cost.",
      agreements: "Most agents agree on the core idea",
      disagreements: "Feasibility is disputed",
      assumptions: "Market exists",
      risks: "Execution risk",
      recommendedAction: "Run a pilot.",
      whatWouldChangeVerdict: "Evidence of demand",
      reasoning: "The evidence is mixed.",
    };
    const result = validate(verdictSchema, messyVerdict);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.agreements).toContain("Most agents agree on the core idea");
      expect(result.data.risks).toContain("Execution risk");
    }
  });
});
