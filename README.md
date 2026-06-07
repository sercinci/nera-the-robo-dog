# 🐕 Nera the Robo Dog

A hands-free, voice-first concierge that greets walk-in visitors and guides them to their destination — built for the **Robo Dog** track.

A submission for **START Hack Vienna '26**, built for the case provided by
**Home of Innovation Vienna (HOIV)**.

---

## About

HOIV has no traditional reception. When someone walks in, we want an unforgettable,
hands-free welcome. **Nera** is the software brain for that: a visitor rings the
doorbell and simply *says* where they want to go ("I'm here to see Gabriela", "the AI
workshop"). Nera greets them by voice, understands the request, matches it against the
building's live directory of people, rooms and events, and lights up a screen with their
destination — in seconds, with no human receptionist. The same brain is architected to
run on a real Unitree Go2 robot dog.

## The challenge

Build a doorbell-triggered voice concierge that understands natural language and shows
the visitor's destination on a 4K display **within seconds** — treating the whole
ring-to-display loop as a latency budget. We built the voice, matching, and signage
brain, plus the real door-intercom and a robot-ready output path.

## What we built

- **Conversational voice agent (Nera)** — ElevenLabs Agents runs the full voice loop
  (speech-to-text, LLM, text-to-speech, turn-taking, barge-in). Two entry points: an
  in-browser SDK session and a **server-side bridge for the Ring door intercom**.
- **Intent → destination matching** — the agent calls tools (`show_destination`,
  `find_person`/`find_place`, `open_door`) that resolve against `directory.json` /
  `people.json`; the building data stays the single source of truth.
- **Live signage** — a browser kiosk (Nera, a copper English Cocker Spaniel) shows the
  destination card, an incoming-buzz banner, a door-opened banner, and a latency readout;
  the same `Destination` event also drives a Yodeck screen.
- **Real door intercom** — Ring two-way audio is bridged to the agent; on an expected
  visitor the agent's `open_door` tool unlocks the building door.
- **Robot-ready output** — a Go2 navigation sink (Foxglove WebSocket + CDR) is wired and
  protocol-verified against a mock (not yet tested on the physical dog).

## Demo

- Live demo: run locally (see **Getting started**) — open the kiosk and ring the doorbell.
- Screenshots / video: `<add demo video link>`

---

## Getting started

### Prerequisites

- **Node.js 24+** and **pnpm 11+**
- An **ElevenLabs** account with a Conversational AI **Agent** (the agent id) and an API key
- *(optional)* an **OpenRouter** API key — used by the fallback text-agent pipeline
- *(optional)* a **Ring** refresh token + intercom, to drive the real door
- A modern browser (Chrome) for the kiosk; microphone access for voice

### Setup

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd nera-the-robo-dog

# 2. Configure environment
cp .env.example .env
# fill in the required values (see .env.example / Configuration below)

# 3. Install
pnpm install
```

### Run

```bash
pnpm dev
```

Then open `http://localhost:8787` in your browser. Click **🔔 Ring**, allow the
microphone, and talk to Nera. (With a Ring intercom configured, pressing the physical
panel drives the same flow and Nera's voice plays through the intercom.)

---

## Project structure

```
contracts/            Shared Zod schemas + projection (DirectoryEntry, Person, Destination, Skill)
data/                 directory.json + people.json (the building directory — source of truth)
skills/               Agent skills (find_place, find_person, check_appointment, navigate_floor) + instructions
apps/
  orchestrator/       Node/TS spine: WS broker, ElevenLabs STT/TTS + agent, door bridge, sinks, instrumentation
  kiosk/              Browser display + audio client (Nera's face, destination card, banners)
packages/
  door-intercom/      Ring door intercom as a clean two-way-audio device
  ring-client-api/    Vendored Ring client (patched for intercom audio)
maps/                 Planimetry / LiDAR for Go2 waypoints
```

## Configuration

All settings come from environment variables. **Never commit secrets** — keep them in
`.env` (git-ignored) and use [`.env.example`](.env.example) as the reference.

| Variable | Purpose |
| --- | --- |
| `ELEVENLABS_API_KEY` | ElevenLabs API key (TTS/STT for the fallback pipeline) |
| `ELEVENLABS_AGENT_ID` | The Conversational AI agent the kiosk/bridge connects to |
| `ELEVENLABS_TTS_VOICE_ID` | Nera's voice (fallback pipeline) |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | Fallback text tool-calling agent |
| `RING_REFRESH_TOKEN` / `RING_INTERCOM_DEVICE_ID` | Ring door intercom (rotates on use; persisted to `.ring-token`) |
| `YODECK_API_TOKEN` / `YODECK_SCREEN_ID` | Optional Yodeck signage push |
| `GO2_FOXGLOVE_URL` | Optional Go2 robot sink (unset ⇒ dry-run) |
| `STT_COMMIT_SILENCE_MS`, `STT_VAD_THRESHOLD`, `STT_MIN_SPEECH_MS` | VAD endpointing tuning |

## Architecture & assumptions

The **ElevenLabs agent is the runner**: it handles the conversation and calls client
tools. Those tool calls are relayed to the **orchestrator**, which matches them against
the directory data and emits one normalized `Destination` event that every sink consumes
(kiosk, Yodeck, Go2). For the **browser** path the agent runs in-page via the SDK; for the
**Ring** path the orchestrator hosts the agent over a WebSocket and bridges the intercom's
audio in/out (and forwards Nera's voice to the browser too). The door is opened only by the
agent's `open_door` tool — never inferred from raw confidence.

Assumptions: the JSON directory is the source of truth; ElevenLabs Agents is reachable; the
public agent connects anonymously; and the Go2 path is verified against a protocol-accurate
mock, not the physical robot.

## Troubleshooting

- **Agent talks but the card doesn't update** → it didn't call `show_destination`; reload the kiosk and/or tighten the agent prompt.
- **Door intercom doesn't trigger anything** → the buzz/ding is a Ring push event; confirm the intercom is online and actually ringing in the Ring app (no ding = nothing for the app to receive).
- **`403` on the server-side agent socket** → the public agent must connect *without* an `xi-api-key` header.
- **Port 8787 already in use** → stop the other process or set `PORT` in `.env`.
- **No snack / old behavior in the browser** → hard-reload (Cmd/Ctrl+Shift+R) to drop cached assets.

---

## Team

- Federico Ercole ([@sercinci](https://github.com/sercinci)) — orchestrator / voice + door integration
- `<teammate>` — agent skills & instructions
- `<teammate>` — screen / signage
- `<teammate>` — data & LiDAR / robot

## Submission

- Track: **Robo Dog** · Case partner: **Home of Innovation Vienna (HOIV)**
- Submitted to the START Hack Vienna '26 GitHub organisation.

## License

Released under the MIT License — see [`LICENSE`](LICENSE).
