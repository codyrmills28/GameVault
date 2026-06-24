# Live Server Console / Log Tailing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream a local game server's live log output to the dashboard console via Server-Sent Events, with auto-scroll, pause, and search.

**Architecture:** A pure file-tailing engine (`logTailer.ts`) reads new bytes appended to the existing `server.log` and yields complete lines. A Next.js App Router SSE route wraps that engine in a `text/event-stream` response. The console modal in `DashboardView.tsx` consumes the stream with an `EventSource`, replacing the current 2-second polling.

**Tech Stack:** Next.js 14 (App Router, route handlers), React 18 (client components), Node `fs`, Server-Sent Events, Vitest, TypeScript, Tailwind, lucide-react icons.

## Global Constraints

- Tests run with **Vitest** (`npm test` → `vitest run`); test files match `src/**/*.test.ts`, conventionally under a `__tests__/` sibling directory. Path alias `@` → `src`.
- Test environment is **node** (no DOM). Only the pure modules (`sse.ts`, `logTailer.ts`) get unit tests; the React modal and HTTP route are verified by typecheck + manual run.
- Log file path is `dataRoot()/local-servers/<serverId>/server.log` — resolve it via the existing `dataRoot()` from `@/lib/appPaths`. Never hardcode a root.
- Git commits must use author email `jimmymills@users.noreply.github.com` (already configured in this worktree). Prefix git/test commands with `rtk` per repo convention.
- Do **not** modify the existing `GET /api/servers/[id]/logs/route.ts` — it stays as a fallback.
- Scope is logs only. No command input / RCON / stdin.

---

### Task 1: SSE framing helper

A pure function that formats a string payload into a Server-Sent Events frame. Isolated so the route logic stays trivial and the framing is unit-tested.

**Files:**
- Create: `src/lib/sse.ts`
- Test: `src/lib/__tests__/sse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `formatSseEvent(data: string, opts?: { event?: string }): string` — frames `data` as one SSE event. Each `\n` in `data` becomes a separate `data:` line; an optional `event:` line is prepended; the frame ends with a blank line.
  - `SSE_HEARTBEAT: string` — a comment-only keep-alive frame (`": ping\n\n"`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/sse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatSseEvent, SSE_HEARTBEAT } from "../sse";

describe("formatSseEvent", () => {
  it("frames a single line with a terminating blank line", () => {
    expect(formatSseEvent("hello")).toBe("data: hello\n\n");
  });
  it("frames each newline-separated line as its own data field", () => {
    expect(formatSseEvent("a\nb")).toBe("data: a\ndata: b\n\n");
  });
  it("prepends an event field when given", () => {
    expect(formatSseEvent("oops", { event: "error" })).toBe(
      "event: error\ndata: oops\n\n"
    );
  });
  it("frames an empty payload as a single empty data field", () => {
    expect(formatSseEvent("")).toBe("data: \n\n");
  });
});

describe("SSE_HEARTBEAT", () => {
  it("is an SSE comment frame", () => {
    expect(SSE_HEARTBEAT).toBe(": ping\n\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk npx vitest run src/lib/__tests__/sse.test.ts`
Expected: FAIL — cannot find module `../sse`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/sse.ts`:

```ts
/**
 * Format a payload as a single Server-Sent Events frame.
 * Each newline in `data` becomes its own `data:` field; the browser's
 * EventSource rejoins them with "\n" in event.data.
 */
export function formatSseEvent(data: string, opts?: { event?: string }): string {
  let out = "";
  if (opts?.event) out += `event: ${opts.event}\n`;
  for (const line of data.split("\n")) {
    out += `data: ${line}\n`;
  }
  return out + "\n";
}

/** Comment-only frame sent periodically to keep the connection alive. */
export const SSE_HEARTBEAT = ": ping\n\n";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk npx vitest run src/lib/__tests__/sse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/sse.ts src/lib/__tests__/sse.test.ts
rtk git commit -m "feat: add SSE event framing helper (#6)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Log-tailing engine

A poll-based file tailer. It yields an initial snapshot of the last N lines, then yields arrays of newly-appended complete lines as the file grows. Poll-based (not `fs.watch`) for Windows reliability and deterministic tests.

**Files:**
- Create: `src/lib/logTailer.ts`
- Test: `src/lib/__tests__/logTailer.test.ts`

