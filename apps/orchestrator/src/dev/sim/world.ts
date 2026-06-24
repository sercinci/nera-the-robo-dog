/**
 * Simulated "world" for offline concierge scenarios.
 *
 * We do NOT touch the canonical data/ files. Instead we overlay a deterministic
 * CALENDAR (event times) + APPOINTMENTS (person -> event FK) + ATTENDANCE
 * (who is physically in the building today) on top of the real directory/people.
 *
 * Attendance is modelled with the existing, read-only contract field `locatedAt`:
 *   locatedAt != null  ->  person is in the building (and that's their location)
 *   locatedAt == null  ->  not in today  (find_person returns destinationId: null)
 *
 * All timestamps are explicit Europe/Vienna (CEST, +02:00 in June) per the repo
 * convention — never assumed UTC.
 */
import type { BuildingData } from "../../data.js";

/** Fixed simulation clock. Deterministic — parsed from a literal, never Date.now(). */
export const SIM_NOW_ISO = "2026-06-16T10:00:00+02:00";
export const SIM_NOW_MS = Date.parse(SIM_NOW_ISO);

/** Today's calendar: event id -> time window (+ optional host). Vienna time. */
export const CALENDAR: Record<string, { startsAt: string; endsAt: string; host?: string }> = {
  "evt-003": { startsAt: "2026-06-16T09:30:00+02:00", endsAt: "2026-06-16T11:00:00+02:00", host: "alexander-s" }, // Investor breakfast — ACTIVE at 10:00
  "evt-004": { startsAt: "2026-06-16T10:00:00+02:00", endsAt: "2026-06-16T12:00:00+02:00", host: "tobias-g" },   // AI & ML workshop — starts at 10:00
  "evt-002": { startsAt: "2026-06-16T17:00:00+02:00", endsAt: "2026-06-16T19:00:00+02:00", host: "markus-h" },   // Robotics meetup — this evening (far from 10:00)
  "evt-001": { startsAt: "2026-06-16T08:00:00+02:00", endsAt: "2026-06-16T20:00:00+02:00" },                      // StartHack — all day
  "evt-005": { startsAt: "2026-06-16T12:00:00+02:00", endsAt: "2026-06-16T13:00:00+02:00" },                      // Community lunch — midday
};

/** Expected visitors: person id -> the event they're here for (Person.event FK). */
export const APPOINTMENTS: Record<string, string> = {
  "jonas-b": "evt-003", // investor, breakfast — valid window at 10:00
  "tobias-g": "evt-004", // AI lead, workshop — starts 10:00
  "markus-h": "evt-002", // robotics engineer, meetup at 17:00 — outside window in the morning
};

/** People who are NOT in the building today (locatedAt forced to null). */
export const ABSENT: readonly string[] = ["gabriela-n"];

export interface World {
  directory: BuildingData["directory"];
  people: BuildingData["people"];
}

/** Build the default simulated world from the real (validated) base data. */
export function buildWorld(base: BuildingData): World {
  const directory = base.directory.map((e) => {
    const cal = CALENDAR[e.id];
    return cal ? { ...e, startsAt: cal.startsAt, endsAt: cal.endsAt, host: cal.host ?? e.host } : { ...e };
  });
  const people = base.people.map((p) => ({
    ...p,
    event: APPOINTMENTS[p.id] ?? p.event,
    locatedAt: ABSENT.includes(p.id) ? null : p.locatedAt,
  }));
  return { directory, people };
}

/** Human-readable summary of the world state, for the log header. */
export function describeWorld(w: World): string[] {
  const lines: string[] = [];
  lines.push(`SIM clock: ${SIM_NOW_ISO}`);
  lines.push("Calendar (events today):");
  for (const e of w.directory.filter((d) => d.kind === "event" && d.startsAt)) {
    const appt = w.people.find((p) => p.event === e.id);
    const who = appt ? ` · expecting ${appt.name}` : "";
    lines.push(`  - ${e.label}: ${hhmm(e.startsAt!)}–${hhmm(e.endsAt!)}${who}`);
  }
  lines.push("Attendance:");
  const present = w.people.filter((p) => p.locatedAt).map((p) => p.name);
  const absent = w.people.filter((p) => !p.locatedAt).map((p) => p.name);
  lines.push(`  - present (${present.length}): ${present.join(", ")}`);
  lines.push(`  - NOT in today (${absent.length}): ${absent.join(", ") || "—"}`);
  return lines;
}

/** "2026-06-16T09:30:00+02:00" -> "09:30" (Vienna wall clock). */
export function hhmm(iso: string): string {
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : iso;
}
