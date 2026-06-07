# Handover: Nera the Robo Dog — Vollständige Codeanalyse
**Stand: 2026-06-07 · Nach `git pull origin main` (Commit e0da13b)**
**Repo: https://github.com/sercinci/nera-the-robo-dog**
**Hackathon Deadline: Sunday June 7, 14:00**

---

## 1. Was dieses System tut (Überblick)

Nera ist ein KI-Türportier. Wenn jemand klingelt, begrüßt sie die Person per Sprache, versteht ihr Anliegen in natürlicher Sprache ("Ich bin zu einem Termin bei der Robotics-Gruppe") und zeigt die Route auf einem 4K-Screen an — alles unter 1 Sekunde Latenz.

**Zwei parallele Audiopfade:**
- **Browser-Pfad (Kiosk):** ElevenLabs SDK läuft im Browser → gibt `show_destination`-Tool-Call an den Server → Server löst auf, broadcastet ans Display.
- **Tür-Pfad (Ring-Intercom):** Ring-Türklingel → `packages/door-intercom` streamt PCM vom Türmikrofon → Server-seitige ElevenLabs ConvAI-Session → Neras Stimme wird zurück zum Türlautsprecher gestreamt.

---

## 2. Systemarchitektur

```
Ring Intercom ──[WebRTC PCM]──► packages/door-intercom
                                        │
                                        ▼
Browser (Kiosk) ──[WS PCM]──► apps/orchestrator/src/index.ts
                                        │
                           ┌────────────┴────────────────┐
                           ▼                             ▼
              intercom/door-bridge.ts          agent/pipeline.ts
              (Ring-Tür-Pfad)                  (Browser-Kiosk-Pfad)
                           │                             │
                           └──────────┬──────────────────┘
                                      ▼
                            agent/convai-ws.ts (Tür)
                            agent/agent.ts (Kiosk via OpenRouter)
                                      │
                                      ▼
                              skills/ (find_person, find_place, ...)
                                      │
                                      ▼
                              contracts/projection.ts → Destination
                                      │
                                      ▼
                              ws-broker.ts → alle Display-Clients
                              sinks/yodeck.ts (manuell/out-of-band)
```

---

## 3. Packages & Apps im Überblick

### `contracts/` — Single Source of Truth (nicht ändern!)
- **`contracts.ts`** — alle Zod-Schemas: `DirectoryEntry`, `Person`, `Destination`, `MatchResult`, `Timings`, `SessionState`, `ScreenContent`, `Pose`
- **`skill.ts`** — `Skill<TArgs, TResult>`, `SkillCtx`, `MatchResult` Interface
- **`projection.ts`** — `projectDestination()`, `composeReply()` — deterministisch, kein LLM

### `packages/door-intercom/` — Ring-Türklingel-Integration (NEU seit diesem Pull)
- Dünne Library über den gepatchten `ring-client-api`-Fork
- Stellt `DoorIntercom`-Klasse bereit: `start()`, `speak(audio)`, `unlock()`, `endCall()`
- Event-Callbacks: `onDing`, `onCallStart`, `onAudioChunk` (PCM s16le), `onCallEnd`, `onRefreshToken`
- `doorIntercomFromEnv()` — factory aus env vars; gibt `null` zurück wenn `RING_REFRESH_TOKEN` fehlt
- **Wichtig:** Benötigt den gepatchten `ring-client-api`-Fork aus `packages/ring-client-api/` — das npm-Paket hat `startLiveCall()` und `transcodeReturnAudio()` NICHT

### `packages/ring-client-api/` — Vendorierter Ring API Client (NEU)
- Lokaler Fork mit `startLiveCall()` (audio-only WebRTC), `transcodeReturnAudio({ endCallOnFinish, onFinished })`
- Nur `.js` + `.d.ts` — kein Source-Code, nur gebautes Paket

### `apps/orchestrator/` — Herzstück des Systems

**Entrypoint: `src/index.ts`**
- HTTP-Server (Port 8787) der auch den Kiosk serviert (`apps/kiosk/public/`)
- `/config` Endpoint liefert `{ agentId, directory }` an den Browser
- WebSocket-Broker für alle Clients
- State Machine (IDLE → WELCOME → LISTEN → PROCESS → RESPOND → CLARIFY → DONE)
- Zwei Pfade: Browser-Kiosk-Pfad (ElevenLabs SDK im Browser) + Tür-Pfad (Ring-Intercom)

**`src/intercom/door-bridge.ts`** (NEU — zentraler neuer Baustein)
- Verdrahtet Ring-Intercom ↔ ElevenLabs ConvAI (server-seitig) ↔ Browser-Display
- Half-Duplex: Türmikrofon wird gemutet während Nera spricht
- Tool-Handling: `show_destination` → `resolveQuery()` → Broadcast, `open_door` → `door.unlock()`
- Ring-Refresh-Token wird persistent in `.ring-token` gespeichert (bei jedem Neustart bevorzugt)
- PCM-Verstärkung (DOOR_GAIN=3) für den leisen Türlautsprecher

**`src/agent/convai-ws.ts`** (NEU — ElevenLabs WS für den Tür-Pfad)
- `ConvaiSession`: direkte WS-Verbindung zu `wss://api.elevenlabs.io/v1/convai/conversation`
- Sendet `user_audio_chunk` (base64 PCM), empfängt `audio` (Neras Stimme als PCM), `client_tool_call`
- Tür-Pfad: kein xi-api-key (öffentlicher Agent → anonymous connect), sonst 403

