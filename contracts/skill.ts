/**
 * Skill contract — the boundary between the agent RUNTIME (spine team) and the
 * SKILLS (skills team author these under skills/).
 *
 * Design rule: a skill IDENTIFIES a destination (returns an id). It does NOT decide
 * what to show on screen or what to say. The orchestrator does that deterministically
 * via projection.ts. This keeps matching (fuzzy/LLM) separate from presentation.
 */
import { z } from "zod";
import type { DirectoryEntry, Person, MatchVia, Candidate } from "./contracts.js";

/** What a "resolve"-type skill returns — destination is just an id here. */
export interface MatchResult {
  /** DirectoryEntry.id, or null when nothing matched. */
  destinationId: string | null;
  /** How the match was reached (person/event/alias) — feeds reply + screen subtitle. */
  via?: MatchVia;
  /** 0..1. The orchestrator uses this for a confidence floor before acting. */
  confidence: number;
  /** When >1, status becomes "ambiguous" and the orchestrator runs ONE clarify turn. */
  candidates?: Candidate[];
}

/** Everything a skill may touch. The orchestrator builds this per call. */
export interface SkillCtx {
  /** Loaded + validated directory.json. */
  directory: DirectoryEntry[];
  /** Loaded + validated people.json. */
  people: Person[];
  /** The live turn. */
  session: { id: string; transcript: string };
  /** Stamp a latency checkpoint (shows up in the Timings block / REPORT.md).
   *  Optional `detail` is for structured debug context (ignored by the timer). */
  log: (stage: string, detail?: unknown) => void;
}

/**
 * An LLM-callable tool. Author one per file under skills/, then add it to
 * skills/registry.ts. `parameters` is the arg schema the model fills; it is
 * validated before `handler` runs, so handlers can trust their args.
 */
export interface Skill<Args = unknown, Result = unknown> {
  name: string; // snake_case, shown to the model: "find_person"
  description: string; // WHEN to use it — the model routes on this. Be concrete.
  parameters: z.ZodType<Args>;
  handler(args: Args, ctx: SkillCtx): Promise<Result>;
}

export type AnySkill = Skill<any, any>;
