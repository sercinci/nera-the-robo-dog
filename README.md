# Nera the Robo Dog

> "Winner of the HOIV Robo Dog Challenge at START Hack Vienna 2026."

Nera is a voice-first concierge for Home of Innovation Vienna. A visitor rings the
doorbell, tells Nera who they are here to see or where they want to go, and the
system answers by voice while showing the destination on a display.

The hackathon build replaces the moving Unitree Go2 with a fixed microphone,
speaker, Ring intercom, and 4K signage. The architecture keeps the same brain and
data contracts so the robot path can be added later.

## What It Does

- Greets visitors through an ElevenLabs Conversational AI agent.
- Resolves people, rooms, zones, and events against local JSON directory data.
- Shows the resolved destination on a browser kiosk and any connected display
  client over WebSocket.
- Bridges a real Ring Intercom call into the server-side ElevenLabs agent.
- Opens the building door only when the agent explicitly calls `open_door`.
- Falls back to a staff handoff through `human_fallback` when Nera cannot help.

## Current Runtime

There are two active demo paths:

| Path | Runtime | Purpose |
| --- | --- | --- |
| Browser kiosk | `@elevenlabs/client` in `apps/kiosk/public/kiosk.js` | Fast local demo with mic, Nera UI, destination card, and client tools. |
| Door intercom | `apps/orchestrator/src/intercom/door-bridge.ts` | Ring two-way audio bridged to the server-side ElevenLabs Conversational AI WebSocket. |

Both paths use the same three client tools exposed to the ElevenLabs agent:

| Tool | Behavior |
| --- | --- |
| `show_destination` | Resolves a free-text query through `find_place`, then `find_person`, and broadcasts a `Destination`. |
| `open_door` | Unlocks the Ring intercom during a live door call, or simulates success in browser-only demo mode. |
| `human_fallback` | Shows fallback UI and tells the visitor a staff member will help. |

The lower-level skill registry currently contains `find_person`, `find_place`,
`check_appointment`, `navigate_floor`, and `human_fallback`. These skills return
`MatchResult` objects only; screen content and speech are composed from
`contracts/projection.ts`.

## Technology Stack

- Runtime: Node.js `>=24`, pnpm `11.5.2`, TypeScript ESM.
- Validation and contracts: `zod`, shared through `@nera/contracts`.
- Server: Node HTTP, `ws`, `dotenv`, `tsx`.
- Browser voice client: `@elevenlabs/client`, bundled locally with `esbuild`.
- Door voice bridge: ElevenLabs Conversational AI WebSocket plus a patched
  vendored `ring-client-api` fork.
- Fallback/dev agent path: OpenRouter through the OpenAI-compatible SDK.
- Optional signage control: Yodeck REST API helper and Web Page player workflow.
- Tests: Vitest and TypeScript `tsc --noEmit`.

The Go2 robot path is future-ready at the data-contract level (`pose` exists on
destinations and `GO2_FOXGLOVE_URL` is reserved), but the current runtime does
not depend on a physical robot.

## Repository Layout

```text
apps/
  orchestrator/       Node/TS server, WebSocket broker, Ring bridge, tools, Yodeck helper
  kiosk/              Browser UI and ElevenLabs client-tool bridge
  agent-runner/       Legacy Anthropic skill runner prototype
contracts/            Zod schemas, skill contract, destination projection
data/                 Building directory and people data
skills/               Deterministic destination skills and agent instructions
packages/
  door-intercom/      Ring intercom as a reusable two-way audio device
  ring-client-api/    Vendored Ring fork with audio-only intercom support
assets/               Welcome copy, planimetry, avatars, and local media
log/                  Handover and implementation notes
tools/                Planimetry and waypoint utilities
```

## Getting Started

### Prerequisites

- Node.js 24 or newer.
- Corepack-enabled pnpm.
- An ElevenLabs Conversational AI agent id for the live kiosk or door path.
- Optional: ElevenLabs API key and voice id for fallback STT/TTS utilities.
- Optional: OpenRouter API key for the legacy text-agent pipeline and harness.
- Optional: Ring Intercom refresh token and Firebase app key for door mode.
- Optional: Yodeck token and screen id for signage API experiments.