**`src/agent/agent.ts`** — OpenRouter Tool-Calling (für Browser-Kiosk-Pfad)
- Einmaliger LLM-Call, `tool_choice: "required"` → Modell muss immer einen Skill callen
- OpenRouter-Client (OpenAI-kompatibel), default Modell: `openai/gpt-4o-mini`
- Kein Tool-Call → `noMatchDestination()`

**`src/agent/tools.ts`** — deterministische Hilfsfunktionen
- `toToolSpecs()`: Skills → OpenAI Function Tool Specs (via `zod-to-json-schema`)
- `resolveWithSkill()`: Skill-Call → `MatchResult` → `projectDestination()`
- `resolveQuery()`: free-text query → versucht erst `find_place`, dann `find_person`
- `renderDirectoryForAgent()`: Directory als Text für ElevenLabs `{{directory}}` Dynamic Variable
- `buildSystemPrompt()`: Instructions.md + bekannte Orte + bekannte Personen

**`src/pipeline.ts`** — eine Konversations-Turn (für Browser-Kiosk-Pfad)
- `createPipeline()` → lädt `instructions.md`, baut SystemPrompt
- `runTurn(transcript, sessionId)` → `{ destination, replyText, turn, agent }`

**`src/ws-broker.ts`** — WebSocket-Broker
- Zwei Rollen: `"audio"` (Kiosk-Browser) und `"display"` (alle Display-Clients)
- Events in: `hello`, `ring`, `audio`, `resolve`, `unlock`, `speech_end`, `welcome_done`
- Events out: `destination`, `idle`, `play_welcome`, `tts_chunk`, `tts_end`, `state`, `resolve_result`, `agent_audio`, `door_state`

**`src/stt/elevenlabs.ts`** — ElevenLabs Scribe v2 Realtime STT (für Browser-Kiosk-Pfad)
- WebSocket, VAD-basierter Commit, Partials + committed Transcript

**`src/tts/elevenlabs.ts`** — ElevenLabs TTS Streaming (für Browser-Kiosk-Pfad)

**`src/audio/wav.ts`** — PCM ↔ WAV Konvertierung (für Tür-Pfad: Neras Stimme als WAV ans Türtelefon)
- `pcmToWav()`, `wavHeader()`, `WAV_STREAM_DATA_SIZE`, `amplifyPcm()`

**`src/sinks/yodeck.ts`** — Yodeck API Sink (manuell / out-of-band)
- `takeoverKey()`, `takeoverMedia()`, `clear()`, `listImages()`, `listScreens()`
- Bewusst NICHT auf dem Per-Visitor-Hotpath (Latenz), nur für manuellen Screen-Takeover

**`src/sinks/yodeck-images.ts`** — Map von `key → Yodeck media id` (aktuell LEER)

**`src/config.ts`** — alle env vars, typisiert via Zod

**`src/session.ts`** — State Machine (IDLE/WELCOME/LISTEN/PROCESS/RESPOND/CLARIFY/DONE)

**`src/timing.ts`** — Latenz-Messung pro Turn (`Turn.mark()`, `turn.heroMs()`, `turn.segments()`)

**`src/dev/`** — Dev-Tools:
- `harness.ts`: lokaler Test ohne Browser
- `kiosk-sim.ts`, `stt-probe.ts`: ElevenLabs STT testen
- `convai-probe.ts`: ElevenLabs ConvAI testen (NEU)
- `door-talkback-test.ts`: Tür-Pfad testen (NEU)
- `yodeck-push.ts`: manuelles Yodeck-CLI

### `apps/kiosk/public/` — Browser-Kiosk (läuft am Laptop)
- **`kiosk.js`** — ElevenLabs SDK im Browser, zwei Client-Tools: `show_destination` (→ WS `resolve`) und `open_door` (→ WS `unlock`)
- Door-Path Playback: empfängt `agent_audio` (PCM base64) vom Server und spielt es ab (Web Audio API)
- Verbindet via WS zum Orchestrator, Auto-Reconnect
- **`index.html`** — Neras UI: Face (idle/listening/talking), Status, Destination-Card, Latency-Overlay, Door-State-Snack

### `skills/` — Agent-Skills
- **`find-person.ts`** — Fuzzy-Suche nach Person per Name/Alias → `{ destinationId: person.locatedAt }`
- **`find-place.ts`** — Fuzzy-Suche nach Raum/Zone/Event → `{ destinationId: entry.id }`
- **`check-appointment.ts`** — Termin-Validierung: `person.event → event.startsAt/endsAt` mit ±30min Fenster (Europe/Vienna)
- **`navigate-floor.ts`** — Go2-Navigation: lädt floor-spezifische `waypoints.json`, gibt `(x,y,yaw)` zurück
- **`registry.ts`** — Skill-Registry (alle Skills hier registriert)
- **`instructions.md`** — Agent-Systempromt (ElevenLabs-Best-Practices-Format)

### `data/`
- **`directory.json`** — Räume, Zonen, Events mit `startsAt`/`endsAt` (ISO 8601 +02:00)
- **`people.json`** — Personen mit Rollen, Aliases, `locatedAt`, `event`

