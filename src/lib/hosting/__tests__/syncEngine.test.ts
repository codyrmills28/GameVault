import { describe, it, expect } from "vitest";
import { planTransfer, isIgnored } from "../syncEngine";
import { DEFAULT_IGNORE, FileEntry } from "../types";

const f = (relPath: string, size: number, mtimeMs: number): FileEntry => ({ relPath, size, mtimeMs, isDir: false });
const d = (relPath: string): FileEntry => ({ relPath, size: 0, mtimeMs: 0, isDir: true });

describe("isIgnored", () => {
  it("matches directory prefixes", () => {
    expect(isIgnored("logs/latest.log", DEFAULT_IGNORE)).toBe(true);
    expect(isIgnored("logs", DEFAULT_IGNORE)).toBe(true);
  });
  it("matches basename globs", () => {
    expect(isIgnored("world/session.lock", DEFAULT_IGNORE)).toBe(true);
  });
  it("matches exact filenames", () => {
    expect(isIgnored("realm.json", DEFAULT_IGNORE)).toBe(true);
  });
  it("does not match unrelated paths", () => {
    expect(isIgnored("world/level.dat", DEFAULT_IGNORE)).toBe(false);
  });
});

describe("planTransfer", () => {
  it("copies files missing on the destination", () => {
    const plan = planTransfer([f("world/level.dat", 10, 100)], [], []);
    expect(plan.ops).toContainEqual({ type: "copy", relPath: "world/level.dat" });
  });

  it("creates destination directories that are absent", () => {
    const plan = planTransfer([d("world"), f("world/level.dat", 10, 100)], [], []);
    const mkdirs = plan.ops.filter((o) => o.type === "mkdir").map((o) => o.relPath);
    expect(mkdirs).toContain("world");
    // mkdir ops sort before copies
    expect(plan.ops[0].type).toBe("mkdir");
  });

  it("skips files that are unchanged (same size, dest not older)", () => {
    const plan = planTransfer([f("a.txt", 5, 100)], [f("a.txt", 5, 100)], []);
    expect(plan.ops.find((o) => o.relPath === "a.txt")).toBeUndefined();
  });

  it("copies when size differs", () => {
    const plan = planTransfer([f("a.txt", 6, 100)], [f("a.txt", 5, 100)], []);
    expect(plan.ops).toContainEqual({ type: "copy", relPath: "a.txt" });
  });

  it("copies when source is newer than destination", () => {
    const plan = planTransfer([f("a.txt", 5, 200)], [f("a.txt", 5, 100)], []);
    expect(plan.ops).toContainEqual({ type: "copy", relPath: "a.txt" });
  });

  it("does not re-copy when destination is newer", () => {
    const plan = planTransfer([f("a.txt", 5, 100)], [f("a.txt", 5, 200)], []);
    expect(plan.ops.find((o) => o.relPath === "a.txt")).toBeUndefined();
  });

  it("excludes ignored paths from the plan", () => {
    const plan = planTransfer([f("logs/x.log", 5, 100), f("world/level.dat", 5, 100)], [], DEFAULT_IGNORE);
    const paths = plan.ops.map((o) => o.relPath);
    expect(paths).not.toContain("logs/x.log");
    expect(paths).toContain("world/level.dat");
  });
});
