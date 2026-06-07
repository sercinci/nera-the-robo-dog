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
  let speaking = false; // Nera is talking -> mute the door mic to avoid feedback
  let door: DoorIntercom | null = null;
  let callStartMs = 0;
  let speakStream: PassThrough | null = null; // live WAV stream feeding door.speak()

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
    speaking = false;
    convai = new ConvaiSession(
      { agentId: cfg.elevenLabsAgentId!, apiKey: cfg.elevenLabsApiKey, dynamicVariables: { directory } },
      {
        onReady: () => log.info("[door] agent session ready"),
        onAgentResponse: (t) => {
          log.info(`[door] Nera: "${t}"`);
          broker.doorState("speaking");
        },
        onUserTranscript: (t) => log.info(`[door] visitor: "${t}"`),
        onAgentAudio: (pcm) => {
          broker.agentAudio(pcm); // browser at normal level
          const boosted = amplifyPcm(pcm, DOOR_GAIN); // intercom speaker is quiet
          turnChunks.push(boosted); // dump reflects what the door actually receives
          // Start a live WAV stream to the door on the first chunk of a turn.
          if (!speakStream && door?.inCall) {
            log.info("[door] 🔊 streaming Nera to the door…");
            speaking = true; // mute door mic while Nera talks
            speakStream = new PassThrough();
            speakStream.write(wavHeader(SAMPLE_RATE, WAV_STREAM_DATA_SIZE)); // streaming header
            door
              .speak(speakStream)
              .then(() => log.info("[door] ✓ finished speaking to the door"))
              .catch((e) => log.error("[door] speak:", (e as Error).message))
              .finally(() => {
                speaking = false;
                broker.doorState("listening");
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
              return respond("The door is open — come on in!");
            } catch (e) {
              log.error("[door] unlock failed:", (e as Error).message);
              return respond("I couldn't open the door just now.", true);
            }
          }
          if (name === "show_destination") {
            const query = String((params as { query?: unknown }).query ?? "");
            const dest = await resolveQuery(skills, query, data, { sessionId: "door", transcript: query });
            if (dest.showOnScreen) broker.broadcastDestination(dest);
            log.info(`[door] show_destination "${query}" -> ${dest.status} ${dest.destinationId ?? ""}`);
            return respond(
              dest.status === "resolved"
                ? `${dest.label}${dest.screen.subtitle ? ", " + dest.screen.subtitle : ""}`
                : dest.status === "ambiguous"
                  ? "Ask the visitor to be more specific."
                  : "No match — direct them to the front desk.",
            );
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
      if (!speaking) convai?.sendAudio(pcm); // half-duplex
    },
    onCallEnd: (info) => {
      const dur = callStartMs ? Date.now() - callStartMs : 0;
      log.info(`[door] call ended after ${dur}ms (inbound audio packets: ${info?.inboundPackets ?? "?"})`);
      convai?.close();
      convai = null;
      if (turnTimer) clearTimeout(turnTimer);
      turnTimer = undefined;
      if (speakStream) {
        speakStream.end();
        speakStream = null;
      }
      speaking = false;
      turnChunks = [];
      broker.doorState("idle");
      broker.broadcastIdle();
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
