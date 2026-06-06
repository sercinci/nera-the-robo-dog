/**
 * ElevenLabs Scribe v2 Realtime STT over WebSocket.
 *
 * Protocol (per docs):
 *   URL    wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=&audio_format=&commit_strategy=vad&...
 *   auth   xi-api-key header
 *   send   { message_type:"input_audio_chunk", audio_base_64, commit, sample_rate }
 *   recv   { message_type:"session_started"|"partial_transcript"|"committed_transcript"|..., text }
 *
 * commit_strategy=vad commits on trailing silence (our ~400ms end-of-turn). You
 * can also force a commit by calling commit().
 *
 * NOTE: live module — verify against a real ELEVENLABS_API_KEY.
 */
import WebSocket from "ws";

export interface SttDeps {
  apiKey: string;
  modelId: string;
  sampleRate?: number; // pcm sample rate; default 16000
  commitSilenceMs?: number; // VAD trailing-silence before commit (end-of-turn)
  minSpeechMs?: number; // ignore speech bursts shorter than this (kills blips)
  vadThreshold?: number; // 0..1 voice-activity sensitivity
}

export interface SttHandlers {
  onOpen?: () => void;
  onPartial?: (text: string) => void;
  onCommit: (text: string) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

export class SttSession {
  private ws: WebSocket;
  private readonly sampleRate: number;
  private open = false;
  private queue: string[] = []; // frames sent before the socket opened

  constructor(deps: SttDeps, handlers: SttHandlers) {
    this.sampleRate = deps.sampleRate ?? 16000;
    const params = new URLSearchParams({
      model_id: deps.modelId,
      audio_format: `pcm_${this.sampleRate}`,
      commit_strategy: "vad",
      // Wait for a real end-of-turn pause, not a mid-sentence breath.
      vad_silence_threshold_secs: String((deps.commitSilenceMs ?? 800) / 1000),
      // Don't let a click/blip start (and instantly end) a "speech" segment.
      min_speech_duration_ms: String(deps.minSpeechMs ?? 300),
      vad_threshold: String(deps.vadThreshold ?? 0.5),
    });
    this.ws = new WebSocket(
      `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params.toString()}`,
      { headers: { "xi-api-key": deps.apiKey } },
    );

    this.ws.on("open", () => {
      this.open = true;
      for (const frame of this.queue) this.ws.send(frame);
      this.queue = [];
      handlers.onOpen?.();
    });
    this.ws.on("error", (e) => handlers.onError?.(e as Error));
    this.ws.on("close", () => handlers.onClose?.());
    this.ws.on("message", (data) => {
      let m: any;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      switch (m.message_type) {
        case "partial_transcript":
          handlers.onPartial?.(m.text ?? "");
          break;
        case "committed_transcript":
        case "committed_transcript_with_timestamps":
          handlers.onCommit(m.text ?? "");
          break;
        case "session_started":
          break;
        default:
          if (m.error) handlers.onError?.(new Error(String(m.error)));
      }
    });
  }

  private send(frame: string): void {
    // Queue until the socket opens so we never drop the start of an utterance.
    if (this.open && this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
    else this.queue.push(frame);
  }

  /** Feed a chunk of raw PCM audio. */
  sendAudio(pcm: Buffer, commit = false): void {
    this.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: pcm.toString("base64"),
        commit,
        sample_rate: this.sampleRate,
      }),
    );
  }

  /** Force end-of-turn commit (manual fallback to VAD). */
  commit(): void {
    this.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: "",
        commit: true,
        sample_rate: this.sampleRate,
      }),
    );
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
