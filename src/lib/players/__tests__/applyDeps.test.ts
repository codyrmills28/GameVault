import { describe, it, expect, vi } from "vitest";
import { resolveInstallSubDir } from "../applyDeps";

describe("resolveInstallSubDir", () => {
  it("returns installSubDir for steamcmd/download specs", () => {
    expect(resolveInstallSubDir({ install: { installSubDir: "valheim-server" } } as any)).toBe("valheim-server");
  });
  it("returns undefined when no subdir (e.g. Minecraft download to base)", () => {
    expect(resolveInstallSubDir({ install: { fileName: "server.jar" } } as any)).toBeUndefined();
  });
});
