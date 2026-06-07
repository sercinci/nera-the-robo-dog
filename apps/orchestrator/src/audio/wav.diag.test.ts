/**
 * Diagnostic unit tests for the door audio helpers (wav.ts).
 *
 * These don't just assert correctness — they LOG the facts we need for the door
 * silence investigation: is the streaming WAV header actually well-formed, and
 * how aggressively does the ×3 door gain clip a realistic agent signal?
 *
 * Run only these:  pnpm -F @nera/orchestrator exec vitest run src/audio/wav.diag.test.ts
 */
import { describe, expect, it } from "vitest";
import { amplifyPcm, pcmToWav, wavHeader, WAV_STREAM_DATA_SIZE } from "./wav.js";

const SR = 16000;

function parseHeader(h: Buffer) {
  return {
    riff: h.toString("ascii", 0, 4),
    riffSize: h.readUInt32LE(4),
    wave: h.toString("ascii", 8, 12),
    fmt: h.toString("ascii", 12, 16),
    fmtSize: h.readUInt32LE(16),
    audioFormat: h.readUInt16LE(20),
    channels: h.readUInt16LE(22),
    sampleRate: h.readUInt32LE(24),
    byteRate: h.readUInt32LE(28),
    blockAlign: h.readUInt16LE(32),
    bitDepth: h.readUInt16LE(34),
    dataTag: h.toString("ascii", 36, 40),
    dataSize: h.readUInt32LE(40),
  };
}

describe("wav header — streaming (the door-bridge path)", () => {
  it("is a structurally valid 44-byte PCM WAV header", () => {
    const h = wavHeader(SR, WAV_STREAM_DATA_SIZE);
    const p = parseHeader(h);
    console.log("[streaming header]", JSON.stringify(p, null, 2));

    expect(h.length).toBe(44);
    expect(p.riff).toBe("RIFF");
    expect(p.wave).toBe("WAVE");
    expect(p.fmt).toBe("fmt ");
    expect(p.audioFormat).toBe(1); // PCM
    expect(p.channels).toBe(1);
    expect(p.sampleRate).toBe(SR);
    expect(p.byteRate).toBe(SR * 2);
    expect(p.blockAlign).toBe(2);
    expect(p.bitDepth).toBe(16);
    expect(p.dataTag).toBe("data");
  });

  it("declares the 0x7FFFFFFF placeholder data size + clamped RIFF size", () => {
    const p = parseHeader(wavHeader(SR, WAV_STREAM_DATA_SIZE));
    console.log(`[streaming header] dataSize=0x${p.dataSize.toString(16)} riffSize=0x${p.riffSize.toString(16)}`);
    // This is the value ffmpeg sees for a live stream. It reads to EOF on a pipe,
    // but a wrong/huge size can confuse a strict WAV demuxer — flagged for review.
    // NOTE: riffSize is ~2 GB (0x80000023), NOT clamped — 36 + 0x7FFFFFFF stays
    // under the uint32 max, so the clamp in wavHeader() never triggers here.
    expect(p.dataSize).toBe(0x7fffffff);
    expect(p.riffSize).toBe(36 + 0x7fffffff); // 0x80000023, ~2 GB
  });
});

describe("wav header — finite (fix candidate)", () => {
  it("declares the exact data size for a complete buffer", () => {
    const pcm = Buffer.alloc(SR * 2 * 2); // 2 s of silence
    const wav = pcmToWav(pcm, SR);
    const p = parseHeader(wav.subarray(0, 44));
    console.log(`[finite header] dataSize=${p.dataSize} (pcm=${pcm.length}) riffSize=${p.riffSize}`);
    expect(p.dataSize).toBe(pcm.length);
    expect(p.riffSize).toBe(36 + pcm.length);
    expect(wav.length).toBe(44 + pcm.length);
  });
});

describe("amplifyPcm — the ×3 door gain", () => {
  function clipStats(amp: number, gain: number) {
    const n = SR; // 1 s
    const pcm = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      pcm.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * 440 * i) / SR)), i * 2);
    }
    const out = amplifyPcm(pcm, gain);
    let clipped = 0;
    let peak = 0;
    for (let i = 0; i < out.length; i += 2) {
      const s = out.readInt16LE(i);
      if (s >= 32767 || s <= -32768) clipped++;
      peak = Math.max(peak, Math.abs(s));
    }
    return { clippedPct: (100 * clipped) / n, peak };
  }

  it("gain=1 returns the input untouched", () => {
    const pcm = Buffer.from([0x10, 0x20, 0x30, 0x40]);
    expect(amplifyPcm(pcm, 1).equals(pcm)).toBe(true);
  });

  it("logs clipping at ×3 for quiet / moderate / loud signals", () => {
    for (const amp of [4000, 8000, 12000, 20000]) {
      const s = clipStats(amp, GAIN_3());
      console.log(
        `[gain×3] input amp ${String(amp).padStart(5)} → peak ${String(s.peak).padStart(5)}, ` +
          `clipped ${s.clippedPct.toFixed(1)}%`,
      );
    }
    // A loud agent signal (amp ~12k+) heavily clips at ×3 — that distorts but is
    // NOT silence. Documents that ×3 alone can't explain a dead speaker.
    expect(clipStats(20000, GAIN_3()).clippedPct).toBeGreaterThan(0);
    expect(clipStats(4000, GAIN_3()).clippedPct).toBe(0);
  });
});

function GAIN_3() {
  return 3; // mirrors DOOR_GAIN in door-bridge.ts
}
