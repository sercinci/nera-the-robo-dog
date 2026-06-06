/**
 * ElevenLabs streaming TTS. Yields audio chunks as they arrive so the orchestrator
 * can forward them to the kiosk for playback (first chunk = hero-KPI stop).
 *
 * Uses the HTTP streaming endpoint with low-latency optimization. For Phase-1
 * (instant welcome) we play a pre-cached file instead of calling this at all.
 *
 * NOTE: live-call module — verify with a real ELEVENLABS_API_KEY + voice id.
 */
export interface TtsDeps {
  apiKey: string;
  voiceId: string;
  modelId: string;
}

export interface TtsOptions {
  /** mp3_44100_128 plays everywhere; pcm_16000 is lighter to pipe to the kiosk. */
  outputFormat?: string;
  /** 0..4 — higher trades quality for first-byte latency. */
  optimizeStreamingLatency?: number;
  signal?: AbortSignal;
}

export async function* streamTts(
  deps: TtsDeps,
  text: string,
  opts: TtsOptions = {},
): AsyncGenerator<Buffer> {
  const format = opts.outputFormat ?? "mp3_44100_128";
  const latency = opts.optimizeStreamingLatency ?? 3;
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${deps.voiceId}/stream` +
    `?optimize_streaming_latency=${latency}&output_format=${format}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": deps.apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: deps.modelId,
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.2 },
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS ${res.status}: ${detail}`);
  }

  // Node 20+: response.body is an async-iterable web ReadableStream.
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    yield Buffer.from(chunk);
  }
}
