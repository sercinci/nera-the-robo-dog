/**
 * Session state machine — pure reducer. The orchestrator interprets the phase
 * to drive effects (play welcome, open mic, run agent, speak, emit destination).
 *
 * IDLE → WELCOME → LISTEN → PROCESS → RESPOND → [CLARIFY ↺≤1] → DONE → IDLE
 *
 * Caps: at most 1 clarification turn and 1 listen-reprompt, then graceful exit.
 * A RING always hard-resets (cancel in-flight work upstream via AbortController).
 */
import type { DestinationStatus, SessionState } from "@nera/contracts";

export const CLARIFY_CAP = 1;
export const REPROMPT_CAP = 1;

export interface Session {
  phase: SessionState;
  clarifyCount: number;
  repromptCount: number;
  transcript?: string;
}

export type SessionEvent =
  | { type: "RING" }
  | { type: "WELCOME_DONE" }
  | { type: "TRANSCRIPT"; transcript: string }
  | { type: "RESOLVED"; status: DestinationStatus }
  | { type: "RESPOND_DONE" }
  | { type: "TIMEOUT" };

export function initialSession(): Session {
  return { phase: "IDLE", clarifyCount: 0, repromptCount: 0 };
}

export function reduce(s: Session, e: SessionEvent): Session {
  // A ring always starts a fresh greeting, cancelling whatever was happening.
  if (e.type === "RING") {
    return { phase: "WELCOME", clarifyCount: 0, repromptCount: 0 };
  }

  switch (s.phase) {
    case "WELCOME":
      if (e.type === "WELCOME_DONE") return { ...s, phase: "LISTEN" };
      return s;

    case "LISTEN":
      if (e.type === "TRANSCRIPT") return { ...s, phase: "PROCESS", transcript: e.transcript };
      if (e.type === "TIMEOUT") {
        return s.repromptCount < REPROMPT_CAP
          ? { ...s, phase: "LISTEN", repromptCount: s.repromptCount + 1 }
          : initialSession();
      }
      return s;

    case "PROCESS":
      if (e.type === "RESOLVED") {
        if (e.status === "resolved") return { ...s, phase: "RESPOND" };
        // ambiguous or no_match: re-ask once, then fall back to a spoken reply.
        return s.clarifyCount < CLARIFY_CAP
          ? { ...s, phase: "CLARIFY", clarifyCount: s.clarifyCount + 1 }
          : { ...s, phase: "RESPOND" };
      }
      return s;

    case "CLARIFY":
      if (e.type === "TRANSCRIPT") return { ...s, phase: "PROCESS", transcript: e.transcript };
      return s;

    case "RESPOND":
      if (e.type === "RESPOND_DONE") return { ...s, phase: "DONE" };
      return s;

    case "DONE":
      if (e.type === "TIMEOUT") return initialSession();
      return s;

    default:
      return s;
  }
}
