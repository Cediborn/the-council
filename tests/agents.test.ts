import { describe, expect, it } from "vitest";
import {
  AGENTS,
  buildAgentContext,
  buildClassificationContext,
  classifyQuestion,
  judgeOutputContract,
  judgeSystemFor,
  selectQuickAgents,
} from "@/lib/council/agents";
import { verdictsForType } from "@/lib/council/types";

describe("classifyQuestion", () => {
  it("detects mathematical questions", () => {
    expect(classifyQuestion("Why is the derivative of sqrt(x) equal to 1/(2sqrt(x))?").type).toBe("mathematical");
    expect(classifyQuestion("How do I solve this quadratic equation?").type).toBe("mathematical");
  });

  it("detects technical questions", () => {
    expect(classifyQuestion("Is this code safe to run?").type).toBe("technical");
    expect(classifyQuestion("Why is my react component re-rendering?").type).toBe("technical");
    expect(classifyQuestion("Is my SQL query vulnerable to injection?").type).toBe("technical");
  });

  it("detects troubleshooting questions before technical ones", () => {
    expect(classifyQuestion("My laptop won't boot, what should I do?").type).toBe("troubleshooting");
    expect(classifyQuestion("The app keeps crashing, how do I fix it?").type).toBe("troubleshooting");
    expect(classifyQuestion("My screen is broken after a fall").type).toBe("troubleshooting");
    // Generic debugging stays technical, not troubleshooting.
    expect(classifyQuestion("Why is my react component re-rendering?").type).toBe("technical");
  });

  it("detects comparison questions", () => {
    expect(classifyQuestion("Compare React vs Vue for a small team").type).toBe("comparison");
    expect(classifyQuestion("What is the difference between a SSD and an HDD?").type).toBe("comparison");
  });

  it("detects business questions", () => {
    expect(classifyQuestion("Is this business idea good?").type).toBe("business");
    expect(classifyQuestion("Should I launch my startup now?").type).toBe("business");
  });

  it("detects decision questions before educational ones", () => {
    expect(classifyQuestion("Should I change my university course?").type).toBe("decision");
    expect(classifyQuestion("Should I buy a new phone?").type).toBe("decision");
    expect(classifyQuestion("Should I quit my job?").type).toBe("decision");
  });

  it("detects educational questions", () => {
    expect(classifyQuestion("Help me understand photosynthesis").type).toBe("educational");
    expect(classifyQuestion("Why am I getting this maths answer wrong?").type).toBe("mathematical");
    expect(classifyQuestion("Explain the water cycle to me").type).toBe("educational");
  });

  it("detects planning questions", () => {
    expect(classifyQuestion("How do I plan a move to another country?").type).toBe("planning");
    expect(classifyQuestion("What steps should I take to get started with investing?").type).toBe("planning");
  });

  it("detects creative questions", () => {
    expect(classifyQuestion("Help me write a story about a time traveler").type).toBe("creative");
  });

  it("detects argumentative questions", () => {
    expect(classifyQuestion("What do you think about this argument for free will?").type).toBe("argumentative");
    expect(classifyQuestion("Give me arguments for and against this claim").type).toBe("argumentative");
  });

  it("detects explanation questions", () => {
    expect(classifyQuestion("Why is the sky blue?").type).toBe("explanation");
    expect(classifyQuestion("What does this news mean for the economy?").type).toBe("explanation");
  });

  it("defaults to general", () => {
    expect(classifyQuestion("Tell me about black holes").type).toBe("general");
  });

  it("returns ordered capabilities", () => {
    const c = classifyQuestion("Is my code vulnerable to SQL injection?");
    expect(c.capabilities).toContain("technical_analysis");
    expect(c.capabilities).toContain("risk_analysis");
    expect(c.label).toBe("Technical");
  });

  it("uses the V0.2.1 capability taxonomy", () => {
    expect(classifyQuestion("Why is the derivative of sqrt(x) 1/(2sqrt(x))?").capabilities).toContain(
      "mathematical_reasoning",
    );
    expect(classifyQuestion("Compare React vs Vue").capabilities).toContain("comparison");
    expect(classifyQuestion("Should I buy this phone?").capabilities).toContain("assumption_testing");
    expect(classifyQuestion("Help me write a story").capabilities).toContain("creativity");
    expect(
      classifyQuestion("What do you think about this argument?").capabilities,
    ).toContain("assumption_testing");
  });

  it("answers the V0.2.1 general-question battery with sensible types", () => {
    expect(classifyQuestion("Should I buy a new phone if my current phone still works?").type).toBe("decision");
    expect(classifyQuestion("Why is the derivative of sqrt(x) equal to 1/(2sqrt(x))?").type).toBe("mathematical");
    expect(classifyQuestion("Should I change my university course because I don't enjoy it?").type).toBe("decision");
    expect(classifyQuestion("Is university still worth attending in 2026?").type).toBe("decision");
    expect(classifyQuestion("Is this AI Council product actually a good idea?").type).toBe("general");
    expect(classifyQuestion("Why is the sky blue?").type).toBe("explanation");
    expect(classifyQuestion("Which is better for me, a gaming laptop or an upgrade?").type).toBe("comparison");
    expect(classifyQuestion("Is this piece of code logically correct?").type).toBe("technical");
    expect(classifyQuestion("I think my friend is angry at me because they haven't replied. What should I consider?").type).toBe("decision");
    expect(classifyQuestion("Give me arguments for and against this claim").type).toBe("argumentative");
  });
});

