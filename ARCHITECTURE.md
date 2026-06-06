# Robo-Dog Concierge — Architecture & Build Plan

**START Hack Vienna '26 · HOIV "Robo Dog" track.** Code freeze: **Sun June 7, 14:00**.

A doorbell ring summons an AI concierge (the robot dog **Nera**) that greets a visitor,
understands in plain language where they want to go, **answers by voice in under a second**,
and shows the destination + route on a 4K screen — then (future) the dog walks them there.

> **Latency is the whole game.** The hero metric is _you stop talking → Nera starts answering_.
> The screen is ambient (Nera's face) and shows directions when useful. The robot is wired and
> protocol-verified, but not tested against hardware this weekend.

---

## 1. What scores, and how we target it

| Criterion (weight) | How we win it |
| --- | --- |
| Functional MVP & Latency (30%) | Rock-solid ring→voice→screen loop; instrumented per-segment timings; hero KPI < 1s shown live. |
| Technical Execution (25%) | LLM intent + alias-rich directory/person matching; clean skill/projection split. |
| UX & Design (20%) | Two-phase voice (instant cached welcome + live reply), Nera personality, never-blank screen, graceful fallbacks. |
| Future Readiness (15%) | `pose` in the data model; **mock-verified** Go2 `/goal_pose` over Foxglove/CDR; LiDAR-backed coordinates. |
| Pitch & Storytelling (10%) | "Same brain runs on the dog"; show the latency numbers; show the bottleneck we tamed (Pi Zero). |

---

## 2. Topology

```
                        ┌──────────────── ORCHESTRATOR (laptop, Node 24 + TS) ─────────────────┐
  Doorbell button ──────►  trigger → STT → AGENT(skills) → projection → TTS                     │
  (sim now, Ring later)  │     │            │                  │            │                    │
                         │     │            │                  │            └─► ElevenLabs TTS ──┐│
                         │     ▼            ▼                  ▼                                 ││
                         │  ElevenLabs   OpenRouter         WS BROKER  ───────────────┐         ││
                         │  Scribe v2    (fast tool model)  (Destination events)      │         ││
                         └───────────────────────────────────────────────────────────┼─────────┘│
                                                                                       │          │
   ┌──── Audio client (browser on laptop) ────┐        ┌─── Display clients (WS subscribers) ───┐ │
   │ mic + speaker, AEC, half-duplex, Nera UI  │◄──WS──►│ Laptop kiosk (rich) · Pi Zero→TV (lean) │◄┘
   │ (sends PCM, plays TTS, shows latency)     │        │ Yodeck Web-Page player · on-dog screen   │
   └───────────────────────────────────────────┘        └─────────────────────────────────────────┘
                                                                       │
                                                          Go2 sink ────┘  (Foxglove WS + CDR; mock-verified)
```

**Devices:** the **laptop** runs the orchestrator + the audio kiosk (mic/speaker/AEC) + the WS
broker. The **Pi Zero 2 W** drives the big HDMI TV and is **display-only**. **Yodeck** displays the
same live page. The **dog** (future) is one more sink.

---

## 3. The loop & latency budget

`IDLE → (ring) → WELCOME → LISTEN → PROCESS → RESPOND → [CLARIFY ↺≤1] → DONE → IDLE`

| Segment | What happens | Target |
| --- | --- | --- |
| ring → welcome audio | play **pre-cached** "Welcome to HOIV! Where to?" (zero TTS latency) | ~instant |
| welcome end → mic open | half-duplex: mic opens after Nera speaks | — |
| speech → commit | ElevenLabs Scribe v2 Realtime, **VAD silence-commit ~400ms** | ~150ms STT + 400ms endpoint |
| commit → agent first token | OpenRouter fast tool model (fallback: native provider) | low |
| agent → destinationId | one skill call resolves an id | low |
| **id → TTS first audio** | `composeReply()` (template) → ElevenLabs stream | **HERO KPI: < 1s from commit** |
| id → screen rendered | `projectDestination()` → WS → display (parallel, secondary) | < 1s when shown |

**Decoupling rule:** the moment a skill returns an id, we (a) start composing+speaking the answer
**and** (b) push the screen event — in parallel. The voice answer is the hero; the screen never blocks it.

---

## 4. Components

### 4.1 Doorbell trigger
Abstract `doorbell` event. **Now:** simulated (button / kiosk tap / Pi GPIO) — instant, reliable.
**Patch later:** real Ring via `ring-client-api` as an _optional parallel_ path (cloud push is multi-second,
never on the critical demo path).

### 4.2 Audio client (browser, on the laptop)
`getUserMedia` with `echoCancellation/noiseSuppression/autoGain` → AEC for free. Streams PCM to the
orchestrator over WS; plays TTS via Web Audio; renders Nera + the **live latency overlay**.
**Half-duplex** core (mic closed while Nera speaks). Barge-in is a deferred stretch (mic-live + VAD-gated,
AEC already in place).

### 4.3 STT — ElevenLabs Scribe v2 Realtime
WebSocket streaming, ~150ms p50, partial + committed transcripts, **VAD/commit ~400ms**. Owned by the
orchestrator (single clock for instrumentation). _Stretch:_ speculative agent warm-start on stable partials.

### 4.4 Agent runtime
Thin custom orchestrator over a **fast tool-calling text model via OpenRouter** (provider behind one
interface; **fall back to native Groq/OpenAI/Anthropic if TTFT disappoints** — measure on the day).
Loads [`skills/instructions.md`](skills/instructions.md) into the system prompt + injects the directory.
Registers exactly [`skills/registry.ts`](skills/registry.ts) as tools. A skill returns a **`MatchResult`
(id-only)** — it never decides assets or phrasing.

> Note: OpenRouter is a **text** gateway (adds a proxy hop, no realtime/audio model). We use ElevenLabs
> for STT/TTS, so we only need a fast text model — OpenRouter is fine, with a native escape hatch.

### 4.5 Projection — the "something else" ([`contracts/projection.ts`](contracts/projection.ts))
- `projectDestination(match, data)` → full `Destination` (screen assets + pose + status; **never blank**).
- `composeReply(destination, data)` → spoken text (template now; LLM-charm later).
- Guardrails enforced here + in the orchestrator: `Destination.parse()`, and **`destinationId` must
  exist in the directory** (the model can never invent a room).

### 4.6 TTS — ElevenLabs streaming (two-phase)
- **Phase 1:** pre-generated cached welcome/transition lines (zero latency) — including the
  "Excuse me one moment" line for the ring-interrupts-ring case.
- **Phase 2:** live streamed reply from `composeReply()` → Web Audio.

### 4.7 Sinks (all consume the same `Destination` event)
- **WS display broker** (hero): broadcasts the tiny `Destination` JSON to all display clients.
- **Yodeck** (required by partner): a Yodeck **Web Page** player loads our **live display URL**; updates
  ride our WS, **not** Yodeck's slow content-push. API touched once to assign the page. _(`YodeckSink`
  also fires best-effort for any content we do want to manage via API.)_
