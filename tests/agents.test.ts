import { describe, expect, it } from "vitest";
import {
  buildClassificationContext,
  classifyQuestion,
  selectQuickAgents,
} from "@/lib/council/agents";

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

  it("detects argument questions", () => {
    expect(classifyQuestion("What do you think about this argument for free will?").type).toBe("argument");
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

describe("buildClassificationContext", () => {
  it("includes the label and capability labels", () => {
    const ctx = buildClassificationContext(classifyQuestion("Should I buy a phone?"));
    expect(ctx).toContain("Decision");
    expect(ctx).toContain("Logical reasoning");
  });
});
