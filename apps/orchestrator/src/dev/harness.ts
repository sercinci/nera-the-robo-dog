/**
 * Text-in dev harness — verify the agent (OpenRouter) and TTS (ElevenLabs) WITHOUT
 * a mic or browser. Type a transcript; see the resolved Destination, the spoken
 * reply, timings, and (if TTS creds are set) a reply.mp3 with the hero KPI.
 *
 *   pnpm --filter @nera/orchestrator harness "where is gabriela?"
 *
 * Requires .env at the repo root with OPENROUTER_API_KEY (and optionally
 * ELEVENLABS_API_KEY + ELEVENLABS_TTS_VOICE_ID for audio).
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { loadData } from "../data.js";
import { createPipeline } from "../pipeline.js";
import { streamTts } from "../tts/elevenlabs.js";
import { makeLogger } from "../log.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");

async function main() {
  dotenv.config({ path: resolve(repoRoot, ".env") });
  const cfg = loadConfig();
  const log = makeLogger(cfg.logLevel);

  if (!cfg.openrouterApiKey) {
    log.error("OPENROUTER_API_KEY is missing — add it to .env at the repo root.");
    process.exit(1);
  }

  const data = await loadData(resolve(repoRoot, "data"));
  const pipeline = await createPipeline({
    data,
    openrouterApiKey: cfg.openrouterApiKey,
    model: cfg.openrouterModel,
    instructionsPath: resolve(repoRoot, "skills/instructions.md"),
  });

  const transcript = process.argv.slice(2).join(" ").trim() || "where is gabriela?";
  log.info(`Visitor: "${transcript}"  (model: ${cfg.openrouterModel})`);

  const { destination, replyText, turn, agent } = await pipeline.runTurn(transcript, "harness");

  console.log("\n=== Destination (to screen + robot) ===");
  console.log(JSON.stringify(destination, null, 2));
  console.log(`\nTool called: ${agent.toolName ?? "(none)"}`);
  if (agent.assistantText) console.log(`Model text:  "${agent.assistantText}"`);
  console.log(`Nera says:   "${replyText}"`);

  if (cfg.elevenLabsApiKey && cfg.ttsVoiceId) {
    log.info("Synthesizing reply via ElevenLabs…");
    const chunks: Buffer[] = [];
    for await (const c of streamTts(
      { apiKey: cfg.elevenLabsApiKey, voiceId: cfg.ttsVoiceId, modelId: cfg.ttsModelId },
      replyText,
    )) {
      if (chunks.length === 0) turn.mark("ttsFirstAudioAt");
      chunks.push(c);
    }
    const out = resolve(repoRoot, "reply.mp3");
    await writeFile(out, Buffer.concat(chunks));
    console.log(`\nWrote ${out}`);
  } else {
    log.warn("ELEVENLABS_API_KEY / ELEVENLABS_TTS_VOICE_ID not set — skipping TTS.");
  }

  console.log("\n=== Timings ===");
  for (const s of turn.segments()) console.log(`  ${s.from} → ${s.to}: ${s.ms}ms`);
  const hero = turn.heroMs();
  if (hero !== undefined) console.log(`  HERO (speech→voice): ${hero}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
