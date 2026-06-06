import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { skills } from "@nera/skills";
import { loadData } from "../data.js";
import { toToolSpecs, resolveWithSkill, buildSystemPrompt, noMatchDestination, resolveQuery, renderDirectoryForAgent } from "./tools.js";

// Stable fixture (not the live data/ files) so directory edits never break tests.
const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../__fixtures__");
const meta = { sessionId: "t", transcript: "x" };

describe("toToolSpecs", () => {
  it("converts every skill into an OpenAI function tool", () => {
    const specs = toToolSpecs(skills);
    const names = specs.map((s) => s.function.name);
    expect(names).toContain("find_place");
    expect(names).toContain("find_person");
    const fp = specs.find((s) => s.function.name === "find_place")!;
    expect(fp.type).toBe("function");
    expect((fp.function.parameters as any).properties.query).toBeTruthy();
  });
});

describe("resolveWithSkill (execute + project, no LLM)", () => {
  it("resolves a place to a Destination", async () => {
    const data = await loadData(dataDir);
    const dest = await resolveWithSkill(skills, "find_place", { query: "robotics club" }, data, meta);
    expect(dest.status).toBe("resolved");
    expect(dest.destinationId).toBe("evt-002");
    expect(dest.screen.title).toBeTruthy();
  });

  it("resolves a person to their location, recording the via.person", async () => {
    const data = await loadData(dataDir);
    const dest = await resolveWithSkill(skills, "find_person", { name: "gabriela" }, data, meta);
    expect(dest.status).toBe("resolved");
    expect(dest.destinationId).toBe("room-3C");
    expect(dest.via.person).toBe("gabriela-n");
  });

  it("returns a no_match Destination (never blank screen) for an unknown query", async () => {
    const data = await loadData(dataDir);
    const dest = await resolveWithSkill(skills, "find_place", { query: "the moon" }, data, meta);
    expect(dest.status).toBe("no_match");
    expect(dest.screen.title.length).toBeGreaterThan(0);
  });

  it("throws on an unknown skill name", async () => {
    const data = await loadData(dataDir);
    await expect(resolveWithSkill(skills, "nope", {}, data, meta)).rejects.toThrow();
  });
});

describe("buildSystemPrompt", () => {
  it("includes the base instructions and the known places + people", async () => {
    const data = await loadData(dataDir);
    const p = buildSystemPrompt("BASE_INSTRUCTIONS", data);
    expect(p).toContain("BASE_INSTRUCTIONS");
    expect(p).toContain("Robotics Club");
    expect(p).toContain("Gabriela");
  });
});

describe("resolveQuery (place-or-person, for the EL agent's show_destination tool)", () => {
  it("resolves a place query", async () => {
    const data = await loadData(dataDir);
    const d = await resolveQuery(skills, "robotics club", data, meta);
    expect(d.status).toBe("resolved");
    expect(d.destinationId).toBe("evt-002");
  });

  it("resolves a person query (falls through to find_person)", async () => {
    const data = await loadData(dataDir);
    const d = await resolveQuery(skills, "Gabriela", data, meta);
    expect(d.status).toBe("resolved");
    expect(d.destinationId).toBe("room-3C");
    expect(d.via.person).toBe("gabriela-n");
  });

  it("returns no_match for nonsense", async () => {
    const data = await loadData(dataDir);
    const d = await resolveQuery(skills, "the moon", data, meta);
    expect(d.status).toBe("no_match");
  });
});

describe("renderDirectoryForAgent (dynamic variable for the EL agent)", () => {
  it("lists places + people with names but NOT internal ids", async () => {
    const data = await loadData(dataDir);
    const txt = renderDirectoryForAgent(data);
    expect(txt).toContain("Robotics Club");
    expect(txt).toContain("Gabriela Novak");
    expect(txt).not.toContain("evt-002"); // no internal ids leaked to the voice
    expect(txt).not.toContain("gabriela-n");
  });
});

describe("noMatchDestination", () => {
  it("produces a no_match Destination with a populated screen", async () => {
    const data = await loadData(dataDir);
    const dest = noMatchDestination(data, meta);
    expect(dest.status).toBe("no_match");
    expect(dest.screen.title.length).toBeGreaterThan(0);
  });
});
