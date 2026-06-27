import { describe, it, expect } from "vitest";
import {
  shellQuote, parseMemToMB, parseDockerStats, buildStartEntrypoint, buildRunArgs,
} from "../dockerCli";

describe("shellQuote", () => {
  it("leaves safe tokens unquoted", () => {
    expect(shellQuote("-port")).toBe("-port");
    expect(shellQuote("2456")).toBe("2456");
  });
  it("single-quotes tokens with spaces", () => {
    expect(shellQuote("Viking Realm")).toBe("'Viking Realm'");
  });
  it("escapes embedded single quotes", () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });
});

describe("parseMemToMB", () => {
  it("parses MiB/GiB/KiB", () => {
    expect(parseMemToMB("123MiB")).toBeCloseTo(123, 3);
    expect(parseMemToMB("2GiB")).toBeCloseTo(2048, 3);
    expect(parseMemToMB("512KiB")).toBeCloseTo(0.5, 3);
    expect(parseMemToMB("1.5GiB")).toBeCloseTo(1536, 3);
  });
  it("returns 0 for junk", () => {
    expect(parseMemToMB("")).toBe(0);
  });
});

describe("parseDockerStats", () => {
  it("parses cpu percent and used memory", () => {
    const s = parseDockerStats("0.15%,123MiB / 2GiB");
    expect(s.cpuPercent).toBeCloseTo(0.15, 3);
    expect(s.memoryMB).toBeCloseTo(123, 3);
  });
  it("returns zeros for empty output", () => {
    expect(parseDockerStats("")).toEqual({ cpuPercent: 0, memoryMB: 0 });
  });
});

describe("buildStartEntrypoint", () => {
  it("runs steamcmd app_update then execs the server binary with quoted args", () => {
    const ep = buildStartEntrypoint("896660", "valheim-server", "valheim_server.x86_64", ["-name", "Viking Realm", "-port", "2456"]);
    expect(ep).toBe(
      "steamcmd +force_install_dir /data/valheim-server +login anonymous +app_update 896660 validate +quit" +
      " && cd /data/valheim-server && exec ./valheim_server.x86_64 -name 'Viking Realm' -port 2456"
    );
  });
});

describe("buildRunArgs", () => {
  it("builds docker run argv with mounts, published ports, env, and entrypoint", () => {
    const args = buildRunArgs({
      containerName: "realmswap-server-abc",
      image: "cm2network/steamcmd",
      hostDataDir: "/data/local-servers/abc",
      ports: [{ protocol: "UDP", port: 2456 }, { protocol: "UDP", port: 2457 }],
      env: { SteamAppId: "892970" },
      entrypoint: "echo hi",
    });
    expect(args).toEqual([
      "run", "-d", "--name", "realmswap-server-abc",
      "-v", "/data/local-servers/abc:/data",
      "-p", "2456:2456/udp",
      "-p", "2457:2457/udp",
      "-e", "SteamAppId=892970",
      "cm2network/steamcmd", "bash", "-lc", "echo hi",
    ]);
  });
});
