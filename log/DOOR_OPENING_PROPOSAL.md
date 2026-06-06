# Proposal: Automatic Door Opening (for Spine-Team)

**Author:** Skills-Team
**Status:** ✅ IMPLEMENTED on branch `opening-door` (typecheck clean, door tests green).
**Context:** Project lead reported "our skills can't open the door."

> **Implementation note:** the door sink lives in `apps/orchestrator/src/door.ts`
> (not a separate top-level `sinks/door/` — `sinks/` doesn't exist yet; the
> orchestrator is where every other sink call already happens). Move it later if the
> Spine-Team formalizes a `sinks/` package. Wired at both emission paths in
> `index.ts` (the pipeline path and the ElevenLabs `resolve` path).

---

## TL;DR

The skills are **not** the place to open the door. Door-opening should be a
**deterministic orchestrator action gated on the confidence score that
`check_appointment` already emits** — fired in parallel with the voice reply and
the screen event, exactly like the existing decoupling rule in `ARCHITECTURE.md` §3.

- **Faster:** no extra LLM turn. The door fires the instant the id resolves.
- **Safer:** the LLM never decides; a code threshold on a number it cannot fake.
- **No Skills-Team work:** `check_appointment` already returns `0.95` (valid) / `0` (invalid).

A door-opening **skill** was explicitly rejected: it would add an LLM round-trip
to the critical path (slower), and re-arm exactly what the `doorguard` disarms
(prompt-injectable physical action).

---

## Why not a skill

| | Door as LLM skill | Door as orchestrator rule (this proposal) |
|---|---|---|
| Latency | +1 LLM turn on critical path | 0 extra turns, fires in parallel |
| Security | Prompt-injectable | Threshold on confidence, not negotiable |
| Architecture fit | Breaks "skills identify, don't act" (`contracts/skill.ts`) | Matches existing parallel-sink decoupling |
| Skills-Team work | New skill + registry + prompt | None — confidence already emitted |

The authorization signal already exists: `check_appointment` returns
`confidence: 0.95` for a valid in-window appointment, `0` otherwise. That score
**is** the door-open authorization.

---

## Proposed changes (Spine-Team owns all of these)

### 1. `contracts/contracts.ts` — add a door flag to `Destination`

```ts
// inside Destination = z.object({ ... })
openDoor: z.boolean().default(false), // true => orchestrator authorized a physical unlock
```

Default `false` keeps every existing producer valid.

### 2. `apps/orchestrator` — set the flag deterministically after projection

```ts
// after projectDestination(...) returns `destination`
const DOOR_CONFIDENCE_FLOOR = 0.9;
destination.openDoor =
  destination.status === "resolved" &&
  destination.confidence >= DOOR_CONFIDENCE_FLOOR;
```

Fire the door sink in parallel with TTS + the screen broadcast — never on the
voice critical path.

### 3. `sinks/door/` — new sink consuming `openDoor`

```ts
// env-gated, mirrors the Go2 mock-verified pattern
const DOOR_URL = process.env.DOOR_CONTROLLER_URL;
export async function doorSink(d: Destination) {
  if (!d.openDoor) return;
  if (!DOOR_URL) { console.log("[door] DRY-RUN unlock", d.sessionId); return; }
  await fetch(DOOR_URL, { method: "POST", body: JSON.stringify({ unlock: true }) });
}
```

Unset `DOOR_CONTROLLER_URL` → dry-run log (the demo never depends on hardware,
same as the Go2 sink).

---

## Lock-side contract (for whoever wires the physical lock)

Venue **has** an electronically controllable lock. The orchestrator → lock seam is
a single HTTP call. Build the lock controller to accept this:

```
POST  <DOOR_CONTROLLER_URL>
Content-Type: application/json

{ "unlock": true, "sessionId": "<string>", "destinationId": "<string>" }
```

- Fired **only** when `authorizeDoor()` is true (resolved + confidence ≥ 0.9).
- Fire-and-forget: the orchestrator does not block on the response and does not
  retry — a slow/failed lock must never stall Nera's voice reply. Any non-2xx is
  logged, not surfaced to the visitor.
- If the real lock speaks something other than HTTP (MQTT / relay / vendor cloud),
  put a tiny adapter behind `DOOR_CONTROLLER_URL` (a local shim that accepts the
  POST above and translates), OR swap the `fetch` in `apps/orchestrator/src/door.ts`
  `makeDoorSink()` for the right transport — that function is the only place to change.

Until `DOOR_CONTROLLER_URL` is set, the sink dry-runs (logs the unlock it would send).

---

## What the doorguard keeps doing (unchanged)

A *visitor asking* Nera to open the door is still refused (`instructions.md`
guardrail + `skills/doorguard/`). Automatic opening on a verified appointment is a
**system** action, not a visitor-triggerable one. The two do not conflict.
