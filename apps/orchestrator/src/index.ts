/**
 * Orchestrator entrypoint. Wires the broker, per-audio-client session machines,
 * ElevenLabs STT, the agent pipeline, and ElevenLabs TTS.
 *
 * Flow: ring → welcome (cached) → listen (STT) → commit → agent → emit Destination
 *       to displays + stream reply to TTS → done → idle. A new ring hard-resets
 *       (AbortController cancels in-flight agent/TTS).
 */
import dotenv from "dotenv";
import { createServer } from "node:http";
import { readFile as fsReadFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname } from "node:path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { loadConfig } from "./config.js";
import { loadData } from "./data.js";
import { makeLogger } from "./log.js";
import { createPipeline, type Pipeline } from "./pipeline.js";
import { Broker } from "./ws-broker.js";
import { SttSession } from "./stt/elevenlabs.js";
import { streamTts } from "./tts/elevenlabs.js";
import { initialSession, reduce, type Session } from "./session.js";
import { resolveQuery, renderDirectoryForAgent } from "./agent/tools.js";
import { skills } from "@nera/skills";
import { startDoorBridge } from "./intercom/door-bridge.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const LISTEN_TIMEOUT_MS = 8000;
const DONE_RESET_MS = 5000;

interface Live {
  id: string;
  session: Session;
  stt?: SttSession;
  abort?: AbortController;
  history?: ChatCompletionMessageParam[];
  listenTimer?: NodeJS.Timeout;
  doneTimer?: NodeJS.Timeout;
  gotAudio?: boolean;
}

