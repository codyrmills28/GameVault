# Auto-Update Self-Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When packaged-app startup fails, make one bounded attempt to download and (with the user's consent) install a fixing update before showing the error and quitting — so a broken release can self-heal instead of bricking.

**Architecture:** Add a one-shot `attemptRecovery` method to the existing injectable update controller (`electron/autoUpdate.js`), expose a headless `attemptRecoveryUpdate` wrapper (`electron/updater.js`), and call it from the `whenReady` `catch` in `electron/main.js` before the existing error-and-quit fallback. The normal successful startup path is unchanged.

**Tech Stack:** Electron, electron-updater, Node EventEmitter, Vitest.

## Global Constraints

- Recovery runs only in packaged production (`!isDev`).
- On a fix found: prompt **[Install and restart] / [Quit]** before applying (not silent).
- Check budget: **30000 ms** for check + download; on none/timeout/offline/error/declined → existing "RealmSwap failed to start" error (including the data-safe backup path when `err.backupPath` is set) + `app.quit()`.
- Recovery sets `autoInstallOnAppQuit = false` so "Quit" does not silently install.
- Recovery must NOT call `registerHandlers()`/`start()` — the normal "Update ready — Restart now / Later" dialog must not fire during recovery.
- Recovery uses one-shot listeners (`autoUpdater.once`) for `update-downloaded` / `update-not-available` / `error`, plus an injected-timer timeout, and removes them all once settled.
- The normal successful path (`initAutoUpdate` after `createWindow`) is untouched.
- Commits use `git -c user.email=jimmymills@users.noreply.github.com` and end the body with a blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: `attemptRecovery` on the update controller

Add the bounded recovery method to the pure controller, with unit tests.

**Files:**
- Modify: `electron/autoUpdate.js`
- Modify: `electron/__tests__/autoUpdate.test.js`

**Interfaces:**
- Consumes: existing `createUpdater(deps)` internals — `autoUpdater`, `dialog`, `showMessage`, `applyUpdate`, `timers`.
- Produces: controller method `attemptRecovery({ timeoutMs }) -> Promise<"applied" | "declined" | "unavailable">`, added to the returned object.

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to `electron/__tests__/autoUpdate.test.js` (after the existing blocks; the file already imports `createUpdater`, `EventEmitter`, `describe/it/expect/vi`):

```js
describe("attemptRecovery", () => {
  function recoveryDeps(overrides = {}) {
    const autoUpdater = new EventEmitter();
    autoUpdater.checkForUpdates = vi.fn().mockResolvedValue(undefined);
    autoUpdater.quitAndInstall = vi.fn();
    let timeoutFn = null;
    const deps = {
      autoUpdater,
      dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) },
      getMainWindow: () => null,
      beginQuit: vi.fn(),
      refreshTrayMenu: vi.fn(),
      log: { error() {}, info() {} },
      timers: {
        setTimeout: (fn) => { timeoutFn = fn; return 1; },
        setInterval: () => {},
        clearTimeout: () => {},
      },
      ...overrides,
    };
    return { deps, autoUpdater, fireTimeout: () => timeoutFn && timeoutFn() };
  }

  it("downloaded + Install -> applies and resolves 'applied'", async () => {
    const { deps, autoUpdater } = recoveryDeps();
    const u = createUpdater(deps);
    const p = u.attemptRecovery({ timeoutMs: 30000 });
    autoUpdater.emit("update-downloaded", {});
    expect(await p).toBe("applied");
    expect(deps.beginQuit).toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalled();
    expect(deps.dialog.showMessageBox.mock.calls[0][0].buttons).toEqual([
      "Install and restart",
      "Quit",
    ]);
  });

  it("downloaded + Quit -> 'declined', does not install", async () => {
    const { deps, autoUpdater } = recoveryDeps({
      dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) },
    });
    const u = createUpdater(deps);
    const p = u.attemptRecovery({ timeoutMs: 30000 });
    autoUpdater.emit("update-downloaded", {});
    expect(await p).toBe("declined");
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("update-not-available -> 'unavailable', no prompt", async () => {
    const { deps, autoUpdater } = recoveryDeps();
    const u = createUpdater(deps);
    const p = u.attemptRecovery({ timeoutMs: 30000 });
    autoUpdater.emit("update-not-available", {});
    expect(await p).toBe("unavailable");
    expect(deps.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("error -> 'unavailable', no prompt", async () => {
    const { deps, autoUpdater } = recoveryDeps();
    const u = createUpdater(deps);
    const p = u.attemptRecovery({ timeoutMs: 30000 });
    autoUpdater.emit("error", new Error("net down"));
    expect(await p).toBe("unavailable");
    expect(deps.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("timeout with no events -> 'unavailable'", async () => {
    const { deps, fireTimeout } = recoveryDeps();
    const u = createUpdater(deps);
    const p = u.attemptRecovery({ timeoutMs: 30000 });
    fireTimeout();
    expect(await p).toBe("unavailable");
  });

  it("does not wire the normal 'Update ready' handler (no staging/tray during recovery)", async () => {
    const { deps, autoUpdater } = recoveryDeps();
    const u = createUpdater(deps);
    const p = u.attemptRecovery({ timeoutMs: 30000 });
    autoUpdater.emit("update-not-available", {});
    await p;
    expect(u.isStaged()).toBe(false);
    // After recovery settles, a later download must not trigger normal staging.
    expect(() => autoUpdater.emit("update-downloaded", {})).not.toThrow();
    expect(u.isStaged()).toBe(false);
    expect(deps.refreshTrayMenu).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run electron/__tests__/autoUpdate.test.js -t "attemptRecovery"`
