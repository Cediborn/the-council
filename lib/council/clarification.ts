import type { ClarificationQuestion, QuestionType } from "./types";
import { type DetectedGap, detectGaps } from "./understand";

/**
 * COUNCIL V0.3 — Clarification round (Part 7).
 *
 * Bank-first, LLM-fallback (user decision #6): the common decision-critical
 * gaps map to a fixed, plain-language question bank. The round never asks
 * more than TWO questions (hard cap), and each question explains why it
 * matters so the user is not interrogated blindly.
 *
 * The bank is deterministic and instant — no model call on the clarify path.
 */

interface BankEntry {
  gap: DetectedGap["key"];
  question: string;
  why: string;
}

const QUESTION_BANK: Record<DetectedGap["key"], BankEntry> = {
  budget: {
    gap: "budget",
    question: "What's your rough budget or the amount of money involved?",
    why: "It changes the recommendation a lot — 'under $500' and '$5,000+' lead to very different verdicts.",
  },
  timeline: {
    gap: "timeline",
    question: "What time frame are you working with?",
    why: "A two-week plan is very different from a two-year one.",
  },
  market: {
    gap: "market",
    question: "Who are the customers, and what do you know about the competition so far?",
    why: "Demand and competition are the biggest unknowns for a business question.",
  },
  location: {
    gap: "location",
    question: "Which city or country are you thinking of?",
    why: "The recommendation depends heavily on where — costs, job market, and lifestyle differ a lot.",
  },
  scale: {
    gap: "scale",
    question: "How big are you imagining this — a small test, or a full build?",
    why: "Effort, cost, and risk are completely different for a pilot versus a full launch.",
  },
  goal: {
    gap: "goal",
    question: "What's the outcome you actually want here?",
    why: "A bare 'should I do this' is hard to judge fairly without knowing the goal behind it.",
  },
};

/** Deterministic type-aware assumption the Council will work under. */
function assumptionFor(type: QuestionType): string {
  switch (type) {
    case "business":
      return "I'll treat this as a serious proposal and evaluate it on market, cost and feasibility — correct me if you mean something smaller.";
    case "decision":
      return "I'll weigh the decision on the practical trade-offs I can reason about from what you've said.";
    case "planning":
      return "I'll assume you want a realistic, ordered plan you can actually follow.";
    case "educational":
      return "I'll explain the concept clearly, building from basics.";
    case "mathematical":
      return "I'll verify the reasoning and show the steps.";
    case "technical":
      return "I'll evaluate it on correctness, risk, and practical soundness.";
    case "troubleshooting":
      return "I'll treat this as a problem to diagnose and fix.";
    case "comparison":
      return "I'll compare the options on the trade-offs that matter.";
    case "argumentative":
      return "I'll judge the strength of the argument on evidence and logic, not agreement.";
    case "explanation":
      return "I'll give the most accurate explanation the available information supports.";
    case "creative":
      return "I'll evaluate both the idea and how it could actually come together.";
    default:
      return "I'll reason from what you've told me and flag what's unknown.";
  }
}

/**
 * Build the clarify response for a question: up to 2 bank questions for the
 * critical gaps found, plus the explicit assumption the Council will work
 * under (Part 6 — assumptions are visible and correctable).
 */
export function buildClarificationRequest(
  question: string,
  type: QuestionType,
  maxQuestions = 2,
): { critical: boolean; questions: ClarificationQuestion[]; assumptions: string[] } {
  const gaps: DetectedGap[] = detectGaps(question, type);
  const questions: ClarificationQuestion[] = gaps
    .slice(0, maxQuestions)
    .map((g) => {
      const entry = QUESTION_BANK[g.key];
      return {
        id: `cl-${g.key}`,
        question: entry.question,
        why: entry.why,
      };
    });

  const assumptions = [assumptionFor(type)];

  return {
    critical: questions.length > 0,
    questions,
    assumptions,
  };
}

/** The id->question map so answers can be echoed back readably. */
export function questionById(questions: ClarificationQuestion[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) out[q.id] = q.question;
  return out;
}
