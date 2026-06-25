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