- **Go2** (future-ready, mock-verified): see §6.

### 4.8 State machine
One enum + one transition fn. **Hard timeouts on every waiting state** (8s no-speech → reprompt once →
8s → IDLE). **Clarify cap = 1**, then `human_fallback` ("let me call someone for you", screen card shown).
**Auto-reset to IDLE** on silence after DONE. **A new ring hard-resets** (cancel in-flight STT/agent/TTS via
`AbortController`; play the excuse line; start clean for the next visitor).

### 4.9 Instrumentation
Orchestrator stamps the [`Timings`](contracts/contracts.ts) block per turn (single server clock; kiosk
sends back its 2 browser-side timestamps to reconcile one timeline). **Live overlay** on the kiosk
("🎤→🗣️ 740ms"); per-segment rows appended to `timings.jsonl` + a p50/p95 table in `REPORT.md`.
_Paste the log to Claude anytime for bottleneck analysis._

---

## 5. Network strategy (real coworking WiFi — no dedicated router)

Designed for a **hostile, shared 2.4GHz** network out of the box:
- **Tiny WS payloads**, **all assets pre-cached locally** (Pi SD card + kiosk), **no cloud hop on the
  critical path** — voice STT/TTS are direct API calls; the screen event is LAN WS.
- **Aggressive reconnect + state-resync** on every client (a dropped Pi rejoins and re-requests the
  current view).
