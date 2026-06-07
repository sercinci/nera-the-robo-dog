/**
 * Fallback skill: used when the visitor asks for something we can't find,
 * or when they are stuck after clarifying questions.
 */
import { z } from "zod";
import type { Skill, MatchResult } from "@nera/contracts";

const Args = z.object({});

export const humanFallback: Skill<z.infer<typeof Args>, MatchResult> = {
  name: "human_fallback",
  description:
    "Trigger this when the visitor asks for someone or somewhere that cannot be found after one clarifying question, " +
    "or if they ask for something completely out of scope or requiring a physical action. " +
    "This alerts a human staff member to assist the visitor.",
  parameters: Args,

  async handler(args, ctx) {
    ctx.log("human_fallback");
    return {
      destinationId: null,
      confidence: 1.0, // We are 100% confident they need a human.
      via: {
        matchedAlias: "human_fallback",
      },
      status: "resolved", // From the tool's perspective, this terminates the routing.
    };
  },
};
