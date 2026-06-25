# In-App Auto-Update — Design

**Date:** 2026-06-24
**Status:** Approved (design), pending implementation plan

## Problem

RealmSwap ships as a Windows NSIS installer published to GitHub Releases (see
`2026-06-24-release-publishing-design.md`). Once installed, the app has no way to
update itself — users must manually re-download `RealmSwap-Setup.exe` and re-run
the installer. There is no in-app mechanism to detect, fetch, or apply new
releases.

## Goal

Add in-app auto-update using `electron-updater` against the GitHub Releases
channel. The app checks for updates on launch, every 6 hours, and on demand;
downloads new versions in the background; and prompts the user with a native
dialog (plus a tray menu item) to restart and apply.

This is the additive path anticipated by the release-publishing design's
"Future auto-update" section.

## Non-goals

- Code signing the installer (no certificate yet). NSIS auto-update works
  unsigned on Windows; the user sees the normal UAC/SmartScreen prompt at
  install time, same as today.
- Changing the version-less artifact name `RealmSwap-Setup.exe` (the marketing
  site's stable "latest" download URL depends on it). `electron-updater` keys
  off the `version` field in `latest.yml`, not the filename, so this is fine.
- macOS/Linux update channels — the app targets Windows (NSIS) only.
- In-app (renderer) update UI / progress bar. The renderer talks only to the
  local HTTP server and the preload is an intentionally empty audited surface;
  the update prompt lives in the Electron main process (native dialog + tray),
  leaving both untouched.
- Delta/differential-only updates as a hard requirement. The `.blockmap` is
  published so differential download works when possible, but a full download
  fallback is acceptable.

## Decisions (from brainstorming)

- **Mechanism:** `electron-updater` + GitHub provider (`owner: RealmSwap`,
  `repo: RealmSwap`). Repo releases are public, so no token is needed at runtime.
- **UX:** Notify + one-click restart. Background auto-download, then a native
  dialog "Update ready — Restart now / Later".
- **Prompt surface:** Native Electron dialog + a tray menu item. Preload and
  renderer are not modified.
- **Cadence:** Check ~10s after launch, then every 6 hours, plus a manual
  "Check for updates" tray item.

## Architecture

### 1. Build / distribution changes

`electron-updater` reads a `latest.yml` manifest from the GitHub release and
downloads the installer that manifest names, plus a `.blockmap` for differential
downloads. `electron-builder` only emits `latest.yml` and the blockmap when a
`publish` block is configured.

- **`electron-builder.yml`:** add a `publish` block:
  ```yaml
  publish:
    provider: github
    owner: RealmSwap
    repo: RealmSwap
  ```
  This makes electron-builder emit `dist/latest.yml` and
  `dist/RealmSwap-Setup.exe.blockmap` during the build. The build is invoked with
  `--publish never` (or `electron-builder` defaults to not publishing on a normal
  build) so electron-builder only generates the manifest — the existing
  `softprops/action-gh-release` step does the actual upload.
- The `artifactName: ${productName}-Setup.${ext}` (→ `RealmSwap-Setup.exe`)
  is unchanged. `latest.yml` references that exact filename.

- **`.github/workflows/release.yml`:** the publish step's `files:` list grows
  from one asset to three:
  - `C:\rsbuild\dist\RealmSwap-Setup.exe`
  - `C:\rsbuild\dist\RealmSwap-Setup.exe.blockmap`
  - `C:\rsbuild\dist\latest.yml`

  Without `latest.yml` on the release, installed clients cannot detect new
  versions. The version is already set into `package.json` by the existing
  `npm version` step, so `latest.yml`'s `version` field is correct.

### 2. Updater module — `electron/updater.js` (new)

A self-contained module so `main.js` stays readable and the update logic is unit
testable in isolation. Exports a single init function plus a manual-check helper.

```
initAutoUpdate({ getMainWindow, getTray, beginQuit, refreshTrayMenu })
checkForUpdatesManual()
```

Responsibilities:

- Lazily `require("electron-updater")` and read `autoUpdater`. Set
  `autoUpdater.autoDownload = true` and `autoUpdater.autoInstallOnAppQuit = true`.
- Wire events:
  - `update-available` / `update-not-available` / `download-progress` — logged.
  - `update-downloaded` — record an "update staged" flag, reveal the
    "Restart to update" tray item (via `refreshTrayMenu`), and show a native
    `dialog.showMessageBox` with buttons "Restart now" / "Later". "Restart now"
    calls `applyUpdate()`.
  - `error` — caught and logged; never thrown to the app.
- `applyUpdate()`: call `beginQuit()` (sets the existing `isQuitting` flag so the
  `before-quit` Next-server shutdown runs) then `autoUpdater.quitAndInstall()`.
- Schedule: call `autoUpdater.checkForUpdates()` ~10s after init, then
  `setInterval(..., 6 * 60 * 60 * 1000)`.
- `checkForUpdatesManual()`: trigger a check and give the user feedback —
  "Checking…", then "You're up to date" or "Downloading update…" via a dialog,
  so manual checks are never silent. Reuses the same staged-update state.
- Every entry point is wrapped so a failure (network down, GitHub unreachable,
  malformed manifest) logs and returns rather than disrupting the app.

State the module owns: `updateStaged` (boolean), the interval handle, and a guard
so overlapping checks don't stack.

### 3. `main.js` integration

- Require `./updater` and call `initAutoUpdate(...)` inside the
  `app.whenReady()` production branch **only when `!isDev`** — `electron-updater`
  throws when the app is not packaged. Dev runs are unaffected.
- `buildTray()` gains two items:
  - **"Check for updates"** — always visible, calls `checkForUpdatesManual()`.
  - **"Restart to update"** — hidden until an update is staged, calls
    `applyUpdate()`.
  The tray menu is rebuilt by a `refreshTrayMenu()` helper so the staged item can
  appear after download. `buildTray()` is refactored to build its template via
  this helper.
- A `beginQuit()` helper sets `isQuitting = true` (the existing flag), reused by
  both the updater and the existing Quit menu items so the `before-quit` path
  cleanly stops the Next server before `quitAndInstall` relaunches the installer.

No changes to `preload.js`, the renderer, the Next server, or data handling.

### 4. Dependency

Add `electron-updater` to `dependencies` (not `devDependencies`) — it is required
at runtime and must be packed inside the asar. It pulls in `electron-builder`'s
update sibling packages; no other source changes needed.

## Components & boundaries

| Unit | Purpose | Depends on |
|------|---------|-----------|
| `electron/updater.js` | All update detection/download/apply/prompt logic | `electron-updater`, injected `dialog`/tray/window accessors |
| `electron/main.js` | Wires updater into app lifecycle + tray, owns `isQuitting` | `electron/updater.js` |
| `electron-builder.yml` | Emits `latest.yml` + blockmap via `publish` block | — |
| `.github/workflows/release.yml` | Uploads the 3 update assets to the release | electron-builder output |

The updater module takes its Electron collaborators (`dialog`, current window,
tray, quit flag setter) via the init params / lazy requires so it can be unit
tested with mocks without spinning up Electron.

## Error handling

- Update-check / download / manifest errors are caught in the module, logged via
  `console.error`, and swallowed — the app continues running normally on the
  current version.
- A failed background check does not prompt the user. A failed **manual** check
  shows a dialog ("Couldn't check for updates — please try again later") so the
  user who explicitly asked gets feedback.
- `initAutoUpdate` is only ever called in packaged production builds, avoiding the
  "app is not packaged" throw in dev.

## Testing / Verification

- **Unit (vitest):** test `electron/updater.js` decision logic with a mocked
  `autoUpdater` (emitting events), mocked `dialog`, and mocked tray/window
  accessors:
  - `update-downloaded` → dialog shown AND `refreshTrayMenu` called to reveal the
    restart item AND `updateStaged` set.
  - "Restart now" choice → `beginQuit()` called before `quitAndInstall()`.
  - `error` event → logged, no throw, app-state untouched.
  - `checkForUpdatesManual()` with `update-not-available` → "up to date" dialog.
- **Manual end-to-end** (documented, not automated — an updater can't be
  meaningfully unit-tested against real GitHub):
  1. Tag/build/publish version N (CI now uploads `latest.yml` + blockmap).
  2. Install an older build (version N-1).
  3. Launch it; within ~10s it detects N, downloads, and shows the dialog.
  4. "Restart now" relaunches into version N.

## Future / out of scope

- Code signing (removes SmartScreen warning; enables signature verification).
- Staged rollout / release channels (beta vs stable).
- In-renderer progress UI (would require opening a preload IPC surface).
