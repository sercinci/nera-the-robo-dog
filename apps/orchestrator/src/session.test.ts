import { describe, it, expect } from "vitest";
import { initialSession, reduce } from "./session.js";

describe("session state machine", () => {
  it("starts IDLE", () => {
    expect(initialSession().phase).toBe("IDLE");
  });

  it("RING -> WELCOME", () => {
    expect(reduce(initialSession(), { type: "RING" }).phase).toBe("WELCOME");
  });

  it("WELCOME -> LISTEN when the welcome line finishes", () => {
    let s = reduce(initialSession(), { type: "RING" });
    s = reduce(s, { type: "WELCOME_DONE" });
    expect(s.phase).toBe("LISTEN");
  });

  it("LISTEN -> PROCESS on a committed transcript, capturing it", () => {
    let s = reduce(initialSession(), { type: "RING" });
    s = reduce(s, { type: "WELCOME_DONE" });
    s = reduce(s, { type: "TRANSCRIPT", transcript: "where is gabriela" });
    expect(s.phase).toBe("PROCESS");
    expect(s.transcript).toBe("where is gabriela");
  });

  it("PROCESS -> RESPOND when resolved", () => {
    const s = reduce({ ...initialSession(), phase: "PROCESS" }, { type: "RESOLVED", status: "resolved" });
    expect(s.phase).toBe("RESPOND");
  });

  it("PROCESS -> CLARIFY when ambiguous (within the clarify cap)", () => {
    const s = reduce({ ...initialSession(), phase: "PROCESS" }, { type: "RESOLVED", status: "ambiguous" });
    expect(s.phase).toBe("CLARIFY");
    expect(s.clarifyCount).toBe(1);
  });

  it("CLARIFY -> PROCESS on the next transcript", () => {
    let s = reduce({ ...initialSession(), phase: "PROCESS" }, { type: "RESOLVED", status: "ambiguous" });
    s = reduce(s, { type: "TRANSCRIPT", transcript: "the one in robotics" });
    expect(s.phase).toBe("PROCESS");
  });

  it("ambiguous again after the clarify cap -> RESPOND (human fallback)", () => {
    let s = reduce({ ...initialSession(), phase: "PROCESS" }, { type: "RESOLVED", status: "ambiguous" });
    s = reduce(s, { type: "TRANSCRIPT", transcript: "still unclear" });
    s = reduce(s, { type: "RESOLVED", status: "ambiguous" });
    expect(s.phase).toBe("RESPOND");
  });

  it("no_match re-asks once, then falls back to RESPOND", () => {
    let s = reduce({ ...initialSession(), phase: "PROCESS" }, { type: "RESOLVED", status: "no_match" });
    expect(s.phase).toBe("CLARIFY"); // first miss => re-ask
    s = reduce(s, { type: "TRANSCRIPT", transcript: "try again" });
    s = reduce(s, { type: "RESOLVED", status: "no_match" });
    expect(s.phase).toBe("RESPOND"); // second miss => human fallback
  });

  it("RESPOND -> DONE -> IDLE", () => {
    let s = reduce({ ...initialSession(), phase: "RESPOND" }, { type: "RESPOND_DONE" });
    expect(s.phase).toBe("DONE");
    s = reduce(s, { type: "TIMEOUT" });
    expect(s.phase).toBe("IDLE");
  });

  it("LISTEN times out: reprompts once, then resets to IDLE", () => {
    let s = reduce(initialSession(), { type: "RING" });
    s = reduce(s, { type: "WELCOME_DONE" });
    s = reduce(s, { type: "TIMEOUT" });
    expect(s.phase).toBe("LISTEN");
    expect(s.repromptCount).toBe(1);
    s = reduce(s, { type: "TIMEOUT" });
    expect(s.phase).toBe("IDLE");
  });

  it("a new RING hard-resets from any phase and clears counters", () => {
    let s = reduce({ ...initialSession(), phase: "RESPOND", clarifyCount: 1, repromptCount: 1 }, { type: "RING" });
    expect(s.phase).toBe("WELCOME");
    expect(s.clarifyCount).toBe(0);
    expect(s.repromptCount).toBe(0);
  });
});
