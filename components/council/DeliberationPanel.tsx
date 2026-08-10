"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { AgentKey, CouncilEvent, CouncilMode } from "@/lib/council/types";
import {
  AlertIcon,
  BoltIcon,
  CheckIcon,
  CompassIcon,
  EyeIcon,
  GavelIcon,
  HourglassIcon,
  NodesIcon,
  PedestalIcon,
  RotateIcon,
  ScalesIcon,
  ShieldIcon,
  WrenchIcon,
  XIcon,
} from "@/components/icons";
import {
  agentVisual,
  chamberState,
  deriveDeliberationStage,
  stagesForMode,
  STAGE_LABELS,
  type DeliberationStageId,
} from "@/lib/client/deliberation";
import type { ComponentType, SVGProps } from "react";

const AGENT_META: Record<
  string,
  { icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }
> = {
  reasoner: { icon: EyeIcon, label: "Reasoner" },
  skeptic: { icon: ShieldIcon, label: "Skeptic" },
  practicalist: { icon: WrenchIcon, label: "Practicalist" },
  perspective: { icon: CompassIcon, label: "Perspective" },
  devils_advocate: { icon: BoltIcon, label: "Devil's Advocate" },
  comparer: { icon: ScalesIcon, label: "Comparer" },
  reassessor: { icon: RotateIcon, label: "Reassessor" },
  judge: { icon: PedestalIcon, label: "Judge" },
};

const STAGE_TITLES: Record<DeliberationStageId, string> = {
  analyzing: "Independent analysis in progress",
  comparing: "Comparing perspectives",
  devils_advocate: "Stress-testing the strongest argument",
  reassessing: "Reassessing after the stress-test",
  judging: "Judge deliberating",
  complete: "Deliberation complete",
};

/** The judge's deliberation sub-steps (Part 15) — shown while the judge is active. */
const JUDGE_SUBSTEPS = ["Weighing evidence", "Reviewing dissent", "Calibrating confidence"];

/** Radiating spokes from the central Council node toward the four card quadrants (Part 7). */
const CHAMBER_SPOKES = [
  { d: "M 32 32 L 7 7" },
  { d: "M 32 32 L 57 7" },
  { d: "M 32 32 L 7 57" },
  { d: "M 32 32 L 57 57" },
];

function StagePipeline({ mode, stage }: { mode: CouncilMode; stage: DeliberationStageId }) {
  const stages = stagesForMode(mode);
  const current = stages.indexOf(stage);
  return (
    <ol
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5"
      aria-label="Deliberation pipeline"
    >
      {stages.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-3 bg-line sm:w-5" aria-hidden="true" />}
            <span
              className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                done
                  ? "text-brand/80"
                  : active
                    ? "text-brand"
                    : "text-ink-soft/40"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  done
                    ? "bg-brand"
                    : active
                      ? "bg-brand animate-pulse-soft"
                      : "bg-ink-soft/40"
                }`}
              />
              {STAGE_LABELS[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SignalDots() {
  return (
    <span className="ml-1 inline-flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 rounded-full bg-brand"
          style={{ animation: "dot-pulse 1.5s ease-in-out infinite", animationDelay: `${i * 0.22}s` }}
        />
      ))}
    </span>
  );
}

function AgentCard({ events, agent }: { events: CouncilEvent[]; agent: AgentKey }) {
  const meta = AGENT_META[agent] ?? { icon: HourglassIcon, label: agent };
  const Icon = meta.icon;
  const v = agentVisual(events, agent);
  const active = v.state === "ACTIVE";

  const tileClass =
    v.state === "FAILED"
      ? "border-bad/40 text-bad bg-bad/10"
      : v.state === "COMPLETE"
        ? "border-brand/40 text-brand bg-brand/10"
        : active
          ? "border-brand/60 text-brand bg-brand/10 animate-glow"
          : "border-line text-ink-soft/70 bg-surface";

  const chipClass =
    v.state === "FAILED"
      ? "border-bad/30 text-bad"
      : v.state === "COMPLETE"
        ? "border-brand/30 text-brand"
        : active
          ? "border-brand/40 text-brand animate-pulse-soft"
          : "border-line text-ink-soft/50";

  const cardClass =
    v.state === "FAILED"
      ? "border-bad/25"
      : v.state === "COMPLETE"
        ? "border-brand/20"
        : active
          ? "border-brand/30 shadow-gold"
          : "border-line";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 transition-colors ${cardClass}`}
    >
      <span
        className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${tileClass}`}
      >
        {v.state === "FAILED" ? (
          <XIcon className="h-5 w-5" />
        ) : v.state === "COMPLETE" ? (
          <CheckIcon className="h-5 w-5" />
        ) : (
          <Icon className={`h-5 w-5 ${active ? "animate-breathe" : ""}`} />
        )}
        {active && (
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-lg border border-brand/50"
            style={{ animation: "ring-pulse 2.2s cubic-bezier(0.22,1,0.36,1) infinite" }}
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-display text-sm font-semibold text-ink">{meta.label}</p>
          {active && <SignalDots />}
        </div>
        <p className="truncate text-xs text-ink-soft">{v.statusText}</p>
      </div>
      <span
        className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${chipClass}`}
      >
        {v.chip}
      </span>
    </motion.div>
  );
}