**Interfaces:**
- Consumes: `dataRoot()` from `@/lib/appPaths`.
- Produces:
  - `serverLogPath(serverId: string): string` — resolves `dataRoot()/local-servers/<serverId>/server.log`.
  - `tailFile(filePath: string, opts: TailOptions): AsyncGenerator<string[]>` — core engine; first yield is the snapshot (array of last `tailLines` lines, or a single placeholder line if the file is missing), subsequent yields are arrays of newly-appended complete lines.
  - `streamServerLog(serverId: string, opts: TailOptions): AsyncGenerator<string[]>` — `tailFile(serverLogPath(serverId), opts)`.
  - `interface TailOptions { signal: AbortSignal; tailLines?: number; pollIntervalMs?: number }` (defaults: `tailLines` 200, `pollIntervalMs` 500).
  - `LOG_PLACEHOLDER: string` — the "no logs yet" placeholder text.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/logTailer.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { tailFile, LOG_PLACEHOLDER } from "../logTailer";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tailer-"));
  file = path.join(dir, "server.log");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const FAST = { tailLines: 200, pollIntervalMs: 10 };

it("snapshot returns the last N lines of an existing file", async () => {
  const lines = Array.from({ length: 250 }, (_, i) => `line ${i}`);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  const ac = new AbortController();
  const gen = tailFile(file, { signal: ac.signal, ...FAST });
  const snap = await gen.next();
  expect(snap.value).toHaveLength(200);
  expect(snap.value[0]).toBe("line 50");
  expect(snap.value[199]).toBe("line 249");
  ac.abort();
});

it("yields newly appended lines incrementally", async () => {
  fs.writeFileSync(file, "first\n");
  const ac = new AbortController();
  const gen = tailFile(file, { signal: ac.signal, ...FAST });
  expect((await gen.next()).value).toEqual(["first"]);
  fs.appendFileSync(file, "second\nthird\n");
  expect((await gen.next()).value).toEqual(["second", "third"]);
  ac.abort();
});

it("buffers a line split across two appends and yields it whole", async () => {
  fs.writeFileSync(file, "x\n");
  const ac = new AbortController();
  const gen = tailFile(file, { signal: ac.signal, ...FAST });
  await gen.next(); // snapshot
  fs.appendFileSync(file, "par");
  fs.appendFileSync(file, "tial\n");
  expect((await gen.next()).value).toEqual(["partial"]);
  ac.abort();
});

it("resets and re-snapshots when the file is truncated", async () => {
  fs.writeFileSync(file, "aaaa\nbbbb\n");
  const ac = new AbortController();
  const gen = tailFile(file, { signal: ac.signal, ...FAST });
  await gen.next(); // ["aaaa","bbbb"]
  fs.writeFileSync(file, "c\n"); // smaller than previous offset
  expect((await gen.next()).value).toEqual(["c"]);
  ac.abort();
});

it("yields a placeholder for a missing file, then picks up content", async () => {
  const missing = path.join(dir, "later.log");
  const ac = new AbortController();
  const gen = tailFile(missing, { signal: ac.signal, ...FAST });
  expect((await gen.next()).value).toEqual([LOG_PLACEHOLDER]);
  fs.writeFileSync(missing, "hello\n");
  expect((await gen.next()).value).toEqual(["hello"]);
  ac.abort();
});

