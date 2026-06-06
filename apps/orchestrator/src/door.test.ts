import { describe, it, expect, vi } from "vitest";
import { Destination } from "@nera/contracts";
import { authorizeDoor, makeDoorSink, DOOR_CONFIDENCE_FLOOR } from "./door.js";

function dest(over: Partial<ReturnType<typeof Destination.parse>>) {
  return Destination.parse({
    sessionId: "s1",
    status: "resolved",
    transcript: "test",
    destinationId: "robotics-club",
    label: "Robotics Club",
    screen: { title: "Robotics Club" },
    confidence: 0.95,
    ...over,
  });
}

describe("authorizeDoor", () => {
  it("opens for a resolved destination at/above the confidence floor", () => {
    expect(authorizeDoor(dest({ confidence: DOOR_CONFIDENCE_FLOOR }))).toBe(true);
    expect(authorizeDoor(dest({ confidence: 0.95 }))).toBe(true);
  });

  it("refuses below the confidence floor", () => {
    expect(authorizeDoor(dest({ confidence: 0.8 }))).toBe(false);
  });

  it("refuses non-resolved statuses regardless of confidence", () => {
    expect(authorizeDoor(dest({ status: "ambiguous", confidence: 1 }))).toBe(false);
    expect(authorizeDoor(dest({ status: "no_match", destinationId: null, confidence: 1 }))).toBe(false);
    expect(authorizeDoor(dest({ status: "human_fallback", destinationId: null, confidence: 1 }))).toBe(false);
  });
});

describe("makeDoorSink", () => {
  it("dry-runs (no fetch) when no URL is configured", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const log = { info: vi.fn(), error: vi.fn() };
    const sink = makeDoorSink(undefined, log);
    sink.open(dest({ openDoor: true }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("DRY-RUN"));
    fetchSpy.mockRestore();
  });

  it("does nothing when openDoor is false", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const log = { info: vi.fn(), error: vi.fn() };
    makeDoorSink("http://door.local/unlock", log).open(dest({ openDoor: false }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("POSTs to the controller when openDoor is true and a URL is set", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const log = { info: vi.fn(), error: vi.fn() };
    makeDoorSink("http://door.local/unlock", log).open(dest({ openDoor: true }));
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://door.local/unlock",
      expect.objectContaining({ method: "POST" }),
    );
    fetchSpy.mockRestore();
  });
});
