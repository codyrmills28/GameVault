import { describe, it, expect } from "vitest";
import { validateBulkRequest } from "@/app/api/players/bulk/validate";

describe("validateBulkRequest", () => {
  it("rejects missing playerIds", () => {
    expect(validateBulkRequest({ action: "ban" }).ok).toBe(false);
  });
  it("rejects unknown action", () => {
    expect(validateBulkRequest({ playerIds: ["a"], action: "nuke" }).ok).toBe(false);
  });
  it("accepts a valid ban request", () => {
    const r = validateBulkRequest({ playerIds: ["a", "b"], action: "ban", reason: "x" });
    expect(r.ok).toBe(true);
  });
});
