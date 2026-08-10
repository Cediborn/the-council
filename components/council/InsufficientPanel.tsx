"use client";

import { AlertIcon, RotateIcon } from "@/components/icons";
import { ExpandableAnalysis } from "./ExpandableAnalysis";
import type { AgentAnalysis, AgentKey } from "@/lib/council/types";

/**
 * COUNCIL V0.2.2.2 — the DEGRADED landing surface.
 *
 * Shown when a session ends with NO usable verdict AND no completed analyses
 * to synthesize from (the genuine no-information case). Completed analyses are
 * always preserved and fully expandable here — the Council's work is never
 * hidden, even when synthesis is impossible. When a provisional verdict DOES
 * exist, the (richer) VerdictView renders instead, with its provisional banner.
 */
export function InsufficientPanel({
  preserved,
  onRetryAgent,
  onRetry,
  onReset,
}: {
  preserved: AgentAnalysis[];
  onRetryAgent?: (agent: AgentKey) => void;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="rounded-2xl border border-line bg-card p-8 text-center shadow-card">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-soft">
          Council result
        </p>
        <div className="mx-auto mt-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/5 text-brand">
          <AlertIcon className="h-6 w-6" />
        </div>
        <h2 className="mt-4 font-display text-2xl font-bold text-ink">
          Council synthesis unavailable
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
          The final Judge could not safely produce a verdict and there were no
          completed analyses to synthesize from. Nothing is fabricated — the
          individual work below (if any) remains available.
        </p>
      </div>

      {preserved.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-soft">
            Completed analyses
          </p>
          {preserved.map((a) => (
            <ExpandableAnalysis
              key={a.agent}
              analysis={a}
              onRetry={onRetryAgent ? () => onRetryAgent(a.agent) : undefined}
            />
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-gold-contrast transition-all hover:bg-brand-2"
        >
          <RotateIcon className="h-4 w-4" />
          Try again
        </button>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold text-ink transition-all hover:border-brand/50"
        >
          New question
        </button>
      </div>
    </div>
  );
}
