// © Gerald Pögl / Hunter-ID MemoryBlock BG FlexCo (FN 658892i)
// HID-PATENT-BUBBLE-V3-2026-04-02-ACTIVE-75EC48-CLO46

import { z } from "zod";
import type { Skill, MatchResult } from "../contracts/skill.js";

const Args = z.object({
  person_id: z.string().describe("The Person.id returned by find_person"),
  now: z.string().datetime({ offset: true }).describe("Current ISO 8601 timestamp with timezone offset"),
});

export const checkAppointment: Skill<z.infer<typeof Args>, MatchResult> = {
  name: "check_appointment",
  description:
    "Validates whether a known visitor has a currently active appointment. " +
    "Call this after find_person returns a match — always, before routing. " +
    "Returns the destination if valid, null if no appointment or outside time window.",
  parameters: Args,

  async handler({ person_id, now }, ctx) {
    ctx.log("check_appointment", { person_id, now });

    // 1. Load person
    const person = ctx.people.find((p) => p.id === person_id);
    if (!person) {
      return { destinationId: null, confidence: 0 };
    }

    // 2. Check event FK
    if (!person.event) {
      return { destinationId: null, confidence: 0 };
    }

    // 3. Load event entry
    const event = ctx.directory.find(
      (d) => d.id === person.event && d.kind === "event"
    );
    if (!event || !event.startsAt || !event.endsAt) {
      return { destinationId: null, confidence: 0 };
    }

    // 4. Check time window: [startsAt - 30min, endsAt + 30min]
    // All timestamps are ISO 8601 with explicit offset (Europe/Vienna = +02:00).
    // Date constructor handles offsets correctly — no external lib needed.
    const THIRTY_MIN_MS = 30 * 60 * 1000;
    const nowMs = new Date(now).getTime();
    const windowStart = new Date(event.startsAt).getTime() - THIRTY_MIN_MS;
    const windowEnd = new Date(event.endsAt).getTime() + THIRTY_MIN_MS;

    if (nowMs < windowStart || nowMs > windowEnd) {
      return { destinationId: null, confidence: 0 };
    }

    // 5. Valid appointment — resolve destination.
    // Include startsAt so the orchestrator can detect early arrivals
    // and trigger a hospitality offer (water/coffee) if wait > 5min.
    const minutesUntilStart = Math.round((new Date(event.startsAt).getTime() - nowMs) / 60000);

    if (person.locatedAt) {
      return {
        destinationId: person.locatedAt,
        confidence: 0.95,
        via: { startsAt: event.startsAt, minutesUntilStart },
      };
    }

    return {
      destinationId: event.id,
      confidence: 0.8,
      via: { startsAt: event.startsAt, minutesUntilStart },
    };
  },
};
