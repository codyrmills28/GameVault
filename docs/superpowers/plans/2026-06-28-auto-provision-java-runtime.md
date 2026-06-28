# Auto-Provision Java Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Java-based servers (Minecraft) launch with zero manual setup by auto-downloading a version-matched JRE, launching with its absolute path, and self-healing the Java version if the jar needs a newer one.

**Architecture:** A new isolated module `src/lib/runtimes/javaRuntime.ts` owns all Java concerns: building the Adoptium download URL, downloading (following redirects) + extracting + flattening a Temurin JRE into a shared app-data cache, and parsing a JVM `UnsupportedClassVersionError` to learn the required version. `LocalWindowsRunner` calls `ensureJava(major)` before launch, spawns the server with the returned `java.exe` path, and on a version-mismatch exit re-provisions the correct Java and relaunches once.

**Tech Stack:** TypeScript, Node `https`/`child_process`, Windows PowerShell `Expand-Archive`, Vitest, Prisma (SQLite), Adoptium Temurin API.

## Global Constraints

- Target platform: **Windows x64 only** (the app targets Windows; JRE asset is `windows/x64`).
- Extraction uses **Windows PowerShell `Expand-Archive`** (same mechanism as `setupSteamCMD`).
- Reuse `computePercent` from `src/lib/downloadProgress.ts` for download percentages — do not reimplement.
- The JRE download endpoint **302-redirects**; the downloader MUST follow redirects (cap at 5).
- JRE cache is **shared across servers** at `dataRoot()/runtimes/jdk-<major>/` — never per-server.
- **Do NOT run `npx tsx … regenerate`** for `builtins.generated.json`. It would delete the dev-seed's Satisfactory/V Rising and strip `readyPattern`/`preLaunchDirs`. Edit that JSON by hand only.
- `builtins.ts` is the **runtime** source of truth (via `ensureBuiltinsSeeded`); `builtins.generated.json` is **dev-seed only** (`prisma/seed.js`).
- Default Java major when unspecified is **25** (`spec.javaMajor ?? 25`).
- Run tests with `rtk npx vitest run <path>`; typecheck with `rtk npx tsc --noEmit`; git via `rtk git …`.

## File Structure

- Create: `src/lib/runtimes/javaRuntime.ts` — all Java provisioning + parsing (pure helpers + `ensureJava`).
- Create: `src/lib/runtimes/__tests__/javaRuntime.test.ts` — unit tests for the pure surface + `ensureJava` short-circuit.
- Modify: `src/lib/definitions/types.ts` — add `javaMajor?: number` to `GameDefinitionSpec`.
- Modify: `src/lib/definitions/builtins.ts` — Minecraft spec gains `javaMajor: 25`.
- Modify: `src/lib/definitions/builtins.generated.json` — hand-add `"javaMajor": 25` to the Minecraft entry (mirror only).
- Modify: `src/lib/definitions/__tests__/builtins.test.ts` — assert Minecraft `requiresJava`/`javaMajor`.
- Modify: `src/lib/runners/LocalWindowsRunner.ts` — provision Java before launch, spawn with full path, self-heal on version mismatch.

---

### Task 1: Pure Java-version helpers

