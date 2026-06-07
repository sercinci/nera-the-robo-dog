/**
 * Door return-audio diagnostics — multi-hypothesis test set.
 *
 * Reproduces the EXACT ffmpeg leg of the broken door path (`transcodeReturnAudio`)
 * OFFLINE, without Ring hardware, using the SAME bundled ffmpeg binary as
 * production (`ffmpeg-for-homebridge`, via @homebridge/camera-utils). It runs
 * several input variants so we don't bet on a single hypothesis, and LOGS every
 * case: argv, exit code, ffmpeg stderr, output bytes + derived duration.
 *
 * Why this exists: in production the ffmpeg stderr for the return path is routed
 * to the ring fork's `debug('ring')` logger and is SILENT unless DEBUG=ring. And
 * the fork's exitCallback fires `onFinished()` on ANY exit (even a crash), so a
 * failing ffmpeg looks like a clean "✓ finished speaking". Here we capture the
 * stderr and measure the actual output, so the failure is visible.
 *
 * What each case answers:
 *   A streaming-wav + -re   -> the CURRENT door-bridge behaviour
 *   B streaming-wav, no -re -> is `-re` (read-at-native-rate) the culprit?
 *   C finite-wav            -> fix candidate: complete WAV buffer, real data size
 *   D raw-pcm + explicit fmt-> robust alt: no container sniffing at all
 *   E mp3 (complete)        -> the proven-working baseline (door-talkback-test)
 *   R rate-sweep            -> Hypothesis D: is the agent PCM actually 16 kHz?
 *
 * Run:  pnpm -F @nera/orchestrator exec tsx src/dev/door-diag.ts
 * Opt:  DIAG_INPUT=C:\path\to\real-agent.wav  (feed real captured agent audio
 *        instead of a synth tone; if a .wav, its 44-byte header is stripped and
 *        it is treated as the door feed AS-IS, i.e. not re-amplified.)
 */
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { amplifyPcm, pcmToWav, wavHeader, WAV_STREAM_DATA_SIZE } from "../audio/wav.js";

const SR = 16000; // door-bridge assumes the agent emits PCM s16le @ 16 kHz
const GAIN = 3; // matches DOOR_GAIN in door-bridge.ts
const DURATION_S = 3;
const FRAME_MS = 100; // simulate the agent streaming ~100 ms chunks
const OUT_DIR = join(tmpdir(), "nera-door-diag");

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// ffmpeg resolution — mirror @homebridge/camera-utils' defaultFfmpegPath so the
// diagnostic uses the exact binary production uses.
// ---------------------------------------------------------------------------
function resolveFfmpeg(): string {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  // Walk up from this file to find the pnpm virtual store, then the bundled binary.
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
  return "ffmpeg"; // last resort: PATH
}

const FFMPEG = resolveFfmpeg();

// ---------------------------------------------------------------------------
// Test signal
// ---------------------------------------------------------------------------
function synthSine(freq = 440, secs = DURATION_S, amp = 8000): Buffer {
  const n = SR * secs;
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * freq * i) / SR)), i * 2);
  }
  return b;
}

/** The PCM the door would actually receive (amplified s16le @ 16 kHz). */
function loadFeedPcm(): { pcm: Buffer; source: string; preAmplified: boolean } {
  const inPath = process.env.DIAG_INPUT;
  if (inPath && existsSync(inPath)) {
    const raw = readFileSync(inPath);
    const isWav = raw.length > 44 && raw.toString("ascii", 0, 4) === "RIFF";
    const pcm = isWav ? raw.subarray(44) : raw;
    // A real capture (e.g. the /tmp/nera-door-last.wav dump) is already the
    // boosted door feed — use as-is, don't double-amplify.
    return { pcm, source: `${inPath} (${isWav ? "wav→pcm" : "raw pcm"})`, preAmplified: true };
  }
  return { pcm: amplifyPcm(synthSine(), GAIN), source: "synth 440Hz sine, amplified ×3", preAmplified: false };
}

// ---------------------------------------------------------------------------
// ffmpeg case runner
// ---------------------------------------------------------------------------
interface CaseResult {
  name: string;
  argv: string[];
  exitCode: number | null;
  signal: string | null;
  wallMs: number;
  firstStderrMs: number | null;
  outListenBytes: number;
  outMulawBytes: number;
  derivedSecs: number;
  stderrTail: string;
  verdict: "PASS" | "FAIL";
  note: string;
}

