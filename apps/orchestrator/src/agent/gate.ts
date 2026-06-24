/**
 * Server-enforced door gate (Weg B). Before the orchestrator honours an
 * open_door request, it asks laika's /api/v1/gate-check whether the visitor is
 * authorized. laika decides on a verified appointment; the agent only requests.
 *
 * Fail-closed by design: any non-200, malformed body, timeout, or unreachable
 * gate yields `authorized: false`. A physical door must never open because the
 * authorization check itself failed.
 */
import type { Logger } from "../log.js";

export interface GateDecision {
  authorized: boolean;
  destinationId: string | null;
  visitorClass?: string;
  handoffTarget?: string | null;
  reasons: string[];
}

const GATE_TIMEOUT_MS = 4000;

function deny(reason: string): GateDecision {
  return { authorized: false, destinationId: null, reasons: [reason] };
}

/**
 * Ask laika's gate-check whether this visitor may be let in. `host` is the
 * person they came to see (the thing laika authorizes); `reason` is the agent's
 * free-text fallback when no structured host is supplied yet.
 */
export async function checkGate(
  gateUrl: string,
  visitor: { visitorName?: string; host?: string; reason?: string; sessionId?: string },
  log?: Logger,
): Promise<GateDecision> {
  try {
    const res = await fetch(gateUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        visitor_name: visitor.visitorName,
        host: visitor.host,
        destination_query: visitor.host ?? visitor.reason,
        session_id: visitor.sessionId,
      }),
      signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
    });
    if (!res.ok) {
      log?.warn(`[gate] gate-check returned ${res.status} — fail-closed`);
      return deny("gate_http_error");
    }
    const d = (await res.json()) as Record<string, unknown>;
    return {
      authorized: d.authorized === true,
      destinationId: (d.destination_id as string | null) ?? null,
      visitorClass: d.visitor_class as string | undefined,
      handoffTarget: (d.handoff_target as string | null) ?? null,
      reasons: Array.isArray(d.reasons) ? (d.reasons as string[]) : [],
    };
  } catch (e) {
    log?.warn(`[gate] gate-check unreachable: ${(e as Error).message} — fail-closed`);
    return deny("gate_unreachable");
  }
}