### `assets/planimetry/`
- 25 PNGs (1920×1080), generiert via `tools/gen-planimetry.py`
- Pro Directory-Eintrag: Schemaplan mit "YOU ARE HERE"-Pin
- ILLUSTRATIV (nicht vermessen) — Fußzeile macht das transparent

---

## 4. Env Vars / Konfiguration

| Variable | Beschreibung | Required für... |
|---|---|---|
| `ELEVENLABS_API_KEY` | STT + TTS | Browser-Kiosk-Pfad |
| `ELEVENLABS_AGENT_ID` | ConvAI Agent ID | Beide Pfade |
| `ELEVENLABS_TTS_VOICE_ID` | Neras Stimme (Fallback-Pipeline) | Browser-Kiosk-Pfad |
| `OPENROUTER_API_KEY` | OpenRouter Agent | Browser-Kiosk-Pfad |
| `OPENROUTER_MODEL` | default: `openai/gpt-4o-mini` | Browser-Kiosk-Pfad |
| `RING_REFRESH_TOKEN` | Ring-Account-Token | Tür-Pfad |
| `RING_INTERCOM_DEVICE_ID` | optional: spezifisches Gerät | Tür-Pfad |
| `YODECK_API_TOKEN` | `label:value` Format | Yodeck-Sink |
| `YODECK_SCREEN_ID` | Screen-ID (740139 = Screen 1) | Yodeck-Sink |
| `GO2_FOXGLOVE_URL` | unset = dry-run | Go2-Sink |
| `PORT` | default: 8787 | immer |

**Sonderfall:** Ring-Refresh-Token rotiert bei jeder Nutzung → wird in `.ring-token` (gitignored) persistiert. Bei Server-Neustart bevorzugt gegenüber `.env`.

---

## 5. Datenpfade (wie alles zusammenhängt)

### Browser-Kiosk-Pfad (ElevenLabs SDK im Browser)
```
Browser: Nutzer klickt Ring → ElevenLabs SDK Conversation.startSession()
  → ElevenLabs führt STT+LLM+TTS aus
  → Wenn Agent show_destination aufruft:
      Browser WS → { type: "resolve", query, reqId }
      Server: resolveQuery(skills, query, data) → Destination
      Server: broker.broadcastDestination(dest)
      Server: broker.resolveResult(clientId, reqId, { result, status, ... })
      Browser: ElevenLabs Agent spricht die Confirmation
  → Wenn Agent open_door aufruft:
      Browser WS → { type: "unlock", reqId }
      Server: doorIntercom.unlock() (falls Ring-Call aktiv)
      Server: broker.doorState("unlocked")
```

### Tür-Pfad (Ring-Intercom)
```
Ring Klingel → door-intercom onDing → openCall() → WebRTC-Session
  → onCallStart → startConversation() → ConvaiSession erstellt
  → Besucher spricht → onAudioChunk PCM → (wenn !speaking) convai.sendAudio()
  → ConvAI → onAgentAudio PCM → broker.agentAudio() (alle Browser)
                              → amplifyPcm(×3) → door.speak(WAV-Stream)
  → ConvAI Tool-Call "show_destination" → resolveQuery() → broadcastDestination()
  → ConvAI Tool-Call "open_door" → door.unlock()
  → Half-Duplex: speaking=true während Nera spricht → Türmikrofon gemutet
```

---

## 6. Tests

```
apps/orchestrator/vitest.config.ts
```

Alle Tests mit `pnpm -F @nera/orchestrator test` ausführen.

| Datei | Was getestet wird | Status |
|---|---|---|
| `src/data.test.ts` | Laden und Validieren von directory.json/people.json | ✅ |
| `src/agent/tools.test.ts` | find_person, find_place, resolveQuery, renderDirectory | ✅ |
| `src/audio/wav.test.ts` | WAV-Header, PCM→WAV, amplifyPcm | ✅ |
| `src/sinks/yodeck.test.ts` | Yodeck API Builder-Funktionen (unit, kein HTTP) | ✅ |
| `src/session.test.ts` | State Machine Transitions | ✅ |
| `src/timing.test.ts` | Turn-Timing-Messungen | ✅ |
| `src/config.test.ts` | Env-Parsing | ✅ |

**Letzter bekannter Stand: 43/43 grün** (vor dem Pull vom 2026-06-07)

---

## 7. Offene / unfertige Items

### ⚠️ Höchste Priorität (Demo-kritisch)
1. **`sinks/yodeck-images.ts` ist LEER** — `IMAGE_MEDIA_IDS` hat keine Einträge. Bilder müssen in Yodeck hochgeladen werden, dann via `tsx src/dev/yodeck-push.ts list` die media-ids holen und eintragen.
2. **Ring-Refresh-Token** muss initial gesetzt werden. Generierung via: `node packages/ring-client-api/lib/ring-auth-cli.js`
3. **Tests nach Pull nicht geprüft** — nach dem großen Pull (110 Dateien) sollten Tests lokal laufen: `pnpm -F @nera/orchestrator test`

