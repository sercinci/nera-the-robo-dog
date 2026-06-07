/**
 * Typed configuration from environment. Credentials are optional here; the
 * modules that need them fail with a clear message if they're missing.
 */
import { z } from "zod";

const Schema = z.object({
  PORT: z.coerce.number().default(8787),
  LOG_LEVEL: z.string().default("info"),

  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_TTS_VOICE_ID: z.string().optional(),
  ELEVENLABS_AGENT_ID: z.string().optional(),
  ELEVENLABS_TTS_MODEL_ID: z.string().default("eleven_flash_v2_5"),
  ELEVENLABS_STT_MODEL_ID: z.string().default("scribe_v2_realtime"),
  STT_COMMIT_SILENCE_MS: z.coerce.number().default(800),
  STT_VAD_THRESHOLD: z.coerce.number().default(0.5),
  STT_MIN_SPEECH_MS: z.coerce.number().default(300),

  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("openai/gpt-4o-mini"),

  GO2_FOXGLOVE_URL: z.string().optional(),
  YODECK_API_TOKEN: z.string().optional(),
  YODECK_SCREEN_ID: z.coerce.number().optional(),
});

export interface Config {
  port: number;
  logLevel: string;
  elevenLabsApiKey?: string;
  elevenLabsAgentId?: string;
  ttsVoiceId?: string;
  ttsModelId: string;
  sttModelId: string;
  sttCommitSilenceMs: number;
  sttVadThreshold: number;
  sttMinSpeechMs: number;
  openrouterApiKey?: string;
  openrouterModel: string;
  go2FoxgloveUrl?: string;
  yodeckApiToken?: string;
  yodeckScreenId?: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const e = Schema.parse(env);
  return {
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    elevenLabsApiKey: e.ELEVENLABS_API_KEY,
    elevenLabsAgentId: e.ELEVENLABS_AGENT_ID,
    ttsVoiceId: e.ELEVENLABS_TTS_VOICE_ID,
    ttsModelId: e.ELEVENLABS_TTS_MODEL_ID,
    sttModelId: e.ELEVENLABS_STT_MODEL_ID,
    sttCommitSilenceMs: e.STT_COMMIT_SILENCE_MS,
    sttVadThreshold: e.STT_VAD_THRESHOLD,
    sttMinSpeechMs: e.STT_MIN_SPEECH_MS,
    openrouterApiKey: e.OPENROUTER_API_KEY,
    openrouterModel: e.OPENROUTER_MODEL,
    go2FoxgloveUrl: e.GO2_FOXGLOVE_URL,
    yodeckApiToken: e.YODECK_API_TOKEN,
    yodeckScreenId: e.YODECK_SCREEN_ID,
  };
}
