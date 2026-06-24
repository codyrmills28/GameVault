import { describe, it, expect, beforeEach } from "vitest";
import {
  parseSteamProgress,
  computePercent,
  setProgress,
  getProgress,
  clearProgress,
} from "../downloadProgress";

describe("parseSteamProgress", () => {
  it("extracts the percent from a steam download line", () => {
    expect(
      parseSteamProgress("Update state (0x61) downloading, progress: 42.66 (123 / 456)")
    ).toBeCloseTo(42.66);
  });
  it("parses an integer-valued progress", () => {
    expect(parseSteamProgress("progress: 100.00 (456 / 456)")).toBe(100);
  });
  it("returns null when there is no progress token", () => {
    expect(parseSteamProgress("Logging in user ... OK")).toBeNull();
  });
  it("returns null for a malformed progress value", () => {
    expect(parseSteamProgress("progress: abc")).toBeNull();
  });
  it("clamps values above 100", () => {
    expect(parseSteamProgress("progress: 150.0")).toBe(100);
  });
});

describe("computePercent", () => {
  it("computes a normal ratio", () => {
    expect(computePercent(50, 200)).toBe(25);
  });
  it("returns null when total is zero", () => {
    expect(computePercent(10, 0)).toBeNull();
  });
  it("returns null when total is negative", () => {
    expect(computePercent(10, -5)).toBeNull();
  });
  it("returns null when total is not finite", () => {
    expect(computePercent(10, NaN)).toBeNull();
  });
  it("clamps when received exceeds total", () => {
    expect(computePercent(300, 200)).toBe(100);
  });
});

describe("progress store", () => {
  beforeEach(() => clearProgress("srv1"));

  it("returns null when nothing is set", () => {
    expect(getProgress("srv1")).toBeNull();
  });
  it("stores and retrieves progress", () => {
    setProgress("srv1", { phase: "steam", percent: 10, label: "Downloading 10%" });
    const p = getProgress("srv1");
    expect(p?.phase).toBe("steam");
    expect(p?.percent).toBe(10);
    expect(p?.label).toBe("Downloading 10%");
    expect(p?.updatedAt).toBeGreaterThan(0);
  });
  it("merges partial updates (keeps existing phase, overwrites percent)", () => {
    setProgress("srv1", { phase: "steam", percent: 10, label: "Downloading 10%" });
    setProgress("srv1", { percent: 55, label: "Downloading 55%" });
    const p = getProgress("srv1");
    expect(p?.phase).toBe("steam");
    expect(p?.percent).toBe(55);
    expect(p?.label).toBe("Downloading 55%");
  });
  it("stores a null percent (indeterminate)", () => {
    setProgress("srv1", { phase: "extract", percent: null, label: "Extracting…" });
    expect(getProgress("srv1")?.percent).toBeNull();
  });
  it("clears progress", () => {
    setProgress("srv1", { percent: 10 });
    clearProgress("srv1");
    expect(getProgress("srv1")).toBeNull();
  });
});
