# Auto-Update Self-Recovery on Startup Failure — Design

**Date:** 2026-06-27
**Status:** Approved (design), pending implementation plan

## Problem

In the packaged app, `app.whenReady()` runs the full startup sequence —
`ensureDataDir()`, `runMigrations()`, `startNextServer()`, `createWindow()` —
and only then calls `initAutoUpdate()`. If any earlier step throws, the existing
`catch` shows a "RealmSwap failed to start" error box and quits. The auto-updater
is never initialized, so a broken release **cannot self-heal** — the only fix is a
manual re-install.

This was observed live: v0.1.3 crashed during startup (the generated Prisma client
wasn't bundled) and could not auto-update to the fix; v0.1.4 had to be installed
by hand. A bad migration in a future release would brick installs the same way.

## Goal

When startup fails in a packaged build, give the app one bounded chance to pull and
apply a fix before giving up — **without changing the normal (successful) startup
path**.

## Non-goals

- Recovering from crashes that happen *before* `app.whenReady()` (corrupt install,
  missing Electron binary) — `electron-updater` can't run there.
- Changing normal-startup auto-update behavior (background checks, the "Update
  ready" prompt, tray items) — untouched.
- Rolling back a bad migration. Recovery rolls *forward* to a fixed release.
- A persistent retry loop / offline queue. Recovery is a single bounded attempt.

## Decisions (from brainstorming)

- **On fix found:** prompt the user — **[Install and restart] / [Quit]** — before
  applying (not silent, not fully automatic).
- **Check budget:** ~30s for check + download. On no-fix / timeout / offline /
  declined → show the existing failure error and quit.
- **"Quit" must truly decline:** recovery sets `autoInstallOnAppQuit = false` so
  quitting does not silently install the downloaded update.

## Architecture

### Flow (production `whenReady` catch only)

1. Startup throws → `catch (err)`.
2. If `isDev` → show error box + quit (no updater in dev), as today.
3. Else run a **bounded recovery check** (~30s):
   - **Fix downloads in time** → prompt *"RealmSwap had a problem starting up. An
     update is available that may fix it."* → **[Install and restart] / [Quit]**.
     - Install → `quitAndInstall()` → app relaunches into the fix.
     - Quit → step 4.
   - **No fix / timeout / offline / error / declined** → step 4.
4. Show the existing *"RealmSwap failed to start"* error (including the data-safe
   backup path when `err.backupPath` is set) and `app.quit()`.

The successful path is unchanged: `initAutoUpdate(...)` still runs after
`createWindow()` and performs its normal background checks and prompts.

### Components

**`electron/autoUpdate.js`** — add to the controller:

```
attemptRecovery({ timeoutMs }) -> Promise<"applied" | "declined" | "unavailable">
```

- Wires **one-shot** listeners via `autoUpdater.once`: `update-downloaded`,
  `update-not-available`, `error`; plus an injected-timer timeout
  (`timers.setTimeout`). Removes all listeners and clears the timer once settled.
- Triggers `autoUpdater.checkForUpdates()` (errors surface via the `error` event).
- Resolves the race to an internal outcome: downloaded / none / error / timeout.
- On **downloaded**: shows the Install/Quit prompt via the existing
  null-window-safe `showMessage`. Install → `applyUpdate()` (existing method:
  `beginQuit()` then `quitAndInstall()`) → returns `"applied"`. Quit → `"declined"`.
- On none / error / timeout → returns `"unavailable"` (no prompt).
- Deliberately does **not** call `registerHandlers()` or `start()`, so the normal
  "Update ready — Restart now / Later" handler cannot double-fire during recovery.

**`electron/updater.js`** — add:

```
attemptRecoveryUpdate({ getMainWindow, beginQuit, timeoutMs }) -> Promise<outcome>
```

- Lazily `require("electron-updater")`; sets `autoDownload = true` and
  `autoInstallOnAppQuit = false` (recovery is explicit-only).
- Builds a headless controller via `createUpdater` with
  `getMainWindow: getMainWindow || (() => null)`, `beginQuit`,
  `refreshTrayMenu: () => {}`.
- Returns `controller.attemptRecovery({ timeoutMs })`.
- Independent of the normal `initAutoUpdate` controller; on the failure path the
  normal one was never created, so there is no conflict. (`autoUpdater` itself is
  an electron-updater singleton; only recovery configures it on this path.)

**`electron/main.js`** — in the `whenReady` `catch (err)`:

```js
let recovered = false;
if (!isDev) {
  try {
    const outcome = await attemptRecoveryUpdate({ beginQuit, timeoutMs: 30000 });
    recovered = outcome === "applied";
  } catch (e) {
    console.error("[updater] recovery attempt failed:", e);
  }
}
if (recovered) return; // app is restarting into the fix
const { dialog } = require("electron");
const backup = err && err.backupPath;
const detail = String((err && err.stack) || err) +
  (backup ? `\n\nYour data is safe. A backup was saved to:\n${backup}` : "");
dialog.showErrorBox("RealmSwap failed to start", detail);
app.quit();
```

`beginQuit` already exists in `main.js`. On the failure path `serverPort` is `0`, so
the existing `before-quit` handler's `stopAllServers` branch is skipped — no hang.

## Components & boundaries

| Unit | Purpose | Depends on |
|------|---------|-----------|
| `electron/autoUpdate.js` `attemptRecovery` | One-shot bounded check + Install/Quit prompt + apply | injected autoUpdater/dialog/timers |
| `electron/updater.js` `attemptRecoveryUpdate` | Headless recovery controller wiring | createUpdater, electron-updater, electron dialog |
| `electron/main.js` catch | Invoke recovery before failing; preserve error+quit fallback | updater.js |

## Error handling

- A recovery attempt that itself throws is caught in `main.js`; the app still falls
  back to the error box + quit (recovery never makes failure worse).
- The 30s bound guarantees termination even when offline / the channel is
  unreachable.
- Recovery only runs in packaged production (`!isDev`).

## Testing / Verification

- **Unit (vitest)** — `attemptRecovery` with a mocked `autoUpdater` (EventEmitter),
  mocked `dialog`, and an injected fake `setTimeout`:
  - `update-downloaded` → Install chosen → `applyUpdate`/`quitAndInstall` called →
    resolves `"applied"`.
  - `update-downloaded` → Quit chosen → resolves `"declined"`, `quitAndInstall`
    NOT called.
  - `update-not-available` → resolves `"unavailable"`, no `showMessageBox`.
  - `error` event → resolves `"unavailable"`, no prompt.
  - timeout (no events fire) → resolves `"unavailable"`.
  - The normal "Update ready" handler does not fire during recovery (no
    `registerHandlers`).
- `node --check electron/main.js`; full suite stays green.
- **Manual E2E** (documented): ship a deliberately-broken release, then a fixed one;
  confirm the broken install prompts and recovers via update.

## Known limitations

- Recovery requires the build to reach `app.whenReady()` and run `electron-updater`.
  Pre-`whenReady` crashes remain manual-reinstall only.
- A single bounded attempt; no background retry if the user quits.