### Setup

```bash
git clone https://github.com/sercinci/nera-the-robo-dog.git
cd nera-the-robo-dog
cp .env.example .env
corepack pnpm install
```

Fill `.env` with local credentials. Do not put real values into committed files.

### Run

```bash
corepack pnpm dev
```

Open `http://localhost:8787`, press `Ring doorbell`, grant microphone access,
and talk to Nera. If Ring credentials are present, the same orchestrator also
arms the real door path and listens for Ring buzz events.

### Verify

```bash
corepack pnpm typecheck
corepack pnpm test
```

Useful targeted commands:

```bash
corepack pnpm -F @nera/orchestrator exec tsc --noEmit
corepack pnpm -F @nera/orchestrator exec vitest run
corepack pnpm -F @nera/door-intercom exec tsc --noEmit
```

## Configuration

All runtime configuration comes from environment variables. `.env` is ignored by
Git; `.env.example` contains blank placeholders only.

| Variable | Purpose |
| --- | --- |
| `PORT` | Orchestrator HTTP and WebSocket port. Defaults to `8787`. |
| `LOG_LEVEL` | Server log verbosity. |
| `ELEVENLABS_AGENT_ID` | Conversational AI agent used by the kiosk and Ring bridge. |
| `ELEVENLABS_API_KEY` | ElevenLabs API key for fallback STT/TTS and server-side agent utilities. |
| `ELEVENLABS_TTS_VOICE_ID` | Voice id for fallback TTS utilities. |
| `ELEVENLABS_TTS_MODEL_ID` | Low-latency TTS model, defaulting to `eleven_flash_v2_5`. |
| `ELEVENLABS_STT_MODEL_ID` | Realtime STT model, defaulting to `scribe_v2_realtime`. |
| `STT_COMMIT_SILENCE_MS` | Fallback STT endpointing window. |
| `STT_VAD_THRESHOLD` | Fallback STT VAD threshold. |
| `STT_MIN_SPEECH_MS` | Minimum speech duration for fallback STT. |
| `OPENROUTER_API_KEY` | Optional key for the OpenRouter-based dev pipeline. |
| `OPENROUTER_MODEL` | OpenRouter model id, defaulting to `openai/gpt-4o-mini`. |
| `RING_REFRESH_TOKEN` | Ring account refresh token for the intercom owner. |
| `RING_INTERCOM_DEVICE_ID` | Optional specific Ring intercom id. |
| `RING_FIREBASE_API_KEY` | Ring Firebase app key required by the vendored push receiver. Keep the real value in `.env`. |
| `YODECK_API_TOKEN` | Optional Yodeck REST token. |
| `YODECK_SCREEN_ID` | Optional target Yodeck screen id. |
| `GO2_FOXGLOVE_URL` | Reserved for the future robot sink; unset in the current demo path. |

## Security And Secrets

Real credentials must stay out of the repository.

- `.env`, `.env.*`, and `.ring-token` are ignored.
- `.env.example` files contain names and placeholders only.
- The Ring refresh token rotates on use and is persisted locally to `.ring-token`.
- The vendored Ring client reads `RING_FIREBASE_API_KEY` from the environment
  instead of embedding the key in source.
- Do not commit dashboard exports, API responses, logs, screenshots, or support
  files that contain tokens.

## Contributors

Contributor list derived from repository history:

| Contributor | Notes |
| --- | --- |
| Federico Ercole ([@sercinci](https://github.com/sercinci)) | Orchestrator, voice, Ring door integration. |
| Gerald Pögl / Geri | Product direction, review, live test feedback, copyright owner. |
| Hunter-ID ([@Lukas-Hi](https://github.com/Lukas-Hi)) | Hackathon contributor. |
| Alexander Sanchez ([@alexander-san](https://github.com/alexander-san)) | Hackathon contributor. |
| TrinishRocky | Hackathon contributor. |
| franckm | Hackathon contributor. |

## Award

Nera was built for the HOIV "Robo Dog" track at START Hack Vienna 2026 and was
the winning project for the challenge.

## License

Released under the MIT License. See `LICENSE`.