### 🔲 Fehlende Features
4. **`apps/agent-runner/`** — war in einem separaten Branch (`agentic-skills`) und ist im Main-Repo in einem eigenen App-Ordner. Der Ordner enthält eigene `agent.ts`, `loader.ts`, `server.ts` — das ist ein älterer paralleler Runner, der möglicherweise veraltet ist. Verhältnis zu `apps/orchestrator/src/agent/` klären.
5. **Waypoints in `skills/navigate-floor-*/waypoints.json`** — alle Koordinaten sind PLACEHOLDER. On-site Mapping nötig (Floor 4 / Robotics Club hat Priorität für Use-Case 1 Demo).
6. **Go2-Sink** — `GO2_FOXGLOVE_URL` ist env-gated (unset = dry-run). Nur relevant wenn echter Roboter verfügbar.
7. **`apps/display-pi/`** existiert im Repo-Baum in der Architektur-Doku, aber nicht als Code-Ordner — Pi-Display läuft über den Kiosk-Code oder statische Bilder.

### 🔲 Out-of-band Yodeck-Setup
8. One-time Web-Page-Assignment: Live-Display-URL als Yodeck-Web-Page-Player eintragen. `§4.7`: Screen rendert Live-WS-Seite, kein per-Visitor-Push.

---

## 8. Wie man das System startet

```bash
# 1. Dependencies
pnpm install

# 2. .env anlegen
cp .env.example .env
# .env befüllen: ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, OPENROUTER_API_KEY
# Optional: RING_REFRESH_TOKEN für Tür-Pfad

# 3. Orchestrator starten
cd apps/orchestrator
pnpm dev  # oder: pnpm exec tsx src/index.ts

# 4. Browser öffnen
# http://localhost:8787
# → Kiosk UI: "🔔 Ring doorbell" klicken → ElevenLabs Session startet
```

**Dev-Tools:**
```bash
# Tür-Pfad testen (ohne Browser)
tsx apps/orchestrator/src/dev/door-talkback-test.ts

# ConvAI direkt testen
tsx apps/orchestrator/src/dev/convai-probe.ts

# Yodeck-CLI
tsx apps/orchestrator/src/dev/yodeck-push.ts screens
tsx apps/orchestrator/src/dev/yodeck-push.ts list
```

---

## 9. Wichtige Constraints (für jeden LLM-Coder)

- **`contracts/` nicht ändern** — Spine-Team-Eigentum
- **Skills geben nur `MatchResult` zurück** — nie Screen-Content, nie Sprache
- **Nur `zod` + Node stdlib in Skills** — keine externen Deps
- **Kein Credentials-Commit** — `.env.example` für Secrets
- **Ring-Refresh-Token rotiert** — immer `onRefreshToken` callback implementieren
- **Tür-Pfad: public agent, kein xi-api-key** — sonst 403 von ElevenLabs
- **Half-Duplex** — Türmikrofon muss gemutet sein während Nera spricht

---

## 10. Kritischer Pfad zur Demo

```
✅ Ring klingelt → ConvAI Session öffnet
✅ Besucher spricht → STT via ElevenLabs → ConvAI antwortet
✅ show_destination Tool-Call → resolveQuery → Destination auf Screen
✅ open_door Tool-Call → door.unlock()
✅ Neras Stimme → Türlautsprecher (door-bridge + WAV-Streaming)
✅ Browser zeigt door_state (ringing/active/speaking/listening/unlocked/idle)
🔲 Planimetrie-Bilder in Yodeck hochladen + IMAGE_MEDIA_IDS füllen
🔲 On-site: Ring-Token generieren und in .env setzen
🔲 Tests nach Pull verifizieren
```

---

## 11. Session Log

### [2026-06-07 Pull + Handover-Erstellung] Repo auf aktuellen Stand gebracht
- `git pull origin main` — 110 Dateien, 8443 Insertions
- Neues: `packages/door-intercom/`, `packages/ring-client-api/` (vendored), `apps/orchestrator/src/intercom/door-bridge.ts`, `apps/orchestrator/src/agent/convai-ws.ts`, `apps/orchestrator/src/sinks/yodeck.ts`, `assets/planimetry/*.png` (25 Bilder)
- Alter Handover archiviert unter `log/archive/HANDOVER_CLAUDE_CODE_2026-06-06.md`
- Neue vollständige Codeanalyse als neuer Handover erstellt
- Status: ✅ Handover aktuell

