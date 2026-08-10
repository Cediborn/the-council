"use client";

import { AlertIcon, RotateIcon } from "@/components/icons";
import type { AgentAnalysis } from "@/lib/council/types";

/**
 * COUNCIL V0.2.2.1 (Part 16) — the distinct Judge-failure result.
 *
 * Shown ONLY when the final verdict is the degraded `INSUFFICIENT_INFORMATION`
 * fallback (the Judge did not complete). It never displays BUILD/REFINE/
 * VALIDATE/RECONSIDER/REJECT: those require a valid Judge verdict. Completed
 * analyses are preserved; no verdict is fabricated; the future Challenge flow
 * (not this panel) is what re-opens deliberation.
 */
export function InsufficientPanel({
  preserved,
  onRetry,
  onReset,
}: {
  preserved: AgentAnalysis[];
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
          Insufficient Information
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
          The Council completed its analysis, but the final Judge could not
          safely produce a verdict. No verdict is fabricated from the surviving
          perspectives.
        </p>
        <p className="mt-3 text-xs text-ink-soft">
          {preserved.length > 0
            ? `${preserved.length} completed analysis${preserved.length === 1 ? "" : "es"} ${
                preserved.length === 1 ? "is" : "are"
              } preserved below.`
            : "No completed analyses could be preserved."}
        </p>
      </div>

      {preserved.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-soft">
            Completed analyses
          </p>
          {preserved.map((a) => (
            <div key={a.agent} className="rounded-xl border border-brand/15 bg-surface px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
                <p className="font-display text-sm font-semibold text-ink">{a.name}</p>
                <span className="text-[10px] uppercase tracking-wider text-brand">completed</span>
              </div>
              {a.summary && <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{a.summary}</p>}
            </div>
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
