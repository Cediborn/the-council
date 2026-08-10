"use client";

import { type CSSProperties } from "react";
import { motion } from "framer-motion";
import type {
  AgentAnalysis,
  AgentKey,
  CouncilEvent,
  CouncilUsage,
  CouncilVerdict,
  VerdictCategory,
} from "@/lib/council/types";
import { labelForStance } from "@/lib/council/agents";
import {
  AlertIcon,
  BanIcon,
  BoltIcon,
  GavelIcon,
  RocketIcon,
  RotateIcon,
  RouteIcon,
  ScalesIcon,
  ShieldIcon,
  WrenchIcon,
  XIcon,
} from "@/components/icons";
import { ExpandableAnalysis, ExpandableCard } from "./ExpandableAnalysis";
import type { ComponentType, SVGProps } from "react";

const VERDICT_META: Record<VerdictCategory, { label: string; tone: string; blurb: string }> = {
  BUILD: {
    label: "Build",
    tone: "mint",
    blurb: "The evidence strongly supports proceeding.",
  },
  BUILD_MVP: {
    label: "Build MVP",
    tone: "mint",
    blurb: "Worth validating — proceed with a small, cheap test of the core idea.",
  },
  PIVOT: {
    label: "Pivot",
    tone: "warn",
    blurb: "The current approach is weak; a different direction is more defensible.",
  },
  DO_NOT_BUILD: {
    label: "Do Not Build",
    tone: "bad",
    blurb: "Fundamentally weak under the available information.",
  },
  REFINE: {
    label: "Refine",
    tone: "info",
    blurb: "The idea is promising, but changes are necessary.",
  },
  VALIDATE: {
    label: "Validate",
    tone: "achievement",
    blurb: "Plausible, but key assumptions need real-world evidence.",
  },
  RECONSIDER: {
    label: "Reconsider",
    tone: "warn",
    blurb: "Significant weaknesses exist; the approach should probably change.",
  },
  REJECT: {
    label: "Reject",
    tone: "bad",
    blurb: "Fundamentally weak under the available information.",
  },
  INSUFFICIENT_INFORMATION: {
    label: "Insufficient Information",
    tone: "ink",
    blurb: "Not enough information to responsibly reach a conclusion.",
  },
};

const TONE_CLASS: Record<string, string> = {
  mint: "text-mint border-mint/40",
  info: "text-info border-info/40",
  achievement: "text-achievement border-achievement/40",
  warn: "text-warn border-warn/40",
  bad: "text-bad border-bad/40",
  ink: "text-ink-soft border-line",
};

const SECTION_DOT: Record<string, string> = {
  mint: "bg-mint",
  info: "bg-info",
  achievement: "bg-achievement",
  warn: "bg-warn",
  bad: "bg-bad",
  ink: "bg-ink-soft",
};

/**
 * V0.2.2.2: every verdict category carries a distinct symbol — the verdict is
 * distinguishable through icon + label + typography, never color alone.
 */
const VERDICT_ICON: Record<VerdictCategory, ComponentType<SVGProps<SVGSVGElement>>> = {
  BUILD: ShieldIcon,
  BUILD_MVP: RocketIcon,
  PIVOT: RouteIcon,
  DO_NOT_BUILD: BanIcon,
  REFINE: WrenchIcon,
  VALIDATE: ScalesIcon,
  RECONSIDER: RotateIcon,
  REJECT: XIcon,
  INSUFFICIENT_INFORMATION: AlertIcon,
};

const SUFFICIENCY_TONE: Record<string, string> = {
  HIGH: "border-mint/40 text-mint",
  MEDIUM: "border-warn/40 text-warn",
  LOW: "border-ink-soft/40 text-ink-soft",
};

