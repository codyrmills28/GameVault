import { describe, it, expect } from "vitest";
import { adoptiumUrl, parseRequiredJavaMajor, findArchiveJavaRoot } from "../javaRuntime";

describe("adoptiumUrl", () => {
  it("builds the Windows x64 GA JRE endpoint for a major version", () => {
    expect(adoptiumUrl(25)).toBe(
      "https://api.adoptium.net/v3/binary/latest/25/ga/windows/x64/jre/hotspot/normal/eclipse"
    );
  });
});

describe("parseRequiredJavaMajor", () => {
  it("maps class file version to Java major (classFileVersion - 44)", () => {
    const msg = (v: string) =>
      `java.lang.UnsupportedClassVersionError: net/minecraft/bundler/Main has been compiled by a more recent version of the Java Runtime (class file version ${v}), this version of the Java Runtime only recognizes class file versions up to 65.0`;
    expect(parseRequiredJavaMajor(msg("69.0"))).toBe(25);
    expect(parseRequiredJavaMajor(msg("65.0"))).toBe(21);
    expect(parseRequiredJavaMajor(msg("61.0"))).toBe(17);
  });
  it("returns null when there is no class-file-version marker", () => {
    expect(parseRequiredJavaMajor("some unrelated crash log")).toBeNull();
    expect(parseRequiredJavaMajor("")).toBeNull();
  });
});

describe("findArchiveJavaRoot", () => {
  it("returns the single top dir that contains bin/java.exe", () => {
    const entries = ["jdk-25+9-jre", "jdk-25+9-jre/bin/java.exe"];
    const exists = (p: string) => p === "jdk-25+9-jre/bin/java.exe";
    expect(findArchiveJavaRoot(entries, exists)).toBe("jdk-25+9-jre");
  });
  it("returns empty string when java.exe is already at the root", () => {
    expect(findArchiveJavaRoot(["bin/java.exe"], (p) => p === "bin/java.exe")).toBe("");
  });
  it("returns null when java.exe is absent", () => {
    expect(findArchiveJavaRoot(["foo", "foo/bar"], () => false)).toBeNull();
  });
});
