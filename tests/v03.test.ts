import { describe, expect, it } from "vitest";
import {
  detectAmbiguity,
  detectGaps,
  detectSmallTalk,
  needsClarification,
} from "@/lib/council/understand";
import { buildClarificationRequest } from "@/lib/council/clarification";
import {
  affectedAgentsFor,
  classifyFollowUp,
  computeVerdictDiff,
} from "@/lib/council/followup";
import { verdictsForType } from "@/lib/council/types";
import type { AgentKey, CouncilVerdict } from "@/lib/council/types";

// ── V0.3 Part 8.1 — small-talk gate (user decision #12) ─────────────────────

describe("detectSmallTalk", () => {
  it("recognizes greetings and acknowledgments", () => {
    expect(detectSmallTalk("hi")).toBe(true);
    expect(detectSmallTalk("Hello")).toBe(true);
    expect(detectSmallTalk("thanks")).toBe(true);
    expect(detectSmallTalk("thank you so much")).toBe(true);
    expect(detectSmallTalk("ok")).toBe(true);
    expect(detectSmallTalk("cool")).toBe(true);
  });

  it("does not treat real questions as small talk", () => {
    expect(detectSmallTalk("hi, should I buy a phone?")).toBe(false);
    expect(detectSmallTalk("thank you, now explain point two")).toBe(false);
    expect(detectSmallTalk("what about Ghana?")).toBe(false);
    expect(detectSmallTalk("")).toBe(false);
  });
});

// ── V0.3 Parts 3-4 — gap detection (decision-critical missing info) ────────

describe("detectGaps", () => {
  it("flags a missing budget for business questions", () => {
    const gaps = detectGaps("Should I start a clothing business?", "business");
    expect(gaps.map((g) => g.key)).toContain("budget");
  });

  it("does not flag a budget when money is already mentioned", () => {
    const gaps = detectGaps("Should I start a clothing business with $500?", "business");
    expect(gaps.map((g) => g.key)).not.toContain("budget");
  });

  it("flags a missing location for move/relocation decisions", () => {
    const gaps = detectGaps("Should I move to study computer science?", "decision");
    expect(gaps.map((g) => g.key)).toContain("location");
  });

  it("does not flag a location when a destination is named", () => {
    const gaps = detectGaps("Should I move to Ghana?", "decision");
    expect(gaps.map((g) => g.key)).not.toContain("location");
  });

  it("flags missing scope for build questions", () => {
    const gaps = detectGaps("I want to build an app. Should I?", "business");
    expect(gaps.map((g) => g.key)).toContain("scale");
  });

  it("flags a bare decision with no stated goal", () => {
    const gaps = detectGaps("Should I do it?", "decision");
    expect(gaps.map((g) => g.key)).toContain("goal");
  });

  it("returns no gaps for a well-specified question", () => {
    const gaps = detectGaps(
      "Should I build an MVP app for students with $5,000 in the next 6 months?",
      "business",
    );
    expect(gaps).toEqual([]);
  });

  it("needsClarification reflects gap presence", () => {
    expect(needsClarification("Should I start a clothing business?", "business")).toBe(true);
    // Stated goal → no goal gap; buy-with-a-reason is decision-critical info.
    expect(needsClarification("Should I buy this phone because I want better photos?", "decision")).toBe(false);
  });
});

describe("detectAmbiguity", () => {
  it("flags very short questions", () => {
    expect(detectAmbiguity("Should I?")).toBe(true);
  });
  it("passes clear questions", () => {
    expect(detectAmbiguity("Should I buy a new phone if my current one still works?")).toBe(false);
  });
});

// ── V0.3 Part 7 — clarification bank (bank-first, ≤2 questions) ─────────────

