# Windrose Builtin Game Definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Windrose as the 9th builtin game definition, installable and runnable through GameVault's local Windows runner.

**Architecture:** Add a `windroseJson` config-file strategy (a dedicated JSON writer, mirroring the existing `enshroudedJson` strategy) for Windrose's `ServerDescription.json`, then add the `WINDROSE` entry to `BUILTIN_DEFINITIONS` and its JSON mirror consumed by the node seed script. SteamCMD install (app `4129620`), Windows-only (no Docker container variant).

**Tech Stack:** TypeScript, Vitest, Node `fs`, Prisma seed (plain CommonJS).

## Global Constraints

- Branch off `main`; do not commit to `main` (already on a worktree branch).
- Builtin definitions are the source of truth in `src/lib/definitions/builtins.ts`; the
  plain-node seed reads the hand-maintained mirror `src/lib/definitions/builtins.generated.json` — keep the two in sync.
- Windrose dedicated server is **Windows-only** — no `container` spec, no Linux binary.
- SteamCMD app id: `4129620`. Server executable: `WindroseServer.exe`. Config file:
  `ServerDescription.json` at the server install root. Ports: 7777 TCP + UDP.
  `recommendedRamGB`: 8. `requiredDiskGB`: 35.
- At runtime, `writeStrategyConfig` receives `installDir` already resolved to the
  per-server subdir (`.../windrose-server`), so the writer drops `ServerDescription.json`
  directly into `installDir`.

---

### Task 1: Add the `windroseJson` config strategy

**Files:**
- Modify: `src/lib/definitions/types.ts` (the `ConfigStrategy` union)
- Modify: `src/lib/definitions/strategies.ts` (new writer + dispatch + param type)
- Modify: `src/lib/runners/LocalWindowsRunner.ts:584` (widen strategy cast)
- Modify: `src/lib/runners/DockerRunner.ts:100` (widen strategy cast)
- Test: `src/lib/definitions/__tests__/strategies.test.ts` (new file)

**Interfaces:**
- Produces: `writeWindroseConfig(serverDir: string, serverName: string, password?: string): void`
  — writes `<serverDir>/ServerDescription.json` with `ServerName`, `Password`,
  `IsPasswordProtected` (boolean), `InviteCode` (≥6 uppercase alphanumeric chars).
- Produces: `ConfigStrategy` now includes the literal `"windroseJson"`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/definitions/__tests__/strategies.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { writeWindroseConfig } from "../strategies";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "windrose-"));
}

function readConfig(dir: string): any {
  return JSON.parse(fs.readFileSync(path.join(dir, "ServerDescription.json"), "utf-8"));
}

