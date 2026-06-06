/**
 * Agent tool plumbing — the deterministic bits, fully testable without an LLM.
 *
 *   toToolSpecs()      skills -> OpenAI function-tool specs (for OpenRouter).
 *   resolveWithSkill() run a chosen skill -> MatchResult -> projected Destination.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  projectDestination,
  type AnySkill,
  type DirectoryEntry,
  type Person,
  type Destination,
} from "@nera/contracts";

export interface DataCtx {
  directory: DirectoryEntry[];
  people: Person[];
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function toToolSpecs(skills: AnySkill[]): ToolSpec[] {
  return skills.map((skill) => {
    const schema = zodToJsonSchema(skill.parameters, { target: "openApi3" }) as Record<string, unknown>;
    delete schema["$schema"];
    return {
      type: "function",
      function: { name: skill.name, description: skill.description, parameters: schema },
    };
  });
}

export interface ResolveMeta {
  sessionId: string;
  transcript: string;
}

/** Execute a skill by name (validating its args), then project to a Destination. */
export async function resolveWithSkill(
  skills: AnySkill[],
  name: string,
  rawArgs: unknown,
  data: DataCtx,
  meta: ResolveMeta,
): Promise<Destination> {
  const skill = skills.find((s) => s.name === name);
  if (!skill) throw new Error(`Unknown skill: ${name}`);

  const args = skill.parameters.parse(rawArgs);
  const match = await skill.handler(args, {
    directory: data.directory,
    people: data.people,
    session: { id: meta.sessionId, transcript: meta.transcript },
    log: () => {},
  });

  return projectDestination(match, { directory: data.directory, people: data.people }, meta);
}

/**
 * Resolve a free-text query to a Destination by trying find_place, then find_person.
 * Used by the ElevenLabs agent's single `show_destination(query)` client tool.
 */
export async function resolveQuery(
  skills: AnySkill[],
  query: string,
  data: DataCtx,
  meta: ResolveMeta,
): Promise<Destination> {
  const place = await resolveWithSkill(skills, "find_place", { query }, data, meta).catch(() => null);
  if (place?.status === "resolved") return place;

  const person = await resolveWithSkill(skills, "find_person", { name: query }, data, meta).catch(
    () => null,
  );
  if (person?.status === "resolved") return person;

  // Neither resolved — prefer an ambiguous result (drives a clarify), else no_match.
  if (person?.status === "ambiguous") return person;
  if (place?.status === "ambiguous") return place;
  return place ?? person ?? noMatchDestination(data, meta);
}

/** A no_match Destination (used when the model resolves nothing). Screen stays populated. */
export function noMatchDestination(data: DataCtx, meta: ResolveMeta): Destination {
  return projectDestination(
    { destinationId: null, confidence: 0 },
    { directory: data.directory, people: data.people },
    meta,
  );
}

/**
 * Render the directory for the ElevenLabs agent's `{{directory}}` dynamic variable.
 * Names + aliases + floor/zone for disambiguation — but NO internal ids (so Nera
 * never reads them aloud). Sourced live from directory.json/people.json.
 */
export function renderDirectoryForAgent(data: DataCtx): string {
  const places = data.directory.map((e) => {
    const loc = e.floor != null ? ` (floor ${e.floor}${e.zone ? `, ${e.zone.replace(/-/g, " ")}` : ""})` : "";
    const aka = e.aliases.length ? ` — also: ${e.aliases.join(", ")}` : "";
    return `- ${e.label}${loc}${aka}`;
  });
  const people = data.people.map((p) => {
    const role = p.role ? ` (${p.role})` : "";
    const aka = p.aliases.length ? ` — also: ${p.aliases.join(", ")}` : "";
    return `- ${p.name}${role}${aka}`;
  });
  return ["Places:", ...places, "", "People:", ...people].join("\n");
}

/** Compose the agent system prompt: authored instructions + the known places/people
 *  so the model can only resolve to things that actually exist. */
export function buildSystemPrompt(instructions: string, data: DataCtx): string {
  const places = data.directory.map(
    (e) => `- ${e.label} [${e.id}]${e.aliases.length ? ` — aka ${e.aliases.join(", ")}` : ""}`,
  );
  const people = data.people.map(
    (p) =>
      `- ${p.name}${p.role ? ` (${p.role})` : ""}${p.aliases.length ? ` — aka ${p.aliases.join(", ")}` : ""}`,
  );
  return [
    instructions.trim(),
    "",
    "## Known places (resolve with find_place)",
    ...places,
    "",
    "## Known people (resolve with find_person)",
    ...people,
  ].join("\n");
}