Expected: FAIL — `u.attemptRecovery is not a function`.

- [ ] **Step 3: Implement `attemptRecovery`**

In `electron/autoUpdate.js`, first add `clearTimeout` to the default timers. Change:

```js
    timers = { setTimeout, setInterval },
```

to:

```js
    timers = { setTimeout, setInterval, clearTimeout },
```

Then add this function inside `createUpdater`, immediately before the `return { ... }` line:

```js
  // One-shot, bounded recovery used only when normal startup failed. Does NOT
  // call registerHandlers()/start(), so the normal "Update ready" dialog cannot
  // fire here. Resolves "applied" (user installed the fix), "declined" (user
  // chose Quit), or "unavailable" (no update / error / timeout).
  function attemptRecovery({ timeoutMs }) {
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const onDownloaded = () => finish("downloaded");
      const onNone = () => finish("none");
      const onError = () => finish("error");

      function cleanup() {
        autoUpdater.removeListener("update-downloaded", onDownloaded);
        autoUpdater.removeListener("update-not-available", onNone);
        autoUpdater.removeListener("error", onError);
        if (timer !== null && typeof timers.clearTimeout === "function") {
          timers.clearTimeout(timer);
        }
      }
      function finish(outcome) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(outcome);
      }

      autoUpdater.once("update-downloaded", onDownloaded);
      autoUpdater.once("update-not-available", onNone);
      autoUpdater.once("error", onError);
      timer = timers.setTimeout(() => finish("timeout"), timeoutMs);

      try {
        Promise.resolve(autoUpdater.checkForUpdates()).catch(() => {
          // Failures are delivered via the "error" event listener above.
        });
      } catch (err) {
        log.error("[updater] recovery check threw:", err);
        finish("error");
      }
    }).then(async (outcome) => {
      if (outcome === "downloaded") {
        const { response } = await showMessage({
          type: "warning",
          buttons: ["Install and restart", "Quit"],
          defaultId: 0,
          cancelId: 1,
          title: "Update available",
          message: "RealmSwap had a problem starting up.",
          detail: "An update is available that may fix it. Install it and restart now?",
        });
        if (response === 0) {
          await applyUpdate();
          return "applied";
        }
        return "declined";
      }
      return "unavailable";
    });
  }
```

Finally, add `attemptRecovery` to the returned object. Change:

```js
  return { start, checkManual, applyUpdate, isStaged };
```

to:

```js
  return { start, checkManual, applyUpdate, isStaged, attemptRecovery };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run electron/__tests__/autoUpdate.test.js`
Expected: PASS — the new `attemptRecovery` tests plus all existing controller tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/autoUpdate.js electron/__tests__/autoUpdate.test.js
git -c user.email=jimmymills@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(updater): add bounded attemptRecovery to the update controller

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire recovery into startup failure (`updater.js` + `main.js`)

Expose a headless recovery wrapper and call it from the `whenReady` catch.

**Files:**
- Modify: `electron/updater.js`
- Modify: `electron/main.js`

**Interfaces:**
- Consumes: `createUpdater(...).attemptRecovery({ timeoutMs })` (Task 1); existing `beginQuit` in `main.js`.
- Produces: `attemptRecoveryUpdate({ getMainWindow, beginQuit, timeoutMs }) -> Promise<"applied" | "declined" | "unavailable">` exported from `electron/updater.js`.

- [ ] **Step 1: Add the recovery wrapper to `electron/updater.js`**

In `electron/updater.js`, add this function after the existing `initAutoUpdate` function:

```js
// Used only when normal startup failed: builds a headless one-shot controller
// (no window, no tray) and tries to pull a fixing update. Recovery is
// explicit-only, so autoInstallOnAppQuit is disabled here — "Quit" must not
// silently install.
function attemptRecoveryUpdate({ getMainWindow, beginQuit, timeoutMs }) {
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  const recoveryController = createUpdater({
    autoUpdater,
    dialog,
    getMainWindow: getMainWindow || (() => null),
    beginQuit,
    refreshTrayMenu: () => {},
  });
  return recoveryController.attemptRecovery({ timeoutMs });
}
```