- **Discovery** via fixed LAN IP or mDNS (`.local`) — no central server to find on the internet.
- ⚠️ **RISK — AP client isolation.** Coworking guest WiFi often blocks device-to-device traffic, which
  would break LAN WS (Pi/Yodeck → laptop). **Verify on-site first.** If isolated, the WS broker is
  **deployable two ways** (URL is configurable): (a) **local** on the laptop (lowest latency, needs peer
  traffic) or (b) a **tiny cloud relay** (robust to isolation, adds internet RTT — and since the screen is
  the _secondary_ path, the hero voice KPI is unaffected). Decide on the day by measuring.

---

## 6. Go2 robot sink (wired + verified, not hardware-tested)

Per the integration guide: connect to the **Foxglove WS bridge** (`ws://<robot>:8765`, offer both
subprotocols), **advertise a channel**, publish `geometry_msgs/PoseStamped` on `/goal_pose`
(`frame_id:"map"`).

- **Libs:** `@foxglove/ws-protocol` + `@foxglove/rosmsg2-serialization` (CDR `MessageWriter`) +
  `@foxglove/rosmsg` (PoseStamped definition).
- **Pose:** `{x,y,yaw}` → position `{x,y,0}`, orientation quaternion `z=sin(yaw/2), w=cos(yaw/2)`.
- **Verify without the dog:** a **protocol-accurate mock Foxglove server** accepts our advertise+publish,
  **decodes the CDR back**, and asserts the `PoseStamped` is byte-correct → "wired **and verified**".
- **No-robot behavior:** env-gated (`GO2_FOXGLOVE_URL`); unset → **dry-run** log. The concierge demo never
  depends on a robot.
- Telemetry (`/battery`, `/odom`): **skipped** for the hack (no live data without the dog).

---

## 7. Data contracts (already generated)

- [`contracts/contracts.ts`](contracts/contracts.ts) — `DirectoryEntry`, `Person`, `Destination`,
  `ScreenContent`, `Pose`, `Timings`, `SessionState`. Zod = source of truth; validate every file at load.
- [`contracts/skill.ts`](contracts/skill.ts) — `Skill`, `SkillCtx`, `MatchResult`.
- [`contracts/projection.ts`](contracts/projection.ts) — `projectDestination()`, `composeReply()`.
- [`data/directory.json`](data/directory.json), [`data/people.json`](data/people.json) — seed data
  (skills/data team populates; [`data/README.md`](data/README.md)).
- [`skills/`](skills/README.md) — `find_place`, `find_person`, `registry.ts`, `instructions.md`.

---

## 8. Repo layout (one repo, folder-per-workstream, pnpm workspaces)

```
robo-dog/
  contracts/        # shared schema (spine owns)            ✅ done
  data/             # directory.json, people.json (data team) ✅ seeded
  skills/           # skills + instructions (skills team)    ✅ examples
  apps/
    orchestrator/   # SPINE: WS broker, STT, agent, TTS, sinks, state machine, instrumentation
    kiosk/          # audio client + rich display + Nera + latency overlay (browser)
    display-pi/     # lean display for the Pi→TV (see §9)
  sinks/
    go2/            # Foxglove/CDR publisher + mock server + tests
    yodeck/         # one-time web-page assignment + best-effort API sink
  assets/           # pre-cached route images/video + cached welcome audio
  maps/             # planimetry + LiDAR (drop in) → pose extraction
  REPORT.md         # latency write-up (p50/p95 per segment)
  .env.example      # NO secrets in repo
```

Stack: Node 24, pnpm workspaces, TypeScript (ESM, NodeNext), `zod`, `ws`, `dotenv`.

---

## 9. Pi Zero display strategy (the bottleneck judges want addressed)

