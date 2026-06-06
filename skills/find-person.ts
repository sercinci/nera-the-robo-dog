/**
 * Example skill: find a person and resolve to where they are.
 * Pattern to copy for new skills. Returns a MatchResult (id-only).
 */
import { z } from "zod";
import type { Skill, MatchResult } from "../contracts/skill.js";

const Args = z.object({
  name: z.string().describe("The person's name or nickname, exactly as the visitor said it"),
});

export const findPerson: Skill<z.infer<typeof Args>, MatchResult> = {
  name: "find_person",
  description:
    "Find a person in the building by name or nickname and resolve to their location. " +
    "Use when the visitor asks for someone — e.g. 'where is Gabriela?', 'I'm here to see Vlad', 'I have a meeting with the founder'.",
  parameters: Args,

  async handler({ name }, ctx) {
    ctx.log("find_person");
    const q = name.toLowerCase().trim();

    const matches = ctx.people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.aliases.some((a) => a.toLowerCase() === q || q.includes(a.toLowerCase())),
    );

    if (matches.length === 0) {
      return { destinationId: null, confidence: 0 };
    }

    if (matches.length > 1) {
      // Ambiguous -> orchestrator runs one CLARIFY turn using these candidates.
      return {
        destinationId: null,
        confidence: 0.5,
        candidates: matches
          .filter((m) => m.locatedAt)
          .map((m) => ({ destinationId: m.locatedAt!, label: m.name, reason: m.role })),
      };
    }

    const p = matches[0];
    return {
      destinationId: p.locatedAt, // null if we don't know where they are
      via: { person: p.id, matchedAlias: q },
      confidence: p.locatedAt ? 0.95 : 0.3,
    };
  },
};