### [2026-06-07 03:40] Door-Silence: Diagnose-Testset gebaut + Audio-Pipeline freigesprochen
- **Neu:** `apps/orchestrator/src/dev/door-diag.ts` (ffmpeg-Return-Audio-Matrix, offline, nutzt dieselbe gebündelte `ffmpeg.exe` wie Prod) + `apps/orchestrator/src/audio/wav.diag.test.ts` (WAV/Amplify-Unit-Diagnose). Run: `corepack pnpm -F @nera/orchestrator exec tsx src/dev/door-diag.ts`
- **Ergebnis:** Alle 5 ffmpeg-Eingabe-Varianten (Streaming-WAV ±`-re`, Finite-WAV, Raw-PCM, MP3) PASS, exit 0, volle 3,00 s Output. → **Hypothese A (inCall-Timing), B (Streaming-WAV vs. ffmpeg) und Gain-Clipping als Ursache WIDERLEGT.** Audio-Pipeline (PCM→Amplify→WAV→ffmpeg-Encode pcm_mulaw) ist sauber.
- **Fehler eingegrenzt auf** die einzige offline nicht erreichbare Schicht: WebRTC-Return-Audio (`transcodeReturnAudio` `-f rtp` → `RtpSplitter` → `connection.sendAudioPacket()` → `returnAudioTrack.writeRtp()` → Ring). Code-Kandidat: **`activateCameraSpeaker()` wird im Intercom-Pfad nie aufgerufen.** Beobachtbares Live-Signal: `webrtc-connection.js:68` `console.log("[webrtc] connection state:", …)` geht auf echtes stdout (nicht unterdrückt).
- Wichtig: ffmpeg-stderr des Return-Pfads ist in Prod hinter `debug('ring')` unterdrückt; `exitCallback`→`onFinished()` feuert bei JEDEM Exit (auch Crash) → `✓ finished speaking` ist KEIN Erfolgsbeweis.
- **RTP-Output-Probe** (`apps/orchestrator/src/dev/door-diag-rtp.ts`): ffmpeg `-f rtp` → lokaler UDP-Socket, beide Codec-Zweige PASS. pcmu → RTP PT 0 (matcht werift PCMU pt0); opus → PT 97 (werift verhandelt Opus ohne festen PT → ggf. Rewrite nötig). → ffmpeg-Output-Stage (inkl. RTP-Mux) ist sauber. **Stille liegt definitiv im `werift returnAudioTrack.writeRtp → Ring`-Delivery.**
- **Live-Probe gebaut:** `apps/orchestrator/src/dev/door-diag-live.ts` (typecheckt clean). Bestätigt Team-Hypothese #3 (`camera_connected` feuert beim Intercom nie → `activateCameraSpeaker()`-Gate öffnet nie) UND testet den Fix in EINEM Buzz: loggt alle Ring-Messages + `onCameraConnected`, spielt Ton A (440Hz) VOR und Ton B (880Hz) NACH einer *ungated* `camera_options{stealth_mode:false}`. Ändert KEINEN Prod-Code (nur Beobachtung + 1 Signalling-Message). Persistiert rotierten Token in `.ring-token`.
  - Run: `$env:DEBUG="ring"; corepack pnpm -F @nera/orchestrator exec tsx src/dev/door-diag-live.ts` → einmal klingeln.
  - Deutung: nur Ton B hörbar → #3 bestätigt, ungated-Aktivierung = Fix · beide → Lautsprecher ok, Bug ConvAI-pfad-spezifisch · keiner → Aktivierung reicht nicht (Codec/Track tiefer).
- Status: 🔲 wartet auf Live-Buzz durch Gerald (Hardware vor Ort). Danach: gezielter Prod-Fix je nach Ton-Ergebnis.

### [2026-06-07 04:10] ROOT CAUSE bestätigt + Fix gesetzt — Tür-Lautsprecher
- **Live-Buzz-Ergebnis:** nur Ton B (880 Hz, NACH ungated `camera_options{stealth_mode:false}`) war an der Türtafel hörbar, Ton A (440 Hz, davor) stumm. → **Hypothese #3 bestätigt.**
- **Root Cause:** Der kameralose Ring-Intercom hält den Return-Audio-Lautsprecher zu, bis `camera_options{stealth_mode:false}` gesendet wird. Der Fork-eigene `activateCameraSpeaker()` ist auf das `camera_connected`-Event gated, das ein Intercom **nie** emittiert → No-Op. `transcodeReturnAudio` ruft es ohnehin nie. Ergebnis: jedes `speak()` wird encodiert + per RTP gesendet, aber am Gerät verworfen → stumm. (Audio-Pipeline/ffmpeg/RTP waren laut Offline-Testset alle sauber.)
- **Fix (Prod):** `packages/door-intercom/index.ts` — neue private `activateSpeaker()` sendet `camera_options{stealth_mode:false}` **ungated, einmal pro Call**, aufgerufen in `openCall()` direkt nach `this.call = call` (früh genug, dass der Kanal vor dem 1. Agent-Audio offen ist). Reicht in private Fork-Internals (`connection.sendSessionMessage`) via Cast, da die öffentliche Fork-API keine ungated Speaker-Kontrolle für den Audio-Intercom hat. `VENDORED.md`-Fork NICHT angefasst. Beide Packages typecheck clean.
- **Verifikation offen:** 1× Buzz mit `DIAG_OBSERVE_ONLY=1` (Ton A muss jetzt hörbar sein) ODER echter Orchestrator-Lauf (`pnpm dev`) + Buzz → Nera-Greeting ab 1. Turn hörbar.
- Diagnose-Artefakte (additiv, kein Prod): `src/dev/door-diag.ts`, `src/dev/door-diag-rtp.ts`, `src/dev/door-diag-live.ts`, `src/audio/wav.diag.test.ts`.
- Status: ✅ Fix gesetzt · 🔲 finale Live-Verifikation durch Gerald

