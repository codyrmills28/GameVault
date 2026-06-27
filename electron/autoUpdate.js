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
    timers = { setTimeout, setInterval, clearTimeout },
    initialDelayMs = 10000,
    intervalMs = 6 * 60 * 60 * 1000,
  } = deps;

  let staged = false;        // an update has been downloaded and awaits restart
  let checking = false;      // a check is in flight (prevents overlap)
  let manualPending = false; // the in-flight check was user-initiated (wants feedback)
  let registered = false;

  const isStaged = () => staged;

  function showMessage(opts) {
    const win = getMainWindow();
    return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
  }

  async function applyUpdate() {
    try {
      // Set isQuitting before quitAndInstall so the before-quit handler runs
      // stopAllServers() to shut the Next server down cleanly before relaunch.
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
      try {
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
      } catch (err) {
        log.error("[updater] update-downloaded handling failed:", err);
      }
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
    try {
      Promise.resolve(autoUpdater.checkForUpdates())
        .catch((err) => log.error("[updater] check failed:", err))
        .finally(() => {
          checking = false;
        });
    } catch (err) {
      log.error("[updater] check failed:", err);
      checking = false;
    }
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

  // One-shot, bounded recovery used only when normal startup failed. Does NOT
  // call registerHandlers()/start(), so the normal "Update ready" dialog cannot
  // fire here. Resolves "applied" (user installed the fix), "declined" (user
  // chose Quit), or "unavailable" (no update / error / timeout).
  function attemptRecovery({ timeoutMs = 30000 } = {}) {
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

  return { start, checkManual, applyUpdate, isStaged, attemptRecovery };
}

module.exports = { createUpdater };
