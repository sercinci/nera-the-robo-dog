import { describe, it, expect } from "vitest";
import { pcmToWav } from "./wav.js";

describe("pcmToWav", () => {
  it("prepends a 44-byte header sized to the PCM payload", () => {
    const pcm = Buffer.alloc(320); // 160 samples of 16-bit mono
    const wav = pcmToWav(pcm, 16000);
    expect(wav.length).toBe(44 + 320);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
  });

  it("writes correct fmt fields (mono, 16-bit, sample rate) and data size", () => {
    const wav = pcmToWav(Buffer.alloc(320), 16000);
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt32LE(24)).toBe(16000); // sample rate
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.readUInt32LE(40)).toBe(320); // data chunk size
    expect(wav.readUInt32LE(4)).toBe(36 + 320); // RIFF chunk size
  });
});
