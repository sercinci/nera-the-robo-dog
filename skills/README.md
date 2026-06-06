# Authoring skills

A **skill** is one LLM-callable tool. The agent picks a skill based on its `name` +
`description`, fills the `parameters`, and the orchestrator runs the `handler`. A skill's
job is to **identify a destination** (return an id) — it does *not* render screens or
write speech (the orchestrator does that via `contracts/projection.ts`).

## Anatomy

```ts
import { z } from "zod";
import type { Skill, MatchResult } from "../contracts/skill.js";

const Args = z.object({ query: z.string().describe("...") });

export const mySkill: Skill<z.infer<typeof Args>, MatchResult> = {
  name: "my_skill",                 // snake_case, shown to the model
  description: "When to use it — be concrete; the model routes on this.",
  parameters: Args,                 // validated before handler runs
  async handler(args, ctx) {
    ctx.log("my_skill");            // stamps a latency checkpoint
    // ...use ctx.directory / ctx.people...
    return { destinationId: "robotics-club", confidence: 0.95 };
  },
};
```

Then register it in [`registry.ts`](registry.ts).

## The `MatchResult` you return

| field           | meaning                                                              |
| --------------- | -------------------------------------------------------------------- |
| `destinationId` | a `directory.json` id, or `null` for no match.                       |
| `confidence`    | 0..1. Below the orchestrator's floor → treated as no match.          |
| `via`           | how you matched (`{ person, event, matchedAlias }`) — feeds reply.   |
| `candidates`    | return **2+** of these to trigger one clarify turn (ambiguous case). |

## What `ctx` gives you

- `ctx.directory`, `ctx.people` — the loaded, validated data files.
- `ctx.session` — `{ id, transcript }` for the current turn.
- `ctx.log(stage)` — stamp a latency checkpoint (shows in the report).

## Rules

- **Identify, don't present.** Return an id; never build screen content or phrasing.
- **Never invent ids.** Only return ids that exist in `directory.json`.
- Keep handlers fast and synchronous-ish — they're on the critical path.
- Add the skill to `registry.ts` or it won't be registered with the model.

## Current skills

- `find_place` — room / zone / event by name or alias.
- `find_person` — person by name/nickname → their location.

The agent's system prompt + guardrails live in [`instructions.md`](instructions.md).
