# Global Player Management (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a centralized Players system to RealmSwap with a player database, global bans, and global whitelists that are really enforced into each game server's config files and live console.

**Architecture:** Five new Prisma models (`Player`, `PlayerBan`, `PlayerWhitelist`, `PlayerEnforcement`, `PlayerEvent`) owned per-`User`. A declarative `playerList` block on `GameDefinitionSpec` describes each game's ban/whitelist file format and console commands. A pure planner (`planEnforcement`) decides what file content / command to produce; a thin I/O shell (`applyToServer`) writes the file in the server install dir and, if the process is running, sends the live command, recording the outcome in `PlayerEnforcement`. Next.js route handlers expose CRUD + ban/whitelist/bulk; a `dashboard/players` page renders a master/detail `PlayersView`.

**Tech Stack:** Next.js 14 (app router), Prisma + SQLite, React 18, TailwindCSS, lucide-react, Vitest. Electron desktop shell (unaffected). RTK wrappers for tooling (`rtk vitest run`, `rtk git ...`).

## Global Constraints

- Prisma client is generated to `src/generated/client`; after any `schema.prisma` change run `npm run db:push` (which runs `prisma generate` via the configured output) — never hand-edit generated files.
- All player-owned rows are scoped by `ownerId` (the authenticated `User.id`); every API route MUST call `getAuthenticatedUser()` and filter by owner. No cross-owner reads or writes.
- Commits use the GitHub noreply email: author `jimmymills <jimmymills@users.noreply.github.com>`. End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run tests with `rtk vitest run`. Work happens on the current worktree branch `claude/wonderful-lumiere-2803ed`.
- Enforcement errors are NON-FATAL: intent rows (`PlayerBan`/`PlayerWhitelist`) always persist even if applying to a server throws; the failure is recorded in `PlayerEnforcement.status = "FAILED"`.
- Source of truth for game definitions is `src/lib/definitions/builtins.ts` (the `.generated.json` file is unused — do not edit it).
- A game/action with no mapping, or `whitelist.enforced === false`, yields `PlayerEnforcement.status = "UNSUPPORTED"` and writes NO file.

---

### Task 1: Prisma models

**Files:**
- Modify: `prisma/schema.prisma` (add 5 models + `User.players` back-relation)

**Interfaces:**
- Produces: Prisma models `Player`, `PlayerBan`, `PlayerWhitelist`, `PlayerEnforcement`, `PlayerEvent` accessible as `prisma.player`, `prisma.playerBan`, `prisma.playerWhitelist`, `prisma.playerEnforcement`, `prisma.playerEvent`.

- [ ] **Step 1: Add the back-relation to `User`**

In `prisma/schema.prisma`, inside `model User { ... }`, add this line alongside the other relations (e.g. after `templateVotes      TemplateVote[]`):

```prisma
  players            Player[]
```

- [ ] **Step 2: Append the five new models**

Add to the end of `prisma/schema.prisma`:

```prisma
model Player {
  id            String   @id @default(cuid())
  ownerId       String
  owner         User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  displayName   String
  steamId       String?
  xboxId        String?
  minecraftUuid String?
  minecraftName String?
  discordId     String?
  notes         String?
  status        String   @default("NEUTRAL") // NEUTRAL | TRUSTED | BANNED
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  bans          PlayerBan[]
  whitelists    PlayerWhitelist[]
  events        PlayerEvent[]

  @@index([ownerId])
}

model PlayerBan {
  id        String    @id @default(cuid())
  playerId  String
  player    Player    @relation(fields: [playerId], references: [id], onDelete: Cascade)
  reason    String
  expiresAt DateTime?
  active    Boolean   @default(true)
  createdAt DateTime  @default(now())

  @@index([playerId])
}

model PlayerWhitelist {
  id        String   @id @default(cuid())
  playerId  String
  player    Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  serverId  String
  createdAt DateTime @default(now())

  @@unique([playerId, serverId])
}

model PlayerEnforcement {
  id        String   @id @default(cuid())
  playerId  String
  serverId  String
  type      String   // "BAN" | "WHITELIST"
  status    String   // "APPLIED" | "PENDING" | "UNSUPPORTED" | "FAILED"
  detail    String?
  appliedAt DateTime @default(now())

  @@unique([playerId, serverId, type])
}

model PlayerEvent {
  id        String   @id @default(cuid())
  playerId  String
  player    Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  actorId   String
  action    String   // PLAYER_CREATED | BANNED | UNBANNED | WHITELISTED | WHITELIST_REVOKED | EDITED
  detail    String
  createdAt DateTime @default(now())

  @@index([playerId])
}
```

- [ ] **Step 3: Push schema and regenerate the client**

Run: `rtk npm run db:push`
Expected: completes with "Your database is now in sync with your Prisma schema" and "Generated Prisma Client".

- [ ] **Step 4: Verify the client typechecks the new models**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `prisma.player*` (pre-existing unrelated errors, if any, are out of scope — note them but do not fix here).

- [ ] **Step 5: Commit**

```bash
rtk git add prisma/schema.prisma src/generated
git -c user.email="jimmymills@users.noreply.github.com" -c user.name="jimmymills" commit -m "feat(players): add Player/Ban/Whitelist/Enforcement/Event prisma models

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: PlayerListSpec types + pure formatters

**Files:**
- Modify: `src/lib/definitions/types.ts` (add `PlayerListSpec` and supporting types)
- Create: `src/lib/players/listFormat.ts`
- Test: `src/lib/players/__tests__/listFormat.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - Types `PlayerIdentityKey = "minecraftName" | "minecraftUuid" | "steamId" | "xboxId"`, `PlayerListFileFormat = "jsonArray" | "lineList"`, `PlayerListFile`, `PlayerListAction`, `PlayerListSpec` exported from `types.ts`.
  - `mergeListFile(existing: string, id: string, op: "add" | "remove", format: PlayerListFileFormat, field?: string): string`
  - `renderConsole(template: string, vars: { id: string; reason?: string }): string`
  - `resolvePlayerId(player: { steamId?: string|null; xboxId?: string|null; minecraftUuid?: string|null; minecraftName?: string|null }, identity: PlayerIdentityKey): string | null`

- [ ] **Step 1: Add the types**

Append to `src/lib/definitions/types.ts`:

```ts
export type PlayerIdentityKey = "minecraftName" | "minecraftUuid" | "steamId" | "xboxId";
export type PlayerListFileFormat = "jsonArray" | "lineList";

export interface PlayerListFile {
  path: string;                 // relative to the server install dir
  format: PlayerListFileFormat;
  field?: string;               // for jsonArray-of-objects: key holding the id (omit for array-of-strings)
}

export interface PlayerListAction {
  file?: PlayerListFile;
  console?: { add: string; remove: string }; // templated with {id} and {reason}
}

export interface PlayerListSpec {
  identity: PlayerIdentityKey;
  ban?: PlayerListAction;
  whitelist?: PlayerListAction & { enforced?: boolean };
}
```

Then add `playerList?: PlayerListSpec;` to the `GameDefinitionSpec` interface (after `queryPort?: string;`).

