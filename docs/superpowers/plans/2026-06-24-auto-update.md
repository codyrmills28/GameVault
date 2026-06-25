# In-App Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app auto-update to the RealmSwap Electron app using `electron-updater` against GitHub Releases, with background download and a native "restart to apply" prompt.

**Architecture:** A pure, dependency-injected update controller (`electron/autoUpdate.js`) holds all decision logic and is unit-tested with mocks — mirroring the codebase's existing `stopAllRunningServers(find, stop)` injection pattern. A thin Electron wrapper (`electron/updater.js`) supplies the real `autoUpdater` (from `electron-updater`) and `dialog`. `electron/main.js` wires it into the app lifecycle and tray. `electron-builder.yml` gains a `publish` block so the build emits `latest.yml` + a blockmap, and `release.yml` uploads those alongside the installer.

**Tech Stack:** Electron 42, electron-builder 26, electron-updater (new), Next.js standalone server, Vitest, GitHub Actions, NSIS (Windows).

## Global Constraints

- **Windows / NSIS only.** No macOS/Linux update channels.
- **Artifact name stays `RealmSwap-Setup.exe`** (version-less). The marketing site links a stable `releases/latest/download/RealmSwap-Setup.exe` URL. `electron-updater` keys off the `version` field in `latest.yml`, not the filename — do not add `${version}` to `artifactName`.
- **No code signing.** Builds remain unsigned; NSIS auto-update works unsigned (user sees the normal UAC/SmartScreen prompt).
- **Preload and renderer stay untouched.** The update prompt lives entirely in the Electron main process (native dialog + tray). `electron/preload.js` remains an empty audited surface.
- **`electron-updater` runs only in packaged production builds** (`!isDev`) — it throws "app is not packaged" in dev.
- **GitHub provider:** `owner: RealmSwap`, `repo: RealmSwap` (public repo, no runtime token needed).
- **Cadence:** check ~10s after launch, then every 6 hours, plus a manual tray item.
- All update errors are caught and logged; a failed background check must never disrupt the app.

---

### Task 1: Pure update controller (`electron/autoUpdate.js`)

This is the testable core. It takes every Electron collaborator via injection so it can be unit-tested without Electron or `electron-updater` loaded.

**Files:**
- Create: `electron/autoUpdate.js`
- Create: `electron/__tests__/autoUpdate.test.js`
- Modify: `vitest.config.ts` (add `electron/**/*.test.js` to `include`)