Then add it to `module.exports`. Change:

```js
module.exports = {
  initAutoUpdate,
  checkForUpdatesManual,
  restartToUpdate,
  isUpdateStaged,
};
```

to:

```js
module.exports = {
  initAutoUpdate,
  attemptRecoveryUpdate,
  checkForUpdatesManual,
  restartToUpdate,
  isUpdateStaged,
};
```

- [ ] **Step 2: Import the wrapper in `electron/main.js`**

In `electron/main.js`, the destructured `require("./updater")` currently reads:

```js
const {
  initAutoUpdate,
  checkForUpdatesManual,
  restartToUpdate,
  isUpdateStaged,
} = require("./updater");
```

Add `attemptRecoveryUpdate` to it:

```js
const {
  initAutoUpdate,
  attemptRecoveryUpdate,
  checkForUpdatesManual,
  restartToUpdate,
  isUpdateStaged,
} = require("./updater");
```

- [ ] **Step 3: Invoke recovery in the `whenReady` catch**

In `electron/main.js`, replace the existing catch block:

```js
  } catch (err) {
    const { dialog } = require("electron");
    const backup = err && err.backupPath;
    const detail = String((err && err.stack) || err) +
      (backup ? `\n\nYour data is safe. A backup was saved to:\n${backup}` : "");
    dialog.showErrorBox("RealmSwap failed to start", detail);
    app.quit();
  }
```

with:

```js
  } catch (err) {
    // Startup failed. In packaged builds, give the app one bounded chance to
    // pull a fixing update before giving up — otherwise a bad release bricks
    // the install with no way to self-heal.
    let recovered = false;
    if (!isDev) {
      try {
        const outcome = await attemptRecoveryUpdate({ beginQuit, timeoutMs: 30000 });
        recovered = outcome === "applied";
      } catch (e) {
        console.error("[updater] recovery attempt failed:", e);
      }
    }
    if (!recovered) {
      const { dialog } = require("electron");
      const backup = err && err.backupPath;
      const detail = String((err && err.stack) || err) +
        (backup ? `\n\nYour data is safe. A backup was saved to:\n${backup}` : "");
      dialog.showErrorBox("RealmSwap failed to start", detail);
      app.quit();
    }
  }
```

- [ ] **Step 4: Verify both files parse**

Run: `node --check electron/updater.js && node --check electron/main.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (no change to tested `src/**` behavior; the autoUpdate tests from Task 1 stay green).

- [ ] **Step 6: Commit**

```bash
git add electron/updater.js electron/main.js
git -c user.email=jimmymills@users.noreply.github.com commit -m "$(cat <<'EOF'
feat(updater): attempt update-based recovery when startup fails

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Manual End-to-End Verification (post-merge, documented — not automated)

1. Cut a deliberately-broken release (e.g. a migration that throws), then a fixed release at a higher version.
2. Install the broken release in the normal user context; launch it.
3. On the startup failure, within ~30s the app should prompt "RealmSwap had a problem starting up… Install and restart?" → choose **Install and restart** → it downloads, restarts into the fixed release, which starts cleanly.
4. Repeat and choose **Quit** → the "RealmSwap failed to start" error appears and the app exits without installing.
5. Offline test: disconnect network, launch the broken release → after ~30s it falls back to the error dialog and quits (no hang).

---

## Self-Review

**Spec coverage:**
- Bounded recovery check (30s) → Task 2 (`timeoutMs: 30000`) + Task 1 timeout outcome. ✓
- Fix found → Install/Quit prompt → apply or fall through → Task 1 `attemptRecovery` downloaded branch. ✓
- No fix / timeout / error / declined → existing error + quit → Task 2 catch fallback. ✓
- `autoInstallOnAppQuit = false` in recovery → Task 2 wrapper. ✓
- No `registerHandlers`/`start` during recovery; one-shot `once` listeners + cleanup → Task 1 implementation + the "does not wire normal handler" test. ✓
- Headless controller (null window, no-op tray) → Task 2 wrapper. ✓
- Production-only (`!isDev`) → Task 2 catch guard. ✓
- Normal successful path untouched → no task modifies `initAutoUpdate` or its call site. ✓
- Recovery attempt that throws is caught, falls back to error+quit → Task 2 inner try/catch. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands. ✓

**Type consistency:** `attemptRecovery({ timeoutMs })` returns `"applied" | "declined" | "unavailable"` in Task 1; consumed in Task 2 as `outcome === "applied"`. `attemptRecoveryUpdate({ getMainWindow, beginQuit, timeoutMs })` defined in Task 2 wrapper and called in Task 2 `main.js` with `{ beginQuit, timeoutMs: 30000 }` (getMainWindow omitted → wrapper default `() => null`). `clearTimeout` added to the `timers` default and guarded in `cleanup`. ✓