- [ ] **Step 2: Write the failing test**

Create `src/lib/players/__tests__/listFormat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeListFile, renderConsole, resolvePlayerId } from "../listFormat";

describe("mergeListFile lineList", () => {
  it("adds an id to an empty file", () => {
    expect(mergeListFile("", "76561", "add", "lineList")).toBe("76561\n");
  });
  it("is idempotent on add", () => {
    expect(mergeListFile("76561\n", "76561", "add", "lineList")).toBe("76561\n");
  });
  it("preserves existing entries and appends", () => {
    expect(mergeListFile("aaa\n", "bbb", "add", "lineList")).toBe("aaa\nbbb\n");
  });
  it("removes an id and leaves the rest", () => {
    expect(mergeListFile("aaa\nbbb\n", "aaa", "remove", "lineList")).toBe("bbb\n");
  });
  it("ignores blank lines and comments on parse", () => {
    expect(mergeListFile("// list\naaa\n\n", "bbb", "add", "lineList")).toBe("// list\naaa\nbbb\n");
  });
});

describe("mergeListFile jsonArray of strings", () => {
  it("adds to an empty/invalid file as a fresh array", () => {
    expect(mergeListFile("", "x", "add", "jsonArray")).toBe(JSON.stringify(["x"], null, 2));
  });
  it("dedupes on add", () => {
    const start = JSON.stringify(["x"], null, 2);
    expect(mergeListFile(start, "x", "add", "jsonArray")).toBe(start);
  });
  it("removes", () => {
    const start = JSON.stringify(["x", "y"], null, 2);
    expect(mergeListFile(start, "x", "remove", "jsonArray")).toBe(JSON.stringify(["y"], null, 2));
  });
});

describe("mergeListFile jsonArray of objects (field)", () => {
  it("adds an object keyed by field", () => {
    const out = mergeListFile("", "Steve", "add", "jsonArray", "name");
    expect(JSON.parse(out)).toEqual([{ name: "Steve" }]);
  });
  it("dedupes by field value", () => {
    const start = JSON.stringify([{ name: "Steve" }], null, 2);
    expect(mergeListFile(start, "Steve", "add", "jsonArray", "name")).toBe(start);
  });
  it("removes by field value", () => {
    const start = JSON.stringify([{ name: "Steve" }, { name: "Alex" }], null, 2);
    expect(JSON.parse(mergeListFile(start, "Steve", "remove", "jsonArray", "name"))).toEqual([{ name: "Alex" }]);
  });
});

describe("renderConsole", () => {
  it("substitutes id and reason", () => {
    expect(renderConsole("ban {id} {reason}", { id: "Steve", reason: "Griefing" })).toBe("ban Steve Griefing");
  });
  it("blanks missing reason", () => {
    expect(renderConsole("whitelist add {id}", { id: "Steve" })).toBe("whitelist add Steve");
  });
});

describe("resolvePlayerId", () => {
  it("returns the requested identity field", () => {
    expect(resolvePlayerId({ steamId: "76561" }, "steamId")).toBe("76561");
  });
  it("returns null when the identity field is missing", () => {
    expect(resolvePlayerId({ steamId: null }, "steamId")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `rtk vitest run src/lib/players/__tests__/listFormat.test.ts`
Expected: FAIL — cannot find module `../listFormat`.

- [ ] **Step 4: Implement the formatters**

Create `src/lib/players/listFormat.ts`:

```ts
import type { PlayerIdentityKey, PlayerListFileFormat } from "@/lib/definitions/types";

type Op = "add" | "remove";

export function resolvePlayerId(
  player: { steamId?: string | null; xboxId?: string | null; minecraftUuid?: string | null; minecraftName?: string | null },
  identity: PlayerIdentityKey,
): string | null {
  const v = player[identity];
  return v && v.trim() !== "" ? v : null;
}

export function renderConsole(template: string, vars: { id: string; reason?: string }): string {
  return template
    .replace(/\{id\}/g, vars.id)
    .replace(/\{reason\}/g, vars.reason ?? "")
    .trim();
}

export function mergeListFile(
  existing: string,
  id: string,
  op: Op,
  format: PlayerListFileFormat,
  field?: string,
): string {
  if (format === "lineList") return mergeLineList(existing, id, op);
  return mergeJsonArray(existing, id, op, field);
}

function mergeLineList(existing: string, id: string, op: Op): string {
  const lines = existing.split(/\r?\n/).filter((l) => l.trim() !== "");
  const isEntry = (l: string) => l.trim() === id;
  let kept = lines.filter((l) => !isEntry(l) || l.trim().startsWith("//") === false ? l.trim() !== id || false : true);
  // Simpler, explicit handling:
  kept = lines.filter((l) => l.trim() !== id);
  if (op === "add") kept.push(id);
  return kept.length ? kept.join("\n") + "\n" : "";
}

function mergeJsonArray(existing: string, id: string, op: Op, field?: string): string {
  let arr: any[] = [];
  try {
    const parsed = JSON.parse(existing);
    if (Array.isArray(parsed)) arr = parsed;
  } catch {
    arr = [];
  }
  const matches = (entry: any) => (field ? entry?.[field] === id : entry === id);
  arr = arr.filter((e) => !matches(e));
  if (op === "add") arr.push(field ? { [field]: id } : id);
  return JSON.stringify(arr, null, 2);
}
```

> Note: keep `mergeLineList` to the single clean filter line (`kept = lines.filter((l) => l.trim() !== id)`); the first `let kept = ...` line above is illustrative of the wrong approach — delete it and use only `const kept = lines.filter((l) => l.trim() !== id);`. Comments/blank lines that are not the id are preserved because the filter only drops exact-id lines.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `rtk vitest run src/lib/players/__tests__/listFormat.test.ts`
Expected: PASS (all cases). If the comment-preservation case fails, confirm the final implementation uses `const kept = lines.filter((l) => l.trim() !== id)` and discards blank lines only.

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/definitions/types.ts src/lib/players/listFormat.ts src/lib/players/__tests__/listFormat.test.ts
git -c user.email="jimmymills@users.noreply.github.com" -c user.name="jimmymills" commit -m "feat(players): PlayerListSpec types and pure list/console formatters

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Author per-game playerList mappings on builtins

**Files:**
- Modify: `src/lib/definitions/builtins.ts` (add `playerList` to each of the 8 specs)
- Test: `src/lib/definitions/__tests__/playerList.test.ts`

**Interfaces:**
- Consumes: `PlayerListSpec` from `types.ts`.
- Produces: `BUILTIN_DEFINITIONS[i].spec.playerList` populated for supported games.

**VERIFICATION GATE (do this before writing code):** For each game below marked "verify", confirm the file path / format / console syntax against the game's official dedicated-server docs. If you cannot confirm a mapping, ship that game with NO `playerList` (or `whitelist.enforced: false` for the whitelist half only) so it reports `UNSUPPORTED` rather than writing a wrong format. Record what you confirmed in the commit body.

- [ ] **Step 1: Write the failing test (high-confidence games)**

Create `src/lib/definitions/__tests__/playerList.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BUILTIN_DEFINITIONS } from "../builtins";

