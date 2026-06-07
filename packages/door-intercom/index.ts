/**
 * @nera/door-intercom — Ring door intercom as a two-way audio device.
 *
 * A thin, app-agnostic library over a patched `ring-client-api`. It:
 *   - listens for the building buzzer (`onDing`),
 *   - on a buzz, opens a live audio call and streams the visitor's voice
 *     continuously as mono PCM s16le chunks (`onAudioChunk`) — feed these to
 *     your own STT/VAD,
 *   - lets you talk back as many times as you like during the call
 *     (`speak()`), without hanging up,
 *   - opens the door (`unlock()`), and
 *   - leaves it to YOU to end the conversation (`endCall()`).
 *
 * This library does NOT do STT, VAD, agent logic, or TTS — it's just the
 * door's mic + speaker + buzzer + lock as a clean interface. Wire the
 * conversation loop (STT → agent → TTS → speak) yourself.
 *
 * Verified against a real Ring Intercom (audio-only, `intercom_handset_audio`):
 * two-way audio works, but only during an active ding (the buzzer provisions a
 * short-lived audio session — there's no on-demand live view, no camera).
 *
 * REQUIRES the patched `ring-client-api` fork that adds
 * `RingIntercom.startLiveCall()`, the audio-only WebRTC option, and the
 * keep-alive `transcodeReturnAudio({ endCallOnFinish, onFinished })` used here.
 * The stock npm package does NOT have these.
 */
import { RingApi, type RingIntercom } from "ring-client-api";
import { Readable } from "node:stream";

type LiveCall = Awaited<ReturnType<RingIntercom["startLiveCall"]>>;

export interface DoorIntercomOptions {
  /** Ring refresh token for the account that OWNS the intercom. Rotates on use. */
  refreshToken: string;
  /** Pick a specific intercom by device id; defaults to the first one found. */
  deviceId?: number;
  /** PCM output sample rate (Hz) for `onAudioChunk`. Default 16000 (STT-friendly). */
  sampleRate?: number;
  /** Hard cap on a single call, ms — a safety net if you never call endCall(). Default 120000. */
  maxCallMs?: number;
}

export interface DoorIntercomHandlers {
  /** Connected and the target intercom is resolved. */
  onReady?: (device: { id: number; name: string }) => void;
  /** Buzzer pressed. A call is being opened. */
  onDing: () => void;
  /** Call connected — you can now `speak()` and audio chunks will flow. */
  onCallStart?: () => void;
  /** A chunk of the visitor's audio: mono PCM s16le @ `sampleRate`. */
  onAudioChunk?: (pcm: Buffer) => void;
  /** Call torn down (you called endCall(), the cap elapsed, or Ring closed it). */
  onCallEnd?: (info: { inboundPackets: number }) => void;
  /** Ring rotated the refresh token — persist `newToken` for the next start. */
  onRefreshToken?: (newToken: string) => void;
  onError?: (err: Error) => void;
}

