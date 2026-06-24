import { describe, it, expect } from "vitest";
import { formatSseEvent, SSE_HEARTBEAT } from "../sse";

describe("formatSseEvent", () => {
  it("frames a single line with a terminating blank line", () => {
    expect(formatSseEvent("hello")).toBe("data: hello\n\n");
  });
  it("frames each newline-separated line as its own data field", () => {
    expect(formatSseEvent("a\nb")).toBe("data: a\ndata: b\n\n");
  });
  it("prepends an event field when given", () => {
    expect(formatSseEvent("oops", { event: "error" })).toBe(
      "event: error\ndata: oops\n\n"
    );
  });
  it("frames an empty payload as a single empty data field", () => {
    expect(formatSseEvent("")).toBe("data: \n\n");
  });
});

describe("SSE_HEARTBEAT", () => {
  it("is an SSE comment frame", () => {
    expect(SSE_HEARTBEAT).toBe(": ping\n\n");
  });
});