/**
 * V0.2.2.1 — the central Council node (Part 6) + radiating connection lines
 * (Part 7). FULL/DEEP only: the four agents sit around the node and the spokes
 * brighten into gold once the Council converges (comparison → judge). QUICK
 * keeps the plain grid. Mobile keeps the small node and drops the lines.
 */
function CouncilChamber({
  events,
  agents,
  mode,
}: {
  events: CouncilEvent[];
  agents: AgentKey[];
  mode: CouncilMode;
}) {
  const chamber = chamberState(events, mode);
  const node = chamber.node;
  const linesActive = chamber.lines === "ACTIVE";
  const lively = node === "ACTIVE" || node === "PROMINENT";

  const nodeRingClass =
    node === "SETTLED"
      ? "border-brand/50 text-brand"
      : node === "PROMINENT"
        ? "border-brand/70 text-brand shadow-gold animate-glow"
        : node === "ACTIVE"
          ? "border-brand/60 text-brand animate-glow"
          : "border-line text-ink-soft/60";

  const top = agents.slice(0, 2);
  const bottom = agents.slice(2);

  return (
    <motion.div layout className="relative mt-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-3 sm:gap-y-1">
        {top.map((agent) => (
          <AgentCard key={agent} events={events} agent={agent} />
        ))}

        {/* The Council node row — sits between the two rows of perspectives. */}
        <div className="col-span-1 flex justify-center sm:col-span-2">
          <div
            className="relative flex h-11 w-11 items-center justify-center sm:h-14 sm:w-14"
            aria-hidden="true"
          >
            {/* Connection lines are desktop-only (Part 21): mobile keeps the
                small node and drops the lines. */}
            <svg
              className="absolute inset-0 hidden h-full w-full sm:block"
              viewBox="0 0 64 64"
              fill="none"
              strokeLinecap="round"
            >
              {CHAMBER_SPOKES.map((s, i) => (
                <motion.path
                  key={i}
                  d={s.d}
                  stroke={linesActive ? "var(--color-brand)" : "var(--color-line)"}
                  strokeWidth={1}
                  initial={{ pathLength: 0, opacity: linesActive ? 0 : 0.35 }}
                  animate={{
                    pathLength: linesActive ? 1 : 0.3,
                    opacity: linesActive ? 0.9 : 0.3,
                  }}
                  transition={{ duration: 0.9, delay: linesActive ? i * 0.12 : 0, ease: "easeInOut" }}
                />
              ))}
            </svg>
            <span
              className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-card transition-all duration-300 sm:h-9 sm:w-9 ${nodeRingClass}`}
            >
              <GavelIcon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${lively ? "animate-breathe" : ""}`} />
              {lively && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full border border-brand/50"
                  style={{ animation: "ring-pulse 2.4s cubic-bezier(0.22,1,0.36,1) infinite" }}
                />
              )}
            </span>
          </div>
        </div>

        {bottom.map((agent) => (
          <AgentCard key={agent} events={events} agent={agent} />
        ))}
      </div>
      <p className="mt-1 text-center font-mono text-[9px] uppercase tracking-[0.3em] text-brand/70">
        The Council
      </p>
    </motion.div>
  );
}