/** Staged reveal — the verdict feels earned, never instant (Part 16). */
function Reveal({
  delay = 0,
  className,
  style,
  children,
}: {
  delay?: number;
  className?: string;
  style?: CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-line"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={10}
      aria-valuenow={score}
      aria-label={`Score ${score} out of 10`}
    >
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${score * 10}%` }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2"
      />
    </div>
  );
}

function VerdictBadge({ verdict, degraded }: { verdict: VerdictCategory; degraded?: boolean }) {
  const meta = VERDICT_META[verdict];
  const Icon = VERDICT_ICON[verdict];
  return (
    <motion.div
      initial={{ scale: 0.88, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.15 }}
      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 ${TONE_CLASS[meta.tone]}`}
    >
      <Icon className="h-4 w-4" />
      <span className="font-display text-sm font-bold uppercase tracking-wider">{meta.label}</span>
      {degraded && <span className="text-[10px] uppercase tracking-wider opacity-70">degraded</span>}
    </motion.div>
  );
}

function VerdictSection({
  title,
  items,
  dotClass,
}: {
  title: string;
  items: string[];
  dotClass: string;
}) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="font-display text-xs font-bold uppercase tracking-widest text-ink-soft">{title}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * V0.2.2.2 (Part 8) — how the verdict was formed: the verdict badge, confidence
 * and information sufficiency up top, then the deciding factors (keyReasons)
 * and the per-member stance breakdown with the main disagreements. Disagreement
 * is first-class — it is never hidden.
 */