async function runCase(
  name: string,
  inputArgs: string[],
  produce: (stdin: NodeJS.WritableStream) => Promise<void>,
): Promise<CaseResult> {
  const outListen = join(OUT_DIR, `${name}__pcm16k.wav`); // listenable
  const outMulaw = join(OUT_DIR, `${name}__mulaw8k.wav`); // what Ring would encode
  const argv = [
    "-hide_banner",
    "-y",
    ...inputArgs,
    "-map", "0:a?", "-c:a", "pcm_mulaw", "-ar", "8000", "-ac", "1", "-f", "wav", outMulaw,
    "-map", "0:a?", "-c:a", "pcm_s16le", "-ar", "16000", "-ac", "1", "-f", "wav", outListen,
  ];

  const t0 = Date.now();
  let firstStderrMs: number | null = null;
  let stderr = "";

  const child = spawn(FFMPEG, argv, { stdio: ["pipe", "ignore", "pipe"] });
  child.stderr.on("data", (d: Buffer) => {
    if (firstStderrMs === null) firstStderrMs = Date.now() - t0;
    stderr += d.toString();
  });
  child.stdin.on("error", (e: NodeJS.ErrnoException) => {
    // ffmpeg may close stdin early on a parse error -> EPIPE. Mirror prod (ignored).
    if (e.code !== "EPIPE") stderr += `\n[stdin error] ${e.message}`;
  });

  // Feed the input (may resolve before/after ffmpeg exits).
  const produced = produce(child.stdin).catch((e) => {
    stderr += `\n[producer error] ${(e as Error).message}`;
  });

  const { code, signal } = await new Promise<{ code: number | null; signal: string | null }>(
    (res) => child.on("exit", (code, signal) => res({ code, signal })),
  );
  await produced;
  const wallMs = Date.now() - t0;

  const sizeOf = (p: string) => (existsSync(p) ? statSync(p).size : 0);
  const outListenBytes = sizeOf(outListen);
  const outMulawBytes = sizeOf(outMulaw);
  const derivedSecs = Math.max(0, (outListenBytes - 44) / (SR * 2));

  const lo = DURATION_S * 0.6;
  const hi = DURATION_S * 1.4;
  let verdict: "PASS" | "FAIL" = "PASS";
  let note = "ok";
  if (code !== 0) {
    verdict = "FAIL";
    note = `ffmpeg exit code ${code}`;
  } else if (outListenBytes <= 44) {
    verdict = "FAIL";
    note = "no audio produced (empty output)";
  } else if (derivedSecs < lo || derivedSecs > hi) {
    verdict = "FAIL";
    note = `duration ${derivedSecs.toFixed(2)}s outside [${lo}-${hi}]s (rate/format mismatch?)`;
  }

  return {
    name,
    argv,
    exitCode: code,
    signal,
    wallMs,
    firstStderrMs,
    outListenBytes,
    outMulawBytes,
    derivedSecs,
    stderrTail: stderr.slice(-1400).trim(),
    verdict,
    note,
  };
}

// ---------------------------------------------------------------------------
// Input producers
// ---------------------------------------------------------------------------
async function writeStreaming(
  stdin: NodeJS.WritableStream,
  header: Buffer | null,
  pcm: Buffer,
): Promise<void> {
  if (header) stdin.write(header);
  const frameBytes = Math.floor(SR * (FRAME_MS / 1000)) * 2;
  for (let i = 0; i < pcm.length; i += frameBytes) {
    stdin.write(pcm.subarray(i, i + frameBytes));
    await delay(FRAME_MS);
  }
  stdin.end();
}

function writeWhole(stdin: NodeJS.WritableStream, buf: Buffer): Promise<void> {
  stdin.end(buf);
  return Promise.resolve();
}

