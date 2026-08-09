"use client";

import { motion } from "framer-motion";
import type { CouncilEvent, CouncilMode } from "@/lib/council/types";
import {
  BoltIcon,
  CheckIcon,
  EyeIcon,
  HourglassIcon,
  PedestalIcon,
  ScalesIcon,
  ShieldIcon,
  WrenchIcon,
  CompassIcon,
  XIcon,
} from "@/components/icons";
import type { ComponentType, SVGProps } from "react";

const AGENT_META: Record<string, { icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }> = {
  reasoner: { icon: EyeIcon, label: "Reasoner" },
  skeptic: { icon: ShieldIcon, label: "Skeptic" },
  practicalist: { icon: WrenchIcon, label: "Practicalist" },
  perspective: { icon: CompassIcon, label: "Perspective" },
  devils_advocate: { icon: BoltIcon, label: "Devil's Advocate" },
  comparer: { icon: ScalesIcon, label: "Comparer" },
  judge: { icon: PedestalIcon, label: "Judge" },
};

function AgentStatus({ events, agent }: { events: CouncilEvent[]; agent: string }) {
  const meta = AGENT_META[agent];
  const Icon = meta?.icon ?? HourglassIcon;
  const label = meta?.label ?? agent;

  const started = events.some((e) => e.type === "agent:start" && e.agent === agent);
  const done = events.findLast(
    (e): e is Extract<CouncilEvent, { type: "agent:done" }> =>
      e.type === "agent:done" && e.analysis.agent === agent,
  );
  const failed = done?.analysis.failed;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
          failed
            ? "border-bad/40 text-bad"
            : done
              ? "border-mint/40 text-mint"
              : started
                ? "border-brand/50 text-brand animate-pulse-soft"
                : "border-line text-ink-soft"
        }`}
      >
        {failed ? <XIcon className="h-4.5 w-4.5" /> : done ? <CheckIcon className="h-4.5 w-4.5" /> : <Icon className="h-4.5 w-4.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-ink">{label}</p>
        <p className="text-xs text-ink-soft">{failed ? "Failed — skipped" : done ? "Analysis complete" : "Analyzing"}</p>
      </div>
      <span
        className={`font-mono text-[11px] uppercase tracking-wider ${
          failed ? "text-bad" : done ? "text-mint" : "text-brand animate-pulse-soft"
        }`}
      >
        {failed ? "FAILED" : done ? "DONE" : "ANALYZING"}
      </span>
    </div>
  );
}

export function DeliberationPanel({
  question,
  mode,
  events,
}: {
  question: string;
  mode: CouncilMode;
  events: CouncilEvent[];
}) {
  const convened = events.find((e) => e.type === "convened") as
    | Extract<CouncilEvent, { type: "convened" }>
    | undefined;

  const allAnalystsDone =
    convened &&
    convened.agents.every((a) => events.some((e) => e.type === "agent:done" && e.analysis.agent === a));

  const comparing = events.some((e) => e.type === "stage" && e.stage === "comparing");
  const daStarted = events.some((e) => e.type === "stage" && e.stage === "devils_advocate");
  const judging = events.some((e) => e.type === "stage" && e.stage === "judging");

  const currentStageLabel = judging
    ? "Judge deliberating"
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
                <p className="text-xs text-ink-soft">Agreements and disagreements</p>
              </div>
              <span className={`font-mono text-[11px] uppercase tracking-wider ${comparing ? "text-brand animate-pulse-soft" : allAnalystsDone ? "text-brand" : "text-ink-soft/50"}`}>
                {comparing ? "COMPARING" : allAnalystsDone ? "QUEUED" : "WAITING"}
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
              <span className={`font-mono text-[11px] uppercase tracking-wider ${daStarted ? "text-brand animate-pulse-soft" : comparing ? "text-brand" : "text-ink-soft/50"}`}>
                {daStarted ? "STRESS-TESTING" : comparing ? "QUEUED" : "WAITING"}
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
            <span className={`font-mono text-[11px] uppercase tracking-wider ${judging ? "text-brand animate-pulse-soft" : daStarted || (allAnalystsDone && mode === "QUICK") ? "text-brand" : "text-ink-soft/50"}`}>
              {judging ? "DELIBERATING" : daStarted || (allAnalystsDone && mode === "QUICK") ? "QUEUED" : "WAITING"}
            </span>
          </div>
        </motion.li>
      </motion.ul>
    </section>
  );
}