function HowVerdictFormed({
  verdict,
  events,
}: {
  verdict: CouncilVerdict;
  events: CouncilEvent[];
}) {
  const comparison = events.findLast((e) => e.type === "comparison");
  const memberEvents = events.filter(
    (e): e is Extract<CouncilEvent, { type: "agent:done" }> => e.type === "agent:done",
  );
  const analyses = memberEvents.map((e) => e.analysis).filter((a) => !a.failed);
  const unavailableCount = memberEvents.filter((e) => e.analysis.failed).length;

  const counts = comparison?.comparison.stanceCounts ?? (() => {
    const c = { SUPPORT: 0, OPPOSE: 0, CONDITIONAL: 0, NEUTRAL: 0, INSUFFICIENT: 0 };
    for (const a of analyses) if (!a.failed) c[a.stance] = (c[a.stance] ?? 0) + 1;
    return c;
  })();

  const mainDisagreement = comparison?.comparison.disagreements[0]?.topic ?? null;
  const deciding = verdict.keyReasons.length > 0 ? verdict.keyReasons : verdict.agreements.slice(0, 4);

  return (
    <div className="rounded-xl border border-line bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-xs font-bold uppercase tracking-widest text-ink-soft">
          COUNCIL POSITION
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${SUFFICIENCY_TONE[verdict.informationSufficiency] ?? SUFFICIENCY_TONE.LOW}`}>
            Info sufficiency: {verdict.informationSufficiency}
          </span>
          <span className="rounded-full border border-brand/30 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brand">
            {verdict.confidence}% confidence
          </span>
        </div>
      </div>

      <p className="mt-2 text-ink">
        <span className="font-semibold text-mint">{counts.SUPPORT ?? 0}</span> support ·{" "}
        <span className="font-semibold text-warn">{counts.CONDITIONAL ?? 0}</span> conditional ·{" "}
        <span className="font-semibold text-bad">{counts.OPPOSE ?? 0}</span> oppose
        {unavailableCount > 0 && (
          <>
            {" "}· <span className="font-semibold text-bad">{unavailableCount} unavailable</span>
          </>
        )}
        {mainDisagreement && (
          <>
            {" "}· main disagreement: <span className="font-semibold text-ink">{mainDisagreement}</span>
          </>
        )}
      </p>

      {deciding.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="font-display text-[11px] font-bold uppercase tracking-widest text-ink-soft">
            Main deciding factors
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {deciding.map((d, i) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      {analyses.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {analyses.map((a) => {
            const stanceLabel = labelForStance(a.stance);
            const tone =
              a.stance === "SUPPORT"
                ? "text-mint"
                : a.stance === "OPPOSE"
                  ? "text-bad"
                  : a.stance === "CONDITIONAL"
                    ? "text-warn"
                    : "text-ink-soft";
            const why = a.keyPoints[0] ?? a.summary;
            return (
              <li key={a.agent} className="flex gap-2 text-xs leading-relaxed">
                <span className={`shrink-0 font-semibold ${tone}`}>{stanceLabel}:</span>
                <span className="text-ink-soft">
                  {a.name} — {why}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {comparison && comparison.comparison.disagreements.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {comparison.comparison.disagreements.map((d, i) => (
            <li key={i} className="text-xs text-ink-soft">
              <span
                className={`font-semibold ${
                  d.nature === "SUPERFICIAL" ? "text-info" : "text-warn"
                }`}
              >
                {d.nature === "SUPERFICIAL" ? "Superficial" : "Fundamental"} disagreement:
              </span>{" "}
              {d.topic} — {d.summary}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** V0.2.2.2: the "Judge unavailable — provisional" callout (Part 2/7). */
function ProvisionalBanner({ verdict }: { verdict: CouncilVerdict }) {
  if (!verdict.provisional) return null;
  return (
    <div className="rounded-xl border border-warn/30 bg-warn/5 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-warn/40 bg-warn/10 text-warn">
          <AlertIcon className="h-4 w-4" />
        </span>
        <div>
          <p className="font-display text-sm font-bold text-warn">Provisional result</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
            The final Judge could not complete its evaluation, so this verdict was synthesized
            deterministically from the surviving analyses — it is labelled degraded and was never
            derived from a vote count. The individual perspectives remain available below.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * V0.2.2.3 (Part 7/8) — one or more analytical members could not respond. The
 * Council continued with the survivors, but the loss is stated plainly instead
 * of being hidden: the verdict exists, and so does the honest count of what is
 * missing. Per-member retry stays on the failed member's card below.
 */
function PartialCouncilBanner({ members }: { members: AgentAnalysis[] }) {
  if (members.length === 0) return null;
  return (
    <div className="rounded-xl border border-warn/25 bg-warn/5 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-warn/40 bg-warn/10 text-warn">
          <AlertIcon className="h-4 w-4" />
        </span>
        <div>
          <p className="font-display text-sm font-bold text-warn">
            Partial Council — {members.length} perspective{members.length === 1 ? "" : "s"} unavailable
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
            {members.map((m) => m.name).join(", ")} could not respond, so the Judge weighed the
            surviving perspectives and reduced its confidence accordingly. No missing analysis is
            fabricated — retry the member from its card below if you want the full Council.
          </p>
        </div>
      </div>
    </div>
  );
}

function DevilsAdvocateCard({
  analysis,
}: {
  analysis: Extract<CouncilEvent, { type: "da:done" }>["analysis"];
}) {
  if (!analysis || analysis.failed) {
    return (
      <div className="rounded-xl border border-bad/30 bg-bad/5 p-4">
        <div className="flex items-center gap-2">
          <AlertIcon className="h-4 w-4 text-bad" />
          <span className="font-display text-sm font-semibold text-bad">Devil's Advocate</span>
        </div>
        <p className="mt-1 text-xs text-ink-soft">Failed to respond. The Judge proceeded without the stress-test.</p>
      </div>
    );
  }
  return (
    <ExpandableCard
      icon={BoltIcon}
      title="Devil's Advocate"
      meta={`Stress-test · ${analysis.convergenceWarning ? "convergence noted" : "consensus held"}`}
      openLabel="Hide stress-test"
      closedLabel="View stress-test"
    >
      <p className="text-sm leading-relaxed text-ink">{analysis.summary}</p>
      <div className="mt-3 rounded-lg bg-surface p-3">
        <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Strongest argument</p>
        <p className="mt-1 text-sm text-ink">{analysis.strongestArgument}</p>
      </div>
      <div className="mt-3 rounded-lg bg-surface p-3">
        <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Attempt to break it</p>
        <p className="mt-1 text-sm text-ink">{analysis.attemptToBreakIt}</p>
      </div>
      {analysis.unsupportedAssumptions.length > 0 && (
        <div className="mt-3 rounded-lg bg-surface p-3">
          <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Unsupported assumptions</p>
          <ul className="mt-1 flex flex-col gap-1">
            {analysis.unsupportedAssumptions.map((a, i) => (
              <li key={i} className="text-sm text-ink-soft">· {a}</li>
            ))}
          </ul>
        </div>
      )}
      {analysis.minorityPoint && (
        <div className="mt-3 rounded-lg bg-surface p-3">
          <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Minority point worth taking seriously</p>
          <p className="mt-1 text-sm text-ink">{analysis.minorityPoint}</p>
        </div>
      )}
      {analysis.evidenceThatWouldResolve.length > 0 && (
        <div className="mt-3 rounded-lg bg-surface p-3">
          <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">Evidence that would resolve the disagreement</p>
          <ul className="mt-1 flex flex-col gap-1">
            {analysis.evidenceThatWouldResolve.map((e, i) => (
              <li key={i} className="text-sm text-ink-soft">· {e}</li>
            ))}
          </ul>
        </div>
      )}
    </ExpandableCard>
  );
}

/** V0.2.1 comparison extras: strongest/weakest argument, missing info, risks, unique insights. */
function ComparisonExtras({ events }: { events: CouncilEvent[] }) {
  const comparison = events.findLast((e) => e.type === "comparison");
  if (!comparison) return null;
  const c = comparison.comparison;
  const hasAny =
    c.missingInformation.length > 0 ||
    c.risks.length > 0 ||
    c.uniqueInsights.length > 0 ||
    Boolean(c.strongestArgument) ||
    Boolean(c.weakestArgument);
  if (!hasAny) return null;
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {c.strongestArgument && (
        <div className="rounded-xl border border-mint/25 bg-mint/5 p-4">
          <p className="font-display text-xs font-bold uppercase tracking-widest text-mint">
            Strongest argument on the table
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink">{c.strongestArgument}</p>
        </div>
      )}
      {c.weakestArgument && (
        <div className="rounded-xl border border-bad/25 bg-bad/5 p-4">
          <p className="font-display text-xs font-bold uppercase tracking-widest text-bad">
            Weakest argument on the table
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink">{c.weakestArgument}</p>
        </div>
      )}
      <VerdictSection title="Missing information" items={c.missingInformation} dotClass="bg-info" />
      <VerdictSection title="Key risks across analyses" items={c.risks} dotClass={SECTION_DOT.warn} />
      {c.uniqueInsights.length > 0 && (
        <VerdictSection title="Unique insights" items={c.uniqueInsights} dotClass="bg-achievement" />
      )}
    </div>
  );
}

/** V0.2 DEEP-mode reassessment display. */
function ReassessmentCard({ events }: { events: CouncilEvent[] }) {
  const ev = events.findLast((e) => e.type === "reassessment:done");
  if (!ev) return null;
  const r = ev.analysis;
  if (r.failed) {
    return (
      <div className="rounded-xl border border-bad/30 bg-bad/5 p-4">
        <p className="font-display text-sm font-semibold text-bad">Reassessment</p>
        <p className="mt-1 text-xs text-ink-soft">Failed to respond. The Judge proceeded without the post-stress-test reassessment.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-center gap-2">
        <RotateIcon className="h-4 w-4 text-brand" />
        <p className="font-display text-sm font-semibold text-ink">Reassessment after the stress-test</p>
        {r.shift && (
          <span
            className={`ml-auto rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
              r.shift === "REVERSED"
                ? "border-bad/40 text-bad"
                : r.shift === "WEAKENED"
                  ? "border-warn/40 text-warn"
                  : r.shift === "STRENGTHENED"
                    ? "border-mint/40 text-mint"
                    : "border-line text-ink-soft"
            }`}
          >
            {r.shift}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink">{r.summary}</p>
      {r.hardened.length > 0 && (
        <p className="mt-2 text-xs text-ink-soft">
          <span className="font-semibold text-mint">Hardened:</span> {r.hardened.join("; ")}
        </p>
      )}
      {r.weakened.length > 0 && (
        <p className="mt-1 text-xs text-ink-soft">
          <span className="font-semibold text-bad">Weakened:</span> {r.weakened.join("; ")}
        </p>
      )}
      {r.positionChanges.length > 0 && (
        <p className="mt-1 text-xs text-ink-soft">
          <span className="font-semibold text-warn">Positions changed:</span>{" "}
          {r.positionChanges.map((p) => `${p.agent} ${p.from} → ${p.to}`).join("; ")}
        </p>
      )}
      {r.judgeGuidance && (
        <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-ink-soft">
          <span className="font-semibold text-ink">Judge guidance:</span> {r.judgeGuidance}
        </p>
      )}
    </div>
  );
}

export function VerdictView({
  verdict,
  usage,
  events,
  onRetryAgent,
}: {
  verdict: CouncilVerdict;
  usage: CouncilUsage;
  events: CouncilEvent[];
  onRetryAgent?: (agent: AgentKey) => void;
}) {
  const meta = VERDICT_META[verdict.verdict];
  const analyses = events.filter((e): e is Extract<CouncilEvent, { type: "agent:done" }> => e.type === "agent:done");
  const failedMembers = analyses.map((e) => e.analysis).filter((a) => a.failed);
  const daEvent = events.findLast((e) => e.type === "da:done");
  const dot = SECTION_DOT[meta.tone];

  return (
    <section className="animate-fade-up">
      {/* Brief interstitial — the deliberation settles before the verdict reveals. */}
      <Reveal delay={0} className="text-center">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 240, damping: 18 }}
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/5 text-brand shadow-gold"
          aria-hidden="true"
        >
          <GavelIcon className="h-6 w-6" />
        </motion.div>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
          Deliberation complete
        </p>
      </Reveal>

      <Reveal delay={0.18} className="text-center">
        <h2 className="font-display text-3xl font-bold tracking-tight text-ink">COUNCIL VERDICT</h2>
      </Reveal>

      <Reveal delay={0.24}>
        <ProvisionalBanner verdict={verdict} />
      </Reveal>

      <Reveal delay={0.27}>
        <PartialCouncilBanner members={failedMembers} />
      </Reveal>

      <Reveal
        delay={0.3}
        className={`verdict-tone mt-6 rounded-2xl border p-6 shadow-card sm:p-8`}
        style={{ "--tone": `var(--color-${meta.tone})` } as CSSProperties}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <VerdictBadge verdict={verdict.verdict} degraded={verdict.degraded} />
          <p className="max-w-xs text-right text-xs leading-snug text-ink-soft">{meta.blurb}</p>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-3xl font-bold text-ink">{verdict.score.toFixed(1)}</span>
              <span className="text-xs text-ink-soft">/ 10</span>
            </div>
            <ScoreBar score={verdict.score} />
            <p className="mt-1 text-xs text-ink-soft">Score</p>
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-3xl font-bold text-ink">{verdict.confidence}%</span>
            </div>
            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-line" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={verdict.confidence} aria-label={`Confidence ${verdict.confidence} percent`}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${verdict.confidence}%` }}
                transition={{ duration: 0.8, ease: "easeOut", delay: 0.25 }}
                className="h-full rounded-full bg-gradient-to-r from-brand-2 to-brand"
              />
            </div>
            <p className="mt-1 text-xs text-ink-soft">Confidence</p>
          </div>
          <div>
            <p className="font-mono text-xl font-bold text-ink">
              {verdict.informationSufficiency}
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line" role="meter" aria-valuemin={0} aria-valuemax={3} aria-valuenow={verdict.informationSufficiency === "HIGH" ? 3 : verdict.informationSufficiency === "MEDIUM" ? 2 : 1} aria-label={`Information sufficiency ${verdict.informationSufficiency}`}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${verdict.informationSufficiency === "HIGH" ? 100 : verdict.informationSufficiency === "MEDIUM" ? 66 : 33}%` }}
                transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
                className="h-full rounded-full bg-gradient-to-r from-brand-2 to-brand"
              />
            </div>
            <p className="mt-1 text-xs text-ink-soft">Information sufficiency</p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-line bg-surface p-4">
          <h3 className="font-display text-xs font-bold uppercase tracking-widest text-ink-soft">Summary</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink">{verdict.summary}</p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-mint/25 bg-mint/5 p-4">
            <p className="font-display text-xs font-bold uppercase tracking-widest text-mint">Strongest argument for</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{verdict.strongestArgumentFor}</p>
          </div>
          <div className="rounded-xl border border-bad/25 bg-bad/5 p-4">
            <p className="font-display text-xs font-bold uppercase tracking-widest text-bad">Strongest argument against</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{verdict.strongestArgumentAgainst}</p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.4} className="mt-4">
        <HowVerdictFormed verdict={verdict} events={events} />
      </Reveal>

      <Reveal delay={0.46} className="mt-6 grid gap-3 sm:grid-cols-2">
        <VerdictSection title="Key reasons" items={verdict.keyReasons} dotClass="bg-mint" />
        <VerdictSection title="Critical unknowns" items={verdict.criticalUnknowns} dotClass="bg-info" />
        <VerdictSection title="Key agreements" items={verdict.agreements} dotClass="bg-mint" />
        <VerdictSection title="Key disagreements" items={verdict.disagreements} dotClass="bg-bad" />
        <VerdictSection title="Critical assumptions" items={verdict.assumptions} dotClass={SECTION_DOT.achievement} />
        <VerdictSection title="Critical risks" items={verdict.risks} dotClass={SECTION_DOT.warn} />
      </Reveal>

      <Reveal delay={0.52}>
        <ComparisonExtras events={events} />
      </Reveal>

      {usage.mode === "DEEP" && (
        <Reveal delay={0.56} className="mt-4">
          <ReassessmentCard events={events} />
        </Reveal>
      )}

      <Reveal delay={0.6} className="mt-3 rounded-xl border border-line bg-surface p-4">
        <h3 className="font-display text-xs font-bold uppercase tracking-widest text-ink-soft">Recommended action</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink">{verdict.recommendedAction}</p>
      </Reveal>

      <Reveal delay={0.64}>
        <VerdictSection title="What would change our mind" items={verdict.whatWouldChangeVerdict} dotClass={dot} />
      </Reveal>

      <Reveal delay={0.68} className="mt-3 rounded-xl border border-line bg-surface p-4">
        <h3 className="font-display text-xs font-bold uppercase tracking-widest text-ink-soft">Why this verdict won</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink">{verdict.whyThisVerdictWon}</p>
      </Reveal>

      <Reveal delay={0.72} className="mt-3 rounded-xl border border-line bg-surface p-4">
        <h3 className="font-display text-xs font-bold uppercase tracking-widest text-ink-soft">Reasoning</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink">{verdict.reasoning}</p>
      </Reveal>

      {/* ── Individual perspectives ─────────────────────────────── */}
      <Reveal delay={0.76} className="mt-8">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-ink">The perspectives</h3>
          <span className="text-xs text-ink-soft">Expand each analysis</span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {analyses.map(({ analysis }) => (
            <ExpandableAnalysis
              key={analysis.agent}
              analysis={analysis}
              onRetry={onRetryAgent ? () => onRetryAgent(analysis.agent) : undefined}
            />
          ))}
          {daEvent && <DevilsAdvocateCard analysis={daEvent.analysis} />}
        </div>
      </Reveal>

      {/* ── Session meta ────────────────────────────────────────── */}
      <Reveal delay={0.8} className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-ink-soft">
        <span>Mode: <span className="font-mono uppercase">{usage.mode}</span></span>
        <span aria-hidden="true">·</span>
        <span>Model: <span className="font-mono">{usage.provider}/{usage.model}</span></span>
        <span aria-hidden="true">·</span>
        <span>Agents: <span className="font-mono">{usage.agentCalls}</span></span>
        <span aria-hidden="true">·</span>
        <span>{(usage.durationMs / 1000).toFixed(1)}s</span>
        {usage.stageDurations && (() => {
          const parts: string[] = [];
          const sd = usage.stageDurations;
          if (sd.analysisMs > 0) parts.push(`Analysis ${(sd.analysisMs / 1000).toFixed(1)}s`);
          if (sd.comparisonMs > 0) parts.push(`Comparison ${(sd.comparisonMs / 1000).toFixed(1)}s`);
          if (sd.judgeMs > 0) parts.push(`Judge ${(sd.judgeMs / 1000).toFixed(1)}s`);
          return parts.length > 0 ? (
            <span aria-label="Stage timings">· {parts.join(" · ")}</span>
          ) : null;
        })()}
      </Reveal>
    </section>
  );
}
