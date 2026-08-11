import type { QuestionType } from "./types";

/**
 * COUNCIL V0.3 — Question Understanding layer (Parts 3, 4, 5).
 *
 * Fully deterministic, free, and unit-testable. Two responsibilities:
 *
 *  1. intentGate — recognise small-talk / casual input so it never triggers
 *     an expensive deliberation (Part 8 / user decision #12).
 *  2. detectGaps — find decision-critical information that is missing from a
 *     question, per question type. This drives the clarification round
 *     (ask-first, user decision #2) WITHOUT needing an LLM call for common
 *     cases (bank-first, user decision #6).
 *
 * The heuristic is deliberately conservative: gaps only fire when a missing
 * detail would materially change the recommendation (Part 5 hierarchy —
 * "maximum usefulness with minimum interrogation").
 */

/** Words that indicate a greeting/acknowledgment rather than a question.
 * Anchored to the WHOLE message (no trailing content): "hi, should I…" is a
 * real question, not small talk. */
const SMALL_TALK =
  /^(hi|hello|hey|yo|hiya|howdy|good (morning|afternoon|evening)|thanks|thank you|thx|ty|ok|okay|k|kk|alright|sure|great|cool|nice|awesome|lol|haha|heh|perfect|excellent|nice one|well done|good job|love it|cheers)[!. ]*$/i;

/** Longer, definite small-talk phrases (gratitude + filler). */
const SMALL_TALK_PHRASE =
  /^(thanks?|thank you)( (so much|a lot|very much|for that|for your help|man|bro))?[!. ]*$/i;

/**
 * V0.3 Part 8.1 — deterministic small-talk gate. A greeting or bare
 * acknowledgment gets a quick chat reply instead of a Council run.
 */
export function detectSmallTalk(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // "hi, and one more thing…" is NOT small talk — require the whole message
  // to be a greeting/acknowledgment, or a short gratitude phrase.
  if (SMALL_TALK.test(t) && t.length <= 40) return true;
  return SMALL_TALK_PHRASE.test(t) && t.length <= 60;
}

/** The kinds of missing information the heuristic can detect (Part 3). */
export type GapKey =
  | "budget"
  | "timeline"
  | "market"
  | "location"
  | "scale"
  | "goal";

export interface DetectedGap {
  key: GapKey;
  /** One plain-language line explaining what is missing. */
  why: string;
  /** The question types where this gap is decision-critical. */
  criticalFor: QuestionType[];
}

const GAP_META: Record<GapKey, { why: string; criticalFor: QuestionType[] }> = {
  budget: {
    why: "no budget or cost figure — feasibility changes a lot with the money involved",
    criticalFor: ["business", "planning", "comparison"],
  },
  timeline: {
    why: "no time frame — a short deadline changes what is realistic",
    criticalFor: ["business", "planning"],
  },
  market: {
    why: "no audience, customers, or competition mentioned — demand is the core unknown",
    criticalFor: ["business"],
  },
  location: {
    why: "no destination mentioned for a move/relocation decision",
    criticalFor: ["decision", "planning", "educational"],
  },
  scale: {
    why: "no scope given (small test vs full build) — effort and risk differ hugely",
    criticalFor: ["business", "technical", "creative"],
  },
  goal: {
    why: "the intended outcome is not stated — a bare 'should I X' is hard to judge",
    criticalFor: ["decision", "general"],
  },
};

/** Money/cost vocabulary already present in the question. */
const HAS_BUDGET = /\$\s?\d|\bbudget\b|\bcost\b|\bprice\b|\bafford\b|\bmoney\b|\bfund(ed|ing)?\b|\bexpensive\b|\bcheap\b|\binvest(ment)?\b|\bcapital\b/i;

/** Time vocabulary. */
const HAS_TIMELINE = /\bwhen\b|\bdeadline\b|\btimeline\b|\bschedule\b|\bsoon\b|\basap\b|\bmonth(s)?\b|\bweek(s)?\b|\bquarter\b|\byear(s)?\b|\bby \d/i;

/** Market/audience vocabulary. */
const HAS_MARKET = /\bcustomer(s)?\b|\bmarket\b|\baudience\b|\buser(s)?\b|\bcompetitor(s)?\b|\bdemand\b|\bclient(s)?\b|\bbuyer(s)?\b|\bshopper(s)?\b|\bstudent(s)?\b|\breader(s)?\b|\bviewer(s)?\b|\bpatient(s)?\b|\bplayer(s)?\b/i;

