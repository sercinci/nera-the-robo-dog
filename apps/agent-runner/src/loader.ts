// © Gerald Pögl / Hunter-ID MemoryBlock BG FlexCo (FN 658892i)
//
// loader.ts — loads data files + system prompt from disk.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DirectoryFile, PeopleFile } from "../../../contracts/contracts.js";

const root = resolve(new URL(".", import.meta.url).pathname, "../../..");

function path(envKey: string, fallback: string): string {
  return resolve(root, process.env[envKey] ?? fallback);
}

export function loadDirectory() {
  const raw = JSON.parse(readFileSync(path("DIRECTORY_PATH", "data/directory.json"), "utf8"));
  return DirectoryFile.parse(raw);
}

export function loadPeople() {
  const raw = JSON.parse(readFileSync(path("PEOPLE_PATH", "data/people.json"), "utf8"));
  return PeopleFile.parse(raw);
}

export function loadSystemPrompt(): string {
  return readFileSync(path("INSTRUCTIONS_PATH", "skills/instructions.md"), "utf8");
}
