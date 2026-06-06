/**
 * Notify-host sink — actually pages a human when Nera gives up.
 *
 * The bug this fixes: instructions.md tells Nera to "trigger human_fallback /
 * notify_host", but those were never registered skills — the model only SPOKE the
 * line ("let me get someone for you") and nothing happened. This sink turns that
 * promise into a real side-effect.
 *
 * Design (mirrors door.ts):
 *   - Deterministic orchestrator action, NOT an LLM tool. It fires on the terminal
 *     give-up state, so it doesn't depend on the single-round agent calling a
 *     second tool (which it cannot).
 *   - Env-gated: no HOST_NOTIFY_URL → dry-run log only. The concierge runs
 *     end-to-end without a staff backend wired.
 *   - Fired in PARALLEL with the spoken reply — never on the voice critical path.
 *   - De-duped per session: one page per visitor, reset on a new RING.
 */
import type { Destination } from "@nera/contracts";

/** Terminal outcomes where a human should be paged. */
export function shouldNotifyHost(d: Destination): boolean {
  return d.status === "no_match" || d.status === "human_fallback";
}

export interface HostNotifier {
  /** Page a human. No-ops if this session was already paged. */
  notify(d: Destination, reason?: string): void;
  /** Allow paging again for this session id (call on a fresh RING). */
  reset(sessionId: string): void;
}

export function makeNotifyHostSink(
  url: string | undefined,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
): HostNotifier {
  const notified = new Set<string>();
  return {
    notify(d, reason = d.status) {
      if (notified.has(d.sessionId)) return; // one page per visitor
      notified.add(d.sessionId);
      if (!url) {
        log.info(
          `[notify-host] DRY-RUN page staff (session=${d.sessionId} reason=${reason} transcript="${d.transcript}")`,
        );
        return;
      }
      // Best-effort, non-blocking: a slow/failed staff backend must never stall Nera's reply.
      void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, sessionId: d.sessionId, transcript: d.transcript }),
      }).then(
        (r) => log.info(`[notify-host] paged (session=${d.sessionId} http=${r.status})`),
        (e) => log.error(`[notify-host] page failed (session=${d.sessionId}):`, (e as Error).message),
      );
    },
    reset(sessionId) {
      notified.delete(sessionId);
    },
  };
}