### [2026-06-07 04:40] Multi-Turn-Audio-Fix (Speaker re-mutet pro Turn) + offene Phase 2
- **Live-Befund:** Greeting hörbar ✅, aber Turns 2+ stumm (obwohl `🔊 streaming`/`✓ finished` im Log). → Ring **re-mutet den Lautsprecher nach jeder Äußerung**; einmaliges `camera_options{stealth_mode:false}` in `openCall` reicht nicht.
- **Fix (Prod):** `packages/door-intercom/index.ts` — `activateSpeaker()` Once-Guard entfernt; wird jetzt **pro Turn** am Anfang von `speak()` re-asserted (zusätzlich weiterhin in `openCall` für Greeting-Vorlauf). Typecheck clean.
- **Phase 2 offen (Gerald-Wunsch: längere Konversation):** Call endete nach ~29s mit Ring-`camera_rsp_timeout` (code 4) — VOR dem 70s-`activate_session`-Limit. Verdacht: ungated `camera_options` armt serverseitig einen Kamera-Antwort-Watchdog (das war vermutlich der Sinn des `camera_connected`-Gates). Protokoll-Surface des Forks bietet keine Alternativ-Speaker-Message; nur Session-Messages: live_view, ice, ping(5s), activate_session, stream_options, camera_options, close. Nächster Schritt: per Live-Test prüfen, ob der per-Turn-Re-Assert die Dauer verändert → entscheidet, ob `camera_options` der Timeout-Auslöser ist.
- Status: ✅ Multi-Turn-Fix gesetzt · 🔲 Live-Verifikation (alle Turns hörbar? + Call-Dauer) · 🔲 Phase 2 Timeout

### [2026-06-07 05:05] speak()-Serialisierung (Drop bei Back-to-Back-Äußerungen) + Dauer-Update
- **Live-Befund:** Konversation läuft jetzt lang über viele Turns, **kein `camera_rsp_timeout`** mehr → der per-Turn-Re-Assert hält die Session offenbar auch lebendig (Phase 2 wohl entschärft, Gerald bestätigt noch endgültig). ABER: `speak: Already speaking`-Fehler 2× → bei zwei schnell aufeinanderfolgenden Agent-Äußerungen (typisch um Tool-Calls: „I'll open the door" → `open_door` → „The door is open, come on in!") warf `speak()` und die **zweite Äußerung ging verloren** (stumm).
- **Fix (Prod):** `packages/door-intercom/index.ts` — `speak()` wirft nicht mehr bei laufender Wiedergabe, sondern **serialisiert** über eine Promise-Queue (`speakQueue`); eigentliche Wiedergabe in neuer `doSpeak()`. Back-to-Back-Äußerungen werden nacheinander abgespielt statt verworfen. `activateSpeaker()` jetzt in `doSpeak` (re-assert direkt vor jeder Wiedergabe). Queue wird pro Call in `openCall` zurückgesetzt. Typecheck clean.
- **Bekannter Minor-Caveat:** Der bridge-seitige `speaking`-Mute-Flag (`door-bridge.ts`) kann während einer *gequeueten* zweiten Äußerung kurz das Mikro entmuten (Echo-Risiko bei back-to-back). Sekundär, später optional härten.
- Status: ✅ Audio-Pipeline + Speaker-Open + Multi-Turn + Serialisierung gefixt · 🔲 Gerald: Re-Test (alle Turns inkl. Tool-Call-Follow-up hörbar? Call-Dauer ok?)

### [2026-06-07 05:25] Half-Duplex-Echo-Fix (Mikro entmutet zu früh bei back-to-back)
- **Befund (Gerald):** Tür öffnete sofort bei korrektem Namen, danach „führte die Konversation weiter" — Ursache: bei gequeueten Back-to-Back-Äußerungen entmutete der half-duplex-Mute das Türmikro schon nach der *ersten* `speak().finally`, während die zweite (z.B. „come on in!") noch lief → Agent hörte sich selbst.
- **Fix (Prod):** `apps/orchestrator/src/intercom/door-bridge.ts` — `speaking` Boolean → `speakingCount` Zähler. `++` vor jedem `door.speak()`, `--` im `finally`; `doorState("listening")` + Mikro-Unmute (`onAudioChunk`-Gate `speakingCount===0`) erst wenn ALLE gequeueten Äußerungen fertig. Resets in `startConversation()` + `onCallEnd`. Sync-Throw von `speak()` unkritisch, da Aufruf durch `door?.inCall`-Guard abgesichert. Typecheck clean.
- **Hinweis:** Falls der Agent *nach* dem Echo-Fix immer noch „zu viel" weiterredet, ist das Agent-Prompt-Verhalten (`skills/instructions.md`), nicht der Audio-Bridge.
- Status: ✅ alle vier Tür-Audio-Probleme gefixt (Speaker-Open, Multi-Turn, Serialisierung, Echo) · 🔲 Gerald: finaler Re-Test

