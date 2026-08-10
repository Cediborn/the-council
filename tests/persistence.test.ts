import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSessions, loadSessions, saveSession, type StoredSession } from "@/lib/client/persistence";

/**
 * A minimal Storage shim so persistence is testable in Node.
 */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

const storage = makeStorage();

function session(id: string, question = "Q?"): StoredSession {
  return {
    version: 1,
    sessionId: id,
    question,
    mode: "FULL",
    startedAt: 123,
    status: "complete",
    events: [],
  };
}

describe("persistence (Part 11 / TEST 6)", () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("window", { localStorage: storage });
  });

  it("saves and reloads a session", () => {
    saveSession(session("a"));
    const loaded = loadSessions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].sessionId).toBe("a");
  });

  it("dedupes by sessionId — a re-saved session replaces the old record", () => {
    saveSession(session("a", "first"));
    saveSession(session("b"));
    saveSession(session("a", "updated"));
    const loaded = loadSessions();
    expect(loaded).toHaveLength(2);
    expect(loaded.find((s) => s.sessionId === "a")?.question).toBe("updated");
  });

  it("caps the session count (newest first)", () => {
    for (let i = 0; i < 15; i++) saveSession(session(`s-${i}`));
    const loaded = loadSessions();
    expect(loaded.length).toBeLessThanOrEqual(10);
    expect(loaded[0].sessionId).toBe("s-14"); // newest first
  });

  it("caps total size", () => {
    const big = session("big", "x".repeat(300_000));
    for (let i = 0; i < 8; i++) saveSession(session(`s-${i}`));
    saveSession(big);
    const loaded = loadSessions();
    expect(JSON.stringify(loaded).length).toBeLessThanOrEqual(500_000);
  });

  it("ignores stale/unknown records (versioned key)", () => {
    storage.setItem("council.sessions.v1", JSON.stringify([{ version: 99, sessionId: "x" }]));
    expect(loadSessions()).toEqual([]);
    storage.setItem("council.sessions.v1", "not json");
    expect(loadSessions()).toEqual([]);
  });

  it("clears all sessions", () => {
    saveSession(session("a"));
    clearSessions();
    expect(loadSessions()).toEqual([]);
  });

  it("returns [] when storage is unavailable", () => {
    vi.stubGlobal("window", undefined);
    expect(loadSessions()).toEqual([]);
    expect(() => saveSession(session("a"))).not.toThrow();
  });
});