Pi Zero 2 W = 512MB, 2.4GHz-only, ~1080p HDMI ceiling. **Display-only** (no audio/agent/AEC).

1. **(A) primary — minimal Chromium kiosk:** vanilla full-screen page, pre-cached background + dynamic
   text on WS message, **1080p** (TV upscales), kiosk/GPU flags. Reuses kiosk code; dynamic text + Nera easy.
2. **(B) fallback — server-rendered frames:** orchestrator composes the finished 1080p frame
   (`node-canvas`/`sharp`); Pi runs a tiny WS client → framebuffer viewer (`fbi`/`feh`), **no browser**.
   Near-zero Pi compute; the strongest "moved work off the weak device" story.
3. **(C) ultimate fallback — pre-baked static images** per destination via `feh`.

**Plan:** build (A), **test on the real Pi in the first hours**, flip to (B) if it can't hold sub-100ms
swaps. Always: pre-cache on SD, auto-reconnect, 1080p.

---

## 10. Build order (24h, splittable across the team)

**Spine (you):**
1. Repo + workspaces + contracts wired (✅ contracts done) · `.env.example`.
2. WS broker + `Destination` broadcast + state machine + `AbortController` cancellation.
3. ElevenLabs Scribe v2 STT (WS, VAD-commit) ← audio from kiosk.
4. Agent runtime (OpenRouter, skill registry, instructions) → `MatchResult`.
5. Projection + `composeReply` + ElevenLabs TTS streaming (two-phase, cached welcome).
6. Instrumentation (timings.jsonl + REPORT.md + overlay feed).
7. `Go2Sink` + **mock Foxglove server + CDR round-trip test**.
8. `YodeckSink` (one-time web-page assignment) + best-effort API.

**Kiosk teammate:** audio client (AEC, half-duplex), Nera UI, destination card, latency overlay, reconnect.
**Pi display teammate:** path (A) on the real Pi early; (B)/(C) fallbacks; SD pre-cache; reconnect.
**Skills/data teammates:** populate `directory.json`/`people.json` (alias-rich!), author skills +
`instructions.md`, supply pre-rendered route assets + cached welcome audio.

**Milestones:** M1 end-to-end happy path (button→STT→agent→TTS→screen) · M2 latency instrumented + tuned
< 1s · M3 fallbacks (no-match/clarify/timeouts) + Pi on real hardware · M4 Go2 mock-verified + Yodeck live
+ Ring patched · M5 polish, REPORT.md numbers, 3-min demo video, MIT license, public repo.

---

## 11. Things to get on the day / open items

- **Named-spot coordinates + LiDAR/planimetry** → backfill `pose` in `directory.json`.
- **Yodeck account** (Premium/Enterprise for API) + player → assign the Web Page item to our URL.
- **Real directory content** (current rooms/events/people) from HOIV.
- **Venue network test:** is AP client isolation on? (decides local vs cloud WS broker — §5).
- **Pi Zero** flashed + on the network + assets pre-cached; measure path (A) swap latency early.
- **Robot IP** (only if a dog is actually available; otherwise mock-only).
- Decide **OpenRouter vs native** by measuring TTFT.

---

## 12. Risk register

| Risk | Mitigation |
| --- | --- |
| AP client isolation breaks LAN WS | Verify early; configurable local/cloud broker; voice KPI unaffected (screen is secondary). |
| Pi Zero can't render fast enough | (A)→(B)→(C) fallbacks; test on real Pi in first hours; 1080p + pre-cache. |
| OpenRouter proxy hop too slow | Provider behind interface; native Groq/OpenAI/Anthropic fallback. |
| Noisy floor breaks VAD | Half-duplex (mic closed while speaking); AEC; tune commit threshold; cached welcome covers think time. |
| Yodeck content-push latency | Don't push per-visitor; Yodeck renders our live WS page. |
| Demo session hangs | Hard timeouts everywhere; new ring hard-resets; screen never blank (Nera default). |
| No dog to test | Mock Foxglove server verifies CDR round-trip; env-gated dry-run. |
```
