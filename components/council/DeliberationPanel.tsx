"use client";

import { motion } from "framer-motion";
import type { CouncilEvent, CouncilMode } from "@/lib/council/types";
import {
  BoltIcon,
  CheckIcon,
  EyeIcon,
  HourglassIcon,
  PedestalIcon,
  RotateIcon,
  ScalesIcon,
  ShieldIcon,
  WrenchIcon,
  CompassIcon,
  XIcon,
} from "@/components/icons";
import type { ComponentType, SVGProps } from "react";

const AGENT_META: Record<
  string,
  {
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    label: string;
    /** What the agent is doing while analyzing (Part 16). */
    doing: string;
    /** What the agent achieved once done (Part 16). */
    done: string;
  }
> = {
  reasoner: { icon: EyeIcon, label: "Reasoner", doing: "Analyzing the problem", done: "Analyzed the problem" },
  skeptic: { icon: ShieldIcon, label: "Skeptic", doing: "Stress-testing assumptions", done: "Stress-tested assumptions" },
  practicalist: { icon: WrenchIcon, label: "Practicalist", doing: "Analyzing feasibility", done: "Assessed real-world feasibility" },
  perspective: { icon: CompassIcon, label: "Perspective", doing: "Seeking alternative framings", done: "Found alternative framings" },
  devils_advocate: { icon: BoltIcon, label: "Devil's Advocate", doing: "Stress-testing the strongest argument", done: "Stress-tested the strongest argument" },
  comparer: { icon: ScalesIcon, label: "Comparer", doing: "Comparing perspectives", done: "Compared perspectives" },
  reassessor: { icon: RotateIcon, label: "Reassessor", doing: "Reassessing after the stress-test", done: "Reassessed positions" },
  judge: { icon: PedestalIcon, label: "Judge", doing: "Evaluating the evidence", done: "Reached a verdict" },
};

