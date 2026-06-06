import { describe, it, expect } from "vitest";
import { Turn } from "./timing.js";

describe("Turn timings", () => {
  it("hero KPI = ttsFirstAudio - speechCommit", () => {
    const t = new Turn();
    t.mark("speechCommitAt", 1000);
    t.mark("ttsFirstAudioAt", 1740);
    expect(t.heroMs()).toBe(740);
  });

  it("screen KPI = screenRendered - speechCommit", () => {
    const t = new Turn();
    t.mark("speechCommitAt", 1000);
    t.mark("screenRenderedAt", 1620);
    expect(t.screenMs()).toBe(620);
  });

  it("returns undefined KPIs when stamps are missing", () => {
    const t = new Turn();
    t.mark("speechCommitAt", 1000);
    expect(t.heroMs()).toBeUndefined();
  });

  it("segments are ordered deltas between consecutive stamps", () => {
    const t = new Turn();
    t.mark("speechCommitAt", 1000);
    t.mark("agentFirstTokenAt", 1300);
    t.mark("destinationEmittedAt", 1500);
    const segs = t.segments();
    expect(segs).toEqual([
      { from: "speechCommitAt", to: "agentFirstTokenAt", ms: 300 },
      { from: "agentFirstTokenAt", to: "destinationEmittedAt", ms: 200 },
    ]);
  });
});