**Files:**
- Create: `src/lib/runtimes/javaRuntime.ts`
- Test: `src/lib/runtimes/__tests__/javaRuntime.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, deps injected).
- Produces:
  - `adoptiumUrl(major: number): string`
  - `parseRequiredJavaMajor(text: string): number | null`
  - `findArchiveJavaRoot(entries: string[], exists: (relPath: string) => boolean): string | null`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/runtimes/__tests__/javaRuntime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { adoptiumUrl, parseRequiredJavaMajor, findArchiveJavaRoot } from "../javaRuntime";

describe("adoptiumUrl", () => {
  it("builds the Windows x64 GA JRE endpoint for a major version", () => {
    expect(adoptiumUrl(25)).toBe(
      "https://api.adoptium.net/v3/binary/latest/25/ga/windows/x64/jre/hotspot/normal/eclipse"
    );
  });
});

describe("parseRequiredJavaMajor", () => {
  it("maps class file version to Java major (classFileVersion - 44)", () => {
    const msg = (v: string) =>
      `java.lang.UnsupportedClassVersionError: net/minecraft/bundler/Main has been compiled by a more recent version of the Java Runtime (class file version ${v}), this version of the Java Runtime only recognizes class file versions up to 65.0`;
    expect(parseRequiredJavaMajor(msg("69.0"))).toBe(25);
    expect(parseRequiredJavaMajor(msg("65.0"))).toBe(21);
    expect(parseRequiredJavaMajor(msg("61.0"))).toBe(17);
  });
  it("returns null when there is no class-file-version marker", () => {
    expect(parseRequiredJavaMajor("some unrelated crash log")).toBeNull();
    expect(parseRequiredJavaMajor("")).toBeNull();
  });
});

describe("findArchiveJavaRoot", () => {
  it("returns the single top dir that contains bin/java.exe", () => {
    const entries = ["jdk-25+9-jre", "jdk-25+9-jre/bin/java.exe"];
    const exists = (p: string) => p === "jdk-25+9-jre/bin/java.exe";
    expect(findArchiveJavaRoot(entries, exists)).toBe("jdk-25+9-jre");
  });
  it("returns empty string when java.exe is already at the root", () => {
    expect(findArchiveJavaRoot(["bin/java.exe"], (p) => p === "bin/java.exe")).toBe("");
  });
  it("returns null when java.exe is absent", () => {
    expect(findArchiveJavaRoot(["foo", "foo/bar"], () => false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `rtk npx vitest run src/lib/runtimes/__tests__/javaRuntime.test.ts`
Expected: FAIL — cannot resolve `../javaRuntime`.

- [ ] **Step 3: Implement the pure helpers**

Create `src/lib/runtimes/javaRuntime.ts`:

```ts
/**
 * Java runtime provisioning for Java-based game servers (e.g. Minecraft).
 * Pure helpers here are deps-injectable and unit-tested; the impure download/
 * extract path lives in `ensureJava` (Task 2).
 */

/** Adoptium Temurin "latest GA JRE" binary endpoint for a Windows x64 major version.
 *  This URL 302-redirects to the actual .zip asset. */
export function adoptiumUrl(major: number): string {
  return `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`;
}

/** Parse a JVM `UnsupportedClassVersionError` and return the Java *major* version the jar needs.
 *  The error reports a class-file version (e.g. "class file version 69.0"); the required Java
 *  major is that number minus 44 (52->8, 61->17, 65->21, 69->25). Returns null when no such
 *  marker is present (i.e. the failure was not a Java-version mismatch). */
export function parseRequiredJavaMajor(text: string): number | null {
  if (!text) return null;
  const m = text.match(/class file version (\d+)(?:\.\d+)?/i);
  if (!m) return null;
  const classFileVersion = parseInt(m[1], 10);
  if (!Number.isFinite(classFileVersion)) return null;
  const major = classFileVersion - 44;
  return major > 0 ? major : null;
}

/** Given the top-level entries of an extracted Temurin archive and an existence check (both
 *  relative to the extract root), return the sub-directory that contains "bin/java.exe" so the
 *  caller can flatten it. Temurin zips contain a single top dir like "jdk-21.0.5+11-jre/".
 *  Returns "" when bin/java.exe is already at the root, or null when not found. */