function ComparisonMoment({ events }: { events: CouncilEvent[] }) {
  const comparison = events.findLast((e) => e.type === "comparison");
  const fundamental = comparison?.comparison.disagreements.find((d) => d.nature === "FUNDAMENTAL");
  const superficial = comparison?.comparison.disagreements.find((d) => d.nature === "SUPERFICIAL");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-brand/25 bg-card p-4"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand/40 bg-brand/10 text-brand">
          <NodesIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-brand">
            {comparison ? "Comparison complete" : "Comparing arguments"}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {comparison
              ? "The independent perspectives have been brought together."
              : "Converging the independent perspectives…"}
          </p>
        </div>
      </div>

      {comparison ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-mint/30 bg-mint/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-mint">
            {comparison.comparison.agreements.length} agreements
          </span>
          <span className="rounded-full border border-warn/30 bg-warn/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-warn">
            {comparison.comparison.disagreements.length} disagreement{comparison.comparison.disagreements.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full border border-bad/30 bg-bad/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-bad">
            {comparison.comparison.contradictions.length} contradiction{comparison.comparison.contradictions.length === 1 ? "" : "s"}
          </span>
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink-soft">
          <span className="inline-block h-3 w-3 animate-pulse-soft rounded-full bg-brand align-[-2px]" aria-hidden="true" />
          {" "}Extracting agreements, disagreements, and shared assumptions…
        </p>
      )}

      {fundamental && (
        <div className="mt-3 rounded-lg border border-warn/25 bg-warn/5 px-3 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-warn">Fundamental disagreement</p>
          <p className="mt-0.5 text-xs text-ink">{fundamental.topic}</p>
        </div>
      )}
      {!fundamental && superficial && (
        <div className="mt-3 rounded-lg border border-info/25 bg-info/5 px-3 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-info">Superficial disagreement</p>
          <p className="mt-0.5 text-xs text-ink">
            Agents largely agree — they are emphasizing different aspects.
          </p>
        </div>
      )}
    </motion.div>
  );
}

/**
 * V0.2.2.1 (Part 12) — gold + subtle warning geometry instead of tangerine:
 * the stress-test stays inside the black/gold identity, with a small triangle
 * signalling the adversarial role.
 */
