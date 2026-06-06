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
import { doorIntercomFromEnv, type DoorIntercom } from "@nera/door-intercom";
import { skills } from "@nera/skills";
import { ConvaiSession } from "../agent/convai-ws.js";
import { pcmToWav } from "../audio/wav.js";
import { resolveQuery, renderDirectoryForAgent } from "../agent/tools.js";

// Ring rotates its refresh token on every use. We persist the freshest one to a
// gitignored file and prefer it over .env, so the door survives restarts.
const TOKEN_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..", ".ring-token");
import type { Config } from "../config.js";
import type { BuildingData } from "../data.js";
import type { Broker } from "../ws-broker.js";
import type { Logger } from "../log.js";

const SAMPLE_RATE = 16000;
const TURN_GAP_MS = 700; // silence after the last agent chunk => end of a spoken turn

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

  function finalizeTurn() {
    turnTimer = undefined;
    if (!turnChunks.length || !door?.inCall) {
      turnChunks = [];
      speaking = false;
      return;
    }
    const wav = pcmToWav(Buffer.concat(turnChunks), SAMPLE_RATE);
    turnChunks = [];
    door
      .speak(wav)
      .catch((e) => log.error("[door] speak:", (e as Error).message))
      .finally(() => {
        speaking = false; // reopen the mic to the agent
        broker.doorState("listening");
      });
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
          speaking = true; // mute door mic while Nera's audio is arriving
          broker.agentAudio(pcm); // always forward to the browser (low-latency stream)
          turnChunks.push(pcm); // accumulate for a single door utterance
          if (turnTimer) clearTimeout(turnTimer);
          turnTimer = setTimeout(finalizeTurn, TURN_GAP_MS);
        },
        onInterruption: () => {
          turnChunks = [];
          if (turnTimer) clearTimeout(turnTimer);
          turnTimer = undefined;
        },
        onToolCall: async (name, params, respond) => {
          if (name !== "show_destination") return respond("Unknown tool", true);
          const query = String((params as { query?: unknown }).query ?? "");
          const dest = await resolveQuery(skills, query, data, { sessionId: "door", transcript: query });
          if (dest.showOnScreen) broker.broadcastDestination(dest);
          log.info(`[door] show_destination "${query}" -> ${dest.status} ${dest.destinationId ?? ""}`);
          respond(
            dest.status === "resolved"
              ? `${dest.label}${dest.screen.subtitle ? ", " + dest.screen.subtitle : ""}`
              : dest.status === "ambiguous"
                ? "Ask the visitor to be more specific."
                : "No match — direct them to the front desk.",
          );
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
      log.info("[door] call live");
      broker.doorState("active");
      startConversation();
    },
    onAudioChunk: (pcm) => {
      if (!speaking) convai?.sendAudio(pcm); // half-duplex
    },
    onCallEnd: () => {
      log.info("[door] call ended");
      convai?.close();
      convai = null;
      if (turnTimer) clearTimeout(turnTimer);
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