export function findArchiveJavaRoot(
  entries: string[],
  exists: (relPath: string) => boolean
): string | null {
  if (exists("bin/java.exe")) return "";
  const topDirs = new Set<string>();
  for (const e of entries) {
    const seg = e.replace(/\\/g, "/").split("/")[0];
    if (seg) topDirs.add(seg);
  }
  for (const dir of topDirs) {
    if (exists(`${dir}/bin/java.exe`)) return dir;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk npx vitest run src/lib/runtimes/__tests__/javaRuntime.test.ts`
Expected: PASS (all 3 describe blocks green).

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/runtimes/javaRuntime.ts src/lib/runtimes/__tests__/javaRuntime.test.ts
rtk git commit -m "feat(runtimes): add pure Java-version helpers (adoptium URL, classfile parse, archive root)"
```

---

### Task 2: `ensureJava` provisioning orchestration

**Files:**
- Modify: `src/lib/runtimes/javaRuntime.ts`
- Test: `src/lib/runtimes/__tests__/javaRuntime.test.ts`

**Interfaces:**
- Consumes: `adoptiumUrl`, `findArchiveJavaRoot` (Task 1); `computePercent` from `@/lib/downloadProgress`.
- Produces:
  - `interface EnsureJavaOpts { dataRoot: string; onLog?: (m: string) => void; onProgress?: (percent: number | null, label: string) => void; }`
  - `interface EnsureJavaDeps { exists?: (p: string) => boolean; provision?: (major: number, cacheDir: string, opts: EnsureJavaOpts) => Promise<void>; }`
  - `ensureJava(major: number, opts: EnsureJavaOpts, deps?: EnsureJavaDeps): Promise<string>` — resolves to an absolute path to `java.exe`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/runtimes/__tests__/javaRuntime.test.ts`:

```ts
import path from "path";
import { ensureJava } from "../javaRuntime";

describe("ensureJava", () => {
  const javaPath = (root: string, major: number) =>
    path.join(root, "runtimes", `jdk-${major}`, "bin", "java.exe");

  it("returns the cached java.exe without provisioning when already present", async () => {
    let provisioned = false;
    const result = await ensureJava(
      25,
      { dataRoot: "/data" },
      {
        exists: (p) => p === javaPath("/data", 25),
        provision: async () => {
          provisioned = true;
        },
      }
    );
    expect(result).toBe(javaPath("/data", 25));
    expect(provisioned).toBe(false);
  });

  it("provisions when missing, then returns the path", async () => {
    const calls: number[] = [];
    let present = false;
    const result = await ensureJava(
      21,
      { dataRoot: "/d" },
      {
        exists: () => present,
        provision: async (major) => {
          calls.push(major);
          present = true;
        },
      }
    );
    expect(calls).toEqual([21]);
    expect(result).toBe(javaPath("/d", 21));
  });

  it("throws when provisioning leaves no java.exe", async () => {
    await expect(
      ensureJava(21, { dataRoot: "/d" }, {
        exists: () => false,
        provision: async () => {},
      })
    ).rejects.toThrow(/did not contain/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `rtk npx vitest run src/lib/runtimes/__tests__/javaRuntime.test.ts`
Expected: FAIL — `ensureJava` is not exported.

- [ ] **Step 3: Implement `ensureJava` and the real provisioner**

Append to `src/lib/runtimes/javaRuntime.ts` (and add the imports at the top of the file):

```ts
import fs from "fs";
import path from "path";
import https from "https";
import { exec } from "child_process";
import { computePercent } from "@/lib/downloadProgress";

export interface EnsureJavaOpts {
  dataRoot: string;
  onLog?: (msg: string) => void;
  onProgress?: (percent: number | null, label: string) => void;
}

export interface EnsureJavaDeps {
  exists?: (p: string) => boolean;
  provision?: (major: number, cacheDir: string, opts: EnsureJavaOpts) => Promise<void>;
}

/** Ensure a Temurin JRE of the given major version is available and return the absolute path to
 *  its java.exe. Downloads + extracts into a shared cache (dataRoot/runtimes/jdk-<major>) on first
 *  use; subsequent calls short-circuit. `deps` is injected in tests; defaults hit the real network. */
export async function ensureJava(
  major: number,
  opts: EnsureJavaOpts,
  deps: EnsureJavaDeps = {}
): Promise<string> {
  const exists = deps.exists ?? fs.existsSync;
  const provision = deps.provision ?? defaultProvision;
  const cacheDir = path.join(opts.dataRoot, "runtimes", `jdk-${major}`);
  const javaExe = path.join(cacheDir, "bin", "java.exe");

  if (exists(javaExe)) {
    opts.onLog?.(`Using cached Java ${major} runtime.`);
    return javaExe;
  }

  opts.onLog?.(`Java ${major} runtime not found. Downloading…`);
  await provision(major, cacheDir, opts);

  if (!exists(javaExe)) {
    throw new Error(`Java ${major} runtime did not contain bin/java.exe after extraction.`);
  }
  return javaExe;
}

// --- Real (impure) provisioning: download -> extract -> flatten into cacheDir ---

async function defaultProvision(major: number, cacheDir: string, opts: EnsureJavaOpts): Promise<void> {
  const runtimesDir = path.dirname(cacheDir);
  fs.mkdirSync(runtimesDir, { recursive: true });

  const zipPath = `${cacheDir}.download.zip`;
  const tmpDir = `${cacheDir}.extract`;
  // Clear leftovers from any prior failed attempt so we start clean.
  try { fs.rmSync(zipPath, { force: true }); } catch (_) {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  try {
    opts.onProgress?.(null, `Downloading Java ${major}…`);
    await downloadFollowingRedirects(adoptiumUrl(major), zipPath, (p) =>
      opts.onProgress?.(
        p,
        p === null ? `Downloading Java ${major}…` : `Downloading Java ${major} ${Math.round(p)}%`
      )
    );

    opts.onProgress?.(null, `Extracting Java ${major}…`);
    await extractZip(zipPath, tmpDir);

    const root = findArchiveJavaRoot(fs.readdirSync(tmpDir), (rel) =>
      fs.existsSync(path.join(tmpDir, rel))
    );
    if (root === null) {
      throw new Error("extracted Java archive did not contain bin/java.exe");
    }
    const src = root === "" ? tmpDir : path.join(tmpDir, root);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.renameSync(src, cacheDir);
  } finally {
    try { fs.rmSync(zipPath, { force: true }); } catch (_) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function extractZip(zip: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zip}' -DestinationPath '${destDir}' -Force"`;
    exec(cmd, (err) =>
      err ? reject(new Error(`Failed to extract Java archive: ${err.message}`)) : resolve()
    );
  });
}

/** https.get that follows 3xx redirects (the Adoptium endpoint redirects to a GitHub asset). */
function downloadFollowingRedirects(
  url: string,
  dest: string,
  onProgress?: (percent: number | null) => void,
  redirectsLeft = 5
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume(); // drain so the socket frees
        if (redirectsLeft <= 0) {
          reject(new Error("Too many redirects while downloading Java"));
          return;
        }
        const next = new URL(res.headers.location, url).toString();
        resolve(downloadFollowingRedirects(next, dest, onProgress, redirectsLeft - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`Failed to download Java: status ${status}`));
        return;
      }
      const total = parseInt(res.headers["content-length"] || "", 10);
      let received = 0;
      let lastEmit = 0;
      const file = fs.createWriteStream(dest);
      onProgress?.(computePercent(received, total));
      res.on("data", (chunk) => {
        received += chunk.length;
        const now = Date.now();
        if (now - lastEmit >= 250) {
          lastEmit = now;
          onProgress?.(computePercent(received, total));
        }
      });
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        onProgress?.(computePercent(received, total));
        resolve();
      });
      file.on("error", (e) => {
        fs.unlink(dest, () => {});
        reject(e);
      });
    });
    req.on("error", (e) => {
      fs.unlink(dest, () => {});
      reject(e);
    });
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk npx vitest run src/lib/runtimes/__tests__/javaRuntime.test.ts`
Expected: PASS (Task 1 + the 3 new `ensureJava` tests).

- [ ] **Step 5: Typecheck**

Run: `rtk npx tsc --noEmit`
Expected: no errors (the `@/lib/downloadProgress` import resolves via the tsconfig path alias).

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/runtimes/javaRuntime.ts src/lib/runtimes/__tests__/javaRuntime.test.ts
rtk git commit -m "feat(runtimes): add ensureJava (download/extract/flatten Temurin JRE into shared cache)"
```