describe("buildClarificationRequest", () => {
  it("asks at most 2 questions and explains why each matters", () => {
    const req = buildClarificationRequest("Should I start a business?", "business");
    expect(req.critical).toBe(true);
    expect(req.questions.length).toBeLessThanOrEqual(2);
    expect(req.questions.length).toBeGreaterThan(0);
    for (const q of req.questions) {
      expect(q.id).toMatch(/^cl-/);
      expect(q.question.length).toBeGreaterThan(0);
      expect(q.why.length).toBeGreaterThan(0);
    }
  });

  it("includes an explicit, correctable assumption", () => {
    const req = buildClarificationRequest("Should I start a business?", "business");
    expect(req.assumptions.length).toBeGreaterThan(0);
    expect(req.assumptions[0]).toMatch(/business|proposal|market/i);
  });

  it("returns critical=false when nothing is missing", () => {
    const req = buildClarificationRequest(
      "Should I build an MVP with $5,000 for students in 6 months?",
      "business",
    );
    expect(req.critical).toBe(false);
    expect(req.questions).toEqual([]);
  });
});

// ── V0.3 Part 8.1 — follow-up intent classification ─────────────────────────

describe("classifyFollowUp", () => {
  it("classifies challenge intent", () => {
    expect(classifyFollowUp("Challenge the verdict")).toBe("CHALLENGE");
    expect(classifyFollowUp("Try to break this conclusion")).toBe("CHALLENGE");
  });

  it("classifies corrections", () => {
    expect(classifyFollowUp("That's not what I meant")).toBe("CORRECTION");
    expect(classifyFollowUp("I already have customers")).toBe("CORRECTION");
    expect(classifyFollowUp("I disagree with the verdict")).toBe("CORRECTION");
  });

  it("classifies explanation requests", () => {
    expect(classifyFollowUp("Explain the second point")).toBe("EXPLANATION_REQUEST");
    expect(classifyFollowUp("Why did you say the market is risky?")).toBe("EXPLANATION_REQUEST");
    expect(classifyFollowUp("What did you mean by that?")).toBe("EXPLANATION_REQUEST");
  });

  it("classifies small talk", () => {
    expect(classifyFollowUp("thanks")).toBe("SMALL_TALK");
    expect(classifyFollowUp("ok")).toBe("SMALL_TALK");
  });

  it("classifies new information referencing the thread", () => {
    expect(classifyFollowUp("What about Ghana?")).toBe("NEW_INFORMATION");
    expect(classifyFollowUp("My budget is $5,000")).toBe("NEW_INFORMATION");
  });

  it("classifies a fresh question", () => {
    expect(classifyFollowUp("Should I learn piano?")).toBe("NEW_QUESTION");
  });

  it("thread-referencing questions stay in the same deliberation", () => {
    expect(classifyFollowUp("What about piano instead?")).toBe("NEW_INFORMATION");
  });
});

// ── V0.3 Part 8.3 — affected-agent selection (targeted re-analysis) ─────────

describe("affectedAgentsFor", () => {
  const all: AgentKey[] = ["reasoner", "skeptic", "practicalist", "perspective"];

  it("maps budget talk to practicalist + skeptic", () => {
    expect(affectedAgentsFor("My budget is $5,000", "business", all)).toEqual([
      "practicalist",
      "skeptic",
    ]);
  });

  it("maps market talk to skeptic + perspective", () => {
    expect(affectedAgentsFor("I already have 5,000 users", "business", all)).toEqual([
      "skeptic",
      "perspective",
    ]);
  });

  it("maps technical talk to reasoner + skeptic", () => {
    expect(affectedAgentsFor("The code has a SQL injection", "technical", all)).toEqual([
      "reasoner",
      "skeptic",
    ]);
  });

  it("only re-runs members the previous Council used (overlap)", () => {
    // Quick-mode council used only reasoner + skeptic + perspective.
    const quick: AgentKey[] = ["reasoner", "skeptic", "perspective"];
    const affected = affectedAgentsFor("My budget is $5,000", "business", quick);
    expect(affected).toContain("skeptic");
    expect(affected).not.toContain("practicalist");
  });

  it("falls back to general lenses when no overlap exists", () => {
    const affected = affectedAgentsFor("My budget is $5,000", "business", ["perspective"]);
    expect(affected).toContain("perspective"); // only available member
  });
});

