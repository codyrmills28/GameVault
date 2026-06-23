import { describe, it, expect } from "vitest";
import { validateSpec, validateParamValues } from "../validate";

const okSpec: any = {
  install: { appId: "1", installSubDir: "x", checkFile: "x.exe", requiredDiskGB: 1 },
  launch: { executable: "x.exe", args: ["-port", "{port}", "-name", "{name}"] },
  defaultPort: 2456, params: [], configFiles: [], ports: [{ protocol: "UDP", port: "{port}" }],
};

describe("validateSpec", () => {
  it("accepts a valid steamcmd spec", () => {
    expect(validateSpec(okSpec, "STEAMCMD")).toEqual([]);
  });
  it("rejects an unknown template variable", () => {
    const bad = { ...okSpec, launch: { executable: "x.exe", args: ["{bogus}"] } };
    expect(validateSpec(bad, "STEAMCMD").join()).toMatch(/bogus/);
  });
  it("accepts a declared param used in args", () => {
    const spec = { ...okSpec, params: [{ key: "slots", label: "Slots", type: "number", default: 8 }], launch: { executable: "x.exe", args: ["-players", "{slots}"] } };
    expect(validateSpec(spec, "STEAMCMD")).toEqual([]);
  });
  it("requires appId for steamcmd", () => {
    const bad = { ...okSpec, install: { installSubDir: "x", checkFile: "x.exe", requiredDiskGB: 1 } };
    expect(validateSpec(bad, "STEAMCMD").join()).toMatch(/appId/i);
  });
  it("requires options for enum params", () => {
    const spec = { ...okSpec, params: [{ key: "mode", label: "Mode", type: "enum" }] };
    expect(validateSpec(spec, "STEAMCMD").join()).toMatch(/options/i);
  });
});

describe("validateParamValues", () => {
  const params: any = [
    { key: "slots", label: "Slots", type: "number", min: 1, max: 32, required: true },
    { key: "mode", label: "Mode", type: "enum", options: ["pve", "pvp"] },
  ];
  it("accepts valid values", () => {
    expect(validateParamValues(params, { slots: 8, mode: "pvp" })).toEqual([]);
  });
  it("rejects out-of-range number", () => {
    expect(validateParamValues(params, { slots: 99 }).join()).toMatch(/slots/);
  });
  it("rejects bad enum", () => {
    expect(validateParamValues(params, { slots: 8, mode: "x" }).join()).toMatch(/mode/);
  });
  it("rejects missing required", () => {
    expect(validateParamValues(params, {}).join()).toMatch(/slots/);
  });
});
