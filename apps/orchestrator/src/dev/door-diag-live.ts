/**
 * Door return-audio LIVE probe — confirms hypothesis #3 AND tests the fix in ONE buzz.
 *
 * Offline diagnostics (door-diag.ts + door-diag-rtp.ts) cleared the entire audio
 * pipeline and ffmpeg/RTP stages. The silence must be in the werift→Ring return
 * leg. Team hypothesis #3: the audio-only intercom never emits the
 * `camera_connected` notification, so `activateCameraSpeaker()` — which gates its
 * `camera_options {stealth_mode:false}` on exactly that event — never opens the
 * speaker channel.
 *
 * This probe needs the real Ring intercom + ONE physical buzz. It:
 *   1. logs EVERY Ring signalling message (so you SEE whether `camera_connected`
 *      arrives) and whether `onCameraConnected` fires,
 *   2. plays tone A (440 Hz) BEFORE, then sends an UNGATED
 *      `camera_options {stealth_mode:false}`, then plays tone B (880 Hz) AFTER —
 *      distinct pitches so you can tell at the panel which one is audible,
 *   3. persists the rotated refresh token to .ring-token (Ring rotates on use).
 *
 * Reads NO production code paths destructively — it only observes the live call
 * and sends one extra signalling message. It does not modify any prod file.
 *
 * Run (PowerShell), then buzz the panel once:
 *   $env:DEBUG="ring"; corepack pnpm -F @nera/orchestrator exec tsx src/dev/door-diag-live.ts
 * Pure baseline (only tone A, no activation — confirm current silence + watch msgs):
 *   $env:DEBUG="ring"; $env:DIAG_OBSERVE_ONLY="1"; corepack pnpm -F @nera/orchestrator exec tsx src/dev/door-diag-live.ts
 *
 * Interpretation:
 *   only tone B audible  -> #3 confirmed; ungated speaker activation is the fix.
 *   both tones audible   -> speaker was fine; the bug is ConvAI-path specific.
 *   neither audible      -> activation alone isn't enough; deeper (codec/track).
 */
import { config as dotenvConfig } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { DoorIntercom } from "@nera/door-intercom";
import { amplifyPcm, wavHeader, WAV_STREAM_DATA_SIZE } from "../audio/wav.js";

const SR = 16000;
const GAIN = 3;
const OBSERVE_ONLY = process.env.DIAG_OBSERVE_ONLY === "1";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TOKEN_FILE = join(REPO_ROOT, ".ring-token");

dotenvConfig({ path: join(REPO_ROOT, ".env") });
dotenvConfig({ path: join(REPO_ROOT, "apps", "orchestrator", ".env") });

const ts = () => new Date().toISOString().slice(11, 23);
const log = (m: string) => console.log(`${ts()}  ${m}`);
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function synthSine(freq: number, secs: number, amp = 8000): Buffer {
  const n = SR * secs;
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * freq * i) / SR)), i * 2);
  return b;
}

/** A live WAV stream in the EXACT door-bridge format (header + paced PCM frames). */
function toneStream(freq: number, secs = 2): PassThrough {
  const pcm = amplifyPcm(synthSine(freq, secs), GAIN);
  const s = new PassThrough();
  s.write(wavHeader(SR, WAV_STREAM_DATA_SIZE));
  void (async () => {
    const frame = Math.floor(SR * 0.1) * 2; // 100 ms frames, like the agent
    for (let i = 0; i < pcm.length; i += frame) {
      s.write(pcm.subarray(i, i + frame));
      await delay(100);
    }
    s.end();
  })();
  return s;
}

function resolveToken(): string | undefined {
  let token = process.env.RING_REFRESH_TOKEN;
  if (existsSync(TOKEN_FILE)) {
    const saved = readFileSync(TOKEN_FILE, "utf8").trim();
    if (saved) token = saved; // prefer the freshest persisted token
  }
  return token;
}

async function main() {
  const token = resolveToken();
  if (!token) {
    console.error("ERR: no RING_REFRESH_TOKEN (.env / .ring-token). Put your token in .env.");
    process.exit(1);
  }

  let inbound = 0;
  log(`armed — mode=${OBSERVE_ONLY ? "OBSERVE_ONLY (tone A only)" : "A/B fix test"}; waiting for a buzz…`);
  log("(tip: run with $env:DEBUG=\"ring\" to also see werift connection/codec logs)");

  const door = new DoorIntercom(
    { refreshToken: token, maxCallMs: 90_000, deviceId: process.env.RING_INTERCOM_DEVICE_ID ? Number(process.env.RING_INTERCOM_DEVICE_ID) : undefined },
    {
      onReady: (d) => log(`✅ ready on "${d.name}" (id ${d.id}). BUZZ THE PANEL ONCE.`),
      onDing: () => log("🔔 buzz received — opening call…"),
      onAudioChunk: () => {
        inbound++;
        if (inbound === 1) log("🎙  first inbound audio chunk (visitor mic path OK)");
      },
      onCallStart: async () => {
        log("📞 call live (WebRTC connected)");

        // Reach the live session/connection to OBSERVE signalling. Dev-only cast;
        // no prod code is modified. StreamingSession.connection + its rxjs
        // subjects are public; onMessage is an unbounded ReplaySubject so we
        // still receive messages that arrived before this subscription.
        const session = (door as unknown as { call?: any }).call;
        const conn = session?.connection;
        if (!conn) {
          log("⚠ could not reach the live connection object (API shape changed?)");
        } else {
          conn.onMessage?.subscribe?.((m: any) => {
            const text = m?.body?.text ? ` text="${m.body.text}"` : "";
            log(`   ↩ ring msg: method=${m?.method}${text}`);
          });
          conn.onCameraConnected?.subscribe?.(() => log("   ✅✅ onCameraConnected FIRED (gate would open)"));
        }

        try {
          log("🔊 [A] speaking 440 Hz tone — BEFORE speaker activation …");
          await door.speak(toneStream(440));
          log("✓ [A] finished");

          if (!OBSERVE_ONLY && conn) {
            await delay(600);
            log("🛎  sending UNGATED camera_options{stealth_mode:false} (bypass camera_connected gate) …");
            conn.sendSessionMessage?.("camera_options", { stealth_mode: false });
            await delay(800);
            log("🔊 [B] speaking 880 Hz tone — AFTER speaker activation …");
            await door.speak(toneStream(880));
            log("✓ [B] finished");
          }
        } catch (e) {
          log(`❌ speak error: ${(e as Error).message}`);
        }

        await delay(1200);
        log(`ending call (inbound chunks this call: ${inbound})`);
        door.endCall();
      },
      onCallEnd: (info) => {
        log(`📞 call ended (inbound packets: ${info.inboundPackets}).`);
        log("Done. Did you hear tone A (440), tone B (880), both, or neither at the door?");
        door.stop();
        setTimeout(() => process.exit(0), 300);
      },
      onRefreshToken: (t) => {
        try {
          writeFileSync(TOKEN_FILE, t, "utf8");
          log("🔑 refresh token rotated → persisted to .ring-token");
        } catch (e) {
          log(`⚠ could not persist rotated token: ${(e as Error).message}`);
        }
      },
      onError: (e) => log(`❌ ${e.message}`),
    },
  );

  await door.start().catch((e) => {
    console.error("start failed:", e.message);
    process.exit(1);
  });
}

main().catch((e) => {
  console.error("door-diag-live crashed:", e);
  process.exit(1);
});
