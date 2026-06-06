/**
 * Door sink — physical unlock on a VERIFIED appointment.
 *
 * Design (see log/DOOR_OPENING_PROPOSAL.md):
 *   - The LLM never opens the door. `check_appointment` emits a confidence score;
 *     the orchestrator turns that score into a deterministic door-open decision.
 *   - Env-gated like the Go2 sink: no DOOR_CONTROLLER_URL → dry-run log only.
 *     The demo never depends on hardware.
 *   - Fired in PARALLEL with voice + screen — never on the voice critical path.
 */
import type { Destination } from "@nera/contracts";

/** Minimum confidence required to authorize a physical unlock. */
export const DOOR_CONFIDENCE_FLOOR = 0.9;

/**
 * Deterministic authorization rule. A door only opens for a resolved destination
 * whose confidence clears the floor — i.e. a known visitor with an in-window
 * appointment (check_appointment returns 0.95) or an explicit high-confidence
 * place match. Ambiguous / no_match / human_fallback never open the door.
 */
export function authorizeDoor(d: Destination): boolean {
  return d.status === "resolved" && d.confidence >= DOOR_CONFIDENCE_FLOOR;
}

export interface DoorSink {
  /** Fire-and-forget. Safe to call on every turn; no-ops unless openDoor is set. */
  open(d: Destination): void;
}

/**
 * Build the door sink. With no URL it dry-runs (logs the unlock it WOULD send) —
 * exactly the Go2 pattern, so the concierge runs end-to-end without a real lock.
 */
export function makeDoorSink(
  url: string | undefined,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
): DoorSink {
  return {
    open(d) {
      if (!d.openDoor) return;
      if (!url) {
        log.info(`[door] DRY-RUN unlock (session=${d.sessionId} dest=${d.destinationId} conf=${d.confidence})`);
        return;
      }
      // Best-effort, non-blocking: a slow/failed lock must never stall the reply.
      void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unlock: true, sessionId: d.sessionId, destinationId: d.destinationId }),
      }).then(
        (r) => log.info(`[door] unlock sent (session=${d.sessionId} http=${r.status})`),
        (e) => log.error(`[door] unlock failed (session=${d.sessionId}):`, (e as Error).message),
      );
    },
  };
}