// ── V0.3 (Part 3 / §5) — verdict diff ───────────────────────────────────────

function verdict(overrides: Partial<CouncilVerdict>): CouncilVerdict {
  return {
    verdict: "BUILD",
    score: 8,
    confidence: 85,
    informationSufficiency: "MEDIUM",
    summary: "s",
    keyReasons: ["market fit"],
    agreements: [],
    disagreements: [],
    criticalUnknowns: [],
    assumptions: [],
    risks: [],
    recommendedAction: "a",
    whatWouldChangeVerdict: [],
    reasoning: "r",
    whyThisVerdictWon: "w",
    strongestArgumentFor: "f",
    strongestArgumentAgainst: "a",
    ...overrides,
  };
}

describe("computeVerdictDiff", () => {
  it("returns a no-change diff when there is no previous verdict", () => {
    const d = computeVerdictDiff(null, verdict({}));
    expect(d.changed).toBe(false);
    expect(d.verdictChanged).toBe(false);
  });

  it("detects a changed verdict", () => {
    const d = computeVerdictDiff(verdict({}), verdict({ verdict: "RECONSIDER" }));
    expect(d.changed).toBe(true);
    expect(d.verdictChanged).toBe(true);
    expect(d.summaryNote).toMatch(/verdict changed from BUILD to RECONSIDER/);
  });

  it("detects score and confidence movement", () => {
    const d = computeVerdictDiff(
      verdict({ score: 8, confidence: 85 }),
      verdict({ score: 6.5, confidence: 60 }),
    );
    expect(d.changed).toBe(true);
    expect(d.scoreDelta).toBe(-1.5);
    expect(d.confidenceDelta).toBe(-25);
  });

  it("detects new and dropped reasons", () => {
    const d = computeVerdictDiff(
      verdict({ keyReasons: ["market fit", "cheap to test"] }),
      verdict({ keyReasons: ["market fit", "competition risk"] }),
    );
    expect(d.reasonsAdded).toContain("competition risk");
    expect(d.reasonsRemoved).toContain("cheap to test");
    expect(d.changed).toBe(true);
  });

  it("reports a neutral summary when nothing material changed", () => {
    const d = computeVerdictDiff(verdict({}), verdict({}));
    expect(d.changed).toBe(false);
    expect(d.summaryNote).toMatch(/same conclusion/i);
  });
});

// ── V0.3 Part 7 — per-type verdict sets ─────────────────────────────────────

describe("verdictsForType (V0.3 per-type sets)", () => {
  it("judges business with the product set", () => {
    expect(verdictsForType("business")).toContain("BUILD_MVP");
    expect(verdictsForType("business")).not.toContain("CONFIRMED");
  });

  it("judges maths with CORRECT/INCORRECT, not product verdicts", () => {
    expect(verdictsForType("mathematical")).toContain("CORRECT");
    expect(verdictsForType("mathematical")).not.toContain("BUILD");
  });

  it("judges arguments with SUPPORTED/UNSUPPORTED", () => {
    expect(verdictsForType("argumentative")).toContain("SUPPORTED");
    expect(verdictsForType("argumentative")).not.toContain("PIVOT");
  });

  it("never offers INSUFFICIENT_INFORMATION to the model", () => {
    for (const type of [
      "decision",
      "explanation",
      "comparison",
      "technical",
      "mathematical",
      "educational",
      "business",
      "planning",
      "creative",
      "argumentative",
      "troubleshooting",
      "general",
    ] as const) {
      expect(verdictsForType(type)).not.toContain("INSUFFICIENT_INFORMATION");
    }
  });
});