function spec(slug: string) {
  return BUILTIN_DEFINITIONS.find((d) => d.slug === slug)!.spec;
}

describe("Minecraft playerList", () => {
  const pl = spec("MINECRAFT").playerList!;
  it("keys on minecraft name", () => expect(pl.identity).toBe("minecraftName"));
  it("whitelist writes whitelist.json as object array on field name", () => {
    expect(pl.whitelist?.file).toEqual({ path: "whitelist.json", format: "jsonArray", field: "name" });
    expect(pl.whitelist?.console).toEqual({ add: "whitelist add {id}", remove: "whitelist remove {id}" });
  });
  it("ban writes banned-players.json and uses ban/pardon console", () => {
    expect(pl.ban?.file).toEqual({ path: "banned-players.json", format: "jsonArray", field: "name" });
    expect(pl.ban?.console).toEqual({ add: "ban {id} {reason}", remove: "pardon {id}" });
  });
});

describe("Valheim playerList", () => {
  const pl = spec("VALHEIM").playerList!;
  it("keys on steamId", () => expect(pl.identity).toBe("steamId"));
  it("whitelist -> permittedlist.txt (lineList)", () => {
    expect(pl.whitelist?.file).toEqual({ path: "permittedlist.txt", format: "lineList" });
  });
  it("ban -> bannedlist.txt (lineList)", () => {
    expect(pl.ban?.file).toEqual({ path: "bannedlist.txt", format: "lineList" });
  });
});

