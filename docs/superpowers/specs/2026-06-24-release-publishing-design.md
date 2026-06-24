# Release Publishing Pipeline — Design

**Date:** 2026-06-24
**Status:** Approved (design), pending implementation plan

## Problem

The marketing site's download button points at
`https://github.com/RealmSwap/RealmSwap/releases/latest/download/RealmSwap-Setup.exe`,
but no GitHub Release containing that asset exists, so the button 404s. There is
currently no automated way to build the Windows installer and publish it to a
release. `electron-builder.yml` has no `publish:` block, and `npm run
electron:build` produces `dist/RealmSwap-Setup.exe` locally but nothing uploads it.

## Goal

Add a tag-driven GitHub Actions workflow that builds the Windows installer and
publishes it as a GitHub Release asset, so the stable "latest" download URL
resolves and the marketing site's download button works.

## Non-goals

- Code signing the installer (no certificate yet — see Caveats).
- In-app auto-update (`electron-updater`) — not added now, but the design keeps a
  clean additive path (see Future auto-update).
- macOS/Linux builds — the app targets Windows (NSIS) only.
- Changing the version-less artifact name (`RealmSwap-Setup.exe`), which the
  marketing download URL depends on.

## Architecture

A new workflow `.github/workflows/release.yml`, independent of the existing
`ci.yml` (tests) and `site.yml` (Pages deploy).

### Trigger & version resolution

Two entry points that converge on a single `VERSION` + `TAG`:

- **Push a tag `v*`** (primary): `VERSION` = tag with the leading `v` stripped
  (`v0.1.0` → `0.1.0`); `TAG` = the pushed tag (`v0.1.0`).
- **`workflow_dispatch`** with a required `version` input (manual fallback /
  re-run): `VERSION` = the input (e.g. `0.1.0`); `TAG` = `v<input>`. The release
  step creates the tag on the checked-out commit.

The version is the source of truth from the tag/input and is written into
`package.json` at build time (approach B), so the NSIS installer embeds the
released version. The rewrite is build-time only and is never committed back:

```
npm version $VERSION --no-git-tag-version --allow-same-version
```

### Build & publish job

Single job:

- `runs-on: windows-latest` — the NSIS installer target is Windows-only.
- `permissions: contents: write` — required to create the release.

Steps:

1. **Checkout** — `actions/checkout@v4`.
2. **Setup Node** — `actions/setup-node@v4`, Node 20, npm cache.
3. **Resolve version & tag** — compute `VERSION` and `TAG` from
   `GITHUB_REF_NAME` (tag push) or the `version` input (dispatch); expose them to
   later steps.
4. **`npm ci`** — runs the existing `postinstall` (`prisma generate`), producing
   the Windows query engine (`src/generated/client/query-engine-windows.exe`)
   that `electron-builder.yml` bundles via `extraResources`.
5. **Set version** — `npm version $VERSION --no-git-tag-version
   --allow-same-version`.
6. **Build the installer** — `npm run electron:build` (which runs `prepackage`:
   `make-template-db.js` + `next build`, then `electron-builder`). Job-level env
   `DATABASE_URL: file:./dev.db` is set because `.env` is gitignored and absent on
   CI; `next build` and `make-template-db.js` both reference `DATABASE_URL`.
   Produces `dist/RealmSwap-Setup.exe`.
7. **Publish release** — `softprops/action-gh-release@v2` with
   `tag_name: $TAG`, `name: $TAG`, `draft: false`, `prerelease: false`,
   `files: dist/RealmSwap-Setup.exe`, authenticated with the built-in
   `GITHUB_TOKEN`.

### Atomicity

The publish step (7) runs only after the build (6) succeeds. A failed build
never produces a public release. On success the release is published *with* the
`.exe` attached in one step, so `releases/latest/download/RealmSwap-Setup.exe`
resolves immediately — no window where "latest" exists without its binary.
(`releases/latest/download/...` only points at full, published, non-prerelease
releases, which is why `draft: false` / `prerelease: false` matter.)

## Caveats

- **Unsigned installer.** With no code-signing certificate, Windows SmartScreen
  warns users ("unknown publisher") on first download/run. Acquiring a cert and
  wiring electron-builder signing is a separate, out-of-scope effort; this is a
  known limitation.
- **Token.** Creating a release in the same repo needs only the built-in
  `GITHUB_TOKEN` plus `contents: write` — no PAT or extra secrets.
- **`ci.yml` also runs on tag pushes.** A tag push triggers the existing
  test workflow (it listens on all `push` events) in addition to this one. This
  is harmless (tests just run again) and out of scope to change here.

## Future auto-update (additive path, not built now)

When `electron-updater` is added later, the delta is additive and touches none of
the trigger, versioning, or job shape decided here:

1. Add `electron-updater` and wire `autoUpdater` in `electron/main.js`.
2. Add a `publish:` block to `electron-builder.yml` (`provider: github`, owner
   `RealmSwap`, repo `RealmSwap`), which makes electron-builder emit `latest.yml`
   and `RealmSwap-Setup.exe.blockmap` into `dist/`.
3. Add `dist/latest.yml` and `dist/RealmSwap-Setup.exe.blockmap` to the release
   step's `files:` list.

The version-less artifact name is compatible with `electron-updater`, which keys
updates off the `version` field in `latest.yml`, not the filename.

## Testing / Verification

A release workflow cannot be meaningfully unit-tested; the real test is cutting a
release.

1. Validate `release.yml` parses as YAML.
2. Cut the first release `v0.1.0` (push the tag, or run `workflow_dispatch` with
   `version: 0.1.0`) — a human-triggered step, since it publishes a public
   artifact. Confirm:
   - the Actions run completes green;
   - the release `v0.1.0` is published with `RealmSwap-Setup.exe` attached;
   - `https://github.com/RealmSwap/RealmSwap/releases/latest/download/RealmSwap-Setup.exe`
     returns the file (the marketing download button works).