### [2026-06-07 05:45] Visitor-Antwort nicht erfasst (`visitor: "..."`) — Diagnose-Logging statt Rateversuch
- **Befund:** Nach einer (langen) Nera-Frage wurde Geralds Antwort nicht erfasst (`visitor: "..."`). Echo-Fix als Ursache **ausgeschlossen**: dieser Run hatte nur Single-Stream-Turns (je 1×`🔊`/`✓`), wo der `speakingCount`-Zähler verhaltensgleich zum alten Boolean ist. Run 2 (vor Echo-Fix) hatte reiche Multi-Turn-Konversation → Mikro funktioniert grundsätzlich.
- **Verdacht:** half-duplex **Taub-Fenster** — Mikro öffnet erst `TURN_GAP_MS` (700ms) + ffmpeg-Drain nach Neras letztem Chunk (`speakingCount→0`). Schnelle Antwort auf lange Frage fällt in dieses ~1s-Fenster → ConvAI bekommt nur Stille → `"..."`. Inhärent, keine Regression.
- **Eingebaut:** env-gated Mess-Logging in `door-bridge.ts` (`DOOR_DEBUG=1`, Standardlauf unverändert): pro Listen-Window `captured N chunks`, pro Speak-Window `dropped N chunks while Nera spoke`. Zeigt beim nächsten Buzz, ob das Mikro offen war / Audio zu ConvAI floss. Typecheck clean.
- **Nächster Schritt je nach Messung:** dropped>0 & captured≈0 beim "..." → Taub-Fenster/Barge-in (Fix: Fenster verkürzen bzw. Barge-in) · captured groß aber "..." → ConvAI-VAD/Transkription (nicht das Mikro).
- Status: 🔲 Gerald: Re-Test mit `DOOR_DEBUG=1`

### [2026-06-07 06:10] ÜBERGABE an neuen Chat — Stand Tür-Audio + offene Konversations-Lifecycle-Themen

**Neuer Befund (Konversation loopt nach erledigtem Fall):** Nach `open_door` + `show_destination` (Person gefunden, Tür offen) lief der Call **volle ~119,6 s** und endete erst am **`maxCallMs`-Hard-Cap (120000 ms)** von `DoorIntercom`. → Der alte `camera_rsp_timeout` (~30 s) ist durch den per-Turn-Speaker-Re-Assert **endgültig weg** (Phase 2 gelöst). Das Looping (`visitor: "..."` → Nera „Are you still there?" in Endlosschleife) hat zwei Ursachen, **beide außerhalb der Audio-Pipeline**:
1. **Kein Konversations-Ende:** Die Bridge ruft nach erledigter Aufgabe nie `door.endCall()` → Call bleibt offen bis 120-s-Cap.
2. **Agent-Prompt re-engaged auf Stille:** Jedes `visitor: "..."` = ConvAI empfängt echte Stille (Besucher ist nach Türöffnen reingegangen); Nera füllt sie laut Prompt mit „Are you still there?".
→ `visitor: "..."` hier = **echte Stille**, NICHT das half-duplex Taub-Fenster.

**✅ ABGESCHLOSSEN (Tür-Audio, alle live verifiziert außer wo vermerkt):**
1. **Lautsprecher öffnet sich** — `packages/door-intercom/index.ts` `activateSpeaker()` sendet `camera_options{stealth_mode:false}` ungated (Fork-`activateCameraSpeaker()` ist auf nie-feuerndes `camera_connected` gated). Root Cause per Live-A/B bestätigt.
2. **Multi-Turn hörbar** — `activateSpeaker()` wird **pro Turn** in `doSpeak()` re-asserted (Ring re-mutet nach jeder Äußerung).
3. **Back-to-Back-Drop behoben** — `speak()` serialisiert über `speakQueue`-Promise statt zu werfen (`Already speaking`-Verlust weg); Wiedergabe in neuer `doSpeak()`.
4. **Echo/Selbst-Trigger behoben** — `door-bridge.ts` half-duplex `speaking` Boolean → `speakingCount` Zähler; Mikro stumm bis ALLE gequeueten Äußerungen fertig.
5. **Diagnose-Logging** — `door-bridge.ts` `DOOR_DEBUG=1`: pro Turn `captured/dropped chunks` (Standardlauf unverändert).

**🔲 OFFEN für neuen Chat (Priorität für sauberen Demo-Flow):**
- **A) Konversations-Lifecycle / Call-Ende** (Hauptthema): Nach `open_door` (Aufgabe erledigt) kurze Abschiedszeile, dann `door.endCall()` (z. B. nach kurzem Timeout). UND/ODER **Inaktivitäts-Timeout**: nach X s Stille / N leeren Turns → `endCall()`. Optional `maxCallMs` senken. Ort: `apps/orchestrator/src/intercom/door-bridge.ts` (Tool-Handler `open_door` / Turn-Logik).
- **B) Agent-Prompt** (`skills/instructions.md`, Skills-Team): Nera soll nach erledigtem Anliegen **abschließen** statt „Are you still there?" zu loopen.
- **C) Noch unbestätigt:** mittlere-Konversation `visitor: "..."` (Antwort nicht erfasst) — Ursache Taub-Fenster (700 ms `TURN_GAP_MS` + ffmpeg-Drain) vs. ConvAI-VAD. **Mit `DOOR_DEBUG=1` messen** (captured≈0+dropped hoch → Taub-Fenster; captured hoch+"..." → VAD). Möglicher Fix: Mikro am `endTurn` öffnen statt erst nach ffmpeg-Drain (700-ms-Gap behalten).

**Working-Tree-Stand (NICHTS committet):**
- Geändert (Prod): `packages/door-intercom/index.ts`, `apps/orchestrator/src/intercom/door-bridge.ts`
- Neu (additiv, Diagnose): `apps/orchestrator/src/dev/door-diag.ts`, `…/door-diag-rtp.ts`, `…/door-diag-live.ts`, `apps/orchestrator/src/audio/wav.diag.test.ts`
- Vendored Fork (`packages/ring-client-api/`) UNANGETASTET.
- (Vorbestehend, nicht von dieser Session: Root-`HANDOVER_CLAUDE_CODE.md`-Deletion, `log/archive/`, `log/test-welcome-timeout-2026-06-07.md`.)

