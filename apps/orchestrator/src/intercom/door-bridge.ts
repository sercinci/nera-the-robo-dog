/**
 * Door path: Ring intercom <-> server-side ElevenLabs agent <-> browser.
 *
 *   buzz (onDing) -> open call -> for each turn:
 *     visitor PCM (onAudioChunk) --> ConvaiSession.sendAudio   [muted while Nera speaks]
 *     agent PCM (onAgentAudio)   --> browser (live stream) + accumulate -> WAV -> door.speak()
 *     show_destination tool      --> resolveQuery -> broadcast Destination -> spoken confirmation
 *
 * Half-duplex on the door: we stop feeding the door mic to the agent while Nera is
 * speaking, so the door speaker doesn't echo back into the agent.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { doorIntercomFromEnv, type DoorIntercom } from "@nera/door-intercom";
import { skills } from "@nera/skills";
import { pcmToWav, wavHeader, WAV_STREAM_DATA_SIZE, amplifyPcm } from "../audio/wav.js";
import { ConvaiSession } from "../agent/convai-ws.js";
import { resolveQuery, renderDirectoryForAgent } from "../agent/tools.js";

const DEBUG_WAV = "/tmp/nera-door-last.wav"; // last greeting, for verification

// Ring rotates its refresh token on every use. We persist the freshest one to a
// gitignored file and prefer it over .env, so the door survives restarts.
const TOKEN_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..", ".ring-token");
import type { Config } from "../config.js";
import type { BuildingData } from "../data.js";
import type { Broker } from "../ws-broker.js";
import type { Logger } from "../log.js";

const SAMPLE_RATE = 16000;
const TURN_GAP_MS = 700; // silence after the last agent chunk => end of a spoken turn
const DOOR_GAIN = 3; // amplify Nera for the quiet intercom speaker (matches the working mp3 volume=3.0)
const DOOR_DEBUG = process.env.DOOR_DEBUG === "1"; // verbose mic mute/capture diagnostics
const DISPLAY_HOLD_MS = 100_000; // keep the last destination on screen this long after the call ends
const INACTIVITY_PROMPT_MS = 10_000; // visitor silence (real speech) before Nera checks in once, then again before goodbye
const REAL_SPEECH_RE = /[\p{L}\p{N}]/u; // filters out filler transcripts like "..." (no letters/digits = not natural language)

export function startDoorBridge(args: {
  cfg: Config;
  data: BuildingData;
  broker: Broker;
  log: Logger;
}): DoorIntercom | null {
  const { cfg, data, broker, log } = args;
  const directory = renderDirectoryForAgent(data);

  // Prefer the freshest persisted token over the (one-shot) .env value.
  if (existsSync(TOKEN_FILE)) {
    const saved = readFileSync(TOKEN_FILE, "utf8").trim();
    if (saved) process.env.RING_REFRESH_TOKEN = saved;
  }

  let convai: ConvaiSession | null = null;
  let turnChunks: Buffer[] = [];
  let turnTimer: ReturnType<typeof setTimeout> | undefined;
  let speakingCount = 0; // # of in-flight door.speak() calls — mute the door mic while > 0
  let door: DoorIntercom | null = null;
  let callStartMs = 0;
  let speakStream: PassThrough | null = null; // live WAV stream feeding door.speak()
  let micSent = 0; // diagnostic: visitor chunks forwarded to the agent (DOOR_DEBUG)
  let micDropped = 0; // diagnostic: visitor chunks dropped because Nera was speaking
  let pendingEndCall = false; // end the call once Nera finishes the utterance in flight
  let shownThisCall = false; // a destination was shown on screen during this call
  let displayHoldTimer: ReturnType<typeof setTimeout> | undefined; // delays broadcastIdle() after call end
  let silenceTimer: ReturnType<typeof setTimeout> | undefined; // absolute visitor-silence clock
  let silenceTimerArmed = false; // starts once, on the first mic-open; from then on only real visitor speech resets it
  let checkedInOnce = false; // "are you still there?" asked once already (the spec's hard cap)

  function clearSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = undefined;
  }

  // Absolute clock on visitor silence — measures time since the visitor's last
  // REAL utterance (not since the mic last opened/closed). This is deliberate:
  // Nera's own turns (including her native "are you still there?" looping) must
  // NOT reset it, otherwise her chatter masks true visitor inactivity forever.
  // Tolerates normal thinking pauses; after INACTIVITY_PROMPT_MS of true visitor
  // silence, checks in once, then says goodbye and ends the call if still no reply.
  function armSilenceTimer() {
    clearSilenceTimer();
    silenceTimer = setTimeout(() => {
      silenceTimer = undefined;
      if (pendingEndCall) return;
      if (!checkedInOnce) {
        checkedInOnce = true;
        log.info("[door] visitor silent — checking in ('are you still there?')");
        convai?.sendUserMessage("[SYSTEM_CUE: visitor_silent]");
        armSilenceTimer(); // give them a window to answer the check-in
      } else {
        log.info("[door] visitor silent after check-in — saying goodbye and ending the call");
        pendingEndCall = true;
        convai?.sendUserMessage("[SYSTEM_CUE: visitor_silent_final]");
      }
    }, INACTIVITY_PROMPT_MS);
  }

  // End-of-turn: stop streaming to the door and dump the turn's audio for verification.
  function endTurn() {
    turnTimer = undefined;
    if (turnChunks.length) {
      try {
        const wav = pcmToWav(Buffer.concat(turnChunks), SAMPLE_RATE);
        writeFileSync(DEBUG_WAV, wav);
        log.info(`[door] dumped greeting → ${DEBUG_WAV} (${wav.length}B)`);
      } catch (e) {
        log.warn(`[door] dump failed: ${(e as Error).message}`);
      }
    }
    turnChunks = [];
    if (speakStream) {
      speakStream.end(); // closes the stream → door.speak() resolves
      speakStream = null;
    }
  }

  function startConversation() {
    convai?.close();
    turnChunks = [];
    speakingCount = 0;
    pendingEndCall = false;
    checkedInOnce = false;
    silenceTimerArmed = false;
    clearSilenceTimer();
    shownThisCall = false;
    if (displayHoldTimer) {
      clearTimeout(displayHoldTimer);
      displayHoldTimer = undefined;
    }
    convai = new ConvaiSession(
      { agentId: cfg.elevenLabsAgentId!, apiKey: cfg.elevenLabsApiKey, dynamicVariables: { directory } },
      {
        onReady: () => log.info("[door] agent session ready"),
        onAgentResponse: (t) => {
          log.info(`[door] Nera: "${t}"`);
          broker.doorState("speaking");
        },
        onUserTranscript: (t) => {
          log.info(`[door] visitor: "${t}"`);
          // ElevenLabs also emits filler transcripts like "..." for silence/noise —
          // per spec only natural language counts as a reply; filler must NOT
          // reset the clock (that's exactly what let the visitor drift past unnoticed).
          if (REAL_SPEECH_RE.test(t)) {
            checkedInOnce = false; // genuine engagement — fresh allowance for a future silence episode
            armSilenceTimer();
          }
        },
        onAgentAudio: (pcm) => {
          broker.agentAudio(pcm); // browser at normal level
          const boosted = amplifyPcm(pcm, DOOR_GAIN); // intercom speaker is quiet
          turnChunks.push(boosted); // dump reflects what the door actually receives
          // Start a live WAV stream to the door on the first chunk of a turn.
          if (!speakStream && door?.inCall) {
            log.info("[door] 🔊 streaming Nera to the door…");
            speakStream = new PassThrough();
            speakStream.write(wavHeader(SAMPLE_RATE, WAV_STREAM_DATA_SIZE)); // streaming header
            speakingCount++; // keep the door mic muted until every queued utterance finishes
            if (DOOR_DEBUG && speakingCount === 1) {
              log.info(`[door][dbg] 🎤 MUTE — captured ${micSent} chunks during last listen window`);
              micSent = 0;
            }
            door
              .speak(speakStream)
              .then(() => log.info("[door] ✓ finished speaking to the door"))
              .catch((e) => log.error("[door] speak:", (e as Error).message))
              .finally(() => {
                if (--speakingCount === 0) {
                  if (pendingEndCall) {
                    pendingEndCall = false;
                    log.info("[door] ending call after Nera's closing line");
                    door?.endCall();
                  } else {
                    broker.doorState("listening");
                    // Start the absolute silence clock once, the first time the
                    // mic opens (i.e. once the visitor is expected to respond).
                    // From here on ONLY onUserTranscript (real speech) resets it —
                    // Nera's own turns must not, see armSilenceTimer's doc comment.
                    if (!silenceTimerArmed) {
                      silenceTimerArmed = true;
                      armSilenceTimer();
                    }
                    if (DOOR_DEBUG) {
                      log.info(`[door][dbg] 🎤 OPEN — dropped ${micDropped} chunks while Nera spoke`);
                      micDropped = 0;
                    }
                  }
                }
              });
          }
          speakStream?.write(boosted); // real-time audio to the door (amplified)
          if (turnTimer) clearTimeout(turnTimer);
          turnTimer = setTimeout(endTurn, TURN_GAP_MS);
        },
        onInterruption: () => {
          turnChunks = [];
          if (turnTimer) clearTimeout(turnTimer);
          turnTimer = undefined;
          if (speakStream) {
            speakStream.end();
            speakStream = null;
          }
        },
        onToolCall: async (name, params, respond) => {
          // Agent explicitly requests the building door be opened.
          if (name === "open_door") {
            if (!door?.inCall) return respond("There's no active door call to open.", true);
            try {
              await door.unlock();
              log.info("[door] 🔓 intercom unlocked (agent open_door)");
              broker.doorState("unlocked");
              clearSilenceTimer(); // task done — stop watching for visitor silence
              pendingEndCall = true; // end the call once Nera finishes the line below
              return respond("The door is open — come on in! Thanks for stopping by — see you next time!");
            } catch (e) {
              log.error("[door] unlock failed:", (e as Error).message);
              return respond("I couldn't open the door just now.", true);
            }
          }
          if (name === "show_destination") {
            const query = String((params as { query?: unknown }).query ?? "");
            const dest = await resolveQuery(skills, query, data, { sessionId: "door", transcript: query });
            if (dest.showOnScreen) {
              broker.broadcastDestination(dest);
              shownThisCall = true;
            }
            log.info(`[door] show_destination "${query}" -> ${dest.status} ${dest.destinationId ?? ""}`);
            return respond(
              dest.status === "resolved"
                ? `${dest.label}${dest.screen.subtitle ? ", " + dest.screen.subtitle : ""}`
                : dest.status === "ambiguous"
                  ? "Ask the visitor to be more specific."
                  : "No match — direct them to the front desk.",
            );
          }
          if (name === "human_fallback") {
            log.info("[door] human_fallback triggered");
            broker.doorState("fallback");
            return respond("Let me get someone from the team to help you — just one moment!");
          }
          return respond("Unknown tool", true);
        },
        onError: (e) => log.error("[door] agent error:", e.message),
        onClose: () => log.info("[door] agent session closed"),
      },
    );
  }

  door = doorIntercomFromEnv({
    onReady: (d) => log.info(`[door] armed on "${d.name}" (id ${d.id}) — waiting for a buzz`),
    onDing: () => {
      log.info("[door] 🔔 buzz");
      broker.doorState("ringing");
    },
    onCallStart: () => {
      callStartMs = Date.now();
      log.info("[door] call live");
      broker.doorState("active");
      startConversation();
    },
    onAudioChunk: (pcm) => {
      // half-duplex: only feed the agent while Nera isn't speaking
      if (speakingCount === 0) {
        micSent++;
        convai?.sendAudio(pcm);
      } else {
        micDropped++;
      }
    },
    onCallEnd: (info) => {
      const dur = callStartMs ? Date.now() - callStartMs : 0;
      log.info(`[door] call ended after ${dur}ms (inbound audio packets: ${info?.inboundPackets ?? "?"})`);
      convai?.close();
      convai = null;
      if (turnTimer) clearTimeout(turnTimer);
      turnTimer = undefined;
      clearSilenceTimer();
      pendingEndCall = false;
      if (speakStream) {
        speakStream.end();
        speakStream = null;
      }
      speakingCount = 0;
      turnChunks = [];
      broker.doorState("idle");
      // Keep a shown destination on screen for a while so the visitor can still
      // read it — display-idle is decoupled from the call's end.
      if (shownThisCall) {
        shownThisCall = false;
        displayHoldTimer = setTimeout(() => {
          displayHoldTimer = undefined;
          broker.broadcastIdle();
        }, DISPLAY_HOLD_MS);
      } else {
        broker.broadcastIdle();
      }
    },
    onRefreshToken: (t) => {
      try {
        writeFileSync(TOKEN_FILE, t, "utf8");
        log.info("[door] Ring refresh token rotated → persisted to .ring-token");
      } catch (e) {
        log.warn(`[door] could not persist rotated token: ${(e as Error).message}`);
      }
    },
    onError: (e) => log.error("[door]", e.message),
  });

  if (!door) {
    log.info("[door] RING_REFRESH_TOKEN not set — door path disabled.");
    return null;
  }
  door.start().catch((e) => log.error("[door] start failed:", (e as Error).message));
  return door;
}
