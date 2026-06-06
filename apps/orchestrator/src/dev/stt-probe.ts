/**
 * STT live probe (throwaway). Synthesizes a sentence as PCM via ElevenLabs TTS,
 * then streams that audio into the Scribe v2 Realtime STT client and prints the
 * transcript — a full TTS→STT round-trip using only the ElevenLabs key.
 *
 *   pnpm --filter @nera/orchestrator exec tsx src/dev/stt-probe.ts
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { streamTts } from "../tts/elevenlabs.js";
import { SttSession } from "../stt/elevenlabs.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

async function main() {
  dotenv.config({ path: resolve(repoRoot, ".env") });
  const cfg = loadConfig();
  if (!cfg.elevenLabsApiKey || !cfg.ttsVoiceId) throw new Error("Need ELEVENLABS_API_KEY + VOICE_ID");

  const phrase = "where is the robotics club";
  console.log(`Synthesizing "${phrase}" as pcm_16000…`);
  const chunks: Buffer[] = [];
  for await (const c of streamTts(
    { apiKey: cfg.elevenLabsApiKey, voiceId: cfg.ttsVoiceId, modelId: cfg.ttsModelId },
    phrase,
    { outputFormat: "pcm_16000" },
  )) {
    chunks.push(c);
  }
  const pcm = Buffer.concat(chunks);
  console.log(`Got ${pcm.length} bytes PCM. Streaming into STT…`);

  await new Promise<void>((resolveDone) => {
    let timer: NodeJS.Timeout;
    const done = () => {
      clearTimeout(timer);
      resolveDone();
    };
    const stt = new SttSession(
      { apiKey: cfg.elevenLabsApiKey!, modelId: cfg.sttModelId, commitSilenceMs: cfg.sttCommitSilenceMs },
      {
        onOpen: async () => {
          const frame = 16000; // ~0.5s of 16-bit PCM
          for (let i = 0; i < pcm.length; i += frame) {
            stt.sendAudio(pcm.subarray(i, i + frame));
            await new Promise((r) => setTimeout(r, 60));
          }
          stt.commit();
        },
        onPartial: (t) => console.log("  partial:", JSON.stringify(t)),
        onCommit: (t) => {
          console.log("  COMMITTED:", JSON.stringify(t));
          stt.close();
          done();
        },
        onError: (e) => {
          console.error("  STT error:", e.message);
          stt.close();
          done();
        },
      },
    );
    timer = setTimeout(() => {
      console.log("  (timeout)");
      stt.close();
      done();
    }, 12000);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