/** Encode amplified PCM to an mp3 buffer (the proven talk-back format). */
function pcmToMp3(pcm: Buffer): Promise<Buffer> {
  return new Promise((res, rej) => {
    const ff = spawn(
      FFMPEG,
      ["-hide_banner", "-f", "s16le", "-ar", String(SR), "-ac", "1", "-i", "pipe:0", "-c:a", "libmp3lame", "-f", "mp3", "pipe:1"],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    const chunks: Buffer[] = [];
    ff.stdout.on("data", (d: Buffer) => chunks.push(d));
    ff.on("exit", (c) => (c === 0 ? res(Buffer.concat(chunks)) : rej(new Error(`mp3 encode exit ${c}`))));
    ff.stdin.on("error", () => {});
    ff.stdin.end(pcm);
  });
}

// ---------------------------------------------------------------------------
// Rate sweep (Hypothesis D): render the SAME agent PCM under several assumed
// sample rates. Whichever sounds natural reveals the agent's true output rate.
// If 16 kHz sounds slow/deep, the door's 16 kHz WAV header is wrong.
// ---------------------------------------------------------------------------
function rateSweep(feedPcm: Buffer): { rate: number; path: string; bytes: number }[] {
  const rates = [8000, 16000, 22050, 24000, 44100, 48000];
  return rates.map((rate) => {
    const path = join(OUT_DIR, `R_rate-as-${rate}.wav`);
    writeFileSync(path, pcmToWav(feedPcm, rate));
    return { rate, path, bytes: statSync(path).size };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const feed = loadFeedPcm();
  const pcm = feed.pcm;

  console.log("════════════════════════════════════════════════════════════════");
  console.log(" Nera door return-audio diagnostics");
  console.log("════════════════════════════════════════════════════════════════");
  console.log(` ffmpeg:   ${FFMPEG}`);
  console.log(` out dir:  ${OUT_DIR}`);
  console.log(` feed:     ${feed.source} (${pcm.length} bytes pcm, pre-amplified=${feed.preAmplified})`);
  console.log(` assumed:  s16le mono @ ${SR} Hz, gain ×${GAIN}, ~${DURATION_S}s frames@${FRAME_MS}ms`);
  console.log("────────────────────────────────────────────────────────────────");

  console.log("\n[mp3 baseline] encoding amplified PCM → mp3 …");
  let mp3: Buffer | null = null;
  try {
    mp3 = await pcmToMp3(pcm);
    console.log(`  ok: ${mp3.length} bytes mp3`);
  } catch (e) {
    console.log(`  FAILED to build mp3 baseline: ${(e as Error).message}`);
  }

  const cases: { name: string; inputArgs: string[]; produce: (s: NodeJS.WritableStream) => Promise<void> }[] = [
    {
      name: "A_streaming_wav_re",
      inputArgs: ["-re", "-i", "pipe:0"],
      produce: (s) => writeStreaming(s, wavHeader(SR, WAV_STREAM_DATA_SIZE), pcm),
    },
    {
      name: "B_streaming_wav_no_re",
      inputArgs: ["-i", "pipe:0"],
      produce: (s) => writeStreaming(s, wavHeader(SR, WAV_STREAM_DATA_SIZE), pcm),
    },
    {
      name: "C_finite_wav_re",
      inputArgs: ["-re", "-i", "pipe:0"],
      produce: (s) => writeWhole(s, pcmToWav(pcm, SR)),
    },
    {
      name: "D_raw_pcm_explicit_re",
      inputArgs: ["-re", "-f", "s16le", "-ar", String(SR), "-ac", "1", "-i", "pipe:0"],
      produce: (s) => writeStreaming(s, null, pcm),
    },
  ];
  if (mp3) {
    const mp3Buf = mp3;
    cases.push({
      name: "E_mp3_whole_re",
      inputArgs: ["-re", "-i", "pipe:0"],
      produce: (s) => writeWhole(s, mp3Buf),
    });
  }

  const results: CaseResult[] = [];
  for (const c of cases) {
    process.stdout.write(`\n▶ ${c.name} … `);
    try {
      const r = await runCase(c.name, c.inputArgs, c.produce);
      results.push(r);
      console.log(`${r.verdict}  (exit ${r.exitCode}, ${r.derivedSecs.toFixed(2)}s out, ${r.wallMs}ms)`);
    } catch (e) {
      console.log(`THREW: ${(e as Error).message}`);
    }
  }

  // Rate sweep
  console.log("\n[rate sweep] rendering feed PCM under assumed rates (listen to find the right one):");
  const sweep = rateSweep(pcm);
  for (const s of sweep) {
    console.log(`  ${String(s.rate).padStart(6)} Hz → ${s.path} (${s.bytes} B)`);
  }

  // Summary
  console.log("\n════════════════════════ SUMMARY ════════════════════════");
  console.log("case                      verdict  exit  out(s)  1st-stderr  note");
  console.log("──────────────────────────────────────────────────────────────");
  for (const r of results) {
    console.log(
      `${r.name.padEnd(24)}  ${r.verdict.padEnd(6)}  ${String(r.exitCode).padStart(4)}  ` +
        `${r.derivedSecs.toFixed(2).padStart(5)}  ${String(r.firstStderrMs ?? "-").padStart(9)}  ${r.note}`,
    );
  }
  console.log("──────────────────────────────────────────────────────────────");
  console.log("Per-case ffmpeg stderr tails:");
  for (const r of results) {
    console.log(`\n── ${r.name} (verdict ${r.verdict}) ─────────────────────────`);
    console.log(`argv: ${["ffmpeg", ...r.argv].join(" ")}`);
    console.log(r.stderrTail || "(no stderr captured)");
  }

  const summaryPath = join(OUT_DIR, "summary.json");
  writeFileSync(summaryPath, JSON.stringify({ ffmpeg: FFMPEG, feed: feed.source, results, sweep }, null, 2));
  console.log(`\nFull machine-readable log: ${summaryPath}`);
  console.log("Listen to *__pcm16k.wav (per case) and R_rate-as-*.wav (rate sweep).");
}

main().catch((e) => {
  console.error("door-diag crashed:", e);
  process.exit(1);
});