async function main() {
  dotenv.config({ path: resolve(repoRoot, ".env") });
  const cfg = loadConfig();
  const log = makeLogger(cfg.logLevel);

  if (!cfg.openrouterApiKey) log.warn("OPENROUTER_API_KEY missing — agent calls will fail.");
  if (!cfg.elevenLabsApiKey) log.warn("ELEVENLABS_API_KEY missing — STT/TTS will fail.");

  const data = await loadData(resolve(repoRoot, "data"));
  const pipeline = await createPipeline({
    data,
    openrouterApiKey: cfg.openrouterApiKey ?? "",
    model: cfg.openrouterModel,
    instructionsPath: resolve(repoRoot, "skills/instructions.md"),
  });

  const kioskDir = resolve(repoRoot, "apps/kiosk/public");
  const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".ico": "image/x-icon",
  };
  const server = createServer(async (req, res) => {
    try {
      const urlPath = (req.url ?? "/").split("?")[0]!;
      // Kiosk config (agent id for the ElevenLabs SDK).
      if (urlPath === "/config") {
        // agentId + a live directory snapshot (from directory.json/people.json) the
        // kiosk passes as the agent's {{directory}} dynamic variable each session.
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            agentId: cfg.elevenLabsAgentId ?? null,
            directory: renderDirectoryForAgent(data),
          }),
        );
        return;
      }
      const rel = (urlPath === "/" ? "/index.html" : urlPath).replace(/\.\.+/g, "");
      const file = resolve(kioskDir, "." + rel);
      if (!file.startsWith(kioskDir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await fsReadFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  server.listen(cfg.port, () =>
    log.info(`Kiosk: http://localhost:${cfg.port}  ·  WS on the same port`),
  );

  const broker = new Broker(server);
  const lives = new Map<string, Live>();

  // Door path: Ring intercom <-> server-side EL agent <-> browser. No-ops without RING_REFRESH_TOKEN.
  const doorIntercom = startDoorBridge({ cfg, data, broker, log });

  const set = (id: string, s: Session) => {
    const l = lives.get(id);
    if (l) {
      l.session = s;
      broker.state(id, s.phase);
    }
  };

  function clearTimers(l: Live) {
    if (l.listenTimer) clearTimeout(l.listenTimer);
    if (l.doneTimer) clearTimeout(l.doneTimer);
    l.listenTimer = undefined;
    l.doneTimer = undefined;
  }

  function teardown(l: Live) {
    clearTimers(l);
    l.abort?.abort();
    l.abort = undefined;
    l.stt?.close();
    l.stt = undefined;
  }

  function openMic(l: Live) {
    l.stt?.close();
    if (!cfg.elevenLabsApiKey) {
      log.error("Cannot open STT without ELEVENLABS_API_KEY.");
      return;
    }
    l.stt = new SttSession(
      {
        apiKey: cfg.elevenLabsApiKey,
        modelId: cfg.sttModelId,
        commitSilenceMs: cfg.sttCommitSilenceMs,
        minSpeechMs: cfg.sttMinSpeechMs,
        vadThreshold: cfg.sttVadThreshold,
      },
      {
        onOpen: () => log.info(`🎙️  STT open (${l.id}) — listening`),
        onPartial: (text) => {
          if (text) log.info(`   …partial: "${text}"`);
        },
        onCommit: (text) => {
          log.info(`   ✓ commit: "${text}"`);
          if (text.trim()) void handleTranscript(l, text.trim());
        },
        onError: (e) => log.error(`STT error (${l.id}):`, e.message),
        onClose: () => log.debug(`STT closed (${l.id})`),
      },
    );
    l.gotAudio = false;
    // No-speech timeout.
    l.listenTimer = setTimeout(() => dispatch(l, { type: "TIMEOUT" }), LISTEN_TIMEOUT_MS);
  }

  async function speak(l: Live, text: string, onFirstAudio?: () => void): Promise<void> {
    if (!cfg.elevenLabsApiKey || !cfg.ttsVoiceId) {
      log.warn(`(no TTS creds) Nera would say: "${text}"`);
      return;
    }
    let first = true;
    try {
      for await (const chunk of streamTts(
        { apiKey: cfg.elevenLabsApiKey, voiceId: cfg.ttsVoiceId, modelId: cfg.ttsModelId },
        text,
        { signal: l.abort?.signal },
      )) {
        if (first) {
          first = false;
          onFirstAudio?.();
        }
        broker.ttsChunk(l.id, chunk);
      }
    } catch (e) {
      if (!l.abort?.signal.aborted) log.error("TTS error:", (e as Error).message);
    } finally {
      broker.ttsEnd(l.id);
    }
  }

  async function handleTranscript(l: Live, transcript: string) {
    clearTimers(l);
    l.stt?.close();
    l.stt = undefined;
    dispatch(l, { type: "TRANSCRIPT", transcript });

    l.abort = new AbortController();
    let result: Awaited<ReturnType<Pipeline["runTurn"]>>;
    try {
      result = await pipeline.runTurn(transcript, l.id, {
        history: l.history,
        signal: l.abort.signal,
      });
    } catch (e) {
      log.error("Agent error:", (e as Error).message);
      return;
    }

    l.history = result.agent.messages;

    // Emit to all displays the instant we have a destination (fast path).
    if (result.destination.showOnScreen) broker.broadcastDestination(result.destination);
    log.info(
      `"${transcript}" → ${result.destination.status} ${result.destination.destinationId ?? ""} ` +
        `(tool=${result.agent.toolName ?? "none"})`,
    );

    // Advance the state machine on the outcome.
    dispatch(l, { type: "RESOLVED", status: result.destination.status });

    if (l.session.phase === "RESPOND") {
      await speak(l, result.replyText, () => result.turn.mark("ttsFirstAudioAt"));
      reportTimings(l, result.turn);
      dispatch(l, { type: "RESPOND_DONE" });
      // Auto-reset to idle after a quiet beat.
      l.doneTimer = setTimeout(() => {
        dispatch(l, { type: "TIMEOUT" });
        broker.broadcastIdle();
      }, DONE_RESET_MS);
    } else if (l.session.phase === "CLARIFY") {
      await speak(l, result.replyText);
      openMic(l); // listen for the clarification
    }
  }

  function reportTimings(l: Live, turn: { heroMs: () => number | undefined; segments: () => unknown }) {
    log.info(`timings ${l.id}:`, JSON.stringify({ heroMs: turn.heroMs(), segments: turn.segments() }));
  }

  function dispatch(l: Live, ev: Parameters<typeof reduce>[1]) {
    const before = l.session.phase;
    const next = reduce(l.session, ev);
    set(l.id, next);
    if (before !== next.phase) log.debug(`${l.id}: ${before} -> ${next.phase} (${ev.type})`);
    // Entering LISTEN after WELCOME: open the mic.
    if (before !== "LISTEN" && next.phase === "LISTEN" && ev.type === "WELCOME_DONE") openMic(l);
    // Reprompt: re-arm the listen timer.
    if (before === "LISTEN" && next.phase === "LISTEN" && ev.type === "TIMEOUT") {
      l.listenTimer = setTimeout(() => dispatch(l, { type: "TIMEOUT" }), LISTEN_TIMEOUT_MS);
    }
  }

  // ---- broker events ----
  broker.on("hello", (id: string, role: string) => {
    if (role === "audio") {
      lives.set(id, { id, session: initialSession() });
      broker.broadcastIdle();
      log.info(`audio client ${id} connected`);
    }
  });

  broker.on("ring", (id: string) => {
    const l = lives.get(id);
    if (!l) return;
    teardown(l); // cancel anything in flight
    dispatch(l, { type: "RING" });
    broker.playWelcome(id);
  });

  broker.on("welcomeDone", (id: string) => {
    const l = lives.get(id);
    if (l) dispatch(l, { type: "WELCOME_DONE" });
  });

  broker.on("audio", (id: string, pcm: Buffer) => {
    const l = lives.get(id);
    if (!l) return;
    if (!l.gotAudio) {
      l.gotAudio = true;
      log.info(`🔊 receiving mic audio from ${id} (first frame ${pcm.length}B)`);
    }
    l.stt?.sendAudio(pcm);
  });

  broker.on("speechEnd", (id: string) => {
    lives.get(id)?.stt?.commit();
  });

  // ---- ElevenLabs agent path: resolve a show_destination tool call ----
  broker.on("resolve", async (id: string, query: string, reqId: unknown) => {
    const meta = { sessionId: id, transcript: query };
    let dest;
    try {
      dest = await resolveQuery(skills, query, data, meta);
    } catch (e) {
      log.error("resolve error:", (e as Error).message);
      broker.resolveResult(id, reqId, { status: "error", result: "I had trouble looking that up." });
      return;
    }
    if (dest.showOnScreen) broker.broadcastDestination(dest);
    log.info(`[agent] "${query}" → ${dest.status} ${dest.destinationId ?? ""}`);

    const result =
      dest.status === "resolved"
        ? `${dest.label}${dest.screen.subtitle ? ", " + dest.screen.subtitle : ""}`
        : dest.status === "ambiguous"
          ? "Multiple matches — ask the visitor to be more specific."
          : "No match — ask them to rephrase, or direct them to the front desk.";

    broker.resolveResult(id, reqId, {
      status: dest.status,
      destinationId: dest.destinationId,
      personId: dest.via.person ?? null,
      label: dest.label,
      result,
    });
  });

  // open_door tool relayed from the browser agent: physically unlock the Ring intercom.
  // Only meaningful during an active door call; browser-only sessions have none.
  broker.on("unlock", async (id: string, reqId: unknown) => {
    log.info(`[agent] open_door requested (live Ring call: ${doorIntercom?.inCall ?? false})`);
    if (doorIntercom?.inCall) {
      try {
        await doorIntercom.unlock();
        log.info("[agent] 🔓 intercom unlocked (open_door)");
      } catch (e) {
        log.error("[agent] unlock failed:", (e as Error).message);
        broker.resolveResult(id, reqId, { status: "error", result: "I couldn't open the door just now." });
        return;
      }
    } else {
      // Browser simulation (no physical buzz): pretend-open so the demo shows the snack.
      log.info("[agent] 🔓 simulated door open (no live Ring call — browser demo)");
    }
    broker.doorState("unlocked"); // -> browser snack
    broker.resolveResult(id, reqId, { status: "ok", result: "The door is open — come on in!" });
  });

  broker.on("disconnect", (id: string) => {
    const l = lives.get(id);
    if (l) {
      teardown(l);
      lives.delete(id);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
