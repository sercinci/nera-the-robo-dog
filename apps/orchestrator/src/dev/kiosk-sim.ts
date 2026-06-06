/**
 * Headless kiosk simulator — drives the LIVE server end-to-end without a browser.
 * Synthesizes a phrase as PCM (TTS), connects as an audio client, rings, completes
 * the welcome, streams the audio as mic frames, forces commit, and reports the full
 * round-trip: STT → agent → destination broadcast → TTS chunks back.
 *
 *   pnpm --filter @nera/orchestrator exec tsx src/dev/kiosk-sim.ts "where is gabriela"
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { streamTts } from "../tts/elevenlabs.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

async function main() {
  dotenv.config({ path: resolve(repoRoot, ".env") });
  const cfg = loadConfig();
  const phrase = process.argv.slice(2).join(" ").trim() || "where is the robotics club";

  // 1) Synthesize the visitor's utterance as 16k PCM.
  console.log(`Synthesizing visitor audio: "${phrase}"`);
  const pcmChunks: Buffer[] = [];
  for await (const c of streamTts(
    { apiKey: cfg.elevenLabsApiKey!, voiceId: cfg.ttsVoiceId!, modelId: cfg.ttsModelId },
    phrase,
    { outputFormat: "pcm_16000" },
  )) {
    pcmChunks.push(c);
  }
  const pcm = Buffer.concat(pcmChunks);

  // 2) Connect to the live server and run the conversation.
  const ws = new WebSocket(`ws://localhost:${cfg.port}`);
  const events: string[] = [];
  let ttsBytes = 0;
  let streamed = false;

  const log = (s: string) => {
    events.push(s);
    console.log("  ←", s);
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const sendAudio = (buf: Buffer) =>
    ws.send(JSON.stringify({ type: "audio", b64: buf.toString("base64") }));

  async function streamMic() {
    if (streamed) return;
    streamed = true;
    console.log(`  → streaming ${pcm.length} bytes of mic audio (realtime pace)…`);
    const frame = 8000; // 0.25s of 16-bit 16k PCM
    for (let i = 0; i < pcm.length; i += frame) {
      sendAudio(pcm.subarray(i, i + frame));
      await sleep(240); // ~realtime so STT keeps up
    }
    // Trailing silence -> the server's VAD (400ms) commits naturally, like a real pause.
    const silence = Buffer.alloc(frame);
    for (let k = 0; k < 5; k++) {
      sendAudio(silence);
      await sleep(240);
    }
    ws.send(JSON.stringify({ type: "speech_end" })); // backstop commit
    console.log("  → trailing silence sent (VAD should commit)");
  }

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "hello", role: "audio" }));
    setTimeout(() => ws.send(JSON.stringify({ type: "ring" })), 200);
  });

  ws.addEventListener("message", (ev: MessageEvent) => {
    const m = JSON.parse(ev.data.toString());
    switch (m.type) {
      case "idle": log("idle (Nera face)"); break;
      case "state": log(`state: ${m.phase}`); if (m.phase === "LISTEN") void streamMic(); break;
      case "play_welcome":
        log("play_welcome");
        setTimeout(() => ws.send(JSON.stringify({ type: "welcome_done" })), 100);
        break;
      case "destination":
        log(`DESTINATION: ${m.destination.status} → ${m.destination.destinationId ?? "—"} ("${m.destination.screen.title}")`);
        break;
      case "tts_chunk": ttsBytes += (m.b64.length * 3) / 4; break;
      case "tts_end": log(`tts_end (~${Math.round(ttsBytes / 1024)} KB audio streamed back)`); break;
    }
  });

  await new Promise((r) => setTimeout(r, 15000));
  ws.close();
  console.log("\n=== RESULT ===");
  console.log(events.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