function AgentStatus({ events, agent }: { events: CouncilEvent[]; agent: string }) {
  const meta = AGENT_META[agent];
  const Icon = meta?.icon ?? HourglassIcon;
  const label = meta?.label ?? agent;
  const doing = meta?.doing ?? "Analyzing";
  const done = meta?.done ?? "Analysis complete";

  const started = events.some((e) => e.type === "agent:start" && e.agent === agent);
  const doneEvent = events.findLast(
    (e): e is Extract<CouncilEvent, { type: "agent:done" }> =>
      e.type === "agent:done" && e.analysis.agent === agent,
  );
  const failed = doneEvent?.analysis.failed;
  const degraded = doneEvent?.analysis.degraded;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
          failed
            ? "border-bad/40 text-bad"
            : doneEvent
              ? "border-mint/40 text-mint"
              : started
                ? "border-brand/50 text-brand animate-pulse-soft"
                : "border-line text-ink-soft"
        }`}
      >
        {failed ? <XIcon className="h-4.5 w-4.5" /> : doneEvent ? <CheckIcon className="h-4.5 w-4.5" /> : <Icon className="h-4.5 w-4.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-ink">{label}</p>
        <p className="text-xs text-ink-soft">
          {failed
            ? "Failed — the Council continued without it"
            : doneEvent
              ? `${done}${degraded ? " (partial)" : ""}`
              : `${doing}…`}
        </p>
      </div>
      <span
        className={`font-mono text-[11px] uppercase tracking-wider ${
          failed ? "text-bad" : doneEvent ? "text-mint" : "text-brand animate-pulse-soft"
        }`}
      >
        {failed ? "FAILED" : doneEvent ? "DONE" : started ? "ANALYZING" : "WAITING"}
      </span>
    </div>
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
  const convened = events.find((e) => e.type === "convened") as
    | Extract<CouncilEvent, { type: "convened" }>
    | undefined;

  const allAnalystsDone =
    convened &&
    convened.agents.every((a) => events.some((e) => e.type === "agent:done" && e.analysis.agent === a));

  const comparing = events.some((e) => e.type === "stage" && e.stage === "comparing");
  const daStarted = events.some((e) => e.type === "stage" && e.stage === "devils_advocate");
  const reassessing = events.some((e) => e.type === "stage" && e.stage === "reassessing");
  const judging = events.some((e) => e.type === "stage" && e.stage === "judging");
  // Completion is signaled by the stage's result event arriving (V0.2: fixed
  // rows now resolve to DONE instead of staying QUEUED forever).
  const comparisonDone = events.some((e) => e.type === "comparison");
  const daDone = events.some((e) => e.type === "da:done");
  const reassessmentDone = events.some((e) => e.type === "reassessment:done");
  const judgeDone = events.some((e) => e.type === "verdict");

  const classificationLabel = convened?.classification?.label ?? null;

  const currentStageLabel = judging
    ? "Judge deliberating"
    : reassessing
      ? "Reassessing after the stress-test"
      : daStarted
        ? "Devil's Advocate stress-testing arguments"
        : comparing
          ? "Comparing perspectives"
          : allAnalystsDone
            ? mode === "QUICK"
              ? "Passing to the Judge"
              : "Passing to comparison"
            : "Independent analysis in progress";

  return (
    <section aria-live="polite" className="mx-auto w-full max-w-xl py-4">
      <div className="text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">COUNCIL CONVENED</p>
        <h2 className="mt-2 font-display text-2xl font-bold text-ink">{currentStageLabel}</h2>
        <p className="mx-auto mt-1 line-clamp-2 max-w-md text-sm text-ink-soft">“{question}”</p>
        {classificationLabel && (
          <span className="mt-2 inline-block rounded-full border border-line bg-surface px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-soft">
            Classified as: {classificationLabel}
          </span>
        )}
      </div>

      <motion.ul
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
        className="mt-6 flex flex-col gap-2"
      >
        {convened?.agents.map((agent) => (
          <motion.li key={agent} variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}>
            <AgentStatus events={events} agent={agent} />
          </motion.li>
        ))}
        {mode !== "QUICK" && (
          <motion.li variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}>
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface/60 px-4 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-soft">
                <ScalesIcon className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-semibold text-ink">Comparison</p>
                <p className="text-xs text-ink-soft">Agreements, disagreements, contradictions</p>
              </div>
              <span className={`font-mono text-[11px] uppercase tracking-wider ${comparisonDone ? "text-mint" : comparing ? "text-brand animate-pulse-soft" : allAnalystsDone ? "text-brand" : "text-ink-soft/50"}`}>
                {comparisonDone ? "DONE" : comparing ? "COMPARING" : allAnalystsDone ? "QUEUED" : "WAITING"}
              </span>
            </div>
          </motion.li>
        )}
        {mode === "DEEP" && (
          <motion.li variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}>
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface/60 px-4 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-soft">
                <BoltIcon className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-semibold text-ink">Devil's Advocate</p>
                <p className="text-xs text-ink-soft">Stress-testing the emerging consensus</p>
              </div>
              <span className={`font-mono text-[11px] uppercase tracking-wider ${daDone ? "text-mint" : daStarted ? "text-brand animate-pulse-soft" : comparing ? "text-brand" : "text-ink-soft/50"}`}>
                {daDone ? "DONE" : daStarted ? "STRESS-TESTING" : comparing ? "QUEUED" : "WAITING"}
              </span>
            </div>
          </motion.li>
        )}
        {mode === "DEEP" && (
          <motion.li variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}>
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface/60 px-4 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-soft">
                <RotateIcon className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-semibold text-ink">Reassessment</p>
                <p className="text-xs text-ink-soft">Re-evaluating positions after the stress-test</p>
              </div>
              <span className={`font-mono text-[11px] uppercase tracking-wider ${reassessmentDone ? "text-mint" : reassessing ? "text-brand animate-pulse-soft" : daDone ? "text-brand" : "text-ink-soft/50"}`}>
                {reassessmentDone ? "DONE" : reassessing ? "REASSESSING" : daDone ? "QUEUED" : "WAITING"}
              </span>
            </div>
          </motion.li>
        )}
        <motion.li variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}>
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface/60 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-soft">
              <PedestalIcon className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold text-ink">Judge</p>
              <p className="text-xs text-ink-soft">Weighing argument quality, not votes</p>
            </div>
            <span className={`font-mono text-[11px] uppercase tracking-wider ${judgeDone ? "text-mint" : judging ? "text-brand animate-pulse-soft" : daStarted || reassessmentDone || (allAnalystsDone && mode === "QUICK") ? "text-brand" : "text-ink-soft/50"}`}>
              {judgeDone ? "DONE" : judging ? "DELIBERATING" : daStarted || reassessmentDone || (allAnalystsDone && mode === "QUICK") ? "QUEUED" : "WAITING"}
            </span>
          </div>
        </motion.li>
      </motion.ul>

      {onCancel && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink-soft transition-all hover:border-bad/50 hover:text-bad"
          >
            <XIcon className="h-4 w-4" />
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
