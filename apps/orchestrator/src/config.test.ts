import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies defaults when env is empty", () => {
    const c = loadConfig({});
    expect(c.port).toBe(8787);
    expect(c.openrouterModel).toBe("openai/gpt-4o-mini");
    expect(c.sttCommitSilenceMs).toBe(800);
    expect(c.sttVadThreshold).toBe(0.5);
    expect(c.sttMinSpeechMs).toBe(300);
  });

  it("coerces numeric env vars", () => {
    const c = loadConfig({ PORT: "9001", STT_COMMIT_SILENCE_MS: "250" });
    expect(c.port).toBe(9001);
    expect(c.sttCommitSilenceMs).toBe(250);
  });

  it("passes through optional credentials", () => {
    const c = loadConfig({ ELEVENLABS_API_KEY: "el-key", OPENROUTER_API_KEY: "or-key" });
    expect(c.elevenLabsApiKey).toBe("el-key");
    expect(c.openrouterApiKey).toBe("or-key");
  });
});
