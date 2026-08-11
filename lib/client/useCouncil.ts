"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  AgentAnalysis,
  AgentKey,
  ClarificationQuestion,
  CouncilEvent,
  CouncilMode,
  CouncilVerdict,
  ConversationTurn,
} from "@/lib/council/types";
import {
  councilReducer,
  initialCouncilState,
  isSessionActive,
  type CouncilPhase,
} from "./councilState";
import {
  clearSessions,
  loadSessions,
  loadThreads,
  saveSession,
  saveThread,
  type StoredSession,
  type StoredThread,
  type StoredTurn,
} from "./persistence";

export type { CouncilPhase } from "./councilState";

function isEvent(e: unknown): e is CouncilEvent {
  return (
    typeof e === "object" &&
    e !== null &&
    "type" in e &&
    typeof (e as { type: unknown }).type === "string"
  );
}

/** A stable client id used until the server confirms its own session id. */
function makeClientId(): string {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeTurnId(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const TERMINAL_PHASES: CouncilPhase[] = ["complete", "degraded", "failed", "cancelled"];

/** The stateless context a follow-up needs (derived from the last verdict run). */
interface ConversationContext {
  question: string;
  mode: CouncilMode;
  sessionId: string | null;
  verdict: CouncilVerdict;
  analyses: AgentAnalysis[];
}

/** Summarize an in-memory turn for persistence (events are stripped). */
function toStoredTurn(t: ConversationTurn): StoredTurn {
  return {
    id: t.id,
    kind: t.kind,
    type: t.type,
    text: t.text,
    verdict: t.verdict,
    usage: t.usage,
    diff: t.diff,
    intent: t.intent,
    clarifications: t.clarifications,
    answers: t.answers,
    startedAt: t.startedAt,
  };
}

function threadToStored(thread: ConversationTurn[], meta: { mergedContext: string[]; explicitAssumptions: string[] }): StoredThread {
  return {
    version: 1,
    id: thread[0]?.id ?? `th-${Date.now()}`,
    mode: (thread.find((t) => t.usage)?.usage?.mode ?? "QUICK") as CouncilMode,
    question: thread.find((t) => t.type === "question")?.text ?? "",
    startedAt: thread[0]?.startedAt ?? Date.now(),
    mergedContext: meta.mergedContext,
    explicitAssumptions: meta.explicitAssumptions,
    turns: thread.map(toStoredTurn),
  };
}

/**
 * Runs the Council by POSTing to /api/council and consuming the SSE stream.
 *
 * V0.2.2.2 additions over V0.2/V0.2.2:
 *  - `retryAgent()` resumes the SAME session, re-running only the failed member.
 *  - `restoreSession()` reopens a persisted session after a refresh.
 *
 * V0.3 additions:
 *  - `startQuestion()` runs the clarify gate first (ask-first, user decision #2),
 *    then convenes with answers if a clarification round happened.
 *  - `answerClarification()` / `abandonClarify()` handle that round.
 *  - `sendFollowUp()` posts a reply to /api/council/followup: the server
 *    classifies the intent (two-path rule) and either answers directly or
 *    re-deliberates with a targeted re-analysis that emits a verdict + diff.
 *  - `thread` holds the archived conversation turns (verdicts visible, diffs
 *    shown); `startNewConversation()` clears it.
 *
 * Reliability guarantees (V0.2) are unchanged: any failure lands in a terminal
 * phase with completed analyses preserved — never a dead UI, never a required
 * refresh. Duplicate submissions are ignored while a session is active.
 */
export function useCouncil() {
  const [state, dispatch] = useReducer(councilReducer, undefined, initialCouncilState);
  const abortRef = useRef<AbortController | null>(null);
  const activeRunRef = useRef<{ controller: AbortController; runId: string } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const runningRef = useRef(false);
  const [previousSessions, setPreviousSessions] = useState<StoredSession[]>([]);

  // V0.3 conversation state.
  const [thread, setThread] = useState<ConversationTurn[]>([]);
  const [threadMeta, setThreadMeta] = useState<{ mergedContext: string[]; explicitAssumptions: string[] }>({
    mergedContext: [],
    explicitAssumptions: [],
  });
  const [clarify, setClarify] = useState<{
    question: string;
    mode: CouncilMode;
    questions: ClarificationQuestion[];
    assumptions: string[];
  } | null>(null);
  /** Whether the current run's question turn was already added to the thread. */
  const questionTurnAddedRef = useRef(false);
  /** Whether the current run is a follow-up re-analysis (affects turn labels). */
  const followUpRunRef = useRef(false);
  /** Context for the follow-up input, kept alive across direct replies. */
  const conversationContextRef = useRef<ConversationContext | null>(null);
  /** A NEW_QUESTION intent queued to run after the current stream finishes. */
  const pendingNewQuestionRef = useRef<{ question: string; mode: CouncilMode } | null>(null);
  /** True when the last stream was a direct reply — the council state must reset. */
  const directReplyHandledRef = useRef(false);

  // Load persisted sessions + threads once on mount (TEST 6 — restore after refresh).
  useEffect(() => {
    setPreviousSessions(loadSessions());
    setThread(
      loadThreads()
        .slice(0, 1)
        .flatMap((t) =>
          t.turns.map<ConversationTurn>((s) => ({
            id: s.id,
            kind: s.kind,
            type: s.type as ConversationTurn["type"],
            text: s.text,
            verdict: s.verdict,
            usage: s.usage,
            diff: s.diff,
            intent: s.intent,
            clarifications: s.clarifications,
            answers: s.answers,
            startedAt: s.startedAt,
            // events are intentionally absent after a refresh (summarized persistence)
          })),
        ),
    );
  }, []);

  // Auto-persist terminal sessions (COMPLETE / DEGRADED / FAILED / CANCELLED).
  useEffect(() => {
    const s = stateRef.current;
    if (!TERMINAL_PHASES.includes(s.phase) || s.events.length === 0) return;
    const verdict = s.events.findLast(
      (e): e is Extract<CouncilEvent, { type: "verdict" }> => e.type === "verdict",
    );
    const stored: StoredSession = {
      version: 1,
      sessionId: s.sessionId ?? `client-${s.startedAt ?? Date.now()}`,
      question: s.question,
      mode: s.mode ?? "QUICK",
      startedAt: s.startedAt ?? Date.now(),
      status: s.phase === "cancelled" ? "cancelled" : s.phase === "failed" ? "failed" : verdict?.verdict.degraded ? "degraded" : "complete",
      error: s.error ?? undefined,
      verdict: verdict?.verdict,
      usage: verdict?.usage,
      events: s.events,
    };
    setPreviousSessions(saveSession(stored));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  /** Archive the current run's question + verdict turns into the thread. */
  const archiveCurrentRun = useCallback(() => {
    const s = stateRef.current;
    const turns: ConversationTurn[] = [];
    if (!questionTurnAddedRef.current && s.question) {
      turns.push({
        id: makeTurnId(),
        kind: "user",
        type: "question",
        text: s.question,
        startedAt: s.startedAt ?? Date.now(),
      });
      questionTurnAddedRef.current = true;
    }
    const verdictEv = s.events.findLast(
      (e): e is Extract<CouncilEvent, { type: "verdict" }> => e.type === "verdict",
    );
    if (verdictEv) {
      const isRevision = followUpRunRef.current;
      const turn: ConversationTurn = {
        id: makeTurnId(),
        kind: "assistant",
        type: isRevision ? "revision" : "verdict",
        verdict: verdictEv.verdict,
        usage: verdictEv.usage,
        diff: verdictEv.diff,
        events: s.events,
        startedAt: Date.now(),
      };
      turns.push(turn);
      conversationContextRef.current = {
        question: s.question,
        mode: s.mode ?? "QUICK",
        sessionId: s.sessionId,
        verdict: verdictEv.verdict,
        analyses: s.events
          .filter((e): e is Extract<CouncilEvent, { type: "agent:done" }> => e.type === "agent:done")
          .map((e) => e.analysis),
      };
    }
    if (turns.length > 0) setThread((prev) => [...prev, ...turns]);
  }, []);

  // Archive a follow-up run's verdict into the thread when it settles.
  useEffect(() => {
    const s = stateRef.current;
    if (!TERMINAL_PHASES.includes(s.phase)) return;
    if (!followUpRunRef.current) return; // only follow-up runs archive automatically
    archiveCurrentRun();
    followUpRunRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // Persist the thread (summarized) whenever it changes.
  useEffect(() => {
    if (thread.length === 0) return;
    saveThread(threadToStored(thread, threadMeta));
  }, [thread, threadMeta]);

  /**
   * Shared SSE consumer for all council streams. Tolerates malformed frames,
   * reports interrupted streams, and routes V0.3 follow-up events through the
   * callbacks instead of the council reducer (they are not council events).
   */
  const consumeStream = useCallback(
    async (
      controller: AbortController,
      res: Response,
      onFollowUp?: (ev: Extract<CouncilEvent, { type: "followup:intent" }>) => void,
      onDirectReply?: (ev: Extract<CouncilEvent, { type: "direct:reply" }>) => void,
    ) => {
      if (controller.signal.aborted) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = (body as { error?: string }).error ?? `Request failed (${res.status}).`;
        dispatch({ type: "STREAM_ERROR", message });
        return;
      }
      if (!res.body) {
        dispatch({ type: "STREAM_ERROR", message: "No response stream." });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminal = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const parsed: unknown = JSON.parse(line.slice(6));
            if (isEvent(parsed)) {
              if (parsed.type === "followup:intent") {
                onFollowUp?.(parsed);
              } else if (parsed.type === "direct:reply") {
                terminal = true;
                onDirectReply?.(parsed);
              } else {
                dispatch({ type: "EVENT", event: parsed });
                if (parsed.type === "verdict" || parsed.type === "error") {
                  terminal = true;
                }
              }
            }
          } catch {
            // ignore malformed frame — never let one bad frame kill the run
          }
        }
      }

      // Stream ended cleanly without a terminal event → interrupted.
      if (!terminal && !controller.signal.aborted) {
        dispatch({
          type: "STREAM_ERROR",
          message: "The Council stream ended before a verdict was reached.",
        });
      }
    },
    [],
  );

  const run = useCallback(
    (q: string, m: CouncilMode, extra?: { clarifications?: { id: string; answer: string }[] }) => {
      if (runningRef.current || isSessionActive(stateRef.current.phase)) return;
      runningRef.current = true;
      followUpRunRef.current = false;

      dispatch({ type: "SUBMIT", question: q, mode: m });

      const controller = new AbortController();
      const runId = makeClientId();
      abortRef.current = controller;
      activeRunRef.current = { controller, runId };

      void (async () => {
        try {
          const res = await fetch("/api/council", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: q,
              mode: m,
              ...(extra?.clarifications?.length
                ? { context: { clarifications: extra.clarifications } }
                : {}),
            }),
            signal: controller.signal,
          });
          await consumeStream(controller, res);
        } catch (err) {
          if (controller.signal.aborted) return;
          const message =
            err instanceof Error && err.name !== "AbortError"
              ? err.message
              : "The connection to the Council was lost.";
          dispatch({ type: "STREAM_ERROR", message });
        } finally {
          if (activeRunRef.current?.runId === runId) {
            activeRunRef.current = null;
            abortRef.current = null;
            runningRef.current = false;
          }
        }
      })();
    },
    [consumeStream],
  );

  /**
   * V0.3 (Part 3): clarify-first question start. The /api/council/clarify check
   * is deterministic and instant; only when it flags critical gaps does the UI
   * show a short clarification round before convening.
   */
  const startQuestion = useCallback(
    async (q: string, m: CouncilMode) => {
      if (runningRef.current || isSessionActive(stateRef.current.phase)) return;
      // A fresh question resets the conversation thread.
      setThread([]);
      setThreadMeta({ mergedContext: [], explicitAssumptions: [] });
      setClarify(null);
      questionTurnAddedRef.current = false;
      followUpRunRef.current = false;
      conversationContextRef.current = null;
      pendingNewQuestionRef.current = null;

      let intent: string | null = null;
      let chatReply: string | undefined;
      let questions: ClarificationQuestion[] = [];
      let assumptions: string[] = [];
      try {
        const res = await fetch("/api/council/clarify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, mode: m }),
          signal: abortRef.current?.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          intent = data.intent;
          chatReply = data.chatReply;
          questions = data.questions ?? [];
          assumptions = data.assumptions ?? [];
        }
      } catch {
        // clarify check failed — proceed directly (never block on it)
      }

      if (intent === "CHAT" && chatReply) {
        setThread((prev) => [
          ...prev,
          {
            id: makeTurnId(),
            kind: "assistant",
            type: "chat_reply",
            text: chatReply,
            startedAt: Date.now(),
          },
        ]);
        return;
      }

      setThread((prev) => [
        ...prev,
        { id: makeTurnId(), kind: "user", type: "question", text: q, startedAt: Date.now() },
      ]);
      questionTurnAddedRef.current = true;

      if (intent === "CLARIFY" && questions.length > 0) {
        setClarify({ question: q, mode: m, questions, assumptions });
        return;
      }

      run(q, m);
    },
    [run],
  );

  const answerClarification = useCallback(
    (answers: { id: string; answer: string }[]) => {
      if (!clarify) return;
      const { question, mode, questions } = clarify;
      setThread((prev) => [
        ...prev,
        {
          id: makeTurnId(),
          kind: "user",
          type: "clarification",
          text: answers.map((a) => a.answer).join(" · "),
          answers,
          clarifications: questions,
          startedAt: Date.now(),
        },
      ]);
      setClarify(null);
      run(question, mode, { clarifications: answers });
    },
    [clarify, run],
  );

  const abandonClarify = useCallback(() => {
    setClarify(null);
  }, []);

  /**
   * V0.3 (Part 8): a reply after a verdict. The server classifies the intent —
   * two paths: direct answer (explanation/small talk/challenge note) or
   * targeted re-analysis (correction / new information) ending in a revised
   * verdict with a diff. A NEW_QUESTION intent starts a fresh thread.
   */
  const sendFollowUp = useCallback(
    (reply: string) => {
      if (runningRef.current || isSessionActive(stateRef.current.phase)) return;
      const ctx = conversationContextRef.current ?? (() => {
        const s = stateRef.current;
        const verdictEv = s.events.findLast(
          (e): e is Extract<CouncilEvent, { type: "verdict" }> => e.type === "verdict",
        );
        if (!s.question || !s.mode || !verdictEv) return null;
        return {
          question: s.question,
          mode: s.mode,
          sessionId: s.sessionId,
          verdict: verdictEv.verdict,
          analyses: s.events
            .filter((e): e is Extract<CouncilEvent, { type: "agent:done" }> => e.type === "agent:done")
            .map((e) => e.analysis),
        } satisfies ConversationContext;
      })();
      if (!ctx) return;

      // Archive the current run (question + verdict) and record the reply.
      archiveCurrentRun();
      followUpRunRef.current = true;
      setThread((prev) => [
        ...prev,
        { id: makeTurnId(), kind: "user", type: "question", text: reply, startedAt: Date.now() },
      ]);
      setThreadMeta((meta) => ({ ...meta, mergedContext: [...meta.mergedContext, reply] }));

      runningRef.current = true;
      dispatch({ type: "SUBMIT", question: ctx.question, mode: ctx.mode });

      const controller = new AbortController();
      const runId = makeClientId();
      abortRef.current = controller;
      activeRunRef.current = { controller, runId };

      void (async () => {
        try {
          const res = await fetch("/api/council/followup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: ctx.question,
              mode: ctx.mode,
              reply,
              sessionId: ctx.sessionId ?? undefined,
              priorVerdict: ctx.verdict,
              priorAnalyses: ctx.analyses,
              mergedContext: threadMeta.mergedContext,
              explicitAssumptions: threadMeta.explicitAssumptions,
            }),
            signal: controller.signal,
          });
          await consumeStream(
            controller,
            res,
            () => {
              // intent event — no-op; the UI derives state from events
            },
            (ev) => {
              if (ev.newQuestion && ev.reply) {
                // Start a fresh conversation with this reply as the question.
                pendingNewQuestionRef.current = { question: ev.reply, mode: ctx.mode };
              } else {
                directReplyHandledRef.current = true;
                setThread((prev) => [
                  ...prev,
                  {
                    id: makeTurnId(),
                    kind: "assistant",
                    type: ev.intent === "SMALL_TALK" ? "chat_reply" : "direct_reply",
                    text: ev.reply,
                    intent: ev.intent,
                    startedAt: Date.now(),
                  },
                ]);
              }
            },
          );
        } catch (err) {
          if (controller.signal.aborted) return;
          const message =
            err instanceof Error && err.name !== "AbortError"
              ? err.message
              : "The connection to the Council was lost.";
          dispatch({ type: "STREAM_ERROR", message });
        } finally {
          if (activeRunRef.current?.runId === runId) {
            activeRunRef.current = null;
            abortRef.current = null;
            runningRef.current = false;
          }
          // A direct reply is not a council run — settle back to the thread.
          if (directReplyHandledRef.current) {
            directReplyHandledRef.current = false;
            dispatch({ type: "RESET" });
          }
          const pending = pendingNewQuestionRef.current;
          if (pending) {
            pendingNewQuestionRef.current = null;
            setThread([]);
            setThreadMeta({ mergedContext: [], explicitAssumptions: [] });
            setClarify(null);
            questionTurnAddedRef.current = false;
            followUpRunRef.current = false;
            conversationContextRef.current = null;
            setThread((prev) => [
              ...prev,
              {
                id: makeTurnId(),
                kind: "user",
                type: "question",
                text: pending.question,
                startedAt: Date.now(),
              },
            ]);
            questionTurnAddedRef.current = true;
            run(pending.question, pending.mode);
          }
        }
      })();
    },
    [consumeStream, run, archiveCurrentRun, threadMeta.mergedContext, threadMeta.explicitAssumptions],
  );

  const startNewConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    activeRunRef.current = null;
    runningRef.current = false;
    followUpRunRef.current = false;
    questionTurnAddedRef.current = false;
    conversationContextRef.current = null;
    pendingNewQuestionRef.current = null;
    setThread([]);
    setThreadMeta({ mergedContext: [], explicitAssumptions: [] });
    setClarify(null);
    dispatch({ type: "RESET" });
  }, []);

  const retryAgent = useCallback(
    (agent: AgentKey) => {
      if (runningRef.current || isSessionActive(stateRef.current.phase)) return;
      const s = stateRef.current;
      if (!s.question || !s.mode || !s.sessionId) return;
      const convened = s.events.find(
        (e): e is Extract<CouncilEvent, { type: "convened" }> => e.type === "convened",
      );
      if (!convened) return;
      const analyses = s.events
        .filter((e): e is Extract<CouncilEvent, { type: "agent:done" }> => e.type === "agent:done")
        .map((e) => e.analysis);

      runningRef.current = true;
      dispatch({ type: "RESUME", retryAgent: agent });

      const controller = new AbortController();
      const runId = makeClientId();
      abortRef.current = controller;
      activeRunRef.current = { controller, runId };

      void (async () => {
        try {
          const res = await fetch("/api/council", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: s.question,
              mode: s.mode,
              sessionId: s.sessionId,
              resume: { agents: convened.agents, analyses, retryAgent: agent },
            }),
            signal: controller.signal,
          });
          await consumeStream(controller, res);
        } catch (err) {
          if (controller.signal.aborted) return;
          const message =
            err instanceof Error && err.name !== "AbortError"
              ? err.message
              : "The connection to the Council was lost.";
          dispatch({ type: "STREAM_ERROR", message });
        } finally {
          if (activeRunRef.current?.runId === runId) {
            activeRunRef.current = null;
            abortRef.current = null;
            runningRef.current = false;
          }
        }
      })();
    },
    [consumeStream],
  );

  const restoreSession = useCallback((session: StoredSession) => {
    dispatch({ type: "RESTORE", session });
  }, []);

  const clearHistory = useCallback(() => {
    clearSessions();
    setPreviousSessions([]);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "CANCEL" });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    activeRunRef.current = null;
    runningRef.current = false;
    dispatch({ type: "RESET" });
  }, []);

  // Abort any in-flight request on unmount (Part 3: clean up listeners).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      activeRunRef.current = null;
      runningRef.current = false;
    };
  }, []);

  const lastVerdict = useMemo(
    () =>
      state.events.findLast((e): e is Extract<CouncilEvent, { type: "verdict" }> => e.type === "verdict"),
    [state.events],
  );

  return {
    phase: state.phase,
    error: state.error,
    question: state.question,
    mode: state.mode,
    events: state.events,
    sessionId: state.sessionId,
    classification: state.classification,
    history: state.history,
    lastVerdict,
    previousSessions,
    isActive: isSessionActive(state.phase),
    // V0.3
    thread,
    clarify,
    startQuestion,
    answerClarification,
    abandonClarify,
    sendFollowUp,
    startNewConversation,
    run,
    retryAgent,
    restoreSession,
    clearHistory,
    cancel,
    reset,
  };
}
