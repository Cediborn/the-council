import { describe, expect, it } from "vitest";
import { classifyQuestion, selectQuickAgents } from "@/lib/council/agents";

describe("classifyQuestion", () => {
  it("detects purchase questions", () => {
    expect(classifyQuestion("Should I buy this phone?")).toBe("purchase");
    expect(classifyQuestion("Is this laptop worth the price?")).toBe("purchase");
  });

  it("detects learning questions", () => {
    expect(classifyQuestion("Why am I getting this maths answer wrong?")).toBe("learning");
    expect(classifyQuestion("Which university should I choose?")).toBe("learning");
  });

  it("detects business questions", () => {
    expect(classifyQuestion("Is this business idea good?")).toBe("business");
    expect(classifyQuestion("Should I launch my startup now?")).toBe("business");
  });

  it("detects technical questions", () => {
    expect(classifyQuestion("Is this code safe to run?")).toBe("technical");
    expect(classifyQuestion("Why is my react component re-rendering?")).toBe("technical");
  });

  it("detects argument questions", () => {
    expect(classifyQuestion("What do you think about this argument for free will?")).toBe("argument");
  });

  it("detects general decision questions", () => {
    expect(classifyQuestion("Should I move to a new city?")).toBe("decision");
    expect(classifyQuestion("Should I quit my job?")).toBe("decision");
  });

  it("defaults to general", () => {
    expect(classifyQuestion("What does this news mean for the economy?")).toBe("general");
    expect(classifyQuestion("Tell me about black holes")).toBe("general");
  });
});

describe("selectQuickAgents", () => {
  it("selects three agents", () => {
    for (const q of [
      "Should I buy this phone?",
      "Why am I getting this maths answer wrong?",
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

  it("keeps the skeptic for purchase questions", () => {
    expect(selectQuickAgents("Should I buy this phone?")).toEqual([
      "reasoner",
      "practicalist",
      "skeptic",
    ]);
  });

  it("uses perspective for learning questions", () => {
    const agents = selectQuickAgents("Why am I getting this maths answer wrong?");
    expect(agents).toContain("perspective");
    expect(agents).toContain("skeptic");
  });
});
