import { describe, it, expect, vi } from "vitest";
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
    const opts = dialog.showMessageBox.mock.calls[0][0];
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
    expect(dialog.showMessageBox.mock.calls[0][0].message).toMatch(/up to date/i);
  });

  it("manual check reports a downloading update when one is available", async () => {
    const { deps, autoUpdater, dialog } = makeDeps();
    const u = createUpdater(deps);
    u.checkManual();

    autoUpdater.emit("update-available", { version: "9.9.9" });
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalled());
    expect(dialog.showMessageBox.mock.calls[0][0].title).toMatch(/available/i);
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
    expect(dialog.showMessageBox.mock.calls[0][0].type).toBe("error");
  });

  it("start() schedules an initial check and a recurring interval", () => {
    const { deps } = makeDeps();
    const u = createUpdater(deps);
    u.start();
    expect(deps.timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 10000);
    expect(deps.timers.setInterval).toHaveBeenCalledWith(expect.any(Function), 21600000);
  });
});

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
