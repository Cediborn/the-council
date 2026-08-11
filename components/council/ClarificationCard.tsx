"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { ClarificationQuestion } from "@/lib/council/types";

/**
 * V0.3 — the ask-first clarification round (Part 7).
 *
 * Shown only when the clarify gate found decision-critical gaps. Up to 2
 * questions, each explaining why it matters. Answer-or-abandon (user decision
 * #13): submitting convenes the Council with the answers; "Cancel" abandons
 * the round (the deliberation does not run).
 */

export function ClarificationCard({
  questions,
  assumptions,
  onAnswer,
  onAbandon,
}: {
  questions: ClarificationQuestion[];
  assumptions: string[];
  onAnswer: (answers: { id: string; answer: string }[]) => void;
  onAbandon: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const missing = questions.filter((q) => !answers[q.id]?.trim()).length;
  const valid = missing === 0;

  const submit = () => {
    if (!valid) {
      setTouched(true);
      return;
    }
    onAnswer(
      questions.map((q) => ({ id: q.id, answer: answers[q.id].trim() })),
    );
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.3 }}
      className="mx-auto w-full max-w-2xl py-6"
      aria-label="The Council needs a little more context"
    >
      <div className="rounded-2xl border border-brand/30 bg-card p-6 shadow-card sm:p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
          Before convening
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold text-ink">
          Two quick things would sharpen the verdict
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          The Council can deliberate anyway, but these details change the
          recommendation significantly. Answer naturally — or cancel and the
          deliberation won't run.
        </p>

        <div className="mt-6 flex flex-col gap-4">
          {questions.map((q, i) => (
            <div key={q.id}>
              <label
                htmlFor={`cl-${q.id}`}
                className="block font-display text-sm font-semibold text-ink"
              >
                {i + 1}. {q.question}
              </label>
              <p className="mt-0.5 text-xs text-ink-soft">{q.why}</p>
              <textarea
                id={`cl-${q.id}`}
                value={answers[q.id] ?? ""}
                onChange={(e) => {
                  setAnswers((a) => ({ ...a, [q.id]: e.target.value }));
                  setTouched(true);
                }}
                rows={2}
                placeholder="Your answer…"
                aria-invalid={touched && !answers[q.id]?.trim()}
                className="mt-2 w-full resize-none rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-ink-soft/60 focus:border-brand/50 focus:outline-none"
              />
            </div>
          ))}
        </div>

        {assumptions.length > 0 && (
          <div className="mt-4 rounded-xl border border-line bg-surface p-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-ink-soft">
              Otherwise, the Council assumes
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {assumptions.map((a, i) => (
                <li key={i} className="text-xs text-ink-soft">· {a}</li>
              ))}
            </ul>
          </div>
        )}

        {touched && !valid && (
          <p className="mt-3 text-xs text-warn" role="alert">
            Please answer all {questions.length} question{questions.length === 1 ? "" : "s"} —
            or cancel.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            onClick={onAbandon}
            className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:border-bad/40 hover:text-bad"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-2.5 text-sm font-bold text-gold-contrast shadow-gold transition-all hover:bg-brand-2"
          >
            Convene the Council
          </button>
        </div>
      </div>
    </motion.section>
  );
}