describe("selectQuickAgents", () => {
  it("selects three distinct agents", () => {
    for (const q of [
      "Should I buy this phone?",
      "Why is the derivative of sqrt(x) 1/(2sqrt(x))?",
      "Is this business idea good?",
      "Which university should I choose?",
      "Is this code safe?",
      "What do you think about this argument?",
      "Should I make this decision?",
      "What does this news mean?",
    ]) {
      const agents = selectQuickAgents(q);
      expect(agents).toHaveLength(3);
      expect(new Set(agents).size).toBe(3);
    }
  });

  it("always includes the reasoner", () => {
    for (const q of [
      "Should I buy this phone?",
      "Which university should I choose?",
      "What does this news mean?",
    ]) {
      expect(selectQuickAgents(q)).toContain("reasoner");
    }
  });

  it("keeps the skeptic + practicalist for purchase questions", () => {
    expect(selectQuickAgents("Should I buy this phone?")).toEqual([
      "reasoner",
      "practicalist",
      "skeptic",
    ]);
  });

  it("uses perspective for mathematical learning questions", () => {
    const agents = selectQuickAgents("Why is the derivative of sqrt(x) equal to 1/(2sqrt(x))?");
    expect(agents).toContain("perspective");
    expect(agents).toContain("skeptic");
  });

  it("uses technical emphasis for code questions", () => {
    const agents = selectQuickAgents("Is my code vulnerable to SQL injection?");
    expect(agents).toContain("skeptic");
    expect(agents).toContain("practicalist");
  });

  it("uses perspective + practicalist for comparison questions", () => {
    const agents = selectQuickAgents("Compare React vs Vue for a small team");
    expect(agents).toContain("perspective");
    expect(agents).toContain("practicalist");
  });
});

