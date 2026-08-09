"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { CouncilMode } from "@/lib/council/types";
import { MODES } from "@/lib/council/types";
import { GavelIcon } from "@/components/icons";

export function QuestionScreen({ onRun }: { onRun: (question: string, mode: CouncilMode) => void }) {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<CouncilMode>("FULL");
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = question.trim();
  const tooLong = question.length > 6000;
  const valid = trimmed.length > 0 && !tooLong;

  const modeInfo = useMemo(() => MODES.find((m) => m.value === mode), [mode]);

  const submit = () => {
    if (!valid) {
      setTouched(true);
      inputRef.current?.focus();
      return;
    }
    onRun(trimmed, mode);
  };

  return (
    <section className="mx-auto w-full max-w-2xl py-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col items-center text-center"
      >
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 text-brand animate-glow">
          <GavelIcon className="h-8 w-8" />
        </div>
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">COUNCIL</h1>
        <p className="mt-3 max-w-md text-balance text-ink-soft">
          Ask anything. When you need more than one perspective, convene the Council.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08 }}
        className="mt-8"
      >
        <label htmlFor="council-question" className="sr-only">
          Your question for the Council
        </label>
        <div className="group relative rounded-2xl border border-line bg-surface shadow-card transition-all focus-within:border-brand/60 focus-within:shadow-lift">
          <textarea
            ref={inputRef}
            id="council-question"
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              setTouched(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder="What do you want the Council to think about?"
            rows={4}
            maxLength={6500}
            aria-describedby="council-hint"
            className="w-full resize-none rounded-2xl bg-transparent px-5 py-4 text-base leading-relaxed text-ink placeholder:text-ink-soft/70 focus:outline-none"
          />
          <div className="flex items-center justify-between px-4 pb-3">
            <p id="council-hint" className="text-xs text-ink-soft">
              {touched && !trimmed ? (
                <span className="text-warn">Ask the Council something.</span>
              ) : tooLong ? (
                <span className="text-bad">Too long — {question.length}/6000</span>
              ) : (
                <>
                  Press <kbd className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10px]">Ctrl</kbd>{" "}
                  + <kbd className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd> to convene
                </>
              )}
            </p>
            <p className="font-mono text-xs tabular-nums text-ink-soft">{question.length}/6000</p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.16 }}
        className="mt-6"
      >
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Council mode">
          {MODES.map((m) => {
            const active = mode === m.value;
            return (
              <button
                key={m.value}
                role="radio"
                aria-checked={active}
                onClick={() => setMode(m.value)}
                className={`flex-1 min-w-[9rem] rounded-xl border px-4 py-3 text-left transition-all ${
                  active
                    ? "border-brand/60 bg-brand/10 shadow-card"
                    : "border-line bg-surface hover:border-brand/30 hover:bg-card"
                }`}
              >
                <span className={`block font-display text-sm font-bold ${active ? "text-brand" : "text-ink"}`}>
                  {m.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-soft">{m.blurb}</span>
              </button>
            );
          })}
        </div>
        <p aria-live="polite" className="mt-2 min-h-4 text-center text-xs text-ink-soft">
          {modeInfo?.blurb}
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.24 }}
        className="mt-6 flex justify-center"
      >
        <button
          onClick={submit}
          disabled={!trimmed && touched}
          className="group inline-flex items-center gap-3 rounded-2xl bg-brand px-8 py-4 text-base font-bold text-white shadow-lift transition-all hover:bg-brand-2 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
        >
          <GavelIcon className="h-5 w-5 transition-transform group-hover:-rotate-6" />
          Convene Council
        </button>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-10 text-center text-xs leading-relaxed text-ink-soft/80"
      >
        Four independent perspectives. One honest verdict. The Council is designed to
        disagree with you when the arguments justify it.
      </motion.p>
    </section>
  );
}
