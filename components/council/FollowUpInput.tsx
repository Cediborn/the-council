"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";

/**
 * V0.3 — the conversation continuation input (Part 7/8).
 *
 * Appears under the verdict. The reply goes to /api/council/followup: the
 * server decides whether to answer directly or re-convene a targeted
 * re-analysis. Natural disagreement needs no special button — typing it here
 * is enough (user decision #9).
 */

export function FollowUpInput({
  disabled,
  onSubmit,
  placeholder = "Continue the conversation — push back, add a detail, or ask a question…",
}: {
  disabled?: boolean;
  onSubmit: (reply: string) => void;
  placeholder?: string;
}) {
  const [reply, setReply] = useState("");
  const [touched, setTouched] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const trimmed = reply.trim();
  const valid = trimmed.length > 0;

  const submit = () => {
    if (!valid) {
      setTouched(true);
      ref.current?.focus();
      return;
    }
    onSubmit(trimmed);
    setReply("");
    setTouched(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.2 }}
      className="mt-4"
    >
      <div className="group relative rounded-2xl border border-line bg-surface shadow-card transition-all focus-within:border-brand/50 focus-within:shadow-lift">
        <label htmlFor="council-followup" className="sr-only">
          Continue the conversation
        </label>
        <textarea
          ref={ref}
          id="council-followup"
          value={reply}
          onChange={(e) => {
            setReply(e.target.value);
            setTouched(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !disabled) submit();
          }}
          placeholder={placeholder}
          rows={2}
          maxLength={4000}
          disabled={disabled}
          className="w-full resize-none rounded-2xl bg-transparent px-5 py-3.5 text-sm leading-relaxed text-ink placeholder:text-ink-soft/70 focus:outline-none disabled:opacity-50"
        />
        <div className="flex items-center justify-between px-4 pb-3">
          <p className="text-[11px] text-ink-soft">
            {touched && !valid ? (
              <span className="text-warn">Say something to the Council.</span>
            ) : disabled ? (
              "The Council is working…"
            ) : (
              "This continues the same deliberation — no special 'challenge' button needed."
            )}
          </p>
          <button
            onClick={submit}
            disabled={disabled || (!valid && touched)}
            className="rounded-lg bg-brand px-4 py-1.5 text-xs font-bold text-gold-contrast transition-all hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </motion.div>
  );
}