describe("every builtin has a valid playerList shape or none", () => {
  it("identity is a known key when playerList is present", () => {
    const keys = ["minecraftName", "minecraftUuid", "steamId", "xboxId"];
    for (const d of BUILTIN_DEFINITIONS) {
      if (d.spec.playerList) expect(keys).toContain(d.spec.playerList.identity);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `rtk vitest run src/lib/definitions/__tests__/playerList.test.ts`
Expected: FAIL — `pl` is undefined (no `playerList` yet).

- [ ] **Step 3: Add the mappings to `builtins.ts`**

For Minecraft, add inside its `spec: { ... }` object:

```ts
      playerList: {
        identity: "minecraftName",
        ban: {
          file: { path: "banned-players.json", format: "jsonArray", field: "name" },
          console: { add: "ban {id} {reason}", remove: "pardon {id}" },
        },
        whitelist: {
          file: { path: "whitelist.json", format: "jsonArray", field: "name" },
          console: { add: "whitelist add {id}", remove: "whitelist remove {id}" },
        },
      },
```

For Valheim (files live in the server's working dir; written relative to install dir `valheim-server`):

```ts
      playerList: {
        identity: "steamId",
        ban: { file: { path: "bannedlist.txt", format: "lineList" } },
        whitelist: { file: { path: "permittedlist.txt", format: "lineList" } },
      },
```

For the remaining six, apply the VERIFICATION GATE. Use these as the intended mappings, but only commit a mapping you can confirm; otherwise omit it (game reports `UNSUPPORTED`):

```ts
// ARK (verify path under install dir):
//   playerList: { identity: "steamId", ban: { file: { path: "ShooterGame/Saved/banlist.txt", format: "lineList" } },
//                 whitelist: { enforced: false } }
// RUST (verify; uses oxide/console; if unconfirmed -> omit):
//   playerList: { identity: "steamId", ban: { console: { add: "banid {id} \"{reason}\"", remove: "unban {id}" } },
//                 whitelist: { enforced: false } }
// PALWORLD (verify; no native whitelist):
//   playerList: { identity: "steamId", ban: { console: { add: "Ban {id}", remove: "Unban {id}" } },
//                 whitelist: { enforced: false } }
// PROJECT ZOMBOID (verify; console ban):
//   playerList: { identity: "steamId", ban: { console: { add: "banid {id}", remove: "unbanid {id}" } },
//                 whitelist: { enforced: false } }
// TERRARIA: no reliable file/console mapping -> omit playerList (UNSUPPORTED)
// ENSHROUDED: no documented mapping -> omit playerList (UNSUPPORTED)
```

For any game you ship enforcement for, extend `playerList.test.ts` with one concrete assertion of its file/console shape (mirror the Valheim block). For games you leave `UNSUPPORTED`, add no assertion (the generic shape test covers them).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk vitest run src/lib/definitions/__tests__/playerList.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full definitions suite for regressions**

Run: `rtk vitest run src/lib/definitions`
Expected: PASS (parity, serialize, validate suites unaffected — `playerList` is optional and round-trips through `stringifySpec`/`parseSpec` as plain JSON).

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/definitions/builtins.ts src/lib/definitions/__tests__/playerList.test.ts
git -c user.email="jimmymills@users.noreply.github.com" -c user.name="jimmymills" commit -m "feat(players): per-game whitelist/ban mappings on builtins

Confirmed formats: Minecraft, Valheim[, ...]. Unconfirmed games ship UNSUPPORTED.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Enforcement engine

**Files:**
- Modify: `src/lib/runners/LocalWindowsRunner.ts` (export `getLocalServerDir`; export `resolveDefinition`)
- Create: `src/lib/players/enforce.ts`
- Test: `src/lib/players/__tests__/enforce.test.ts`

**Interfaces:**
- Consumes: `mergeListFile`, `resolvePlayerId`, `renderConsole` (Task 2); `PlayerListSpec`, `GameDefinitionSpec` (Task 2); Prisma `prisma.playerEnforcement` (Task 1).
- Produces:
  - `EnforcementType = "BAN" | "WHITELIST"`, `EnforcementOp = "add" | "remove"`, `EnforcementStatus = "APPLIED" | "PENDING" | "UNSUPPORTED" | "FAILED"`.
  - `planEnforcement(spec, player, args)` (pure) → `{ status; filePath?: string; mergeId?: string; format?; field?; op; consoleCommand?: string; detail?: string }`.
  - `applyToServer(player, server, deps, args)` → `Promise<{ serverId: string; status: EnforcementStatus; detail?: string }>` and upserts `PlayerEnforcement`.
  - `applyPlayerEverywhere(player, servers, deps, args)` → `Promise<Array<{ serverId; status; detail? }>>`.

- [ ] **Step 1: Export the two helpers from `LocalWindowsRunner.ts`**

Change `function getLocalServerDir(` (line ~95) to `export function getLocalServerDir(`.
Change `async function resolveDefinition(` (line ~382) to `export async function resolveDefinition(`.

- [ ] **Step 2: Write the failing test**

Create `src/lib/players/__tests__/enforce.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { planEnforcement, applyToServer } from "../enforce";
import type { GameDefinitionSpec } from "@/lib/definitions/types";

const mcSpec = {
  playerList: {
    identity: "minecraftName",
    ban: { file: { path: "banned-players.json", format: "jsonArray", field: "name" }, console: { add: "ban {id} {reason}", remove: "pardon {id}" } },
    whitelist: { file: { path: "whitelist.json", format: "jsonArray", field: "name" }, console: { add: "whitelist add {id}", remove: "whitelist remove {id}" } },
  },
} as unknown as GameDefinitionSpec;

const player = { id: "p1", minecraftName: "Steve", steamId: null, xboxId: null, minecraftUuid: null };

describe("planEnforcement", () => {
  it("UNSUPPORTED when the spec has no playerList", () => {
    const r = planEnforcement({} as GameDefinitionSpec, player, { type: "BAN", op: "add", reason: "x" });
    expect(r.status).toBe("UNSUPPORTED");
  });
  it("FAILED when the player lacks the identity field", () => {
    const r = planEnforcement(mcSpec, { ...player, minecraftName: null }, { type: "BAN", op: "add", reason: "x" });
    expect(r.status).toBe("FAILED");
    expect(r.detail).toMatch(/minecraftName/);
  });
  it("produces a file path and console command for a ban add", () => {
    const r = planEnforcement(mcSpec, player, { type: "BAN", op: "add", reason: "Griefing" });
    expect(r.filePath).toBe("banned-players.json");
    expect(r.mergeId).toBe("Steve");
    expect(r.consoleCommand).toBe("ban Steve Griefing");
  });
  it("UNSUPPORTED for whitelist when enforced is false", () => {
    const spec = { playerList: { identity: "steamId", whitelist: { enforced: false } } } as unknown as GameDefinitionSpec;
    const r = planEnforcement(spec, { ...player, steamId: "1" }, { type: "WHITELIST", op: "add" });
    expect(r.status).toBe("UNSUPPORTED");
  });
});

describe("applyToServer", () => {
  function deps(overrides: any = {}) {
    return {
      resolveSpec: vi.fn().mockResolvedValue(mcSpec),
      installDir: vi.fn().mockReturnValue("/tmp/srv"),
      readFile: vi.fn().mockReturnValue(""),
      writeFile: vi.fn(),
      isRunning: vi.fn().mockReturnValue(false),
      sendCommand: vi.fn().mockResolvedValue(undefined),
      recordEnforcement: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }
  const server = { id: "s1", game: "MINECRAFT", definitionId: null, status: "STOPPED" } as any;

  it("writes the merged file and records APPLIED when stopped", async () => {
    const d = deps();
    const r = await applyToServer(player, server, d, { type: "BAN", op: "add", reason: "Griefing" });
    expect(d.writeFile).toHaveBeenCalledOnce();
    expect(d.sendCommand).not.toHaveBeenCalled();
    expect(r.status).toBe("APPLIED");
    expect(d.recordEnforcement).toHaveBeenCalledWith("s1", "BAN", "APPLIED", undefined);
  });

  it("also sends the live command when running", async () => {
    const d = deps({ isRunning: vi.fn().mockReturnValue(true) });
    await applyToServer(player, { ...server, status: "RUNNING" }, d, { type: "BAN", op: "add", reason: "g" });
    expect(d.sendCommand).toHaveBeenCalledWith(expect.anything(), "ban Steve g");
  });

  it("records UNSUPPORTED and writes nothing when no mapping", async () => {
    const d = deps({ resolveSpec: vi.fn().mockResolvedValue({}) });
    const r = await applyToServer(player, server, d, { type: "BAN", op: "add", reason: "g" });
    expect(d.writeFile).not.toHaveBeenCalled();
    expect(r.status).toBe("UNSUPPORTED");
  });

  it("records FAILED with detail when writeFile throws", async () => {
    const d = deps({ writeFile: vi.fn(() => { throw new Error("disk full"); }) });
    const r = await applyToServer(player, server, d, { type: "BAN", op: "add", reason: "g" });
    expect(r.status).toBe("FAILED");
    expect(r.detail).toMatch(/disk full/);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `rtk vitest run src/lib/players/__tests__/enforce.test.ts`
Expected: FAIL — cannot find module `../enforce`.

- [ ] **Step 4: Implement the engine**

Create `src/lib/players/enforce.ts`:

```ts
import type { GameDefinitionSpec, PlayerListAction, PlayerListSpec } from "@/lib/definitions/types";
import { mergeListFile, renderConsole, resolvePlayerId } from "./listFormat";

export type EnforcementType = "BAN" | "WHITELIST";
export type EnforcementOp = "add" | "remove";
export type EnforcementStatus = "APPLIED" | "PENDING" | "UNSUPPORTED" | "FAILED";

export interface EnforceArgs { type: EnforcementType; op: EnforcementOp; reason?: string; }

export interface EnforcementPlan {
  status: EnforcementStatus;        // UNSUPPORTED/FAILED short-circuit; otherwise the planned change
  filePath?: string;
  mergeId?: string;
  format?: "jsonArray" | "lineList";
  field?: string;
  op: EnforcementOp;
  consoleCommand?: string;
  detail?: string;
}

type EnforcePlayer = { steamId?: string | null; xboxId?: string | null; minecraftUuid?: string | null; minecraftName?: string | null };

function actionFor(pl: PlayerListSpec, type: EnforcementType): (PlayerListAction & { enforced?: boolean }) | undefined {
  return type === "BAN" ? pl.ban : pl.whitelist;
}

export function planEnforcement(spec: GameDefinitionSpec, player: EnforcePlayer, args: EnforceArgs): EnforcementPlan {
  const pl = spec.playerList;
  if (!pl) return { status: "UNSUPPORTED", op: args.op };
  const action = actionFor(pl, args.type);
  if (!action || action.enforced === false || (!action.file && !action.console)) {
    return { status: "UNSUPPORTED", op: args.op };
  }
  const id = resolvePlayerId(player, pl.identity);
  if (!id) return { status: "FAILED", op: args.op, detail: `Player has no ${pl.identity} value` };

  const plan: EnforcementPlan = { status: "APPLIED", op: args.op };
  if (action.file) { plan.filePath = action.file.path; plan.mergeId = id; plan.format = action.file.format; plan.field = action.file.field; }
  if (action.console) plan.consoleCommand = renderConsole(args.op === "add" ? action.console.add : action.console.remove, { id, reason: args.reason });
  return plan;
}

export interface ApplyDeps {
  resolveSpec: (server: { definitionId: string | null; game: string }) => Promise<GameDefinitionSpec>;
  installDir: (server: { id: string; game: string }, spec: GameDefinitionSpec) => string;
  readFile: (absPath: string) => string;       // "" if missing
  writeFile: (absPath: string, content: string) => void;
  isRunning: (serverId: string) => boolean;
  sendCommand: (server: any, command: string) => Promise<void>;
  recordEnforcement: (serverId: string, type: EnforcementType, status: EnforcementStatus, detail?: string) => Promise<void>;
}

export async function applyToServer(
  player: EnforcePlayer & { id?: string },
  server: { id: string; game: string; definitionId: string | null; status: string },
  deps: ApplyDeps,
  args: EnforceArgs,
): Promise<{ serverId: string; status: EnforcementStatus; detail?: string }> {
  let status: EnforcementStatus = "APPLIED";
  let detail: string | undefined;
  try {
    const spec = await deps.resolveSpec(server);
    const plan = planEnforcement(spec, player, args);
    if (plan.status === "UNSUPPORTED" || plan.status === "FAILED") {
      status = plan.status; detail = plan.detail;
    } else {
      let didFile = false;
      if (plan.filePath && plan.mergeId && plan.format) {
        const path = require("path") as typeof import("path");
        const abs = path.join(deps.installDir(server, spec), plan.filePath);
        const next = mergeListFile(deps.readFile(abs), plan.mergeId, plan.op, plan.format, plan.field);
        deps.writeFile(abs, next);
        didFile = true;
      }
      let didConsole = false;
      if (plan.consoleCommand && deps.isRunning(server.id)) {
        await deps.sendCommand(server, plan.consoleCommand);
        didConsole = true;
      }
      if (!didFile && !didConsole && plan.consoleCommand) {
        status = "PENDING"; detail = "Server stopped; live-only command will apply on next start";
      }
    }
  } catch (e: any) {
    status = "FAILED"; detail = e?.message ?? String(e);
  }
  await deps.recordEnforcement(server.id, args.type, status, detail);
  return { serverId: server.id, status, detail };
}

export async function applyPlayerEverywhere(
  player: EnforcePlayer & { id?: string },
  servers: Array<{ id: string; game: string; definitionId: string | null; status: string }>,
  deps: ApplyDeps,
  args: EnforceArgs,
) {
  const out: Array<{ serverId: string; status: EnforcementStatus; detail?: string }> = [];
  for (const s of servers) out.push(await applyToServer(player, s, deps, args));
  return out;
}
```

> Replace the inline `require("path")` with a top-of-file `import path from "path";` and use `path.join(...)` directly — `require` is shown only to keep the snippet self-contained. The default `ApplyDeps` used in production is built in Task 5's shared helper.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `rtk vitest run src/lib/players/__tests__/enforce.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/runners/LocalWindowsRunner.ts src/lib/players/enforce.ts src/lib/players/__tests__/enforce.test.ts
git -c user.email="jimmymills@users.noreply.github.com" -c user.name="jimmymills" commit -m "feat(players): enforcement engine (planEnforcement + applyToServer)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Production ApplyDeps + Players CRUD API

**Files:**
- Create: `src/lib/players/applyDeps.ts` (wires the real Prisma/runner/fs deps + `applyForOwner`)
- Create: `src/app/api/players/route.ts` (GET list, POST create)
- Create: `src/app/api/players/[id]/route.ts` (GET, PATCH, DELETE)
- Test: `src/lib/players/__tests__/applyDeps.test.ts`

**Interfaces:**
- Consumes: `applyPlayerEverywhere`, `ApplyDeps` (Task 4); `getLocalServerDir`, `resolveDefinition`, `localProcesses` (Task 4 exports); `prisma` (`src/lib/db.ts`); `getAuthenticatedUser` (`src/lib/auth.ts`).
- Produces:
  - `buildApplyDeps(): ApplyDeps`
  - `applyForOwner(ownerId, player, args, opts?)` → applies to the owner's servers (all servers for BAN; given `serverIds` for WHITELIST), returns the per-server results.
  - `logPlayerEvent(playerId, actorId, action, detail)` helper.

- [ ] **Step 1: Write the failing test for `buildApplyDeps` install-dir logic**

Create `src/lib/players/__tests__/applyDeps.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { resolveInstallSubDir } from "../applyDeps";

describe("resolveInstallSubDir", () => {
  it("returns installSubDir for steamcmd/download specs", () => {
    expect(resolveInstallSubDir({ install: { installSubDir: "valheim-server" } } as any)).toBe("valheim-server");
  });
  it("returns undefined when no subdir (e.g. Minecraft download to base)", () => {
    expect(resolveInstallSubDir({ install: { fileName: "server.jar" } } as any)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `rtk vitest run src/lib/players/__tests__/applyDeps.test.ts`
Expected: FAIL — cannot find module `../applyDeps`.

- [ ] **Step 3: Implement `applyDeps.ts`**

Create `src/lib/players/applyDeps.ts`:

```ts
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import type { GameDefinitionSpec } from "@/lib/definitions/types";
import { getRunner } from "@/lib/runners";
import { getLocalServerDir, resolveDefinition, localProcesses } from "@/lib/runners/LocalWindowsRunner";
import { applyPlayerEverywhere, type ApplyDeps, type EnforceArgs } from "./enforce";

export function resolveInstallSubDir(spec: GameDefinitionSpec): string | undefined {
  const i = spec.install as any;
  return i?.installSubDir || undefined;
}

export function buildApplyDeps(): ApplyDeps {
  return {
    resolveSpec: async (server) => (await resolveDefinition(server)).spec,
    installDir: (server, spec) => {
      const sub = resolveInstallSubDir(spec);
      return sub ? getLocalServerDir(server.id, sub) : getLocalServerDir(server.id);
    },
    readFile: (abs) => (fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : ""),
    writeFile: (abs, content) => { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content); },
    isRunning: (serverId) => localProcesses.has(serverId),
    sendCommand: (server, command) => getRunner(server.runnerType).sendCommand(server, command),
    recordEnforcement: async (serverId, type, status, detail) => {
      await prisma.playerEnforcement.upsert({
        where: { playerId_serverId_type: { playerId: CURRENT_PLAYER_ID, serverId, type } },
        update: { status, detail: detail ?? null, appliedAt: new Date() },
        create: { playerId: CURRENT_PLAYER_ID, serverId, type, status, detail: detail ?? null },
      });
    },
  };
}
```

> The `recordEnforcement` closure needs the player id. Implement `buildApplyDeps(playerId: string)` taking the id as a parameter and use it in the upsert (replace `CURRENT_PLAYER_ID`). Update the `ApplyDeps` call sites accordingly.

Add the owner-facing helpers to the same file:

```ts
export async function applyForOwner(
  ownerId: string,
  player: { id: string; steamId: string | null; xboxId: string | null; minecraftUuid: string | null; minecraftName: string | null },
  args: EnforceArgs,
  opts?: { serverIds?: string[] },
) {
  const where: any = { userId: ownerId };
  if (opts?.serverIds) where.id = { in: opts.serverIds };
  const servers = await prisma.server.findMany({ where });
  const deps = buildApplyDeps(player.id);
  return applyPlayerEverywhere(player, servers as any, deps, args);
}

export async function logPlayerEvent(playerId: string, actorId: string, action: string, detail: string) {
  await prisma.playerEvent.create({ data: { playerId, actorId, action, detail } });
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `rtk vitest run src/lib/players/__tests__/applyDeps.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the list/create route**

Create `src/app/api/players/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { logPlayerEvent } from "@/lib/players/applyDeps";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const players = await prisma.player.findMany({
    where: { ownerId: user.id },
    orderBy: { displayName: "asc" },
    include: { bans: { where: { active: true } }, whitelists: true },
  });
  return NextResponse.json({ players });
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body?.displayName || typeof body.displayName !== "string") {
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }
  const player = await prisma.player.create({
    data: {
      ownerId: user.id,
      displayName: body.displayName,
      steamId: body.steamId || null,
      xboxId: body.xboxId || null,
      minecraftUuid: body.minecraftUuid || null,
      minecraftName: body.minecraftName || null,
      discordId: body.discordId || null,
      notes: body.notes || null,
    },
  });
  await logPlayerEvent(player.id, user.id, "PLAYER_CREATED", `Created ${player.displayName}`);
  return NextResponse.json({ player }, { status: 201 });
}
```

- [ ] **Step 6: Implement the [id] route**

Create `src/app/api/players/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { logPlayerEvent } from "@/lib/players/applyDeps";

async function ownedPlayer(id: string, ownerId: string) {
  return prisma.player.findFirst({ where: { id, ownerId } });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const player = await prisma.player.findFirst({
    where: { id: params.id, ownerId: user.id },
    include: { bans: { where: { active: true } }, whitelists: true, events: { orderBy: { createdAt: "desc" } } },
  });
  if (!player) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const enforcement = await prisma.playerEnforcement.findMany({ where: { playerId: player.id } });
  return NextResponse.json({ player, enforcement });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await ownedPlayer(params.id, user.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  const fields = ["displayName", "steamId", "xboxId", "minecraftUuid", "minecraftName", "discordId", "notes"] as const;
  const data: Record<string, string | null> = {};
  for (const f of fields) if (f in body) data[f] = body[f] || null;
  const player = await prisma.player.update({ where: { id: params.id }, data });
  await logPlayerEvent(player.id, user.id, "EDITED", `Edited ${player.displayName}`);
  return NextResponse.json({ player });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await ownedPlayer(params.id, user.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.player.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 7: Typecheck and run players tests**

Run: `npx tsc --noEmit -p tsconfig.json && rtk vitest run src/lib/players`
Expected: no new type errors; all players tests PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add src/lib/players/applyDeps.ts src/app/api/players
git -c user.email="jimmymills@users.noreply.github.com" -c user.name="jimmymills" commit -m "feat(players): production ApplyDeps + players CRUD API

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Ban / Unban API

**Files:**
- Create: `src/app/api/players/[id]/ban/route.ts` (POST ban, DELETE unban)
- Test: `src/lib/players/__tests__/banFlow.test.ts`

**Interfaces:**
- Consumes: `applyForOwner`, `logPlayerEvent` (Task 5); `prisma`; `getAuthenticatedUser`.
- Produces: ban/unban endpoints. Extracted pure helper `nextBanStatus(hasActiveBan)` for the player's denormalized `status`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/players/__tests__/banFlow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { playerStatusAfterBan, playerStatusAfterUnban } from "@/app/api/players/[id]/ban/status";

describe("ban status helpers", () => {
  it("ban -> BANNED", () => expect(playerStatusAfterBan()).toBe("BANNED"));
  it("unban with whitelists -> TRUSTED", () => expect(playerStatusAfterUnban(true)).toBe("TRUSTED"));
  it("unban without whitelists -> NEUTRAL", () => expect(playerStatusAfterUnban(false)).toBe("NEUTRAL"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `rtk vitest run src/lib/players/__tests__/banFlow.test.ts`
Expected: FAIL — cannot find module `.../ban/status`.

- [ ] **Step 3: Implement the status helper**

Create `src/app/api/players/[id]/ban/status.ts`:

```ts
export function playerStatusAfterBan(): "BANNED" { return "BANNED"; }
export function playerStatusAfterUnban(hasWhitelists: boolean): "TRUSTED" | "NEUTRAL" {
  return hasWhitelists ? "TRUSTED" : "NEUTRAL";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `rtk vitest run src/lib/players/__tests__/banFlow.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the ban route**

Create `src/app/api/players/[id]/ban/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { applyForOwner, logPlayerEvent } from "@/lib/players/applyDeps";
import { playerStatusAfterBan, playerStatusAfterUnban } from "./status";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const player = await prisma.player.findFirst({ where: { id: params.id, ownerId: user.id } });
  if (!player) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const reason: string = body?.reason || "No reason given";
  const expiresAt = body?.expiresAt ? new Date(body.expiresAt) : null;

  await prisma.playerBan.updateMany({ where: { playerId: player.id, active: true }, data: { active: false } });
  await prisma.playerBan.create({ data: { playerId: player.id, reason, expiresAt } });
  await prisma.player.update({ where: { id: player.id }, data: { status: playerStatusAfterBan() } });

  const results = await applyForOwner(user.id, player, { type: "BAN", op: "add", reason });
  await logPlayerEvent(player.id, user.id, "BANNED", `Banned: ${reason}`);
  return NextResponse.json({ success: true, results });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const player = await prisma.player.findFirst({ where: { id: params.id, ownerId: user.id }, include: { whitelists: true } });
  if (!player) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.playerBan.updateMany({ where: { playerId: player.id, active: true }, data: { active: false } });
  await prisma.player.update({ where: { id: player.id }, data: { status: playerStatusAfterUnban(player.whitelists.length > 0) } });

  const results = await applyForOwner(user.id, player, { type: "BAN", op: "remove" });
  await logPlayerEvent(player.id, user.id, "UNBANNED", "Ban lifted");
  return NextResponse.json({ success: true, results });
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
rtk git add "src/app/api/players/[id]/ban"
git -c user.email="jimmymills@users.noreply.github.com" -c user.name="jimmymills" commit -m "feat(players): global ban/unban API with enforcement

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Whitelist / Revoke API

**Files:**
- Create: `src/app/api/players/[id]/whitelist/route.ts` (POST whitelist, DELETE revoke)
- Test: `src/lib/players/__tests__/whitelistTargets.test.ts`

**Interfaces:**
- Consumes: `applyForOwner`, `logPlayerEvent`; `prisma`; `getAuthenticatedUser`.
- Produces: whitelist/revoke endpoints. Extracted pure helper `resolveTargetServerIds(body, allServerIds)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/players/__tests__/whitelistTargets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveTargetServerIds } from "@/app/api/players/[id]/whitelist/targets";

describe("resolveTargetServerIds", () => {
  it("'all' expands to every server id", () => {
    expect(resolveTargetServerIds({ all: true }, ["a", "b"])).toEqual(["a", "b"]);
  });
  it("explicit ids are intersected with owned servers", () => {
    expect(resolveTargetServerIds({ serverIds: ["a", "z"] }, ["a", "b"])).toEqual(["a"]);
  });
  it("empty when nothing specified", () => {
    expect(resolveTargetServerIds({}, ["a", "b"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `rtk vitest run src/lib/players/__tests__/whitelistTargets.test.ts`
Expected: FAIL — cannot find module `.../whitelist/targets`.

- [ ] **Step 3: Implement the helper**

Create `src/app/api/players/[id]/whitelist/targets.ts`:

```ts
export function resolveTargetServerIds(
  body: { all?: boolean; serverIds?: string[] },
  ownedServerIds: string[],
): string[] {
  if (body.all) return [...ownedServerIds];
  if (Array.isArray(body.serverIds)) return body.serverIds.filter((id) => ownedServerIds.includes(id));
  return [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `rtk vitest run src/lib/players/__tests__/whitelistTargets.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the whitelist route**

Create `src/app/api/players/[id]/whitelist/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { applyForOwner, logPlayerEvent } from "@/lib/players/applyDeps";
import { resolveTargetServerIds } from "./targets";

async function ownedServerIds(ownerId: string): Promise<string[]> {
  const servers = await prisma.server.findMany({ where: { userId: ownerId }, select: { id: true } });
  return servers.map((s) => s.id);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const player = await prisma.player.findFirst({ where: { id: params.id, ownerId: user.id } });
  if (!player) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const targets = resolveTargetServerIds(body, await ownedServerIds(user.id));
  if (targets.length === 0) return NextResponse.json({ error: "No target servers" }, { status: 400 });

  for (const serverId of targets) {
    await prisma.playerWhitelist.upsert({
      where: { playerId_serverId: { playerId: player.id, serverId } },
      update: {},
      create: { playerId: player.id, serverId },
    });
  }
  const results = await applyForOwner(user.id, player, { type: "WHITELIST", op: "add" }, { serverIds: targets });
  await logPlayerEvent(player.id, user.id, "WHITELISTED", `Whitelisted on ${targets.length} server(s)`);
  return NextResponse.json({ success: true, results });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const player = await prisma.player.findFirst({ where: { id: params.id, ownerId: user.id } });
  if (!player) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const targets = resolveTargetServerIds(body, await ownedServerIds(user.id));

  await prisma.playerWhitelist.deleteMany({ where: { playerId: player.id, serverId: { in: targets } } });
  const results = await applyForOwner(user.id, player, { type: "WHITELIST", op: "remove" }, { serverIds: targets });
  await logPlayerEvent(player.id, user.id, "WHITELIST_REVOKED", `Revoked on ${targets.length} server(s)`);
  return NextResponse.json({ success: true, results });
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
rtk git add "src/app/api/players/[id]/whitelist"
git -c user.email="jimmymills@users.noreply.github.com" -c user.name="jimmymills" commit -m "feat(players): global whitelist/revoke API with enforcement

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Bulk actions API

**Files:**
- Create: `src/app/api/players/bulk/route.ts` (POST)
- Test: `src/lib/players/__tests__/bulk.test.ts`

**Interfaces:**
- Consumes: ban/whitelist logic via `applyForOwner`, `logPlayerEvent`; `prisma`; `getAuthenticatedUser`.
- Produces: `validateBulkRequest(body)` pure helper + the bulk endpoint.

- [ ] **Step 1: Write the failing test**

Create `src/lib/players/__tests__/bulk.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateBulkRequest } from "@/app/api/players/bulk/validate";

describe("validateBulkRequest", () => {
  it("rejects missing playerIds", () => {
    expect(validateBulkRequest({ action: "ban" }).ok).toBe(false);
  });
  it("rejects unknown action", () => {
    expect(validateBulkRequest({ playerIds: ["a"], action: "nuke" }).ok).toBe(false);
  });
  it("accepts a valid ban request", () => {
    const r = validateBulkRequest({ playerIds: ["a", "b"], action: "ban", reason: "x" });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `rtk vitest run src/lib/players/__tests__/bulk.test.ts`
Expected: FAIL — cannot find module `.../bulk/validate`.

- [ ] **Step 3: Implement the validator**

Create `src/app/api/players/bulk/validate.ts`:

```ts
export type BulkAction = "ban" | "whitelist" | "delete";
export interface BulkRequest { playerIds: string[]; action: BulkAction; reason?: string; serverIds?: string[]; all?: boolean; }

export function validateBulkRequest(body: any): { ok: true; value: BulkRequest } | { ok: false; error: string } {
  if (!Array.isArray(body?.playerIds) || body.playerIds.length === 0) return { ok: false, error: "playerIds required" };
  if (!["ban", "whitelist", "delete"].includes(body?.action)) return { ok: false, error: "invalid action" };
  return { ok: true, value: body as BulkRequest };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `rtk vitest run src/lib/players/__tests__/bulk.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the bulk route**

Create `src/app/api/players/bulk/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { applyForOwner, logPlayerEvent } from "@/lib/players/applyDeps";
import { validateBulkRequest } from "./validate";
import { resolveTargetServerIds } from "../[id]/whitelist/targets";

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = validateBulkRequest(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { playerIds, action, reason, serverIds, all } = parsed.value;

  const players = await prisma.player.findMany({ where: { id: { in: playerIds }, ownerId: user.id } });
  const results: Record<string, any> = {};

  for (const player of players) {
    if (action === "delete") {
      await prisma.player.delete({ where: { id: player.id } });
      results[player.id] = "deleted";
      continue;
    }
    if (action === "ban") {
      await prisma.playerBan.updateMany({ where: { playerId: player.id, active: true }, data: { active: false } });
      await prisma.playerBan.create({ data: { playerId: player.id, reason: reason || "Bulk ban" } });
      await prisma.player.update({ where: { id: player.id }, data: { status: "BANNED" } });
      results[player.id] = await applyForOwner(user.id, player, { type: "BAN", op: "add", reason });
      await logPlayerEvent(player.id, user.id, "BANNED", `Bulk ban: ${reason || "Bulk ban"}`);
    }
    if (action === "whitelist") {
      const owned = (await prisma.server.findMany({ where: { userId: user.id }, select: { id: true } })).map((s) => s.id);
      const targets = resolveTargetServerIds({ serverIds, all }, owned);
      for (const sid of targets) {
        await prisma.playerWhitelist.upsert({
          where: { playerId_serverId: { playerId: player.id, serverId: sid } },
          update: {}, create: { playerId: player.id, serverId: sid },
        });
      }
      results[player.id] = await applyForOwner(user.id, player, { type: "WHITELIST", op: "add" }, { serverIds: targets });
      await logPlayerEvent(player.id, user.id, "WHITELISTED", `Bulk whitelist on ${targets.length} server(s)`);
    }
  }
  return NextResponse.json({ success: true, results });
}
```

- [ ] **Step 6: Typecheck and run the full players suite**

Run: `npx tsc --noEmit -p tsconfig.json && rtk vitest run src/lib/players`
Expected: no new type errors; all PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src/app/api/players/bulk
git -c user.email="jimmymills@users.noreply.github.com" -c user.name="jimmymills" commit -m "feat(players): bulk ban/whitelist/delete API

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Players UI (page, view, nav)

**Files:**
- Modify: `src/components/DashboardView.tsx` (add the "Players" nav entry)
- Create: `src/app/dashboard/players/page.tsx`
- Create: `src/components/PlayersView.tsx`

**Interfaces:**
- Consumes: API routes from Tasks 5–8; `useModal()` (`src/components/ModalProvider.tsx`), `useToast()` (`src/components/ToastProvider.tsx`); `getAuthenticatedUser` / `prisma` for the server component.
- Produces: a reachable `/dashboard/players` route.

- [ ] **Step 1: Add the nav entry**

In `src/components/DashboardView.tsx`, in the `[{ label, icon, href }]` array (~line 554), add (and add `UserCog` to the existing `lucide-react` import):

```tsx
              { label: "Players", icon: UserCog, href: "/dashboard/players" },
```

- [ ] **Step 2: Create the server-component page**

Create `src/app/dashboard/players/page.tsx` (mirror `src/app/dashboard/logs/page.tsx` for the auth + data-fetch pattern — open that file and follow its `getAuthenticatedUser()` + redirect shape exactly):

```tsx
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import PlayersView from "@/components/PlayersView";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/start");
  const [players, servers] = await Promise.all([
    prisma.player.findMany({
      where: { ownerId: user.id },
      orderBy: { displayName: "asc" },
      include: { bans: { where: { active: true } }, whitelists: true },
    }),
    prisma.server.findMany({ where: { userId: user.id }, select: { id: true, name: true, game: true } }),
  ]);
  return <PlayersView initialPlayers={JSON.parse(JSON.stringify(players))} servers={servers} userName={user.name} />;
}
```

- [ ] **Step 3: Create the client view**

Create `src/components/PlayersView.tsx`. Follow `src/components/TeamView.tsx` for styling conventions, modal usage (`useModal()`), and toast usage (`useToast()`). It must implement:

- Left master list: each player row shows a status dot (red BANNED / green TRUSTED / slate NEUTRAL), `displayName`, and a selection checkbox feeding a `Set<string>` of selected ids.
- A bulk action bar (rendered when `selected.size > 0`) with buttons: Ban, Whitelist, Delete → calls `POST /api/players/bulk`.
- Right detail panel for the focused player: identity fields, active ban (with Unban button → `DELETE /api/players/[id]/ban`), a Ban button (opens a modal: reason + duration → `POST /api/players/[id]/ban`), a Whitelist button (opens a modal: server multi-select from `servers` + "All servers" → `POST /api/players/[id]/whitelist`), and the per-server enforcement matrix with Applied/Pending/Unsupported/Failed badges (from `GET /api/players/[id]` `enforcement`), plus the `events` history list.
- "Add Player" button → modal with `displayName` + identity fields → `POST /api/players`.
- After each mutation, re-fetch `GET /api/players` (and `GET /api/players/[id]` for the open detail) and show a toast; on non-2xx show the error toast.

Skeleton (fill the modal bodies and badge styling following `TeamView.tsx`):

```tsx
"use client";
import { useState, useCallback } from "react";
import { UserCog, Plus, Ban, ShieldCheck, Trash2 } from "lucide-react";
import { useModal } from "@/components/ModalProvider";
import { useToast } from "@/components/ToastProvider";

interface PlayerRow { id: string; displayName: string; status: string; steamId: string | null; xboxId: string | null; minecraftUuid: string | null; minecraftName: string | null; discordId: string | null; notes: string | null; bans: any[]; whitelists: any[]; }
interface ServerRow { id: string; name: string; game: string; }

export default function PlayersView({ initialPlayers, servers, userName }: { initialPlayers: PlayerRow[]; servers: ServerRow[]; userName: string; }) {
  const [players, setPlayers] = useState<PlayerRow[]>(initialPlayers);
  const [focusedId, setFocusedId] = useState<string | null>(initialPlayers[0]?.id ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<{ player: any; enforcement: any[] } | null>(null);
  const modal = useModal();
  const toast = useToast();

  const refresh = useCallback(async () => {
    const res = await fetch("/api/players");
    if (res.ok) setPlayers((await res.json()).players);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/players/${id}`);
    if (res.ok) setDetail(await res.json());
  }, []);

  async function mutate(url: string, method: string, body?: any) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { toast.show((await res.json().catch(() => ({}))).error || "Action failed", "error"); return false; }
    await refresh();
    if (focusedId) await loadDetail(focusedId);
    return true;
  }

  // Render master/detail per the requirements above.
  return (
    <div className="min-h-screen flex bg-background text-slate-100">
      {/* master list, bulk bar, detail panel — implement per Step 3 requirements */}
    </div>
  );
}
```

- [ ] **Step 4: Build to verify the route compiles**

Run: `rtk next build`
Expected: build succeeds; route `/dashboard/players` appears in the output.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Per memory, launch the dev app detached (do not block the harness):
`Start-Process powershell -ArgumentList '-NoExit','-Command','npm run electron:dev'`
Then verify: Players appears in the sidebar; create a player; ban → see enforcement badges; whitelist a server; check the event history. Stop the app when done.

- [ ] **Step 6: Commit**

```bash
rtk git add src/components/DashboardView.tsx src/app/dashboard/players src/components/PlayersView.tsx
git -c user.email="jimmymills@users.noreply.github.com" -c user.name="jimmymills" commit -m "feat(players): Players dashboard page, view, and nav entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Full suite + issue wrap-up

- [ ] **Step 1: Run the whole test suite**

Run: `rtk vitest run`
Expected: PASS (no regressions). Fix any failures before proceeding.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors introduced by this work.

- [ ] **Step 3: Use the verification-before-completion and requesting-code-review skills**

Invoke `superpowers:verification-before-completion`, then `superpowers:requesting-code-review` before opening the PR. Address findings.

- [ ] **Step 4: Open the PR (rebased onto origin/main first, per memory)**

Per memory `worktree-pr-rebase-onto-main`: `rtk git fetch origin && rtk git rebase origin/main` before pushing, to avoid reverting newer work. Then push and open a PR referencing issue #55 (note in the body that this is Slice 1 and list the deferred follow-ups).

## Self-Review (completed)

- **Spec coverage:** Players tab (Task 9) ✓; central Player DB + identity fields (Task 1) ✓; Global Ban + propagation (Tasks 4–6) ✓; Global Whitelist per-server/all (Tasks 4,7) ✓; per-game mapping on `GameDefinitionSpec` (Tasks 2–3) ✓; real file + console enforcement (Task 4) ✓; per-server Applied/Pending/Unsupported/Failed status (Tasks 1,4,9) ✓; bulk actions (Task 8) ✓; per-player audit `PlayerEvent` + history UI (Tasks 1,5,9) ✓; owner isolation (Global Constraints, every route) ✓. Deferred-by-design (roles, Discord, identity merge, reputation, access profiles, validation APIs) are explicitly out of scope per the spec.
- **Placeholder scan:** The only intentionally-incomplete spots are the verify-gated game mappings (Task 3, by design — ship UNSUPPORTED if unconfirmed) and the `PlayersView` modal bodies/badge styling (Task 9 Step 3), which have explicit, enumerated requirements and a reference component (`TeamView.tsx`) rather than vague "implement UI". The `require("path")`/`let kept` snippets carry explicit "replace with" notes.
- **Type consistency:** `EnforceArgs`/`ApplyDeps`/`EnforcementStatus` names are consistent across Tasks 4–8; `resolveTargetServerIds` is defined once (Task 7) and reused in Task 8; `applyForOwner`/`logPlayerEvent`/`buildApplyDeps(playerId)` signatures match across call sites; Prisma accessor names match the Task 1 models.
- **Open item carried from spec:** re-apply of `PENDING` console-only changes on next server start is intentionally NOT in this plan (flagged in the spec as a possible tiny follow-up); `applyToServer` records `PENDING` so no state is lost.
