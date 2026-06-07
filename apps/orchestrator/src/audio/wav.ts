/**
 * WAV helpers. The EL agent emits raw PCM (s16le); the door's speak() needs an
 * ffmpeg-sniffable container, so we prepend a WAV header.
 */

/** Large data size for a streaming WAV header (unknown length → ffmpeg reads to EOF). */
export const WAV_STREAM_DATA_SIZE = 0x7fffffff;

/** Build a 44-byte WAV header. For streaming, pass dataSize = WAV_STREAM_DATA_SIZE. */
export function wavHeader(
  sampleRate: number,
  dataSize: number,
  channels = 1,
  bitDepth = 16,
): Buffer {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const riffSize = Math.min(36 + dataSize, 0xffffffff);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(riffSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size (PCM)
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);
  return header;
}

/** Wrap a complete PCM buffer as a finite WAV. */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bitDepth = 16): Buffer {
  return Buffer.concat([wavHeader(sampleRate, pcm.length, channels, bitDepth), pcm]);
}

/** Amplify s16le PCM by `gain` (clamped). The intercom speaker is quiet — the
 *  working talkback mp3 used volume=3.0, so we match that for the door feed. */
export function amplifyPcm(pcm: Buffer, gain: number): Buffer {
  if (gain === 1) return pcm;
  const usable = pcm.length - (pcm.length % 2);
  const out = Buffer.alloc(usable);
  for (let i = 0; i + 1 < usable; i += 2) {
    let s = Math.round(pcm.readInt16LE(i) * gain);
    if (s > 32767) s = 32767;
    else if (s < -32768) s = -32768;
    out.writeInt16LE(s, i);
  }
  return out;
}
