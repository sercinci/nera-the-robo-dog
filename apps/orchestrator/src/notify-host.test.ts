import { describe, it, expect, vi } from "vitest";
import { Destination } from "@nera/contracts";
import { shouldNotifyHost, makeNotifyHostSink } from "./notify-host.js";

function dest(over: Partial<ReturnType<typeof Destination.parse>>) {
  return Destination.parse({
    sessionId: "s1",
    status: "no_match",
    transcript: "is bob here?",
    destinationId: null,
    label: null,
    screen: { title: "Let me find someone for you" },
    confidence: 0,
    ...over,
  });
}

describe("shouldNotifyHost", () => {
  it("pages on no_match and human_fallback", () => {
    expect(shouldNotifyHost(dest({ status: "no_match" }))).toBe(true);
    expect(shouldNotifyHost(dest({ status: "human_fallback" }))).toBe(true);
  });

  it("does not page on resolved or ambiguous", () => {
    expect(shouldNotifyHost(dest({ status: "resolved", destinationId: "room-cafe", confidence: 0.9 }))).toBe(false);
    expect(shouldNotifyHost(dest({ status: "ambiguous" }))).toBe(false);
  });
});

describe("makeNotifyHostSink", () => {
  it("dry-runs (no fetch) when no URL is configured", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const log = { info: vi.fn(), error: vi.fn() };
    makeNotifyHostSink(undefined, log).notify(dest({}));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("DRY-RUN"));
    fetchSpy.mockRestore();
  });

  it("POSTs to the staff endpoint when a URL is set", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const log = { info: vi.fn(), error: vi.fn() };
    makeNotifyHostSink("http://staff.local/page", log).notify(dest({}));
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://staff.local/page",
      expect.objectContaining({ method: "POST" }),
    );
    fetchSpy.mockRestore();
  });

  it("pages at most once per session, until reset", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const log = { info: vi.fn(), error: vi.fn() };
    const sink = makeNotifyHostSink("http://staff.local/page", log);
    sink.notify(dest({ sessionId: "s1" }));
    sink.notify(dest({ sessionId: "s1" })); // de-duped
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    sink.reset("s1");
    sink.notify(dest({ sessionId: "s1" })); // new visitor on same id
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });
});