**Interfaces:**
- Produces: `createUpdater(deps) -> { start(), checkManual(), applyUpdate(), isStaged() }`
  - `deps`:
    - `autoUpdater` — EventEmitter with `checkForUpdates(): Promise`, `quitAndInstall(): void`. Emits `update-available`, `update-not-available`, `update-downloaded`, `error`.
    - `dialog` — `{ showMessageBox(window, opts): Promise<{ response: number }> }`
    - `getMainWindow` — `() => BrowserWindow | null`
    - `beginQuit` — `() => void` (sets the app's quitting flag)
    - `refreshTrayMenu` — `() => void` (rebuilds the tray to reflect staged state)
    - `log` — optional, defaults to `console` (`{ error }`)
    - `timers` — optional, defaults to `{ setTimeout, setInterval }` (injected for tests)
    - `initialDelayMs` — optional, default `10000`
    - `intervalMs` — optional, default `21600000` (6h)

- [ ] **Step 1: Add electron tests to the vitest include**

Modify `vitest.config.ts` — change the `include` line to also match electron test files:

```ts
    include: ["src/**/*.test.ts", "electron/**/*.test.js"],
```

- [ ] **Step 2: Write the failing test**

Create `electron/__tests__/autoUpdate.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { createUpdater } from "../autoUpdate.js";

function makeDeps(overrides = {}) {
  const autoUpdater = new EventEmitter();
  autoUpdater.checkForUpdates = vi.fn().mockResolvedValue(undefined);
  autoUpdater.quitAndInstall = vi.fn();

  const calls = [];
  const beginQuit = vi.fn(() => calls.push("beginQuit"));
  autoUpdater.quitAndInstall.mockImplementation(() => calls.push("quitAndInstall"));

  const dialog = { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) };
  const refreshTrayMenu = vi.fn();

  const deps = {
    autoUpdater,
    dialog,
    getMainWindow: () => null,
    beginQuit,
    refreshTrayMenu,
    log: { error: vi.fn() },
    timers: { setTimeout: vi.fn(), setInterval: vi.fn() },
    ...overrides,
  };
  return { deps, autoUpdater, dialog, refreshTrayMenu, beginQuit, calls };
}

describe("createUpdater", () => {
  it("on update-downloaded: stages, refreshes tray, and prompts to restart", async () => {
    const { deps, autoUpdater, dialog, refreshTrayMenu } = makeDeps();
    const u = createUpdater(deps);
    u.start();

    autoUpdater.emit("update-downloaded", { version: "9.9.9" });
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalled());

    expect(u.isStaged()).toBe(true);
    expect(refreshTrayMenu).toHaveBeenCalled();
    const opts = dialog.showMessageBox.mock.calls[0][1];
    expect(opts.buttons).toEqual(["Restart now", "Later"]);
  });

  it("applies the update when the user picks Restart now (beginQuit before quitAndInstall)", async () => {
    const { deps, autoUpdater, dialog, calls } = makeDeps();
    dialog.showMessageBox.mockResolvedValue({ response: 0 });
    const u = createUpdater(deps);
    u.start();

    autoUpdater.emit("update-downloaded", {});
    await vi.waitFor(() => expect(calls).toContain("quitAndInstall"));
    expect(calls).toEqual(["beginQuit", "quitAndInstall"]);
  });

  it("does NOT restart when the user picks Later", async () => {
    const { deps, autoUpdater, calls } = makeDeps(); // default response: 1 (Later)
    const u = createUpdater(deps);
    u.start();

    autoUpdater.emit("update-downloaded", {});
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).not.toContain("quitAndInstall");
    expect(u.isStaged()).toBe(true);
  });

  it("manual check shows 'up to date' when no update is available", async () => {
    const { deps, autoUpdater, dialog } = makeDeps();
    const u = createUpdater(deps);
    u.checkManual();

    expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
    autoUpdater.emit("update-not-available", {});
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalled());
    expect(dialog.showMessageBox.mock.calls[0][1].message).toMatch(/up to date/i);
  });

  it("manual check reports a downloading update when one is available", async () => {
    const { deps, autoUpdater, dialog } = makeDeps();
    const u = createUpdater(deps);
    u.checkManual();

    autoUpdater.emit("update-available", { version: "9.9.9" });
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalled());
    expect(dialog.showMessageBox.mock.calls[0][1].title).toMatch(/available/i);
  });

  it("manual check when an update is already staged applies it immediately", async () => {
    const { deps, autoUpdater, calls } = makeDeps();
    const u = createUpdater(deps);
    u.start();
    autoUpdater.emit("update-downloaded", {});
    await new Promise((r) => setTimeout(r, 0));

    autoUpdater.checkForUpdates.mockClear();
    u.checkManual();
    await vi.waitFor(() => expect(calls).toContain("quitAndInstall"));
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("background error is logged and swallowed (no manual dialog)", async () => {
    const { deps, autoUpdater, dialog } = makeDeps();
    const u = createUpdater(deps);
    u.start();

    expect(() => autoUpdater.emit("error", new Error("boom"))).not.toThrow();
    expect(deps.log.error).toHaveBeenCalled();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("manual check failure shows an error dialog", async () => {
    const { deps, autoUpdater, dialog } = makeDeps();
    const u = createUpdater(deps);
    u.checkManual();

    autoUpdater.emit("error", new Error("network"));
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalled());
    expect(dialog.showMessageBox.mock.calls[0][1].type).toBe("error");
  });

  it("start() schedules an initial check and a recurring interval", () => {
    const { deps } = makeDeps();
    const u = createUpdater(deps);
    u.start();
    expect(deps.timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 10000);
    expect(deps.timers.setInterval).toHaveBeenCalledWith(expect.any(Function), 21600000);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run electron/__tests__/autoUpdate.test.js`
Expected: FAIL — `Cannot find module '../autoUpdate.js'` (and/or vitest reporting no such file resolves).

- [ ] **Step 4: Write the implementation**

Create `electron/autoUpdate.js`:

```js
"use strict";
// Pure, dependency-injected auto-update controller. All Electron collaborators
// (autoUpdater, dialog, window/tray accessors) are passed in so this module is
// unit-testable without Electron loaded — mirrors stopAllRunningServers(find, stop).

function createUpdater(deps) {
  const {
    autoUpdater,
    dialog,
    getMainWindow,
    beginQuit,
    refreshTrayMenu,
    log = console,
    timers = { setTimeout, setInterval },
    initialDelayMs = 10000,
    intervalMs = 6 * 60 * 60 * 1000,
  } = deps;

  let staged = false;        // an update has been downloaded and awaits restart
  let checking = false;      // a check is in flight (prevents overlap)
  let manualPending = false; // the in-flight check was user-initiated (wants feedback)
  let registered = false;

  const isStaged = () => staged;

  function showMessage(opts) {
    return dialog.showMessageBox(getMainWindow() || undefined, opts);
  }

  async function applyUpdate() {
    try {
      beginQuit();
      autoUpdater.quitAndInstall();
    } catch (err) {
      log.error("[updater] quitAndInstall failed:", err);
    }
  }

  function registerHandlers() {
    if (registered) return;
    registered = true;

    autoUpdater.on("update-available", () => {
      if (!manualPending) return;
      manualPending = false;
      showMessage({
        type: "info",
        buttons: ["OK"],
        title: "Update available",
        message: "A new version of RealmSwap is available.",
        detail: "It's downloading now — you'll be prompted to restart when it's ready.",
      });
    });

    autoUpdater.on("update-not-available", () => {
      if (!manualPending) return;
      manualPending = false;
      showMessage({
        type: "info",
        buttons: ["OK"],
        title: "No updates",
        message: "RealmSwap is up to date.",
      });
    });

    autoUpdater.on("update-downloaded", async () => {
      staged = true;
      manualPending = false;
      refreshTrayMenu();
      const { response } = await showMessage({
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update ready",
        message: "A new version of RealmSwap has been downloaded.",
        detail:
          "Restart now to apply it, or keep working — it'll install the next time you quit.",
      });
      if (response === 0) await applyUpdate();
    });

    autoUpdater.on("error", (err) => {
      log.error("[updater] error:", err);
      if (!manualPending) return;
      manualPending = false;
      showMessage({
        type: "error",
        buttons: ["OK"],
        title: "Update check failed",
        message: "Couldn't check for updates.",
        detail: "Please try again later.",
      });
    });
  }

  function check() {
    if (checking) return;
    checking = true;
    Promise.resolve()
      .then(() => autoUpdater.checkForUpdates())
      .catch((err) => log.error("[updater] check failed:", err))
      .finally(() => {
        checking = false;
      });
  }

  function checkManual() {
    registerHandlers();
    if (staged) {
      applyUpdate();
      return;
    }
    manualPending = true;
    check();
  }

  function start() {
    registerHandlers();
    timers.setTimeout(check, initialDelayMs);
    timers.setInterval(check, intervalMs);
  }

  return { start, checkManual, applyUpdate, isStaged };
}

module.exports = { createUpdater };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run electron/__tests__/autoUpdate.test.js`
Expected: PASS — all 9 tests green.

- [ ] **Step 6: Confirm the full suite still passes**

Run: `npm test`
Expected: PASS — existing `src/**` tests plus the new electron test.

- [ ] **Step 7: Commit**

```bash
git add electron/autoUpdate.js electron/__tests__/autoUpdate.test.js vitest.config.ts
git commit -m "feat(updater): add pure auto-update controller with tests"
```

---

### Task 2: Electron wrapper + dependency (`electron/updater.js`)

Thin glue that supplies the real `autoUpdater` and `dialog` to the controller. Not unit-tested (it only wires real Electron modules, like `electron/shutdown.js`); verified by install + lint.

**Files:**
- Create: `electron/updater.js`
- Modify: `package.json` (add `electron-updater` to `dependencies`)
- Modify: `electron-builder.yml` (exclude test files from the packed app)

**Interfaces:**
- Consumes: `createUpdater(deps)` from Task 1.
- Produces (required by Task 3):
  - `initAutoUpdate({ getMainWindow, beginQuit, refreshTrayMenu }) -> controller`
  - `checkForUpdatesManual() -> void`
  - `restartToUpdate() -> void`
  - `isUpdateStaged() -> boolean`

- [ ] **Step 1: Add the runtime dependency**

Run: `npm install --save electron-updater`
Expected: `electron-updater` appears under `dependencies` in `package.json` and `package-lock.json` updates.

- [ ] **Step 2: Verify it resolves**

Run: `npm ls electron-updater`
Expected: prints the installed `electron-updater@<version>` with no "missing"/"invalid" error.

- [ ] **Step 3: Write the wrapper**

Create `electron/updater.js`:

```js
"use strict";
// Electron-side glue: supplies the real autoUpdater (electron-updater) and dialog
// to the pure controller in ./autoUpdate. Only ever called in packaged builds.
const { dialog } = require("electron");
const { createUpdater } = require("./autoUpdate");

let controller = null;

function initAutoUpdate({ getMainWindow, beginQuit, refreshTrayMenu }) {
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (err) =>
    console.error("[updater] electron-updater error:", err)
  );

  controller = createUpdater({
    autoUpdater,
    dialog,
    getMainWindow,
    beginQuit,
    refreshTrayMenu,
  });
  controller.start();
  return controller;
}

function checkForUpdatesManual() {
  if (controller) controller.checkManual();
}

function restartToUpdate() {
  if (controller) controller.applyUpdate();
}

function isUpdateStaged() {
  return controller ? controller.isStaged() : false;
}

module.exports = {
  initAutoUpdate,
  checkForUpdatesManual,
  restartToUpdate,
  isUpdateStaged,
};
```

- [ ] **Step 4: Keep test files out of the packaged app**

`electron-builder.yml` packs `electron/**/*`, which would include `electron/__tests__`. Modify the `files:` list so it reads:

```yaml
files:
  - electron/**/*
  - "!electron/__tests__/**"
  - package.json
```

- [ ] **Step 5: Confirm the suite is unaffected**

Run: `npm test`
Expected: PASS (unchanged from Task 1 — this task adds no tests).

- [ ] **Step 6: Commit**

```bash
git add electron/updater.js package.json package-lock.json electron-builder.yml
git commit -m "feat(updater): add electron-updater wrapper and dependency"
```

---

### Task 3: Wire the updater into the app lifecycle and tray (`electron/main.js`)

Refactor the tray so its menu can be rebuilt when an update stages, add a shared quit helper, and initialize the updater in production only.

**Files:**
- Modify: `electron/main.js`

**Interfaces:**
- Consumes: `initAutoUpdate`, `checkForUpdatesManual`, `restartToUpdate`, `isUpdateStaged` from Task 2.

- [ ] **Step 1: Import the wrapper**

In `electron/main.js`, below the existing `const { stopAllServers } = require("./shutdown");` line, add:

```js
const {
  initAutoUpdate,
  checkForUpdatesManual,
  restartToUpdate,
  isUpdateStaged,
} = require("./updater");
```

- [ ] **Step 2: Add shared `beginQuit` and `showMainWindow` helpers**

In `electron/main.js`, immediately after the module-scope state declarations (the block ending with `let serverPort = 0;`), add:

```js
function beginQuit() {
  isQuitting = true;
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
```

- [ ] **Step 3: Replace `buildTray()` with a rebuildable tray menu**

Replace the entire existing `buildTray()` function with the following (the application menu setup is unchanged; the context menu is now built by a helper, and a "Restart to update" item appears only once an update is staged):

```js
function buildTrayMenu() {
  const items = [
    { label: "Open RealmSwap", click: showMainWindow },
    { type: "separator" },
    { label: "Check for updates", click: () => checkForUpdatesManual() },
  ];
  if (isUpdateStaged()) {
    items.push({ label: "Restart to update", click: () => restartToUpdate() });
  }
  items.push({ type: "separator" });
  items.push({ label: "Quit", click: () => { beginQuit(); app.quit(); } });
  return items;
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu()));
}

function buildTray() {
  const icon = nativeImage.createFromPath(
    isDev ? path.join(__dirname, "..", "build", "tray.png")
          : path.join(process.resourcesPath, "tray.png")
  );
  tray = new Tray(icon);
  tray.setToolTip("RealmSwap");
  refreshTrayMenu();
  tray.on("double-click", showMainWindow);

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [{ label: "Quit", click: () => { beginQuit(); app.quit(); } }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }] },
    { label: "Help", submenu: [{ role: "about" }] },
  ]));
}
```

- [ ] **Step 4: Initialize the updater in the production branch**

In `app.whenReady().then(...)`, inside the `else` branch, after the existing `await createWindow(serverPort);` line, add:

```js
      initAutoUpdate({
        getMainWindow: () => mainWindow,
        beginQuit,
        refreshTrayMenu,
      });
```

(Do NOT add it to the `isDev` branch — `electron-updater` throws when the app is not packaged.)

- [ ] **Step 5: Verify the file is syntactically valid**

Run: `node --check electron/main.js`
Expected: no output, exit code 0 (syntax OK). This does not execute Electron — it only parses.

- [ ] **Step 6: Confirm the suite still passes and lint is clean**

Run: `npm test`
Expected: PASS (no behavior change to tested `src/**` code).

Run: `npx next lint --dir electron --no-cache 2>/dev/null || npm run lint`
Expected: no errors introduced in `electron/`. (If `next lint` does not cover `electron/`, the `node --check` in Step 5 is the binding gate.)

- [ ] **Step 7: Commit**

```bash
git add electron/main.js
git commit -m "feat(updater): wire auto-update into app lifecycle and tray"
```

---

### Task 4: Publish update artifacts (`electron-builder.yml`, `release.yml`)

Make the build emit `latest.yml` + blockmap, and upload them with the installer so installed clients can detect new versions.

**Files:**
- Modify: `electron-builder.yml` (add `publish` block)
- Modify: `.github/workflows/release.yml` (upload 3 assets)

**Interfaces:**
- Consumes: nothing from prior tasks (build/CI only).

- [ ] **Step 1: Add the `publish` block to `electron-builder.yml`**

Append the following top-level block to `electron-builder.yml` (after the `nsis:` block, before or after `asar: true` — order of top-level keys does not matter):

```yaml
publish:
  provider: github
  owner: RealmSwap
  repo: RealmSwap
```

This makes `electron-builder` emit `dist/latest.yml` and `dist/RealmSwap-Setup.exe.blockmap` during a normal build. The existing `npm run electron:build` does not pass `--publish`, so electron-builder generates the manifest without uploading — the GitHub Actions release step still does the upload.

- [ ] **Step 2: Verify the config still parses**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('electron-builder.yml','utf8')); console.log('ok')"`
Expected: prints `ok`. (`js-yaml` is already a transitive dependency via electron-builder; if it is not resolvable, use `npx electron-builder --help` to confirm the project's config loads without a parse error instead.)

- [ ] **Step 3: Upload the update manifest and blockmap in CI**

In `.github/workflows/release.yml`, replace the final `files:` line of the "Publish GitHub Release" step:

```yaml
          files: 'C:\rsbuild\dist\RealmSwap-Setup.exe'
```

with a multi-asset list:

```yaml
          files: |
            C:\rsbuild\dist\RealmSwap-Setup.exe
            C:\rsbuild\dist\RealmSwap-Setup.exe.blockmap
            C:\rsbuild\dist\latest.yml
```

Without `latest.yml` on the release, installed clients cannot detect updates; without the blockmap, differential downloads fall back to a full download.

- [ ] **Step 4: Verify the workflow YAML parses**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/release.yml','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add electron-builder.yml .github/workflows/release.yml
git commit -m "build(updater): publish latest.yml and blockmap for auto-update"
```

---

## Manual End-to-End Verification (post-merge, documented — not automated)

An updater cannot be meaningfully unit-tested against real GitHub Releases. After all tasks merge and a release is cut:

1. Tag and let CI publish version **N**; confirm the release now contains `RealmSwap-Setup.exe`, `RealmSwap-Setup.exe.blockmap`, and `latest.yml`.
2. Install an older build (version **N-1**) on a Windows machine.
3. Launch it. Within ~10s it should detect N, download in the background, then show the "Update ready — Restart now / Later" dialog and reveal the "Restart to update" tray item.
4. Click **Restart now** → the app stops its Next server (existing `before-quit` path, triggered because `beginQuit()` set `isQuitting` before `quitAndInstall()`), runs the NSIS installer, and relaunches into version N.
5. Use the **Check for updates** tray item on an up-to-date install → confirm the "RealmSwap is up to date" dialog.

---

## Self-Review

**Spec coverage:**
- Build emits + CI uploads `latest.yml`/blockmap → Task 4. ✓
- Fixed artifact name preserved → Global Constraints + Task 4 (no `artifactName` change). ✓
- `electron/updater.js` module (init + manual + apply + staged state, error swallowing) → split into pure controller (Task 1) + wrapper (Task 2) for testability, consistent with the spec's "injected collaborators / unit-testable" requirement. ✓
- `main.js` integration: `!isDev` guard, two tray items (restart item hidden until staged), `beginQuit` reuse → Task 3. ✓
- `electron-updater` in `dependencies` → Task 2. ✓
- Preload/renderer untouched → no task modifies them. ✓
- Cadence (launch ~10s + 6h + manual) → Task 1 defaults + Task 3 tray item. ✓
- Unit tests (downloaded→dialog+tray+staged; restart→beginQuit before quitAndInstall; error→logged no throw; manual not-available→up-to-date) → Task 1 test cases. ✓
- Test files excluded from packed app → Task 2 Step 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands. ✓

**Type consistency:** `createUpdater` returns `{ start, checkManual, applyUpdate, isStaged }` (Task 1) — consumed by the wrapper as exactly those names (Task 2), which exports `initAutoUpdate/checkForUpdatesManual/restartToUpdate/isUpdateStaged` consumed under those exact names in Task 3. `refreshTrayMenu`/`beginQuit`/`getMainWindow` names match across Tasks 1→2→3. ✓
