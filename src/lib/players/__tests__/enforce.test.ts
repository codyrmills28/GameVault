import { describe, it, expect, vi } from "vitest";
import { planEnforcement, applyToServer } from "../enforce";
import type { GameDefinitionSpec } from "@/lib/definitions/types";

const mcSpec = {
  playerList: {
    identity: "minecraftName",
    ban: { file: { path: "banned-players.json", format: "jsonArray", field: "name" }, console: { add: "ban {id} {reason}", remove: "pardon {id}" } },
    whitelist: { file: { path: "whitelist.json", format: "jsonArray", field: "name" }, console: { add: "whitelist add {id}", remove: "whitelist remove {id}" } },
  },
} as unknown as GameDefinitionSpec;

const player = { id: "p1", minecraftName: "Steve", steamId: null, xboxId: null, minecraftUuid: null };

describe("planEnforcement", () => {
  it("UNSUPPORTED when the spec has no playerList", () => {
    const r = planEnforcement({} as GameDefinitionSpec, player, { type: "BAN", op: "add", reason: "x" });
    expect(r.status).toBe("UNSUPPORTED");
  });
  it("FAILED when the player lacks the identity field", () => {
    const r = planEnforcement(mcSpec, { ...player, minecraftName: null }, { type: "BAN", op: "add", reason: "x" });
    expect(r.status).toBe("FAILED");
    expect(r.detail).toMatch(/minecraftName/);
  });
  it("produces a file path and console command for a ban add", () => {
    const r = planEnforcement(mcSpec, player, { type: "BAN", op: "add", reason: "Griefing" });
    expect(r.filePath).toBe("banned-players.json");
    expect(r.mergeId).toBe("Steve");
    expect(r.consoleCommand).toBe("ban Steve Griefing");
  });
  it("UNSUPPORTED for whitelist when enforced is false", () => {
    const spec = { playerList: { identity: "steamId", whitelist: { enforced: false } } } as unknown as GameDefinitionSpec;
    const r = planEnforcement(spec, { ...player, steamId: "1" }, { type: "WHITELIST", op: "add" });
    expect(r.status).toBe("UNSUPPORTED");
  });
});

describe("applyToServer", () => {
  function deps(overrides: any = {}) {
    return {
      resolveSpec: vi.fn().mockResolvedValue(mcSpec),
      installDir: vi.fn().mockReturnValue("/tmp/srv"),
      readFile: vi.fn().mockReturnValue(""),
      writeFile: vi.fn(),
      isRunning: vi.fn().mockReturnValue(false),
      sendCommand: vi.fn().mockResolvedValue(undefined),
      recordEnforcement: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }
  const server = { id: "s1", game: "MINECRAFT", definitionId: null, status: "STOPPED" } as any;

  it("writes the merged file and records APPLIED when stopped", async () => {
    const d = deps();
    const r = await applyToServer(player, server, d, { type: "BAN", op: "add", reason: "Griefing" });
    expect(d.writeFile).toHaveBeenCalledOnce();
    expect(d.sendCommand).not.toHaveBeenCalled();
    expect(r.status).toBe("APPLIED");
    expect(d.recordEnforcement).toHaveBeenCalledWith("s1", "BAN", "APPLIED", undefined);
  });

  it("also sends the live command when running", async () => {
    const d = deps({ isRunning: vi.fn().mockReturnValue(true) });
    await applyToServer(player, { ...server, status: "RUNNING" }, d, { type: "BAN", op: "add", reason: "g" });
    expect(d.sendCommand).toHaveBeenCalledWith(expect.anything(), "ban Steve g");
  });

  it("records UNSUPPORTED and writes nothing when no mapping", async () => {
    const d = deps({ resolveSpec: vi.fn().mockResolvedValue({}) });
    const r = await applyToServer(player, server, d, { type: "BAN", op: "add", reason: "g" });
    expect(d.writeFile).not.toHaveBeenCalled();
    expect(r.status).toBe("UNSUPPORTED");
  });

  it("records FAILED with detail when writeFile throws", async () => {
    const d = deps({ writeFile: vi.fn(() => { throw new Error("disk full"); }) });
    const r = await applyToServer(player, server, d, { type: "BAN", op: "add", reason: "g" });
    expect(r.status).toBe("FAILED");
    expect(r.detail).toMatch(/disk full/);
  });
});
