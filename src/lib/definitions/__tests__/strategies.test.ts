import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { writeWindroseConfig } from "../strategies";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "windrose-"));
}

function readConfig(dir: string): any {
  return JSON.parse(fs.readFileSync(path.join(dir, "ServerDescription.json"), "utf-8"));
}

describe("writeWindroseConfig", () => {
  it("sets the password and marks the server password-protected when a password is given", () => {
    const dir = tmpDir();
    writeWindroseConfig(dir, "My Server", "secret");
    const cfg = readConfig(dir);
    expect(cfg.ServerName).toBe("My Server");
    expect(cfg.Password).toBe("secret");
    expect(cfg.IsPasswordProtected).toBe(true);
  });

  it("empties the password and clears the flag when no password is given", () => {
    const dir = tmpDir();
    writeWindroseConfig(dir, "My Server");
    const cfg = readConfig(dir);
    expect(cfg.Password).toBe("");
    expect(cfg.IsPasswordProtected).toBe(false);
  });

  it("derives a deterministic 6+ alphanumeric invite code from the name", () => {
    const dir = tmpDir();
    writeWindroseConfig(dir, "My Server!", "x");
    const cfg = readConfig(dir);
    expect(cfg.InviteCode).toMatch(/^[A-Z0-9]{6,}$/);
    // alnum("My Server!") = "MyServer" -> + "WINDROSE" -> upper -> slice(0,6)
    expect(cfg.InviteCode).toBe("MYSERV");
  });

  it("pads short names so the invite code is always >= 6 chars", () => {
    const dir = tmpDir();
    writeWindroseConfig(dir, "ab");
    const cfg = readConfig(dir);
    expect(cfg.InviteCode).toBe("ABWIND");
  });
});