it("stops iterating once the signal is aborted", async () => {
  fs.writeFileSync(file, "x\n");
  const ac = new AbortController();
  const gen = tailFile(file, { signal: ac.signal, ...FAST });
  await gen.next(); // snapshot
  ac.abort();
  expect((await gen.next()).done).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk npx vitest run src/lib/__tests__/logTailer.test.ts`
Expected: FAIL — cannot find module `../logTailer`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/logTailer.ts`:

```ts
import fs from "fs";
import path from "path";
import { dataRoot } from "./appPaths";

export const LOG_PLACEHOLDER = "No logs yet. Waiting for server output…";

export interface TailOptions {
  signal: AbortSignal;
  tailLines?: number;
  pollIntervalMs?: number;
}

export function serverLogPath(serverId: string): string {
  return path.join(dataRoot(), "local-servers", serverId, "server.log");
}

function statSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function readRange(filePath: string, start: number, end: number): string {
  const length = end - start;
  if (length <= 0) return "";
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buf, 0, length, start);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Tail a file: yield the last `tailLines` lines as a snapshot, then yield
 * arrays of newly-appended complete lines. Poll-based for Windows reliability.
 */
export async function* tailFile(
  filePath: string,
  opts: TailOptions
): AsyncGenerator<string[]> {
  const tailLines = opts.tailLines ?? 200;
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const { signal } = opts;

  let offset = 0;
  let leftover = "";

  // Initial snapshot
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    yield lines.slice(-tailLines);
    offset = Buffer.byteLength(content, "utf8");
  } else {
    yield [LOG_PLACEHOLDER];
    offset = 0;
  }

  // Tail loop
  while (!signal.aborted) {
    await delay(pollIntervalMs, signal);
    if (signal.aborted) break;

    const size = statSize(filePath);
    if (size < offset) {
      // truncated / rotated — start over
      offset = 0;
      leftover = "";
    }
    if (size > offset) {
      const chunk = readRange(filePath, offset, size);
      offset = size;
      const text = leftover + chunk;
      const parts = text.split("\n");
      leftover = parts.pop() ?? "";
      if (parts.length > 0) yield parts;
    }
  }
}

export function streamServerLog(
  serverId: string,
  opts: TailOptions
): AsyncGenerator<string[]> {
  return tailFile(serverLogPath(serverId), opts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk npx vitest run src/lib/__tests__/logTailer.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/logTailer.ts src/lib/__tests__/logTailer.test.ts
rtk git commit -m "feat: add poll-based log-tailing engine (#6)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: SSE streaming route

A new App Router route that streams a server's log tail as `text/event-stream`. Reuses the existing auth/access guard. No unit test (HTTP streaming) — verified by typecheck and manual run; the framing and tailing logic it depends on are already tested in Tasks 1–2.

**Files:**
- Create: `src/app/api/servers/[id]/logs/stream/route.ts`

**Interfaces:**
- Consumes: `formatSseEvent`, `SSE_HEARTBEAT` (Task 1); `streamServerLog` (Task 2); `getAuthenticatedUser` from `@/lib/auth`; `verifyServerAccess` from `@/lib/serverAuth`.
- Produces: `GET` handler returning a streamed `Response`. The wire format is SSE messages whose `data` is newline-joined log lines; the UI (Task 4) splits `event.data` on `\n`.

- [ ] **Step 1: Write the route**

Create `src/app/api/servers/[id]/logs/stream/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { verifyServerAccess } from "@/lib/serverAuth";
import { streamServerLog } from "@/lib/logTailer";
import { formatSseEvent, SSE_HEARTBEAT } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = await verifyServerAccess(params.id, user.id);
  if (!access) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }
  const { server } = access;

  const encoder = new TextEncoder();
  const ac = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval>;

      const send = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          /* controller already closed */
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        ac.abort();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Client disconnect (modal closed / navigated away)
      req.signal.addEventListener("abort", close);

      heartbeat = setInterval(() => send(SSE_HEARTBEAT), 15000);

      if (server.runnerType === "LOCAL") {
        (async () => {
          try {
            for await (const lines of streamServerLog(server.id, {
              signal: ac.signal,
            })) {
              if (ac.signal.aborted) break;
              send(formatSseEvent(lines.join("\n")));
            }
          } catch (err: any) {
            send(
              formatSseEvent(`Log stream error: ${err?.message ?? "unknown"}`, {
                event: "error",
              })
            );
          } finally {
            close();
          }
        })();
      } else {
        // Cloud runner has no local process; send a one-time notice and keep
        // the connection alive via heartbeats until the client disconnects.
        const note =
          server.status === "RUNNING"
            ? `Cloud runner '${server.name}' is running. Live console is available for local servers only.`
            : "Server is offline. Press Start to boot the server instance.";
        send(formatSseEvent(note));
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `rtk npx tsc --noEmit`
Expected: PASS — no type errors. (If `verifyServerAccess`'s return shape differs, open `src/lib/serverAuth.ts` and match the actual `{ server }` destructuring used in `src/app/api/servers/[id]/logs/route.ts:24`.)

- [ ] **Step 3: Commit**

```bash
rtk git add src/app/api/servers/[id]/logs/stream/route.ts
rtk git commit -m "feat: add SSE log streaming route (#6)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Console modal — live SSE consumer

Replace the 2-second polling in the console modal with an `EventSource`, and add auto-scroll, pause-while-buffering, and search. All edits are in `src/components/DashboardView.tsx`.

**Files:**
- Modify: `src/components/DashboardView.tsx` (imports ~3 and ~6-33; state ~57-58; effect/handler ~93-116; modal JSX ~981-999)

**Interfaces:**
- Consumes: the SSE route from Task 3 (`GET /api/servers/[id]/logs/stream`).
- Produces: no exported symbols; internal component behavior only.

- [ ] **Step 1: Add `useRef` to the React import**

In `src/components/DashboardView.tsx`, replace line 3:

```tsx
import React, { useState, useEffect } from "react";
```

with:

```tsx
import React, { useState, useEffect, useRef } from "react";
```

- [ ] **Step 2: Add the `Pause` and `Search` icons**

In the lucide-react import block (lines ~6-33), replace the line:

```tsx
  Terminal,
```

with:

```tsx
  Terminal,
  Pause,
  Search,
```

(`Play` is already imported and is reused for the Resume state.)

- [ ] **Step 3: Replace the console state**

Replace line 58:

```tsx
  const [consoleLogs, setConsoleLogs] = useState("");
```

with:

```tsx
  // Live console (SSE) state
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [consolePaused, setConsolePaused] = useState(false);
  const [consoleSearch, setConsoleSearch] = useState("");
  const [consoleConn, setConsoleConn] = useState<"connecting" | "live">("connecting");
  const [pendingCount, setPendingCount] = useState(0);
  const consolePausedRef = useRef(false);
  const pendingLinesRef = useRef<string[]>([]);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  const MAX_CONSOLE_LINES = 5000;
  const capLines = (lines: string[]) =>
    lines.length > MAX_CONSOLE_LINES ? lines.slice(-MAX_CONSOLE_LINES) : lines;
```

- [ ] **Step 4: Replace the log-fetch helper and polling effect with the EventSource wiring**

Replace lines 93-116 (the `fetchLogsDirect` function and the "Live polling for the active console modal" effect, i.e. everything from `const fetchLogsDirect = async () => {` through the `}, [activeConsoleServer]);` that closes that polling effect):

```tsx
  // Keep the paused flag readable inside the EventSource handler closure
  useEffect(() => {
    consolePausedRef.current = consolePaused;
  }, [consolePaused]);

  // Live log stream for the active console modal (SSE)
  useEffect(() => {
    if (!activeConsoleServer) {
      setConsoleLines([]);
      pendingLinesRef.current = [];
      setPendingCount(0);
      setConsolePaused(false);
      setConsoleSearch("");
      return;
    }

    setConsoleConn("connecting");
    setConsoleLines([]);
    pendingLinesRef.current = [];
    setPendingCount(0);
    autoScrollRef.current = true;

    const es = new EventSource(`/api/servers/${activeConsoleServer.id}/logs/stream`);
    es.onopen = () => setConsoleConn("live");
    es.onerror = () => setConsoleConn("connecting"); // EventSource auto-reconnects
    es.onmessage = (e) => {
      const incoming = e.data.split("\n");
      if (consolePausedRef.current) {
        pendingLinesRef.current = capLines([...pendingLinesRef.current, ...incoming]);
        setPendingCount(pendingLinesRef.current.length);
      } else {
        setConsoleLines((prev) => capLines([...prev, ...incoming]));
      }
    };

    return () => es.close();
  }, [activeConsoleServer]);

  // Auto-scroll to the bottom on new lines unless the user scrolled up
  useEffect(() => {
    if (autoScrollRef.current && logContainerRef.current) {
      const el = logContainerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [consoleLines]);

  const handleConsoleScroll = () => {
    const el = logContainerRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const toggleConsolePause = () => {
    setConsolePaused((prev) => {
      const next = !prev;
      if (!next) {
        // Resuming: flush buffered lines and jump to bottom
        setConsoleLines((cur) => capLines([...cur, ...pendingLinesRef.current]));
        pendingLinesRef.current = [];
        setPendingCount(0);
        autoScrollRef.current = true;
        requestAnimationFrame(() => {
          if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
          }
        });
      }
      return next;
    });
  };
```

- [ ] **Step 5: Replace the modal body (toolbar + log area + footer)**

Replace lines 981-999 (the `{/* Log Terminal Screen */}` block through the end of the `{/* Modal Footer */}` block, i.e. up to and including the closing `</div>` of the footer that precedes the blank line before `</div>` at ~1001):

```tsx
            {/* Console Toolbar */}
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-mutedText absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={consoleSearch}
                  onChange={(e) => setConsoleSearch(e.target.value)}
                  placeholder="Filter logs…"
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-black/40 border border-white/10 focus:border-accentPurple/40 outline-none text-xs text-slate-200 placeholder:text-mutedText"
                />
              </div>
              <button
                onClick={toggleConsolePause}
                className="px-3 py-2 rounded-lg bg-slate-900 border border-white/10 hover:border-white/20 text-xs font-bold text-slate-300 transition-colors flex items-center gap-1.5"
              >
                {consolePaused ? (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Resume
                    {pendingCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accentPurple/30 text-[10px] text-white">
                        {pendingCount}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    Pause
                  </>
                )}
              </button>
            </div>

            {/* Log Terminal Screen */}
            <div
              ref={logContainerRef}
              onScroll={handleConsoleScroll}
              className="flex-1 bg-black/90 border border-white/5 rounded-xl p-4 font-mono text-[11px] text-emerald-400 overflow-y-auto whitespace-pre-wrap select-text selection:bg-emerald-500/20 scrollbar-thin"
            >
              {(() => {
                const visible = consoleSearch
                  ? consoleLines.filter((l) =>
                      l.toLowerCase().includes(consoleSearch.toLowerCase())
                    )
                  : consoleLines;
                if (visible.length === 0) {
                  return consoleSearch
                    ? "No lines match the filter."
                    : "Initializing console stream…";
                }
                return visible.join("\n");
              })()}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-white/5">
              <span className="text-[10px] text-mutedText flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    consoleConn === "live"
                      ? "bg-emerald-400 animate-ping"
                      : "bg-amber-400 animate-pulse"
                  }`}
                ></span>
                {consoleConn === "live"
                  ? consolePaused
                    ? "Live stream paused"
                    : "Live stream connected (SSE)"
                  : "Connecting…"}
              </span>
              <span className="text-[10px] text-mutedText">
                {consoleLines.length} lines
              </span>
            </div>
```

- [ ] **Step 6: Typecheck and lint**

Run: `rtk npx tsc --noEmit`
Expected: PASS — no type errors.

Run: `rtk npm run lint`
Expected: PASS (or no new errors introduced by these files).

- [ ] **Step 7: Manual verification**

Run the app and confirm the live console works end-to-end:

```bash
rtk npm run electron:dev
```

Then: start a local server, open its console (Terminal icon), and verify:
- Footer shows "Live stream connected (SSE)" and lines appear without the old 2s lag.
- New output appended by the server scrolls into view automatically.
- Scrolling up stops auto-scroll; scrolling back to the bottom resumes it.
- Clicking **Pause** freezes the view and the badge counts buffered lines; **Resume** flushes them and jumps to the bottom.
- Typing in the filter box narrows the visible lines.

- [ ] **Step 8: Commit**

```bash
rtk git add src/components/DashboardView.tsx
rtk git commit -m "feat: live SSE console with auto-scroll, pause, and search (#6)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Capture & stream stdout/stderr → Tasks 2 (tailer over `server.log`, which already receives piped child output + runner messages) + 3 (SSE route). ✓
- Live-tail view (auto-scroll, pause, search) → Task 4. ✓
- Built on real-time push channel (SSE) → Tasks 1+3. ✓
- File-tailing source decision → Task 2. ✓
- Pause = freeze-view-while-buffering with badge → Task 4 Step 4/5. ✓
- TDD unit tests for tailer + SSE framing helper → Tasks 1 & 2. ✓
- Existing `GET /logs` untouched → respected (not in any task's file list). ✓
- Command input out of scope → no task. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code step has complete code. ✓

**Type consistency:** `formatSseEvent`/`SSE_HEARTBEAT` (Task 1) used verbatim in Task 3. `streamServerLog`/`TailOptions`/`LOG_PLACEHOLDER` (Task 2) used in Task 3 and the Task 2 test. `tailFile` signature consistent between impl and test. UI refs (`consolePausedRef`, `pendingLinesRef`, `logContainerRef`, `autoScrollRef`, `capLines`) defined in Step 3 and used in Steps 4-5. ✓

**Note on a deliberate spec deviation:** the design mentioned `fs.watch` + stat-poll; the plan implements **poll-only** (default 500ms) for Windows reliability and deterministic tests. This is a strict simplification that still satisfies "live tail" and is called out here for the reviewer.
