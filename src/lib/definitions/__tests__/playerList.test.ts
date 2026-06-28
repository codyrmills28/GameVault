import { describe, it, expect } from "vitest";
import { BUILTIN_DEFINITIONS } from "../builtins";

function spec(slug: string) {
  return BUILTIN_DEFINITIONS.find((d) => d.slug === slug)!.spec;
}

describe("Minecraft playerList", () => {
  const pl = spec("MINECRAFT").playerList!;
  it("keys on minecraft name", () => expect(pl.identity).toBe("minecraftName"));
  it("whitelist writes whitelist.json as object array on field name", () => {
    expect(pl.whitelist?.file).toEqual({ path: "whitelist.json", format: "jsonArray", field: "name" });
    expect(pl.whitelist?.console).toEqual({ add: "whitelist add {id}", remove: "whitelist remove {id}" });
  });
  it("ban writes banned-players.json and uses ban/pardon console", () => {
    expect(pl.ban?.file).toEqual({ path: "banned-players.json", format: "jsonArray", field: "name" });
    expect(pl.ban?.console).toEqual({ add: "ban {id} {reason}", remove: "pardon {id}" });
  });
});

describe("Valheim playerList", () => {
  const pl = spec("VALHEIM").playerList!;
  it("keys on steamId", () => expect(pl.identity).toBe("steamId"));
  it("whitelist -> permittedlist.txt (lineList)", () => {
    expect(pl.whitelist?.file).toEqual({ path: "permittedlist.txt", format: "lineList" });
  });
  it("ban -> bannedlist.txt (lineList)", () => {
    expect(pl.ban?.file).toEqual({ path: "bannedlist.txt", format: "lineList" });
  });
});

describe("Rust playerList", () => {
  const pl = spec("RUST").playerList!;
  it("keys on steamId", () => expect(pl.identity).toBe("steamId"));
  it("ban uses banid/unban console commands", () => {
    expect(pl.ban?.console).toEqual({ add: 'banid {id} "{reason}"', remove: "unban {id}" });
    expect(pl.ban?.file).toBeUndefined();
  });
  it("whitelist is not enforced (no native whitelist)", () => {
    expect(pl.whitelist?.enforced).toBe(false);
  });
});

describe("Palworld playerList", () => {
  const pl = spec("PALWORLD").playerList!;
  it("keys on steamId", () => expect(pl.identity).toBe("steamId"));
  it("ban uses BanPlayer console command and banlist.txt file", () => {
    expect(pl.ban?.console).toEqual({ add: "BanPlayer {id}", remove: "UnBanPlayer {id}" });
    expect(pl.ban?.file).toEqual({ path: "Pal/Saved/SaveGames/banlist.txt", format: "lineList" });
  });
  it("whitelist is not enforced (no native whitelist)", () => {
    expect(pl.whitelist?.enforced).toBe(false);
  });
});

describe("ARK playerList", () => {
  const pl = spec("ARK").playerList!;
  it("keys on steamId", () => expect(pl.identity).toBe("steamId"));
  it("ban uses cheat BanPlayer/UnbanPlayer console commands (no local file)", () => {
    expect(pl.ban?.console).toEqual({ add: "cheat BanPlayer {id}", remove: "cheat UnbanPlayer {id}" });
    expect(pl.ban?.file).toBeUndefined();
  });
  it("whitelist is not enforced (URL-based ban list, no local whitelist file)", () => {
    expect(pl.whitelist?.enforced).toBe(false);
  });
});

describe("Project Zomboid playerList", () => {
  const pl = spec("ZOMBOID").playerList!;
  it("keys on steamId", () => expect(pl.identity).toBe("steamId"));
  it("ban uses banid/unbanid console commands", () => {
    expect(pl.ban?.console).toEqual({ add: "banid {id}", remove: "unbanid {id}" });
    expect(pl.ban?.file).toBeUndefined();
  });
  it("whitelist is not enforced (no confirmed native whitelist)", () => {
    expect(pl.whitelist?.enforced).toBe(false);
  });
});

describe("every builtin has a valid playerList shape or none", () => {
  it("identity is a known key when playerList is present", () => {
    const keys = ["minecraftName", "minecraftUuid", "steamId", "xboxId"];
    for (const d of BUILTIN_DEFINITIONS) {
      if (d.spec.playerList) expect(keys).toContain(d.spec.playerList.identity);
    }
  });
});
