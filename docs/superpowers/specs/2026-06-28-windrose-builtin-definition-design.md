# Windrose builtin game definition — design

**Date:** 2026-06-28
**Status:** Approved (pending implementation)

## Goal

Add **Windrose** as a default (builtin) game definition so it appears alongside the
existing 8 games (Minecraft, Valheim, Enshrouded, Project Zomboid, ARK, Terraria,
Palworld, Rust) and can be installed and run through GameVault's local runner.

Windrose is a co-op seafaring/survival adventure with a **free SteamCMD dedicated
server** (Steam app `4129620`, anonymous login). The dedicated server is **Windows-only**
(no Linux server binary).

## Source facts

From the official dedicated server guide (playwindrose.com) and hosting guides:

- **Install:** SteamCMD app `4129620`, anonymous login. ~35 GB SSD.
- **Executable:** `WindroseServer.exe` at the server install root (a
  `StartServerForeground.bat` also exists for console visibility).
- **Config:** `ServerDescription.json` in the server root, with fields `ServerName`,
  `Password`, `IsPasswordProtected`, and `InviteCode` (6+ alphanumeric, case-sensitive
  join code). No command-line arguments — configuration is via JSON only.
- **Ports:** 7777 TCP + UDP documented for direct connections; the game also uses NAT
  punch-through.
- **RAM (server alone):** 8 GB for 2 players, 12 GB for 4, 16 GB for 10. We use the
  2-player baseline of **8 GB** as the single recommended default.
- **Platform:** Windows-only dedicated server — no Linux binary, so no Docker container
  variant (like Minecraft).

## The definition entry — `src/lib/definitions/builtins.ts`

```ts
{
  slug: "WINDROSE", displayName: "Windrose", icon: "🧭",
  color: "from-teal-500 to-cyan-700 bg-teal-500/10 border-teal-500/30 text-teal-400",
  description: "Co-op seafaring adventure", recommendedRamGB: 8.0,
  installMethod: "STEAMCMD",
  spec: {
    install: { appId: "4129620", installSubDir: "windrose-server",
               checkFile: "WindroseServer.exe", requiredDiskGB: 35.0 },
    launch: { executable: "WindroseServer.exe", cwdSubDir: "windrose-server", args: [] },
    defaultPort: 7777,
    params: [],
    configFiles: [{ path: "ServerDescription.json", strategy: "windroseJson" }],
    editableConfigPath: "windrose-server/ServerDescription.json",
    ports: [{ protocol: "TCP", port: "7777" }, { protocol: "UDP", port: "7777" }],
  },
}
```

Decisions:
- **No `container`** — the dedicated server is Windows-only.
- **No `passwordPolicy`** — the password is optional. The primary join mechanism is the
  `InviteCode`, which is always written.
- **Icon `🧭`** (compass rose) matches the name; **teal** is the first palette not already
  used by another builtin.

## New config strategy — `windroseJson`

Windrose configures via a JSON file with conditional logic (`IsPasswordProtected` depends
on whether a password is set, and `InviteCode` must be generated), so it gets a dedicated
writer like the existing `enshroudedJson` strategy rather than a flat `template`.

- **`src/lib/definitions/types.ts`** — add `"windroseJson"` to the `ConfigStrategy` union.
- **`src/lib/definitions/strategies.ts`** — add:

  ```ts
  function makeInviteCode(serverName: string): string {
    const cleaned = serverName.replace(/[^a-zA-Z0-9]/g, "");
    return (cleaned + "WINDROSE").toUpperCase().slice(0, 6); // always >= 6 alnum chars
  }

  export function writeWindroseConfig(serverDir: string, serverName: string, password?: string) {
    const config = {
      ServerName: serverName,
      Password: password || "",
      IsPasswordProtected: !!password,
      InviteCode: makeInviteCode(serverName),
    };
    fs.writeFileSync(path.join(serverDir, "ServerDescription.json"), JSON.stringify(config, null, 2));
  }
  ```

  Wire it into `writeStrategyConfig`'s dispatch and widen that function's `strategy`
  parameter type to include `"windroseJson"`.
- **Runners** — widen the `cf.strategy as "enshroudedJson" | "zomboidIniMerge"` casts in
  `src/lib/runners/LocalWindowsRunner.ts` and `src/lib/runners/DockerRunner.ts` to also
  include `"windroseJson"`.

The deterministic `InviteCode` is testable and user-editable afterward (the file is the
`editableConfigPath`). A user can change it, the server name, or the password through the
config editor after install.

## Seed mirror — `src/lib/definitions/builtins.generated.json`

This file is a hand-maintained JSON mirror of `builtins.ts`, consumed by the plain-node
`prisma/seed.js` (which can't import TS). Add the matching Windrose object (same field
values as above, with `recommendedRamGB: 8`) so a fresh `npm run seed` picks it up.

## Tests

- **`__tests__/builtins.test.ts`** — bump the count from 8 to 9 games and add `"WINDROSE"`
  to the sorted slug list. The existing `every builtin spec validates` loop covers the new
  spec automatically.
- **`__tests__/parity.test.ts`** — add a Windrose case asserting the install target
  (`appId: "4129620"`, `checkFile: "WindroseServer.exe"`, `requiredDiskGB: 35`) and the
  launch executable (`WindroseServer.exe`, empty args).
- **`__tests__/` strategy coverage** — add a test for `writeWindroseConfig`:
  - password present → `IsPasswordProtected: true`, `Password` set;
  - empty password → `IsPasswordProtected: false`, `Password: ""`;
  - `InviteCode` is ≥6 alphanumeric characters and deterministic for a given name.

## Verification / open implementation details

- `validateSpec` does not gate strategy names against an allowlist, so `windroseJson`
  validates without changes.
- `writeStrategyConfig` is called with `installDir`. During implementation, confirm the
  exact directory so `ServerDescription.json` lands at the windrose-server root and stays
  consistent with `editableConfigPath` — mirroring however `enshroudedJson` resolves its
  path today.
- Ports use 7777 TCP+UDP for parity with the documented direct-connection port and what
  hosting providers open; NAT punch-through is handled by the game at runtime.

## Out of scope

- Docker/Linux container support for Windrose (no Linux server binary exists).
- Any UI changes beyond what the builtin list renders automatically.
- Tunable gameplay `params` — none are exposed for the initial definition.
