import { describe, it, expect } from "vitest";
import { playerStatusAfterBan, playerStatusAfterUnban } from "@/app/api/players/[id]/ban/status";

describe("ban status helpers", () => {
  it("ban -> BANNED", () => expect(playerStatusAfterBan()).toBe("BANNED"));
  it("unban with whitelists -> TRUSTED", () => expect(playerStatusAfterUnban(true)).toBe("TRUSTED"));
  it("unban without whitelists -> NEUTRAL", () => expect(playerStatusAfterUnban(false)).toBe("NEUTRAL"));
});
