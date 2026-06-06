/**
 * Example skill: match a room / zone / event directly from the directory.
 * The most common path ("where's the robotics club?", "I'm going to the makerspace").
 */
import { z } from "zod";
import type { Skill, MatchResult } from "@nera/contracts";

const Args = z.object({
  query: z.string().describe("The place, room, or event the visitor asked for, as spoken"),
});

export const findPlace: Skill<z.infer<typeof Args>, MatchResult> = {
  name: "find_place",
  description:
    "Find a room, zone, or event in the building and resolve to it. " +
    "Use when the visitor names a destination — e.g. 'the robotics club', 'the makerspace', 'the 5pm meetup', 'the entrance'.",
  parameters: Args,

  async handler({ query }, ctx) {
    ctx.log("find_place");
    const q = query.toLowerCase().trim();

    const score = (e: (typeof ctx.directory)[number]) => {
      const hay = [e.label, ...e.aliases].map((s) => s.toLowerCase());
      if (hay.some((h) => h === q)) return 1.0; // exact
      if (hay.some((h) => q.includes(h) || h.includes(q))) return 0.85; // substring
      return 0;
    };

    const ranked = ctx.directory
      .map((e) => ({ e, s: score(e) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s);

    if (ranked.length === 0) return { destinationId: null, confidence: 0 };

    // Single clear winner, or a tie at the top -> ambiguous.
    const top = ranked[0];
    const tied = ranked.filter((r) => r.s === top.s);
    if (tied.length > 1) {
      return {
        destinationId: null,
        confidence: 0.5,
        candidates: tied.map((r) => ({ destinationId: r.e.id, label: r.e.label })),
      };
    }

    return {
      destinationId: top.e.id,
      via: { matchedAlias: q },
      confidence: top.s,
    };
  },
};
