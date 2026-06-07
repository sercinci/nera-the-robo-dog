/**
 * Door return-audio RTP probe — the last hardware-free leg of the diagnosis.
 *
 * door-diag.ts proved ffmpeg can DECODE our input and ENCODE pcm_mulaw. This
 * probe goes one step further and reproduces the EXACT output stage of the real
 * `transcodeReturnAudio`: ffmpeg `-f rtp` -> a local UDP socket (standing in for
 * the fork's RtpSplitter -> connection.sendAudioPacket). It does NOT touch Ring.
 *
 * It answers: does ffmpeg emit valid RTP packets, how many, and with which
 * payload type / SSRC — for BOTH codec branches the fork picks via `isUsingOpus`:
 *   pcmu : -acodec pcm_mulaw -ac 1 -ar 8k   (expect RTP payload type 0)
 *   opus : -acodec libopus  -ac 2 -ar 48k   (expect a dynamic PT, often 97)
 *
 * If packets flow correctly here, the silence is conclusively in the
 * werift returnAudioTrack.writeRtp -> Ring delivery (codec negotiation /
 * activateCameraSpeaker), NOT in our audio or ffmpeg.
 *
 * Run: corepack pnpm -F @nera/orchestrator exec tsx src/dev/door-diag-rtp.ts
 */
import { spawn } from "node:child_process";
import dgram from "node:dgram";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { wavHeader, amplifyPcm, WAV_STREAM_DATA_SIZE } from "../audio/wav.js";

const SR = 16000;
const GAIN = 3;
const DURATION_S = 3;
const FRAME_MS = 100;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function resolveFfmpeg(): string {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const store = join(dir, "node_modules", ".pnpm");
    if (existsSync(store)) {
      const pkg = readdirSync(store).find((d) => d.startsWith("ffmpeg-for-homebridge@"));
      if (pkg) {
        for (const bin of ["ffmpeg.exe", "ffmpeg"]) {
          const p = join(store, pkg, "node_modules", "ffmpeg-for-homebridge", bin);
          if (existsSync(p)) return p;
        }
      }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return "ffmpeg";
}
const FFMPEG = resolveFfmpeg();

function synthSine(freq = 440, secs = DURATION_S, amp = 8000): Buffer {
  const n = SR * secs;
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * freq * i) / SR)), i * 2);
  return b;
}

interface RtpStat {
  packets: number;
  bytes: number;
  payloadTypes: Set<number>;
  ssrcs: Set<number>;
  firstSeq: number | null;
  lastSeq: number | null;
}

function parseFirst(buf: Buffer) {
  const version = (buf[0] >> 6) & 0x3;
  const pt = buf[1] & 0x7f;
  const marker = (buf[1] >> 7) & 0x1;
  const seq = buf.readUInt16BE(2);
  const ts = buf.readUInt32BE(4);
  const ssrc = buf.readUInt32BE(8);
  return { version, pt, marker, seq, ts, ssrc };
}

async function probe(name: string, codecArgs: string[]): Promise<void> {
  const sock = dgram.createSocket("udp4");
  const stat: RtpStat = { packets: 0, bytes: 0, payloadTypes: new Set(), ssrcs: new Set(), firstSeq: null, lastSeq: null };
  let firstHeader: ReturnType<typeof parseFirst> | null = null;

  sock.on("message", (msg) => {
    if (msg.length < 12) return; // not an RTP packet
    const h = parseFirst(msg);
    if (h.version !== 2) return;
    if (!firstHeader) firstHeader = h;
    stat.packets++;
    stat.bytes += msg.length;
    stat.payloadTypes.add(h.pt);
    stat.ssrcs.add(h.ssrc);
    if (stat.firstSeq === null) stat.firstSeq = h.seq;
    stat.lastSeq = h.seq;
  });

  const port: number = await new Promise((res) => sock.bind(0, "127.0.0.1", () => res(sock.address().port)));

  const argv = [
    "-hide_banner", "-y",
    "-re", "-i", "pipe:0",
    ...codecArgs,
    "-flags", "+global_header",
    "-f", "rtp", `rtp://127.0.0.1:${port}?rtcpport=${port}`,
  ];

  let stderr = "";
  const ff = spawn(FFMPEG, argv, { stdio: ["pipe", "ignore", "pipe"] });
  ff.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  ff.stdin.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code !== "EPIPE") stderr += `\n[stdin] ${e.message}`;
  });

  // Feed the CURRENT bridge input: streaming WAV (header + amplified PCM frames).
  const pcm = amplifyPcm(synthSine(), GAIN);
  (async () => {
    ff.stdin.write(wavHeader(SR, WAV_STREAM_DATA_SIZE));
    const frame = Math.floor(SR * (FRAME_MS / 1000)) * 2;
    for (let i = 0; i < pcm.length; i += frame) {
      ff.stdin.write(pcm.subarray(i, i + frame));
      await delay(FRAME_MS);
    }
    ff.stdin.end();
  })().catch(() => {});

  const code: number | null = await new Promise((res) => ff.on("exit", (c) => res(c)));
  await delay(150); // drain any last datagrams
  sock.close();

  const expectedPcmuPt = 0;
  const ptList = [...stat.payloadTypes];
  console.log(`\n── ${name} ──────────────────────────────────────`);
  console.log(`argv: ffmpeg ${argv.join(" ")}`);
  console.log(`ffmpeg exit: ${code}`);
  console.log(`RTP packets received: ${stat.packets}  (${stat.bytes} bytes total)`);
  console.log(`payload types: [${ptList.join(", ")}]   ssrcs: [${[...stat.ssrcs].map((s) => s.toString(16)).join(", ")}]`);
  if (firstHeader) {
    const h = firstHeader as ReturnType<typeof parseFirst>;
    console.log(`first packet: v${h.version} pt=${h.pt} seq=${h.seq} ts=${h.ts} ssrc=0x${h.ssrc.toString(16)}`);
  }
  console.log(`seq range: ${stat.firstSeq} → ${stat.lastSeq}`);
  const verdict = code === 0 && stat.packets > 0 ? "PASS" : "FAIL";
  console.log(`verdict: ${verdict}${name.startsWith("pcmu") && ptList.length && !ptList.includes(expectedPcmuPt) ? "  ⚠ pcmu PT != 0" : ""}`);
  const tail = stderr.slice(-600).trim();
  if (tail) console.log(`stderr tail:\n${tail}`);
}

async function main() {
  console.log("════════════ Door return-audio RTP probe (no Ring) ════════════");
  console.log(`ffmpeg: ${FFMPEG}`);
  console.log(`feed:   synth 440Hz sine ×${GAIN}, streaming WAV (current bridge format)`);

  await probe("pcmu_8k", ["-acodec", "pcm_mulaw", "-ac", "1", "-ar", "8000"]);
  await probe("opus_48k_stereo", ["-acodec", "libopus", "-ac", "2", "-ar", "48000"]);

  console.log("\nInterpretation:");
  console.log(" • PASS on both  → ffmpeg RTP output is fine. Silence is in werift→Ring");
  console.log("   delivery (writeRtp / codec negotiation / missing activateCameraSpeaker).");
  console.log(" • FAIL on opus  → the opus return branch is broken at the RTP stage.");
}

main().catch((e) => {
  console.error("rtp probe crashed:", e);
  process.exit(1);
});
