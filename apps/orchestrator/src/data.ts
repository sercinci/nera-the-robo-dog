/**
 * Loads + validates the building directory and person DB against the Zod
 * contracts. Invalid data fails loudly with the offending path.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DirectoryFile, PeopleFile, type DirectoryEntry, type Person } from "@nera/contracts";

export interface BuildingData {
  directory: DirectoryEntry[];
  people: Person[];
}

async function readJson(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`Cannot read data file: ${path} (${(err as Error).message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${path}: ${(err as Error).message}`);
  }
}

export async function loadData(dataDir: string): Promise<BuildingData> {
  const [dirRaw, peopleRaw] = await Promise.all([
    readJson(join(dataDir, "directory.json")),
    readJson(join(dataDir, "people.json")),
  ]);

  const directory = DirectoryFile.parse(dirRaw);
  const people = PeopleFile.parse(peopleRaw);
  return { directory, people };
}