function DevilsAdvocateMoment({ events }: { events: CouncilEvent[] }) {
  const da = events.findLast((e) => e.type === "da:done");
  const active = !da;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`rounded-xl border bg-card p-4 ${
        active ? "border-brand/40 bg-gradient-to-b from-surface to-card" : "border-brand/25"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-brand/40 bg-brand/10 text-brand">
          <BoltIcon className={`h-5 w-5 ${active ? "animate-breathe" : ""}`} />
          {/* warning geometry — the adversarial role, kept gold */}
          <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-brand/50 bg-card">
            <AlertIcon className="h-2 w-2 text-brand" />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-brand">
            {da ? "Stress-test complete" : "Devil's Advocate"}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {da
              ? da.analysis.convergenceWarning
                ? "Convergence was flagged — consensus may be premature."
                : "The strongest argument was challenged and examined."
              : "What could make the Council wrong?"}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function ReassessmentMoment({ events }: { events: CouncilEvent[] }) {
  const ev = events.findLast((e) => e.type === "reassessment:done");
  const shift = ev?.analysis.shift;
  const shiftClass =
    shift === "REVERSED"
      ? "border-bad/40 text-bad"
      : shift === "WEAKENED"
        ? "border-warn/40 text-warn"
        : shift === "STRENGTHENED"
          ? "border-mint/40 text-mint"
          : "border-line text-ink-soft";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-line bg-card p-4"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand/30 bg-brand/10 text-brand">
          <RotateIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-brand">
            {ev ? "Stress test complete — conclusion" : "Reassessing"}
          </p>
          {ev ? (
            <div className="mt-1 flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${shiftClass}`}>
                {shift ?? "UNCHANGED"}
              </span>
              <span className="truncate text-xs text-ink-soft">{ev.analysis.summary}</span>
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-ink-soft">Re-evaluating positions after the challenge…</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function JudgeMoment({ events }: { events: CouncilEvent[] }) {
  const judging = events.some((e) => e.type === "stage" && e.stage === "judging");
  const judgeDone = events.some((e) => e.type === "verdict");
  const [sub, setSub] = useState(0);

  // Presentation-only: cycles the judge's sub-steps while the judge is active.
  useEffect(() => {
    if (!judging || judgeDone) return;
    const t = setInterval(() => setSub((s) => (s + 1) % JUDGE_SUBSTEPS.length), 1800);
    return () => clearInterval(t);
  }, [judging, judgeDone]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-brand/30 bg-card p-4"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-brand/40 bg-brand/10 text-brand">
          <PedestalIcon className="h-5 w-5" />
          {judging && !judgeDone && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-lg border border-brand/50"
              style={{ animation: "ring-pulse 2.2s cubic-bezier(0.22,1,0.36,1) infinite" }}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-brand">
            {judgeDone ? "Verdict reached" : "Judge"}
          </p>
          {judging && !judgeDone ? (
            <p className="mt-0.5 font-display text-sm font-semibold text-ink">
              Deliberating — <span className="text-brand">{JUDGE_SUBSTEPS[sub]}</span>
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-ink-soft">
              Weighing argument quality, never counting votes.
            </p>
          )}
        </div>
      </div>
      {judging && !judgeDone && (
        <div className="mt-3 flex items-center gap-1.5" aria-hidden="true">
          {JUDGE_SUBSTEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
                i <= sub ? "bg-brand" : "bg-line"
              }`}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function DeliberationPanel({
  question,
  mode,
  events,
  onCancel,
}: {
  question: string;
  mode: CouncilMode;
  events: CouncilEvent[];
  onCancel?: () => void;
}) {
  const convened = events.find((e): e is Extract<CouncilEvent, { type: "convened" }> => e.type === "convened");
  const stage = deriveDeliberationStage(events, mode);
  const comparing = stage === "comparing";
  const daActive = stage === "devils_advocate" || events.some((e) => e.type === "da:done");
  const reassessing = stage === "reassessing" || events.some((e) => e.type === "reassessment:done");
  const judging = stage === "judging" || events.some((e) => e.type === "verdict");
  const classificationLabel = convened?.classification?.label ?? null;

  return (
    <section aria-live="polite" className="mx-auto w-full max-w-2xl py-4">
      {/* Header */}
      <div className="text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">Council convened</p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">
          {STAGE_TITLES[stage]}
        </h2>
        <p className="mx-auto mt-1.5 line-clamp-2 max-w-md text-sm text-ink-soft">“{question}”</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full border border-brand/30 bg-brand/5 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-brand">
            {mode}
          </span>
          {classificationLabel && (
            <span className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-soft">
              Classified as: {classificationLabel}
            </span>
          )}
        </div>
      </div>

      {/* Pipeline */}
      <div className="mt-5">
        <StagePipeline mode={mode} stage={stage} />
      </div>

      {/* Agent chamber (FULL/DEEP radial) or plain grid (QUICK) */}
      {convened &&
        (mode === "QUICK" ? (
          <motion.div layout className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {convened.agents.map((agent) => (
              <AgentCard key={agent} events={events} agent={agent} />
            ))}
          </motion.div>
        ) : (
          <CouncilChamber events={events} agents={convened.agents} mode={mode} />
        ))}

      {/* Stage moments */}
      <div className="mt-4 flex flex-col gap-3">
        {comparing && <ComparisonMoment events={events} />}
        {mode === "DEEP" && daActive && <DevilsAdvocateMoment events={events} />}
        {mode === "DEEP" && reassessing && <ReassessmentMoment events={events} />}
        {judging && <JudgeMoment events={events} />}
      </div>

      {onCancel && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink-soft transition-all hover:border-bad/40 hover:text-bad"
          >
            <XIcon className="h-4 w-4" />
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