describe("agent prompt contracts (V0.2.1 Parts 6-11, 16, 26, 27)", () => {
  it("the Reasoner must refuse to agree automatically and call out wrong premises", () => {
    const s = AGENTS.reasoner.system;
    expect(s).toMatch(/premise is wrong/i);
    expect(s).toMatch(/do not agree to be agreeable/i);
    expect(s).toMatch(/facts|assumptions/i);
  });

  it("the Skeptic must not disagree automatically and must praise strong arguments", () => {
    const s = AGENTS.skeptic.system;
    expect(s).toMatch(/must NOT disagree automatically/i);
    expect(s).toMatch(/genuinely strong.*SAY SO|SAY SO.*strong/i);
    expect(s).toMatch(/stress-testing, not contrarianism/i);
  });

  it("the Practicalist distinguishes possible from practical and weighs opportunity cost", () => {
    const s = AGENTS.practicalist.system;
    expect(s).toMatch(/technically possible.*actually practical|actually practical.*technically possible/is);
    expect(s).toMatch(/opportunity cost/i);
    expect(s).toMatch(/failure points/i);
  });

  it("the Perspective agent may reframe the question itself", () => {
    expect(AGENTS.perspective.system).toMatch(/framed incorrectly/i);
  });

  it("every analytical agent carries the evidence discipline (Part 11)", () => {
    for (const key of ["reasoner", "skeptic", "practicalist", "perspective"] as const) {
      expect(AGENTS[key].system).toMatch(/never treat confidence, majority opinion, or the user's assertion as evidence/i);
    }
  });

  it("the Judge follows a 10-step reasoning process, calibrates confidence, and is willing to say no", () => {
    const s = AGENTS.judge.system;
    expect(s).toMatch(/work through this internal process/i);
    expect(s).toMatch(/restate the actual question/i);
    expect(s).toMatch(/confidence calibration/i);
    expect(s).toMatch(/never inflate confidence/i);
    expect(s).toMatch(/be willing to say no/i);
    expect(s).toMatch(/do NOT soften every conclusion/i);
    expect(s).toMatch(/never count stances/i);
  });

  it("V0.2.2.3: the Judge is told INSUFFICIENT_INFORMATION is NOT available to it — provisional verdicts with sufficiency instead", () => {
    const s = AGENTS.judge.system;
    expect(s).toMatch(/INSUFFICIENT_INFORMATION is NOT an available verdict/i);
    expect(s).toMatch(/provisional verdict/i);
    expect(s).toMatch(/informationSufficiency/i);
    expect(s).toMatch(/criticalUnknowns/i);
    expect(s).toMatch(/separate information sufficiency from the verdict/i);
  });

  it("V0.2.2.2: the Judge output contract is type-dependent (Part 6)", () => {
    const business = judgeOutputContract("business");
    expect(business).toMatch(/"BUILD_MVP"/);
    expect(business).toMatch(/"PIVOT"/);
    expect(business).toMatch(/"DO_NOT_BUILD"/);
    expect(business).not.toMatch(/"REFINE"/);

    const explanation = judgeOutputContract("explanation");
    expect(explanation).toMatch(/"CONFIRMED"/);
    expect(explanation).toMatch(/"UNRESOLVED"/);
    expect(explanation).not.toMatch(/"PIVOT"/);
    expect(explanation).not.toMatch(/"BUILD_MVP"/);

    const math = judgeOutputContract("mathematical");
    expect(math).toMatch(/"CORRECT"/);
    expect(math).toMatch(/"INCORRECT"/);
    expect(math).not.toMatch(/"REJECT"/);
  });

  it("V0.2.2.2: judgeSystemFor lists the categories allowed for the question type", () => {
    expect(judgeSystemFor("business")).toMatch(/BUILD_MVP/);
    expect(judgeSystemFor("explanation")).not.toMatch(/BUILD_MVP/);
    expect(judgeSystemFor("explanation")).toMatch(/CONFIRMED/);
    expect(judgeSystemFor("mathematical")).toMatch(/CORRECT/);
  });

  it("V0.2.2.2 + V0.3: verdictsForType maps per-type sets (Part 13)", () => {
    expect(verdictsForType("business")).toContain("BUILD_MVP");
    expect(verdictsForType("decision")).toContain("PIVOT");
    expect(verdictsForType("explanation")).not.toContain("BUILD_MVP");
    expect(verdictsForType("explanation")).toContain("CONFIRMED");
    expect(verdictsForType("business")).not.toContain("REFINE");
    // V0.3: maths is judged with CORRECT/INCORRECT, not product verdicts.
    expect(verdictsForType("mathematical")).toContain("CORRECT");
    expect(verdictsForType("mathematical")).not.toContain("BUILD");
    // An argument is judged SUPPORTED/UNSUPPORTED, not PIVOT.
    expect(verdictsForType("argumentative")).toContain("SUPPORTED");
    expect(verdictsForType("argumentative")).not.toContain("PIVOT");
  });

  it("V0.2.2.3: INSUFFICIENT_INFORMATION is never offered to the model for ANY question type", () => {
    // The dead-end verdict is reserved for the deterministic synthesizer's
    // genuinely-impossible case — the Judge can no longer pick it as an escape.
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

  it("the Comparer must name the strongest/weakest argument and classify disagreement nature", () => {
    const s = AGENTS.comparer.system;
    expect(s).toMatch(/strongest argument/i);
    expect(s).toMatch(/weakest argument/i);
    expect(s).toMatch(/FUNDAMENTAL/i);
    expect(s).toMatch(/SUPERFICIAL/i);
  });

  it("the Reassessor must determine the stress-test shift", () => {
    expect(AGENTS.reassessor.system).toMatch(/UNCHANGED.*STRENGTHENED.*WEAKENED.*REVERSED/is);
  });

  it("every agent declares its capability profile (Part 4)", () => {
    expect(AGENTS.reasoner.capabilities).toContain("logical_reasoning");
    expect(AGENTS.skeptic.capabilities).toContain("assumption_testing");
    expect(AGENTS.practicalist.capabilities).toContain("practical_analysis");
    expect(AGENTS.perspective.capabilities).toContain("alternative_perspectives");
  });
});

describe("buildClassificationContext", () => {
  it("includes the label and capability labels", () => {
    const ctx = buildClassificationContext(classifyQuestion("Should I buy a phone?"));
    expect(ctx).toContain("Decision");
    expect(ctx).toContain("Logical reasoning");
  });
});

describe("buildAgentContext (V0.2.1 per-agent emphasis)", () => {
  it("tells the skeptic its assumption-testing capability matters for decisions", () => {
    const ctx = buildAgentContext("skeptic", classifyQuestion("Should I buy this phone?"));
    expect(ctx).toContain("Decision");
    expect(ctx).toContain("Assumption testing");
    expect(ctx).toContain("Risk analysis");
  });

  it("gives the reasoner the mathematical lens for math questions", () => {
    const ctx = buildAgentContext(
      "reasoner",
      classifyQuestion("Why is the derivative of sqrt(x) equal to 1/(2sqrt(x))?"),
    );
    expect(ctx).toContain("Mathematical reasoning");
    expect(ctx).toContain("Educational explanation");
  });

  it("tells a non-central agent to keep its lens brief", () => {
    const ctx = buildAgentContext(
      "practicalist",
      classifyQuestion("Why is the derivative of sqrt(x) equal to 1/(2sqrt(x))?"),
    );
    expect(ctx).toMatch(/not the central one/i);
  });

  it("keeps each analytical agent independent — no reference to other agents", () => {
    const ctx = buildAgentContext("skeptic", classifyQuestion("Should I buy this phone?"));
    expect(ctx).not.toMatch(/reasoner|practicalist|perspective/i);
  });
});
