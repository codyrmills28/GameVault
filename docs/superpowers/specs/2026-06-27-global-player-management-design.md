# Global Player Management — Design (Slice 1)

**Issue:** [#55 — Feature Request: Global Player Management (Cross-Game Whitelists & Bans)](https://github.com/RealmSwap/RealmSwap/issues/55)
**Date:** 2026-06-27
**Status:** Approved (brainstorming) — pending spec review

## Context

Issue #55 requests a centralized Players system: one player profile, one ban
button, one whitelist, enforced across every game server. The full issue spans
~9 subsystems (player DB, cross-platform identity mapping, global bans, global
whitelist, role→game-permission mapping, bulk actions, Discord sync, audit
logging, plus future shared-ban-networks / reputation / access-profiles). That
is far too large for a single spec or implementation plan.

This document specs **Slice 1** only: a central **Player database**, **Global
Ban**, and **Global Whitelist**, with **real enforcement** into game servers.

### Decisions made during brainstorming

1. **Scope of this slice:** Player DB + Global Ban + Global Whitelist.
2. **Enforcement:** Real — write each game's actual config files and, when a
   server is running, also send the live console command.
3. **Target games:** All 8 built-ins get enforcement mappings. Formats that
   cannot be verified ship as `UNSUPPORTED` rather than risk corrupting a
   server config with a wrong format.
4. **Audit:** Dedicated per-player event log (`PlayerEvent`), not the global
   `ActivityLog`, because the audit story is player-centric and seeds the
   future reputation feature.
5. **Per-game mapping** lives declaratively on `GameDefinitionSpec`.

### Existing architecture this builds on

- **Data:** Prisma + SQLite (`src/lib/db.ts`, models in `prisma/schema.prisma`).
  `Collaborator` is the existing per-server people model; `ActivityLog` exists
  for server-level audit.
- **Auth:** `getAuthenticatedUser()` (`src/lib/auth.ts`). Ownership scoping
  mirrors `Server`/`Archive` (rows carry `ownerId`/`userId`).
- **API:** Next.js route handlers at `src/app/api/.../route.ts`.
- **UI:** `src/app/dashboard/<feature>/page.tsx` (server component, fetches
  data) renders a `*View.tsx` client component in `src/components/`. Sidebar nav
  is a `{label, icon, href}[]` array in `DashboardView.tsx`. Modals/toasts via
  `useModal()` / `useToast()`.
- **Enforcement levers:** `GameDefinitionSpec.configFiles` are rendered by
  `planConfigFiles` and written into the install dir (`LocalWindowsRunner.ts`
  ~line 596, via `getLocalServerDir(serverId, installSubDir)`).
  `runner.sendCommand(server, cmd)` writes a line to the running process stdin.

## Data model (Prisma)

All player-owned rows are scoped to a `User` via `ownerId`, mirroring `Server`.

```prisma
model Player {
  id            String   @id @default(cuid())
  ownerId       String
  owner         User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  displayName   String
  // Identity mapping (all nullable; each game uses whichever it needs)
  steamId       String?
  xboxId        String?
  minecraftUuid String?
  minecraftName String?
  discordId     String?   // reserved for the future Discord slice
  notes         String?
  status        String   @default("NEUTRAL") // NEUTRAL | TRUSTED | BANNED (display)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  bans          PlayerBan[]
  whitelists    PlayerWhitelist[]
  events        PlayerEvent[]
  @@index([ownerId])
}

model PlayerBan {           // global ban intent (one active ban per player)
  id        String    @id @default(cuid())
  playerId  String
  player    Player    @relation(fields: [playerId], references: [id], onDelete: Cascade)
  reason    String
  expiresAt DateTime?  // null = permanent
  active    Boolean   @default(true)
  createdAt DateTime  @default(now())
}

model PlayerWhitelist {     // whitelist intent, scoped to chosen servers
  id        String   @id @default(cuid())
  playerId  String
  player    Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  serverId  String   // "all servers" = one row per server
  createdAt DateTime @default(now())
  @@unique([playerId, serverId])
}

model PlayerEnforcement {   // per (player, server, type) applied-state -> status UI
  id        String   @id @default(cuid())
  playerId  String
  serverId  String
  type      String   // "BAN" | "WHITELIST"
  status    String   // "APPLIED" | "PENDING" | "UNSUPPORTED" | "FAILED"
  detail    String?  // error text / which method (file|console)
  appliedAt DateTime @default(now())
  @@unique([playerId, serverId, type])
}

model PlayerEvent {         // per-player audit trail (seeds future reputation)
  id        String   @id @default(cuid())
  playerId  String
  player    Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  actorId   String   // User who performed the action
  action    String   // PLAYER_CREATED | BANNED | UNBANNED | WHITELISTED | WHITELIST_REVOKED | EDITED
  detail    String
  createdAt DateTime @default(now())
  @@index([playerId])
}
```

`User` gains the back-relation: `players Player[]`.

### Semantics

- **Ban is global:** creating a `PlayerBan` targets every server the owner has.
  `PlayerBan.active` toggles on unban. At most one active ban per player.
- **Whitelist is per-server:** `PlayerWhitelist` rows name explicit servers;
  "All servers" expands to one row per current server.
- **`PlayerEnforcement`** is the source of truth for the per-server status
  badges. It is upserted on every apply attempt.
- **`Player.status`** is a denormalized display value kept in sync on
  ban/unban (BANNED when an active ban exists, else NEUTRAL/TRUSTED).

## Enforcement engine

### Declarative per-game mapping on `GameDefinitionSpec`

New optional field `playerList?: PlayerListSpec`:

```ts
type PlayerIdentityKey = "minecraftName" | "minecraftUuid" | "steamId" | "xboxId";
type PlayerListFileFormat = "jsonArray" | "lineList";

interface PlayerListFile {
  path: string;                 // relative to install dir
  format: PlayerListFileFormat;
  field?: string;               // for jsonArray-of-objects, the key holding the id
}

interface PlayerListAction {
  file?: PlayerListFile;
  console?: { add: string; remove: string }; // templated: {id} {reason}
}

interface PlayerListSpec {
  identity: PlayerIdentityKey;  // which Player field this game keys on
  ban?: PlayerListAction;
  whitelist?: (PlayerListAction & { enforced?: boolean });
}
```

### `src/lib/players/enforce.ts`

Pure, testable core + thin I/O shell.

**Pure functions (unit-tested per game):**
- `resolvePlayerId(player, identity)` → the id string (or null if the player
  lacks that identifier → enforcement records `FAILED` "missing <identity>").
- `mergeListFile(existing, id, op)` for `jsonArray` and `lineList` formats —
  idempotent add, clean remove, preserves unrelated entries.
- `renderConsole(template, { id, reason })` → command string.

**`applyToServer(player, server, definition, { type, op })`** (`op` = add|remove):
1. Resolve `playerList` spec for the game. Absent, or the relevant
   `ban`/`whitelist` block absent (or `whitelist.enforced === false`) →
   upsert `PlayerEnforcement` `UNSUPPORTED`, return.
2. Resolve the player id for `spec.identity`. Missing → `FAILED`.
3. **File path:** if `file` defined, read (if present) → `mergeListFile` →
   write into `getLocalServerDir(server.id, installSubDir)`. Reuse the
   `jsonArray`/`lineList` writers (modeled on `writeStrategyConfig`).
4. **Console path:** if `console` defined AND `server.status === "RUNNING"`,
   `runner.sendCommand` the rendered command (live effect, no restart).
5. Upsert `PlayerEnforcement`:
   - `APPLIED` — file written and/or live command sent.
   - `PENDING` — server stopped and the game has console-only enforcement
     (no file), so the change takes effect on next start (queued conceptually;
     re-applied by a hook on start — see Open Questions).
   - `FAILED` — exception or missing id; `detail` carries the message.
   Enforcement errors are **non-fatal**: the intent row persists.

`applyPlayerEverywhere(player, op, type, servers)` iterates the owner's servers
and aggregates `PlayerEnforcement` results for the API response.

### Per-game mapping plan & confidence

| Game | Identity | Ban | Whitelist | Confidence |
|---|---|---|---|---|
| Minecraft | minecraftName (uuid preferred) | `banned-players.json` (jsonArray, field `name`/`uuid`) + console `ban`/`pardon` | `whitelist.json` + console `whitelist add`/`remove` | **High** |
| Valheim | steamId | `bannedlist.txt` (lineList) | `permittedlist.txt` (lineList) | **High** |
| Rust | steamId | `bans.cfg` / `banid` console | console `whitelist`/`ownerid` (mod-dependent) | Medium — verify |
| Palworld | steamId | console `Ban <steamid>` | no native whitelist | Medium — verify; whitelist `UNSUPPORTED` |
| ARK | steamId | `banlist.txt` (lineList) | `PlayersExclusiveJoinList.txt`/`Whitelist.txt` | Medium — verify |
| Project Zomboid | steamId/username | console `banuser`/`banid` | `WhitelistMode` server option | Medium — verify |
| Terraria | name | no native ban file; console `ban` (limited) | no native whitelist | Low — likely `UNSUPPORTED` |
| Enshrouded | steamId | none documented | none documented | Low — likely `UNSUPPORTED` |

**Honesty rule:** any mapping that cannot be verified against authoritative
docs during implementation ships as `UNSUPPORTED` (no file written) rather than
writing a guessed format. The table's "Low/Medium — verify" rows are explicit
flags to confirm before trusting them.

## API surface

All routes use `getAuthenticatedUser()` and enforce owner isolation.

| Route | Methods | Purpose |
|---|---|---|
| `api/players` | GET, POST | List owner players; create player |
| `api/players/[id]` | GET, PATCH, DELETE | Read / edit identity+notes / delete |
| `api/players/[id]/ban` | POST, DELETE | Create global ban (reason, expiresAt) → apply to all servers; DELETE = unban |
| `api/players/[id]/whitelist` | POST, DELETE | Whitelist to serverIds or "all"; DELETE revokes |
| `api/players/bulk` | POST | Bulk `{playerIds, action: ban\|whitelist\|delete}` |

Each mutating route: writes intent rows → runs the enforcement engine for every
affected server → writes a `PlayerEvent` → returns updated per-server
`PlayerEnforcement`. Enforcement failures are surfaced, not thrown.

## UI

- Sidebar entry **"Players"** added to the nav array in `DashboardView.tsx`
  (lucide `Users`/`UserCog` icon) → `src/app/dashboard/players/page.tsx`
  (server component fetches players + servers) → `src/components/PlayersView.tsx`.
- **Master/detail:** left list with selection checkboxes + status dots; right
  detail panel with identity fields, ban state, a per-server whitelist /
  enforcement matrix showing **Applied / Pending / Unsupported / Failed**
  badges, and the player's `PlayerEvent` history inline.
- **Modals** (`useModal()`): Add/Edit Player, Ban Player (reason + duration),
  Whitelist (server multi-select + "All servers"). Toasts via `useToast()`.
- A **bulk action bar** appears when ≥1 player is selected.

## Audit

Every mutation writes a `PlayerEvent` (actor = current user). The detail panel
renders that player's history (issue's "June 24 — Admin banned Jake"). No new
top-level audit page in this slice.

## Testing (TDD)

- **Pure-function unit tests** (primary confidence): per game, `Player` +
  `PlayerListSpec` → expected file contents (`jsonArray`/`lineList` merge,
  idempotent re-apply, removal) and console command strings.
- **Enforcement engine tests** (mocked runner + temp install dir):
  `UNSUPPORTED` with no spec, `PENDING` when stopped & console-only, `APPLIED`
  writes file, `FAILED` on throw / missing id.
- **API route tests** (style of `src/app/api/system/shutdown/__tests__`):
  auth required, owner isolation, ban creates intent + enforcement + event.
- Run via `rtk vitest run`.

## Open questions / implementation notes

- **Re-apply on start:** `PENDING` console-only changes should be flushed when a
  server next starts. Cleanest hook: in the start path of `LocalWindowsRunner`,
  after the process is ready, replay active bans/whitelists for that server.
  Flagged for the implementation plan; may be deferred to a tiny follow-up if it
  expands the start path too much.
- **Validation:** identity fields are free-text in this slice (no Steam/Mojang
  API lookups); format validation only. API verification is a later slice.

## Out of scope (follow-up issues)

Roles & game-permission mapping; Discord role sync; cross-platform identity
*merge* UX; shared ban networks; player reputation; server-access profiles.