describe("writeWindroseConfig", () => {
  it("sets the password and marks the server password-protected when a password is given", () => {
    const dir = tmpDir();
    writeWindroseConfig(dir, "My Server", "secret");
    const cfg = readConfig(dir);
    expect(cfg.ServerName).toBe("My Server");
    expect(cfg.Password).toBe("secret");
    expect(cfg.IsPasswordProtected).toBe(true);
  });

  it("empties the password and clears the flag when no password is given", () => {
    const dir = tmpDir();
    writeWindroseConfig(dir, "My Server");
    const cfg = readConfig(dir);
    expect(cfg.Password).toBe("");
    expect(cfg.IsPasswordProtected).toBe(false);
  });

  it("derives a deterministic 6+ alphanumeric invite code from the name", () => {
    const dir = tmpDir();
    writeWindroseConfig(dir, "My Server!", "x");
    const cfg = readConfig(dir);
    expect(cfg.InviteCode).toMatch(/^[A-Z0-9]{6,}$/);
    // alnum("My Server!") = "MyServer" -> + "WINDROSE" -> upper -> slice(0,6)
    expect(cfg.InviteCode).toBe("MYSERV");
  });

  it("pads short names so the invite code is always >= 6 chars", () => {
    const dir = tmpDir();
    writeWindroseConfig(dir, "ab");
    const cfg = readConfig(dir);
    expect(cfg.InviteCode).toBe("ABWIND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/definitions/__tests__/strategies.test.ts`
Expected: FAIL — `writeWindroseConfig` is not exported from `../strategies`.

- [ ] **Step 3: Add the strategy literal to the type union**

In `src/lib/definitions/types.ts`, change line 4 from:

```ts
export type ConfigStrategy = "template" | "enshroudedJson" | "zomboidIniMerge";
```

to:

```ts
export type ConfigStrategy = "template" | "enshroudedJson" | "zomboidIniMerge" | "windroseJson";
```

- [ ] **Step 4: Add the writer and wire it into the dispatch**

In `src/lib/definitions/strategies.ts`, add the writer above `writeStrategyConfig`:

```ts
// Builds a deterministic Windrose invite code: >= 6 uppercase alphanumeric chars,
// derived from the server name (padded with "WINDROSE" so short names still qualify).
function makeWindroseInviteCode(serverName: string): string {
  const cleaned = serverName.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned + "WINDROSE").toUpperCase().slice(0, 6);
}

// Writes the Windrose ServerDescription.json at the server install root.
// Windrose joins are driven by InviteCode (always set); Password is an optional gate.
export function writeWindroseConfig(serverDir: string, serverName: string, password?: string) {
  const config = {
    ServerName: serverName,
    Password: password || "",
    IsPasswordProtected: !!password,
    InviteCode: makeWindroseInviteCode(serverName),
  };
  fs.writeFileSync(path.join(serverDir, "ServerDescription.json"), JSON.stringify(config, null, 2));
}
```

Then update `writeStrategyConfig` (currently at lines 70–78) to accept and dispatch the
new strategy:

```ts
export function writeStrategyConfig(args: {
  strategy: "enshroudedJson" | "zomboidIniMerge" | "windroseJson";
  installDir: string;       // the server's install subdir (e.g. .../enshrouded-server)
  serverName: string;
  password?: string;
}) {
  if (args.strategy === "enshroudedJson") writeEnshroudedConfig(args.installDir, args.serverName, args.password);
  else if (args.strategy === "zomboidIniMerge") writeZomboidConfig(args.installDir, args.password);
  else if (args.strategy === "windroseJson") writeWindroseConfig(args.installDir, args.serverName, args.password);
}
```

- [ ] **Step 5: Widen the strategy casts in both runners**

In `src/lib/runners/LocalWindowsRunner.ts:584`, change:

```ts
        strategy: cf.strategy as "enshroudedJson" | "zomboidIniMerge",
```

to:

```ts
        strategy: cf.strategy as "enshroudedJson" | "zomboidIniMerge" | "windroseJson",
```

In `src/lib/runners/DockerRunner.ts:100`, make the identical change to the same line.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/definitions/__tests__/strategies.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Typecheck the touched runner/strategy code**

Run: `npx tsc --noEmit`
Expected: no errors (the widened casts and new union member typecheck).

- [ ] **Step 8: Commit**

```bash
git add src/lib/definitions/types.ts src/lib/definitions/strategies.ts \
  src/lib/runners/LocalWindowsRunner.ts src/lib/runners/DockerRunner.ts \
  src/lib/definitions/__tests__/strategies.test.ts
git commit -m "feat(definitions): add windroseJson config strategy"
```

---

### Task 2: Add the WINDROSE builtin definition

**Files:**
- Modify: `src/lib/definitions/builtins.ts` (append the `WINDROSE` entry to `BUILTIN_DEFINITIONS`)
- Test: `src/lib/definitions/__tests__/builtins.test.ts:6-10` (bump count, add slug)
- Test: `src/lib/definitions/__tests__/parity.test.ts` (new Windrose parity case)

**Interfaces:**
- Consumes: `ConfigStrategy` literal `"windroseJson"` from Task 1.
- Produces: `BUILTIN_DEFINITIONS` entry with `slug: "WINDROSE"`, install app `4129620`,
  launch executable `WindroseServer.exe`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/definitions/__tests__/builtins.test.ts`, update the first test (lines 6–10) to:

```ts
  it("has all 9 games", () => {
    expect(BUILTIN_DEFINITIONS.map((d) => d.slug).sort()).toEqual(
      ["ARK", "ENSHROUDED", "MINECRAFT", "PALWORLD", "RUST", "TERRARIA", "VALHEIM", "WINDROSE", "ZOMBOID"]
    );
  });
```

In `src/lib/definitions/__tests__/parity.test.ts`, add this block after the
`describe("parity: install targets", ...)` block:

```ts
describe("parity: Windrose", () => {
  it("steam install target and launch executable", () => {
    expect(planInstall(def("WINDROSE").spec, "STEAMCMD")).toMatchObject({
      appId: "4129620", checkFile: "WindroseServer.exe", requiredDiskGB: 35,
    });
    const c = ctxFor("WINDROSE", { name: "Sea Dogs", password: null, ram: 8 });
    const p = planLaunch(def("WINDROSE").spec, c);
    expect(p.executable).toBe("WindroseServer.exe");
    expect(p.args).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/definitions/__tests__/builtins.test.ts src/lib/definitions/__tests__/parity.test.ts`
Expected: FAIL — count test expects 9 but finds 8; `def("WINDROSE")` returns `undefined`.

- [ ] **Step 3: Add the WINDROSE definition**

In `src/lib/definitions/builtins.ts`, insert this object as the last element of the
`BUILTIN_DEFINITIONS` array (after the `RUST` entry, before the closing `];`):

```ts
  {
    slug: "WINDROSE", displayName: "Windrose", icon: "🧭",
    color: "from-teal-500 to-cyan-700 bg-teal-500/10 border-teal-500/30 text-teal-400",
    description: "Co-op seafaring adventure", recommendedRamGB: 8.0,
    installMethod: "STEAMCMD",
    spec: {
      install: { appId: "4129620", installSubDir: "windrose-server", checkFile: "WindroseServer.exe", requiredDiskGB: 35.0 },
      launch: { executable: "WindroseServer.exe", cwdSubDir: "windrose-server", args: [] },
      defaultPort: 7777, params: [],
      configFiles: [{ path: "ServerDescription.json", strategy: "windroseJson" }],
      editableConfigPath: "windrose-server/ServerDescription.json",
      ports: [{ protocol: "TCP", port: "7777" }, { protocol: "UDP", port: "7777" }],
    },
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/definitions/__tests__/builtins.test.ts src/lib/definitions/__tests__/parity.test.ts`
Expected: PASS. The `every builtin spec validates` test also passes (Windrose spec is valid).

- [ ] **Step 5: Commit**

```bash
git add src/lib/definitions/builtins.ts \
  src/lib/definitions/__tests__/builtins.test.ts \
  src/lib/definitions/__tests__/parity.test.ts
git commit -m "feat(definitions): add Windrose builtin game definition"
```

---

### Task 3: Add WINDROSE to the seed JSON mirror

**Files:**
- Modify: `src/lib/definitions/builtins.generated.json` (append the WINDROSE object)

**Interfaces:**
- Consumes: the same field values as the `BUILTIN_DEFINITIONS` WINDROSE entry from Task 2.
- Produces: a JSON array element the node `prisma/seed.js` reads to seed the DB.

- [ ] **Step 1: Append the WINDROSE object to the JSON mirror**

In `src/lib/definitions/builtins.generated.json`, add this object as the last element of
the top-level array (after the `RUST` object, before the closing `]`). Add a comma after
the preceding object's closing brace:

```json
  {
    "slug": "WINDROSE",
    "displayName": "Windrose",
    "icon": "🧭",
    "color": "from-teal-500 to-cyan-700 bg-teal-500/10 border-teal-500/30 text-teal-400",
    "description": "Co-op seafaring adventure",
    "recommendedRamGB": 8,
    "installMethod": "STEAMCMD",
    "spec": {
      "install": { "appId": "4129620", "installSubDir": "windrose-server", "checkFile": "WindroseServer.exe", "requiredDiskGB": 35 },
      "launch": { "executable": "WindroseServer.exe", "cwdSubDir": "windrose-server", "args": [] },
      "defaultPort": 7777,
      "params": [],
      "configFiles": [{ "path": "ServerDescription.json", "strategy": "windroseJson" }],
      "editableConfigPath": "windrose-server/ServerDescription.json",
      "ports": [{ "protocol": "TCP", "port": "7777" }, { "protocol": "UDP", "port": "7777" }]
    }
  }
```

- [ ] **Step 2: Verify the JSON parses and contains WINDROSE**

Run: `node -e "const b=require('./src/lib/definitions/builtins.generated.json'); const w=b.find(x=>x.slug==='WINDROSE'); if(!w) throw new Error('WINDROSE missing'); console.log('ok', w.spec.install.appId, b.length, 'defs');"`
Expected: prints `ok 4129620 9 defs`.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/definitions/builtins.generated.json
git commit -m "feat(definitions): seed Windrose builtin in generated mirror"
```

---

## Self-Review

**Spec coverage:**
- Definition entry (slug/icon/color/RAM/install/launch/ports/config) → Task 2 + Task 3. ✓
- `windroseJson` strategy (types, writer, dispatch, runner casts) → Task 1. ✓
- Seed mirror update → Task 3. ✓
- Tests (builtins count + slug, parity, strategy writer) → Tasks 1 & 2. ✓
- No container / no passwordPolicy → reflected in the Task 2 spec object. ✓

**Type consistency:**
- `writeWindroseConfig(serverDir, serverName, password?)` — same signature in Task 1's
  interface block, the writer, the dispatch call, and the test. ✓
- `ConfigStrategy` literal `"windroseJson"` defined in Task 1, consumed by Task 2's
  `configFiles` entry. ✓
- Invite code expectation `"MYSERV"` matches the `makeWindroseInviteCode` algorithm. ✓

**Placeholder scan:** none — every step has concrete code/commands and expected output.