---

### Task 3: Declare `javaMajor` on the definition + Minecraft built-in

**Files:**
- Modify: `src/lib/definitions/types.ts:64` (the `requiresJava?` line in `GameDefinitionSpec`)
- Modify: `src/lib/definitions/builtins.ts:20` (Minecraft spec `requiresJava: true`)
- Modify: `src/lib/definitions/builtins.generated.json` (Minecraft entry — hand edit, mirror only)
- Test: `src/lib/definitions/__tests__/builtins.test.ts`

**Interfaces:**
- Consumes: `GameDefinitionSpec` (Task adds `javaMajor?: number`).
- Produces: Minecraft built-in spec with `requiresJava: true, javaMajor: 25`, readable via `BUILTIN_DEFINITIONS` and `spec.javaMajor`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/definitions/__tests__/builtins.test.ts` inside the existing `describe("builtin definitions", ...)` block:

```ts
  it("Minecraft requires Java and pins an initial major version", () => {
    const mc = BUILTIN_DEFINITIONS.find((d) => d.slug === "MINECRAFT")!;
    expect(mc.spec.requiresJava).toBe(true);
    expect(mc.spec.javaMajor).toBe(25);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `rtk npx vitest run src/lib/definitions/__tests__/builtins.test.ts`
Expected: FAIL — `mc.spec.javaMajor` is `undefined` (and may be a TS error: property `javaMajor` does not exist).

- [ ] **Step 3: Add the field to the type**

In `src/lib/definitions/types.ts`, in the `GameDefinitionSpec` interface, add `javaMajor` right after the existing `requiresJava?: boolean;` line:

```ts
  requiresJava?: boolean;
  javaMajor?: number;   // initial Java major to provision (e.g. 25); runner self-heals to a higher one if the jar needs it
```

- [ ] **Step 4: Set it on the Minecraft built-in**

In `src/lib/definitions/builtins.ts`, in the Minecraft spec, change:

```ts
      requiresJava: true,
```

to:

```ts
      requiresJava: true,
      javaMajor: 25,
```

- [ ] **Step 5: Mirror the field into the dev-seed JSON (hand edit — DO NOT regenerate)**

In `src/lib/definitions/builtins.generated.json`, in the `"MINECRAFT"` entry's `spec`, add `"javaMajor": 25,` immediately after the `"requiresJava": true,` line:

```json
      "requiresJava": true,
      "javaMajor": 25,
```

(Leave everything else in that file untouched — it still has 10 games / `readyPattern`s that must be preserved.)

- [ ] **Step 6: Run the definition tests to verify they pass**

Run: `rtk npx vitest run src/lib/definitions`
Expected: PASS — the new Minecraft test passes, the "has all 8 games" assertion is unchanged, and "every builtin spec validates" still returns `[]` for all specs.

- [ ] **Step 7: Commit**

```bash
rtk git add src/lib/definitions/types.ts src/lib/definitions/builtins.ts src/lib/definitions/builtins.generated.json src/lib/definitions/__tests__/builtins.test.ts
rtk git commit -m "feat(definitions): declare javaMajor and set Minecraft to Java 25"
```

---

### Task 4: Provision Java in the runner and launch with its full path

**Files:**
- Modify: `src/lib/runners/LocalWindowsRunner.ts` (imports; `globalForRunner`; `startLocalServer` Java block ~495–499 and spawn block ~611–623)

**Interfaces:**
- Consumes: `ensureJava` (Task 2); `spec.javaMajor` (Task 3); existing `setProgress`/`clearProgress`/`dataRoot`/`resolveCommand`/`resolveExecutablePath`.
- Produces: a `javaMajorOverrides: Map<string, number>` on `globalForRunner` (consumed by Task 5); servers with `requiresJava` launch using the provisioned `java.exe`.

- [ ] **Step 1: Add the import**

In `src/lib/runners/LocalWindowsRunner.ts`, add near the other definition imports (after the `planInstall …` import on line 14):

```ts
import { ensureJava, parseRequiredJavaMajor } from "../runtimes/javaRuntime";
```

- [ ] **Step 2: Add the override map to the global runner state**

Extend the `globalForRunner` type and initializers. Change the type block:

```ts
const globalForRunner = globalThis as unknown as {
  localProcesses: Map<string, any> | undefined;
  intentionalStops: Set<string> | undefined;
  crashCounters: Map<string, CrashCounter> | undefined;
  javaMajorOverrides: Map<string, number> | undefined;
};
```

Add an initializer alongside the existing ones:

```ts
if (!globalForRunner.javaMajorOverrides) {
  globalForRunner.javaMajorOverrides = new Map();
}
```

And add the local alias next to the other aliases (`const crashCounters = …`):

```ts
const javaMajorOverrides = globalForRunner.javaMajorOverrides;
```

- [ ] **Step 3: Replace the Java check block with provisioning**

In `startLocalServer`, replace this block (currently around lines 495–499):

```ts
  // 3. Install if needed
  if (requiresJava) {
    if (!(await checkJavaInstalled())) {
      throw new Error("Java Runtime Environment (JRE) was not found on your system. Please install Java (JDK/JRE 17+) to run Minecraft servers locally.");
    }
  }
```

with:

```ts
  // 3. Install if needed
  let javaExe: string | undefined;
  if (requiresJava) {
    const major = javaMajorOverrides.get(serverId) ?? spec.javaMajor ?? 25;
    try {
      await prisma.server.update({ where: { id: serverId }, data: { status: "STARTING" } });
      serverEventBus.emit("status_update", { serverId, status: "STARTING" });
      setProgress(serverId, { phase: "java", percent: null, label: `Preparing Java ${major}…` });
      javaExe = await ensureJava(major, {
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

- [ ] **Step 4: Use the provisioned java.exe at spawn time**

In the `else` branch of the launch block, replace the `resolvedExe`/`finalExe` computation (currently around lines 615–623):

```ts
    const resolvedExe = resolveCommand(installDir, launch.executable, launch.executableOnPath);
    const finalExe = launch.executableOnPath
      ? resolveExecutablePath(
          resolvedExe,
          process.env.PATH || "",
          process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM",
          fs.existsSync
        )
      : resolvedExe;
```

with:

```ts
    const resolvedExe = resolveCommand(installDir, launch.executable, launch.executableOnPath);
    let finalExe: string;
    if (requiresJava && launch.executable === "java" && javaExe) {
      finalExe = javaExe; // bundled JRE — never trust the user's PATH java
    } else if (launch.executableOnPath) {
      finalExe = resolveExecutablePath(
        resolvedExe,
        process.env.PATH || "",
        process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM",
        fs.existsSync
      );
    } else {
      finalExe = resolvedExe;
    }
```

- [ ] **Step 5: Typecheck and run the full test suite**

Run: `rtk npx tsc --noEmit`
Expected: no errors. (`checkJavaInstalled` remains defined/exported and unused by `startLocalServer` — that is fine; do not delete it.)

Run: `rtk npx vitest run`
Expected: PASS — all existing tests still green (no runner unit tests regress; parity/builtins/javaRuntime pass).

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/runners/LocalWindowsRunner.ts
rtk git commit -m "feat(runner): auto-provision Java and launch Minecraft with the bundled JRE"
```

---

### Task 5: Self-heal the Java version on `UnsupportedClassVersionError`

**Files:**
- Modify: `src/lib/runners/LocalWindowsRunner.ts` (`handleProcessExit`, before the crash-counter logic)

**Interfaces:**
- Consumes: `parseRequiredJavaMajor` (Task 1, already imported in Task 4); `javaMajorOverrides` (Task 4); existing `getServerLogTail`, `clearStatsHistory`, `startLocalServer`, `serverEventBus`.
- Produces: a one-shot, per-required-version relaunch with the correct Java when the server died only because the bundled Java was too old.

- [ ] **Step 1: Add the self-heal branch**

In `handleProcessExit`, inside the `try` block, immediately after:

```ts
    const serverRec = await prisma.server.findUnique({ where: { id: serverId } });
    if (!serverRec) return;
```

insert:

```ts
    // Self-heal: the server may have failed only because the bundled Java was too old for its jar.
    // Detect the required version from the JVM error, learn it, and relaunch once with the right Java.
    // Runs before crash detection so a version mismatch never burns the crash-retry budget.
    if (!wasIntentional) {
      const requiredJava = parseRequiredJavaMajor(getServerLogTail(serverId));
      if (requiredJava && javaMajorOverrides.get(serverId) !== requiredJava) {
        javaMajorOverrides.set(serverId, requiredJava);
        appendLog(serverId, `[Java] This server needs Java ${requiredJava}. Downloading it and retrying…`);
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "STARTING", pid: null, cpuUsage: 0, memoryUsage: 0 },
        }).catch(() => {});
        serverEventBus.emit("status_update", { serverId, status: "STARTING" });
        clearStatsHistory(serverId);
        startLocalServer(serverId, serverRec.game, serverRec.ramAllocation).catch((e: any) =>
          appendLog(serverId, `[Java] Retry after version detection failed: ${e.message}`)
        );
        return;
      }
    }
```

Why this is safe and terminates:
- `startLocalServer` calls `clearLogs(serverId)` on entry, so a second failure cannot re-match the *same* stale error text.
- The `javaMajorOverrides.get(serverId) !== requiredJava` guard means the same required version is attempted at most once; a server that still fails afterward falls through to normal crash handling.

- [ ] **Step 2: Typecheck**

Run: `rtk npx tsc --noEmit`
Expected: no errors (`parseRequiredJavaMajor`, `getServerLogTail`, `clearStatsHistory`, `javaMajorOverrides` are all in scope).

- [ ] **Step 3: Run the full test suite**

Run: `rtk npx vitest run`
Expected: PASS — all tests green.

- [ ] **Step 4: Commit**

```bash
rtk git add src/lib/runners/LocalWindowsRunner.ts
rtk git commit -m "feat(runner): self-heal Java version on UnsupportedClassVersionError and relaunch"
```

---

## Manual verification (after all tasks)

These confirm the real end-to-end path on Windows (the unit tests cover logic only):

1. Delete any existing `dataRoot()/runtimes/` cache and ensure no system Java is needed.
2. Start a fresh Minecraft server in the app. Expect: a "Preparing Java 25…" → "Downloading Java 25 …%" → "Extracting Java 25…" progress sequence, then the server reaches RUNNING with no manual Java install. Verify `dataRoot()/runtimes/jdk-25/bin/java.exe` exists.
3. Start a second Minecraft server. Expect: no re-download (cache hit; "Using cached Java 25 runtime." in logs).
4. (Optional self-heal smoke) Temporarily set the Minecraft `javaMajor` to `17` in `builtins.ts`, reseed, and start a server. Expect: first launch fails with `UnsupportedClassVersionError`, the log shows "This server needs Java 25. Downloading it and retrying…", and the server then reaches RUNNING. Revert the temporary change afterward.