/** Relocation intent triggers (require a target to be mentioned). */
const MOVE_TRIGGER = /\bmove to\b|\brelocat\b|\bimmigrat\b|\bmigrat\b|\bmoving (to|abroad)\b|\bstudy (in|abroad)\b|\btransfer to\b|\bwork in\b|\bgo to\b|\bsettle\b/i;

/** A destination name. Kept intentionally small — false negatives are fine. */
const HAS_LOCATION =
  /\b(country|city|town|village|abroad|overseas|india|ghana|nigeria|kenya|south africa|egypt|usa|us|america|canada|uk|britain|england|germany|france|spain|italy|netherlands|sweden|norway|denmark|poland|australia|new zealand|japan|china|korea|singapore|dubai|uae|qatar|saudi|brazil|mexico|argentina|turkey|indonesia|philippines|vietnam|thailand)\b/i;

/** Building/creating vocabulary that needs a scope. */
const BUILD_TRIGGER = /\b(build|create|start|launch|make|develop|write|design|produce)\b/i;
const HAS_SCALE =
  /\b(small|large|big|huge|test|mvp|pilot|prototype|solo|alone|team|company|scale|full|scope|first version|v1|simple|basic)\b/i;

/** Bare "should I …?" with no stated outcome or constraint. */
const BARE_DECISION = /^(should|would) i [^?]{0,40}\??$/i;
const HAS_GOAL = /\b(because|so that|in order to|for my|i want to|i need to|my goal|aim is|purpose|to (get|start|make|become|earn|save|learn|build))\b/i;

/**
 * Detect the decision-critical gaps in a question for its classified type.
 * Returns ONLY gaps that are critical for `type` — non-critical gaps are
 * dropped so the clarification round never over-asks (Part 5).
 */
export function detectGaps(question: string, type: QuestionType): DetectedGap[] {
  const q = question.trim();
  const gaps: DetectedGap[] = [];

  const budget = { ...GAP_META.budget, key: "budget" as GapKey };
  if (budget.criticalFor.includes(type) && !HAS_BUDGET.test(q)) {
    gaps.push(budget);
  }

  const timeline = { ...GAP_META.timeline, key: "timeline" as GapKey };
  if (timeline.criticalFor.includes(type) && !HAS_TIMELINE.test(q)) {
    gaps.push(timeline);
  }

  const market = { ...GAP_META.market, key: "market" as GapKey };
  if (market.criticalFor.includes(type) && !HAS_MARKET.test(q)) {
    gaps.push(market);
  }

  if (MOVE_TRIGGER.test(q) && !HAS_LOCATION.test(q)) {
    gaps.push({ ...GAP_META.location, key: "location" });
  }

  const scale = { ...GAP_META.scale, key: "scale" as GapKey };
  if (scale.criticalFor.includes(type) && BUILD_TRIGGER.test(q) && !HAS_SCALE.test(q)) {
    gaps.push(scale);
  }

  const goal = { ...GAP_META.goal, key: "goal" as GapKey };
  if (goal.criticalFor.includes(type) && BARE_DECISION.test(q) && !HAS_GOAL.test(q)) {
    gaps.push(goal);
  }

  return gaps;
}

/** True when the question needs the clarify round before convening. */
export function needsClarification(question: string, type: QuestionType): boolean {
  return detectGaps(question, type).length > 0;
}

/**
 * V0.3 (Part 3) — strong ambiguity signals that justify the LLM understander
 * even when no keyword gap fired: elliptical references, multiple plausible
 * referents, or a broad topic with no decision/outcome. Kept narrow so it
 * rarely fires (Part 24 — avoid extra model calls on the local provider).
 */
export function detectAmbiguity(question: string): boolean {
  const q = question.trim();
  const words = q.split(/\s+/).length;
  // Very short questions are ambiguous by default. The pronoun-start check
  // below catches the 3-4 word "Is this good?" class without paying an extra
  // understander call for every terse-but-clear question (V0.3 Part 24 — no
  // unnecessary model calls on the local provider).
  if (words < 3) return true;
  if (/^(should|is|are|can|could|do|does|will|would|was|were) (this|that|it|they|there)\b/i.test(q)) {
    return true; // pronoun with no clear antecedent
  }
  if (/\b(it|this|that|there|they|them)\b/i.test(q) && !/[A-Za-z]{4,} (the|this|that|my|our) [A-Za-z]{4,}/.test(q)) {
    return false; // handled by length/pronoun checks above
  }
  return false;
}
