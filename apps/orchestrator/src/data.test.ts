import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadData } from "./data.js";

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data");

describe("loadData", () => {
  it("loads and validates the seed directory + people", async () => {
    const data = await loadData(dataDir);
    expect(data.directory.find((e) => e.id === "room-robotics")).toBeTruthy();
    expect(data.people.find((p) => p.id === "gabriela-n")).toBeTruthy();
  });

  it("throws a clear error when a file is invalid", async () => {
    await expect(loadData("/no/such/dir")).rejects.toThrow();
  });
});
