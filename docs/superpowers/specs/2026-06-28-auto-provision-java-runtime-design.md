# Auto-Provision Java Runtime for Minecraft (and other Java servers)

**Date:** 2026-06-28
**Status:** Approved design — ready for implementation plan

## Problem

Starting a Minecraft server locally fails for many users because of Java. The current
runner ([`src/lib/runners/LocalWindowsRunner.ts`](../../../src/lib/runners/LocalWindowsRunner.ts))
only checks whether *any* `java` is on `PATH`:

```ts
if (requiresJava) {
  if (!(await checkJavaInstalled())) {
    throw new Error("Java Runtime Environment (JRE) was not found ... Please install Java (JDK/JRE 17+) ...");
  }
}
```

This produces two distinct user-facing failures:

1. **No Java installed** → a hard wall. The user must find, download, and install a JDK/JRE
   themselves before the app works. (This is the manual step the maintainer hit.)
2. **Wrong Java version installed** → the check *passes* (some `java` is on PATH), the server
   launches, then crashes with a cryptic `UnsupportedClassVersionError`. The Minecraft server
   jar requires a specific Java *major* version (current vanilla → Java 21); an older system
   Java (e.g. 8 or 17) silently fails this way.

Both contradict the app's simplicity goal: the user should never have to think about Java.

The pinned Minecraft server-jar URL being stale was a related earlier symptom; that has already
been corrected in `builtins.generated.json`, so dynamic URL resolution is **out of scope** here.

## Goal

When a Java-based server starts, automatically ensure the **correct Java major version** is
present and launch using it — no manual install, no dependence on the user's `PATH`, no version
mismatch. The process is invisible: a progress bar, identical in feel to the existing
download/SteamCMD provisioning.

## Approach

Download a version-matched JRE on demand from the **Adoptium Temurin** API, cache it in the
app data directory, and launch the server with that JRE's absolute path. This mirrors the
existing on-demand provisioning of SteamCMD (`setupSteamCMD`), so it fits the codebase and
stays invisible to the user.

Rejected alternatives:
- *Ship JREs in the installer* — bloats the installer by 100 MB+ per major version and can't
  adapt to future version requirements.
- *Install Java via winget/choco* — adds an external dependency and admin prompts; fights the
  simplicity goal.

## Design

### 1. Declare the required Java version in the definition

Add an optional field to `GameDefinitionSpec` in
[`src/lib/definitions/types.ts`](../../../src/lib/definitions/types.ts):

```ts
requiresJava?: boolean;
javaMajor?: number;   // major version the jar needs (e.g. 21). Meaningful only when requiresJava.
```

- The Minecraft built-in sets `requiresJava: true, javaMajor: 21` (its current pinned jar is a
  modern version requiring Java 21).
- The runner treats a missing `javaMajor` as **21** (`spec.javaMajor ?? 21`). This makes the
  feature **backward compatible**: existing user databases already seeded with the old Minecraft
  spec (no `javaMajor`) still auto-provision Java 21 — no re-seed required for them to benefit.

`javaMajor` flows through unchanged via `parseSpec`/`stringifySpec` (plain JSON). It does not
need to be added to `InstallPlan`/`LaunchPlan`; the runner already holds the full `spec` and
reads `spec.javaMajor` directly. `validateSpec` does not need a new rule (optional numeric field),
though an optional sanity check (`javaMajor` is a positive integer when present) may be added.

### 2. New module: `src/lib/runtimes/javaRuntime.ts`

A self-contained, unit-testable module whose single public job is:

```ts
ensureJava(major: number, opts: {
  dataRoot: string;
  onLog?: (msg: string) => void;
  onProgress?: (percent: number | null, label: string) => void;
}): Promise<string>   // resolves to an absolute path to java.exe
```

Behavior:

1. **Cache location:** `path.join(dataRoot, "runtimes", "jdk-<major>")`. Shared across all
   servers (NOT per-server) so a ~45 MB JRE is downloaded at most once per major version.
2. **Already provisioned?** If `<cacheDir>/bin/java.exe` exists, return it immediately.
3. **Download** from the Adoptium Temurin API:
   `https://api.adoptium.net/v3/binary/latest/<major>/ga/windows/x64/jre/hotspot/normal/eclipse`
   This endpoint **302-redirects** to the actual archive (`.zip`). The download must follow
   redirects.
4. **Extract** the `.zip` with PowerShell `Expand-Archive` (the same mechanism `setupSteamCMD`
   uses for `steamcmd.zip`). The archive contains a single top-level directory
   (e.g. `jdk-21.0.x+y-jre/`); flatten it so `java.exe` lands at `<cacheDir>/bin/java.exe`.
5. **Verify** `<cacheDir>/bin/java.exe` exists; delete the partial download and any half-extracted
   directory on failure so a retry starts clean (consistent with the existing
   "clean failed downloads" behavior in the runner).
6. Return the absolute path.

**Redirect-aware download:** the existing `downloadFile` in the runner uses `https.get` and does
not follow 3xx redirects. Provide a redirect-following download inside this module (cap redirects,
e.g. 5). Generalizing the runner's `downloadFile` to follow redirects is an acceptable alternative,
decided during implementation; the design requires only that the JRE download follows redirects.

**Pure helpers (extracted for unit tests, deps injected like `resolveExecutablePath`):**
- `adoptiumUrl(major)` → the request URL.
- `findArchiveJavaRoot(entries, exists)` → locate the extracted top-level dir / the dir containing
  `bin/java.exe` for flattening.
