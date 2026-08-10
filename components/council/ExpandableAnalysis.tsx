"use client";

import { useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckIcon,
  ChevronIcon,
  CompassIcon,
  EyeIcon,
  RotateIcon,
  ShieldIcon,
  WrenchIcon,
  XIcon,
} from "@/components/icons";
import type { AgentAnalysis } from "@/lib/council/types";
import { labelForStance } from "@/lib/council/agents";

/**
 * COUNCIL V0.2.2.2 (Part 3) — shared expandable analysis card.
 *
 * Every surface that shows a Council member's analysis uses this component so
 * expand/collapse behaves identically everywhere: opens on click, closes on
 * click, preserves content, works on desktop + mobile, never overlaps, and is
 * keyboard-accessible (aria-expanded + focusable button).
 */

export function ExpandableCard({
  icon: Icon,
  title,
  meta,
  tone = "brand",
  defaultOpen = false,
  openLabel = "Hide",
  closedLabel = "View",
  children,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  meta?: ReactNode;
  tone?: "brand" | "bad" | "warn";
  defaultOpen?: boolean;
  openLabel?: string;
  closedLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const tileClass =
    tone === "bad"
      ? "border-bad/40 bg-bad/10 text-bad"
      : tone === "warn"
        ? "border-warn/40 bg-warn/10 text-warn"
        : "border-brand/30 bg-brand/10 text-brand";

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface"
      >
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${tileClass}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold text-ink">{title}</p>
          {meta && <p className="truncate text-xs text-ink-soft">{meta}</p>}
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand">
          {open ? openLabel : closedLabel}
          <ChevronIcon className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="relative border-t border-line px-4 py-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A failed member's card — never fabricated, never hidden (Part 2/10). */
export function FailedMemberCard({
  analysis,
  onRetry,
}: {
  analysis: AgentAnalysis;
  onRetry?: () => void;
}) {
  const timedOut = analysis.outcome === "TIMED_OUT";
  const outcomeLabel = timedOut ? "Timed out" : "Failed";
  return (
    <div className="rounded-xl border border-bad/30 bg-bad/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-bad/40 bg-bad/10 text-bad">
          <XIcon className="h-4 w-4" />
        </span>
        <p className="font-display text-sm font-semibold text-bad">{analysis.name}</p>
        <span className="rounded-full border border-bad/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-bad">
          {outcomeLabel}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-ink-soft">
        {timedOut
          ? "This member timed out before responding. The Council continued with the remaining perspectives."
          : "This member could not respond. The Council continued with the remaining perspectives."}
      </p>
      {analysis.error && (
        <p className="mt-1.5 rounded-lg bg-surface px-3 py-2 font-mono text-[11px] text-ink-soft">
          {analysis.error}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition-all hover:border-brand/50 hover:text-brand"
        >
          <RotateIcon className="h-3.5 w-3.5" />
          Retry {analysis.name}
        </button>
      )}
    </div>
  );
}

/** Icon per analytical agent (mirrors DeliberationPanel's mapping). */
const AGENT_ICON: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  reasoner: EyeIcon,
  skeptic: ShieldIcon,
  practicalist: WrenchIcon,
  perspective: CompassIcon,
};

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">{title}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((p, i) => (
          <li key={i} className="text-sm text-ink-soft">· {p}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * V0.2.2.3 — the shared analysis body, reused by the terminal surfaces AND the
 * live deliberation chamber so a completed member is inspectable as soon as it
 * finishes (Part 6), not only after the whole Council settles.
 */
export function AnalysisBody({ analysis }: { analysis: AgentAnalysis }) {
  return (
    <>
      {analysis.degraded && (
        <p className="mb-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
          This analysis could not be fully structured and is shown as raw text.
        </p>
      )}
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{analysis.summary}</p>
      <BulletList title="Key points" items={analysis.keyPoints} />
      <BulletList title="Assumptions" items={analysis.assumptions} />
      <BulletList title="Risks" items={analysis.risks} />
      <BulletList title="Missing information" items={analysis.missingInformation} />
      {analysis.retries ? (
        <p className="mt-3 text-[11px] text-ink-soft">Retried {analysis.retries}× before responding.</p>
      ) : null}
    </>
  );
}

/**
 * V0.2.2.2 (Part 3) — the standard member analysis view used by the verdict,
 * degraded, error, and cancelled surfaces.
 */
export function ExpandableAnalysis({
  analysis,
  defaultOpen = false,
  onRetry,
}: {
  analysis: AgentAnalysis;
  defaultOpen?: boolean;
  onRetry?: () => void;
}) {
  if (analysis.failed) {
    return <FailedMemberCard analysis={analysis} onRetry={onRetry} />;
  }

  const Icon = AGENT_ICON[analysis.agent] ?? CheckIcon;
  const meta = (
    <>
      {labelForStance(analysis.stance)} · confidence {analysis.confidence}%
      {analysis.evidenceQuality && analysis.evidenceQuality !== "UNKNOWN" && (
        <> · evidence {analysis.evidenceQuality.toLowerCase()}</>
      )}
    </>
  );

  return (
    <ExpandableCard icon={Icon} title={analysis.name} meta={meta} openLabel="Hide analysis" closedLabel="View analysis">
      <AnalysisBody analysis={analysis} />
    </ExpandableCard>
  );
}