export class DoorIntercom {
  private readonly sampleRate: number;
  private readonly maxCallMs: number;
  private api: RingApi | null = null;
  private intercom: RingIntercom | null = null;
  private call: LiveCall | null = null;
  private inboundPackets = 0;
  private speaking = false;
  private speakQueue: Promise<void> = Promise.resolve(); // serialize back-to-back utterances
  private opening = false;
  private callTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly options: DoorIntercomOptions,
    private readonly handlers: DoorIntercomHandlers,
  ) {
    this.sampleRate = options.sampleRate ?? 16000;
    this.maxCallMs = options.maxCallMs ?? 120_000;
  }

  /** Connect, resolve the intercom, and start listening for buzzer presses. */
  async start(): Promise<void> {
    const api = new RingApi({ refreshToken: this.options.refreshToken });
    this.api = api;

    api.onRefreshTokenUpdated.subscribe(({ newRefreshToken, oldRefreshToken }) => {
      if (newRefreshToken && newRefreshToken !== oldRefreshToken) {
        this.handlers.onRefreshToken?.(newRefreshToken);
      }
    });

    const locations = await api.getLocations();
    const intercoms = locations.flatMap((l) => l.intercoms);
    const intercom = this.options.deviceId
      ? intercoms.find((i) => i.id === this.options.deviceId)
      : intercoms[0];

    if (!intercom) {
      throw new Error(
        this.options.deviceId
          ? `No Ring intercom with id ${this.options.deviceId} on this account.`
          : "No Ring intercom found on this account.",
      );
    }

    this.intercom = intercom;
    this.handlers.onReady?.({ id: intercom.id, name: intercom.name });

    intercom.onDing.subscribe(() => {
      this.handlers.onDing();
      void this.openCall();
    });
  }

  /** True while a call is live — i.e. `speak()` will work and audio is flowing. */
  get inCall(): boolean {
    return this.call !== null;
  }

  /**
   * Open the intercom's speaker (return-audio) channel.
   *
   * The patched ring-client-api only exposes the camera-style
   * `activateCameraSpeaker()`, which gates its `camera_options {stealth_mode:false}`
   * on a `camera_connected` notification. A cameraless audio intercom never emits
   * that event, so the gate never opens and the speaker stays muted — every
   * `speak()` is encoded and sent, but silently dropped at the device.
   *
   * We send the same speaker-open message UNGATED. Verified live: a tone played
   * before this runs is inaudible at the panel; the same tone after it is audible.
   * Ring RE-MUTES the speaker after each utterance, so we re-assert it on call
   * open AND before every speak() — otherwise only the first turn is audible.
   * `sendSessionMessage` internally waits for the session id, so this is safe to
   * call as soon as the call object exists.
   *
   * Reaches private internals of the vendored fork because its public API has no
   * ungated speaker control for the audio-only intercom.
   */
  private activateSpeaker(): void {
    if (!this.call) return;
    const conn = (
      this.call as unknown as {
        connection?: { sendSessionMessage?: (method: string, body?: Record<string, unknown>) => void };
      }
    ).connection;
    conn?.sendSessionMessage?.("camera_options", { stealth_mode: false });
  }

  /** Open the live audio call for the current ding and start streaming inbound audio. */
  private async openCall(): Promise<void> {
    if (this.stopped || this.call || this.opening || !this.intercom) return;
    this.opening = true;
    this.inboundPackets = 0;
    this.speakQueue = Promise.resolve();

    try {
      const call = await this.intercom.startLiveCall();
      this.call = call;
      this.opening = false;
      // Audio intercoms keep the speaker muted until told otherwise — open it now
      // so Nera is audible from the first turn (see activateSpeaker docs).
      this.activateSpeaker();

      call.onAudioRtp.subscribe(() => {
        this.inboundPackets++;
      });

      call.onCallEnded.subscribe(() => {
        if (this.callTimer) clearTimeout(this.callTimer);
        const info = { inboundPackets: this.inboundPackets };
        this.call = null;
        this.speaking = false;
        this.handlers.onCallEnd?.(info);
      });

      // Fire onCallStart only once the WebRTC media is actually CONNECTED. The
      // media path takes a couple of seconds to negotiate; audio sent before that
      // is dropped (the intercom never hears it). Gate the conversation on it.
      let callStarted = false;
      const fireStart = () => {
        if (!callStarted) {
          callStarted = true;
          this.handlers.onCallStart?.();
        }
      };
      const pc = (
        call as unknown as {
          connection?: { pc?: { onConnectionState?: { subscribe: (cb: (s: string) => void) => void } } };
        }
      ).connection?.pc;
      if (pc?.onConnectionState?.subscribe) {
        pc.onConnectionState.subscribe((s) => {
          if (s === "connected") fireStart();
        });
        setTimeout(fireStart, 8000); // safety net if 'connected' never fires
      } else {
        fireStart();
      }

      call.activateCameraSpeaker();

      // Stream the visitor's audio continuously as mono PCM s16le.
      await call.startTranscoding({
        video: false,
        audio: ["-acodec", "pcm_s16le", "-ar", String(this.sampleRate), "-ac", "1"],
        output: ["-f", "s16le", "pipe:1"],
        stdoutCallback: (chunk: Buffer) => this.handlers.onAudioChunk?.(chunk),
      });

      // Safety net so a call can't hang open forever.
      this.callTimer = setTimeout(() => this.endCall(), this.maxCallMs);
    } catch (err) {
      this.opening = false;
      this.call = null;
      this.handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Talk back to the visitor during a live call. Streams `audio` to the door
   * speaker and resolves when playback finishes. Does NOT end the call, so you
   * can call it repeatedly across conversation turns.
   *
   * `audio` must be a format ffmpeg can sniff (mp3/wav/ogg) — e.g. an
   * ElevenLabs mp3 TTS stream. Calls are QUEUED and played back-to-back in order
   * (a single speaker can only play one thing at a time), so a follow-up
   * utterance — e.g. the line the agent says right after a tool call — is no
   * longer dropped. Throws only if there's no live call.
   */
  speak(audio: NodeJS.ReadableStream | Buffer): Promise<void> {
    if (!this.call) {
      throw new Error("No active call — speak() only works during a live ding.");
    }
    const run = this.speakQueue.then(() => this.doSpeak(audio));
    this.speakQueue = run.catch(() => {}); // a failed utterance must not wedge the queue
    return run;
  }

  private async doSpeak(audio: NodeJS.ReadableStream | Buffer): Promise<void> {
    if (!this.call) return; // the call ended while this utterance was queued
    this.speaking = true;
    this.activateSpeaker(); // Ring re-mutes the speaker after each utterance — re-open it
    const inputStream = Buffer.isBuffer(audio) ? Readable.from(audio) : audio;
    const call = this.call;
    try {
      await new Promise<void>((resolve, reject) => {
        call
          .transcodeReturnAudio({
            inputStream,
            endCallOnFinish: false, // keep the call open for the next turn
            onFinished: () => resolve(),
          })
          .catch(reject);
      });
    } finally {
      this.speaking = false;
    }
  }

  /** End the current conversation (tears down the call). Safe to call when idle. */
  endCall(): void {
    if (this.callTimer) clearTimeout(this.callTimer);
    this.callTimer = undefined;
    this.call?.stop();
    this.call = null;
    this.speaking = false;
  }

  /** Open the building door. */
  async unlock(): Promise<void> {
    if (!this.intercom) throw new Error("DoorIntercom not started.");
    await this.intercom.unlock();
  }

  /** Disconnect from Ring and stop listening for buzzes. */
  stop(): void {
    this.stopped = true;
    this.endCall();
    this.api?.disconnect();
    this.api = null;
  }
}

/**
 * Convenience: build a DoorIntercom from environment variables.
 *   RING_REFRESH_TOKEN       (required)
 *   RING_INTERCOM_DEVICE_ID  (optional)
 * Returns null when RING_REFRESH_TOKEN is absent (feature disabled).
 */
export function doorIntercomFromEnv(
  handlers: DoorIntercomHandlers,
  env: Record<string, string | undefined> = process.env,
): DoorIntercom | null {
  const refreshToken = env.RING_REFRESH_TOKEN;
  if (!refreshToken) return null;
  const deviceId = env.RING_INTERCOM_DEVICE_ID
    ? Number(env.RING_INTERCOM_DEVICE_ID)
    : undefined;
  return new DoorIntercom({ refreshToken, deviceId }, handlers);
}