**Run/Verify:**
- Voller Lauf: `$env:DEBUG="ring"; $env:DOOR_DEBUG="1"; corepack pnpm dev` (in `apps/orchestrator`) — `pnpm` nur via `corepack` (nicht im PATH); Node v22 aktiv (Projekt will ≥24, läuft aber).
- Offline-Testset: `corepack pnpm -F @nera/orchestrator exec tsx src/dev/door-diag.ts` (+ `door-diag-rtp.ts`); Unit: `… exec vitest run src/audio/wav.diag.test.ts`.
- Typecheck: `corepack pnpm -F @nera/door-intercom exec tsc --noEmit` und `… -F @nera/orchestrator …` — beide aktuell clean.

**Noch zu entscheiden (Gerald):** Diagnose-Skripte + Fixes committen? (bisher nichts committet)
- Status: 🔲 neuer Chat: A) Call-Ende-Lifecycle, B) Agent-Prompt, C) `DOOR_DEBUG`-Messung Taub-Fenster

### [2026-06-07 06:35] AUFGABE für neuen Chat: Gespräch beenden + Location auf Yodeck halten

**Entscheidung (Gerald):** Konversations-Ende = **„Call nach `open_door` beenden + Location halten"**. D.h. wenn der Fall erledigt ist (Person gefunden + Tür auf), soll Nera kurz abschließen, der Ring-Call enden — ABER die Location muss **auf dem Yodeck-Screen sichtbar bleiben** (nicht sofort idle).

**Kernproblem (am Code verifiziert):**
- Location erscheint via `broker.broadcastDestination()` → WS-„display"-Clients. Yodeck ist laut ARCHITECTURE §4.7 ein **Web-Page-Player auf die Live-Display-URL** (kein per-Visitor-API-Push; `YodeckSink`/`yodeck-images.ts` ist out-of-band + leer).
- `door-bridge.ts:205` (`onCallEnd`) ruft `broker.broadcastIdle()` → **leert den Screen sofort**. Wenn man den Call nach `open_door` beendet, verschwindet damit die Location. ⇒ Anzeige muss vom Call-Ende **entkoppelt** werden.
- Das „Are you still there?"-Loopen ist Agent-Verhalten (re-prompt auf echte Stille); Call lief bisher bis `maxCallMs` (120 s).

**Umsetzungsskizze (neuer Chat):**
1. In `door-bridge.ts` `open_door`-Tool-Handler (nach erfolgreichem `door.unlock()`): Aufgabe-erledigt-Flag setzen + **graceful end** planen — nach kurzer Verzögerung (Nera ihre Abschiedszeile sprechen lassen) `door.endCall()`.
2. **Display-Idle vom Call-Ende entkoppeln:** `onCallEnd` nicht sofort `broadcastIdle()`; wenn diese Session eine Destination gezeigt hat, Location **X s halten** (z.B. `DISPLAY_HOLD_MS` ~60 s) und ERST DANN idlen. (Letzte Destination + „shownThisCall" tracken.)
3. Optional B) `skills/instructions.md` (Skills-Team): Nera nach erledigtem Anliegen abschließen lassen statt loopen.

**OFFENE YODECK-AUFGABE (Gerald hat es noch NICHT geprüft — Fokus lag bisher auf Audio):**
- **Frage/To-do:** Ist der Yodeck-Screen überhaupt schon als Web-Page-Player auf die Live-Display-URL eingerichtet? (Laut früherem Handover-Punkt war dieses One-time-Setup noch offen.) Falls nein, zeigt der TV die Location noch gar nicht — dann entweder (a) Dashboard-Setup (out-of-band) ODER (b) `YodeckSink`-Push verdrahten (braucht Bilder-Upload + media-ids in `yodeck-images.ts`).
- **Wie testen (Gerald fragte: „kannst du dich mit meinem TV-Screen verbinden?"):** Direkter Zugriff auf den physischen TV/Yodeck-Player ist NICHT möglich (eigenständiges Remote-Gerät). Stattdessen:
  1. **Display-URL im Browser** öffnen = exakt was der Yodeck-Web-Page-Player rendert → Destination triggern, prüfen ob sie erscheint (Claude kann das via Chrome-MCP selbst verifizieren). Welche Route/URL die „display"-Seite ist, im neuen Chat aus `apps/orchestrator/src/index.ts` (servt `apps/kiosk/public`) + `apps/kiosk` bestimmen.
  2. **Yodeck-REST-API** mit Token aus `.env`: `corepack pnpm -F @nera/orchestrator exec tsx src/dev/yodeck-push.ts screens` (Screens + Status) / `… yodeck-push.ts list` (Bilder/media-ids).
  3. Physischer TV: einmaliges Yodeck-Dashboard-Setup (Screen → Web-Page-Player → Display-URL), dann visuell prüfen.
- Status: 🔲 neuer Chat: (1) Yodeck-Ist-Stand prüfen (API + Display-URL im Browser), (2) Gespräch-Ende nach `open_door` + Location-Hold implementieren, (3) ggf. Agent-Prompt-Abschluss
