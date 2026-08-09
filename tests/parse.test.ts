import { describe, expect, it } from "vitest";
import { parseJsonObject, validate, isPlainObject, unwrapNestedObject } from "@/lib/council/parse";
import { verdictSchema, agentAnalysisSchema } from "@/lib/council/schemas";

describe("parseJsonObject", () => {
  it("parses exact JSON", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
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
  it("accepts valid verdicts", () => {
    const good = {
      verdict: "BUILD",
      score: 7.5,
      confidence: 80,
      summary: "Strong evidence.",
      strongestArgumentFor: "Fits the market.",
      strongestArgumentAgainst: "Competition.",
      keyAgreements: ["a"],
      keyDisagreements: ["b"],
      criticalAssumptions: ["c"],
      criticalRisks: ["d"],
      recommendedAction: "Proceed.",
      whatWouldChangeTheVerdict: ["new data"],
      reasoning: "Because.",
    };
    const result = validate(verdictSchema, good);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.verdict).toBe("BUILD");
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

  it("coerces scalar string lists in verdicts", () => {
    const messyVerdict = {
      verdict: "REFINE",
      score: 6,
      confidence: 70,
      summary: "Promising but needs work.",
      strongestArgumentFor: "Good fit.",
      strongestArgumentAgainst: "Cost.",
      keyAgreements: "Most agents agree on the core idea",
      keyDisagreements: "Feasibility is disputed",
      criticalAssumptions: "Market exists",
      criticalRisks: "Execution risk",
      recommendedAction: "Run a pilot.",
      whatWouldChangeTheVerdict: "Evidence of demand",
      reasoning: "The evidence is mixed.",
    };
    const result = validate(verdictSchema, messyVerdict);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.keyAgreements).toContain("Most agents agree on the core idea");
      expect(result.data.criticalRisks).toContain("Execution risk");
    }
  });
});