- `parseJavaMajor(versionOutput)` → parse `java -version` stderr text to a major number (used by
  the optional system-Java reuse check below).

### 3. Runner integration (`LocalWindowsRunner.ts`)

Replace the throw-block (currently lines ~495–499):

```ts
let javaExe: string | undefined;
if (requiresJava) {
  setProgress(serverId, { phase: "java", percent: null, label: "Preparing Java runtime…" });
  try {
    javaExe = await ensureJava(spec.javaMajor ?? 21, {
      dataRoot: dataRoot(),
      onLog: logWriter,
      onProgress: (percent, label) => setProgress(serverId, { phase: "java", percent, label }),
    });
  } catch (err: any) {
    clearProgress(serverId);
    logWriter(`Java runtime setup failed: ${err.message}`);
    throw new Error(`Failed to prepare the Java runtime needed to run this server: ${err.message}`);
  }
}
```

At spawn time, when `requiresJava` and the launch executable is the bare `java` command, use the
provisioned absolute path instead of PATH-resolving `java`:

```ts
const resolvedExe = resolveCommand(installDir, launch.executable, launch.executableOnPath);
let finalExe: string;
if (requiresJava && launch.executable === "java" && javaExe) {
  finalExe = javaExe;                 // bundled JRE — never trust the user's PATH java
} else if (launch.executableOnPath) {
  finalExe = resolveExecutablePath(resolvedExe, process.env.PATH || "",
    process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM", fs.existsSync);
} else {
  finalExe = resolvedExe;
}
```

`executableOnPath` semantics for non-Java launchers (e.g. `cmd.exe` for Zomboid) are unchanged.
The `"java"` progress phase is added alongside the existing `steam`/`download`/`extract`/`script`
phases (a UI label of "Downloading Java 21 …%").

**Optional optimization (decide in plan):** before downloading, run the system `java -version`,
parse its major with `parseJavaMajor`, and reuse it if it equals `major`. The maintainer chose a
"version-aware" provisioner over "prefer system Java," so the default behavior is to use the
bundled JRE for determinism; this optimization, if added, must still guarantee the major matches.

### 4. Reconcile the drifted builtins sources

`prisma/seed.js` seeds the runtime DB from
[`src/lib/definitions/builtins.generated.json`](../../../src/lib/definitions/builtins.generated.json),
which is supposed to be a regenerated mirror of
[`src/lib/definitions/builtins.ts`](../../../src/lib/definitions/builtins.ts) but has **drifted**:
the JSON has a newer pinned Minecraft URL plus `queryType: "minecraft"` and a `readyPattern` that
the `.ts` lacks. Naively regenerating from the current `.ts` would *regress* the live seed.

Therefore, as part of this change:
1. Bring `builtins.ts` up to match the live JSON for Minecraft (corrected `url`, add `queryType`,
   add `readyPattern`).
2. Add `requiresJava: true, javaMajor: 21` to the Minecraft spec in `builtins.ts`.
3. Regenerate `builtins.generated.json` with the documented command:
   `npx tsx -e "import {BUILTIN_DEFINITIONS} from './src/lib/definitions/builtins'; import fs from 'fs'; fs.writeFileSync('./src/lib/definitions/builtins.generated.json', JSON.stringify(BUILTIN_DEFINITIONS, null, 2));"`
4. Confirm the regenerated JSON differs from the old one only in the intended fields (URL stays
   as the corrected one, `queryType`/`readyPattern` preserved, `javaMajor` added).

Existing users whose DB is not re-seeded are still covered by the `spec.javaMajor ?? 21` default
in the runner.

### 5. Error handling & disk space

- Network/extract failures surface an actionable message ("Failed to prepare the Java runtime …")
  and leave no partial files (delete partial `.zip` and half-extracted dir).
- Optionally reuse `getFreeDiskSpaceGB` to pre-check ~0.3 GB before downloading the JRE, matching
  the SteamCMD disk-check pattern. Low priority; decide in plan.

## Testing

Following TDD, the testable surface is the pure module — the runner spawn path is integration-level
and stays thin.

- `javaRuntime` unit tests (deps injected, no real network/fs):
  - `adoptiumUrl(major)` produces the expected URL for a given major.
  - `findArchiveJavaRoot` locates the `bin/java.exe`-bearing directory for flattening.
  - `parseJavaMajor` parses representative `java -version` outputs (8, 17, 21) to the right major.
  - "already provisioned" short-circuit returns the cached path without downloading.
- Definition tests:
  - Minecraft built-in has `requiresJava: true` and `javaMajor: 21`
    (`builtins.test.ts` / `parity.test.ts`).
  - `builtins.generated.json` is in sync with `builtins.ts` for the changed fields
    (URL, `queryType`, `readyPattern`, `javaMajor`).
  - Every built-in spec still validates (`validateSpec` returns `[]`).

## Scope

**In scope:** auto-provisioning a version-matched Windows x64 JRE for `requiresJava` definitions;
launching with its absolute path; reconciling the builtins source drift.

**Out of scope (YAGNI):**
- Dynamic Minecraft version selection via the Mojang version manifest (the pinned URL is already
  corrected).
- Modded servers (Forge/Fabric/Paper) — different jars/launch flows.
- Non-Windows / non-x64 runtimes and the Linux container path (the app targets Windows x64;
  Minecraft has no container spec today).
