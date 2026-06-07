/**
 * Robo-Dog Concierge — shared data contracts (SINGLE SOURCE OF TRUTH).
 *
 * Owned by: the spine/runtime team.
 * Populated by: the skills/data team (directory.json, people.json).
 * Consumed by: the agent (matching), the screen (rendering), the Go2 sink (navigation).
 *
 * Zod schemas are canonical; TS types are inferred from them. Validate every
 * data file at startup with `DirectoryFile.parse(...)` / `PeopleFile.parse(...)`.
 *
 *   npm i zod
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

/** A navigation pose on the Nav2 "map" frame. Meters + radians. null = unmapped. */
export const Pose = z
  .object({
    x: z.number(),
    y: z.number(),
    yaw: z.number(), // radians; converted to a quaternion when publishing /goal_pose
  })
  .nullable();
export type Pose = z.infer<typeof Pose>;

/** What a display client needs to render. Selects PRE-CACHED assets — never inlines media. */
export const ScreenContent = z.object({
  title: z.string(), // "Robotics Club"
  subtitle: z.string().optional(), // "4th floor · East Wing"
  routeAssetId: z.string().optional(), // id of a pre-loaded route image/video on the client
  mapMarker: z.string().optional(), // marker id on the floor map ("R4")
  accentColor: z.string().optional(), // optional theming
  mediaId: z.string().optional(), // optional hero image/video id (pre-cached)
});
export type ScreenContent = z.infer<typeof ScreenContent>;

/* ------------------------------------------------------------------ */
/* Directory entries (rooms, zones, events) — directory.json           */
/* ------------------------------------------------------------------ */

export const DirectoryKind = z.enum(["room", "zone", "event"]);
export type DirectoryKind = z.infer<typeof DirectoryKind>;

export const DirectoryEntry = z.object({
  id: z.string(), // kebab-case, stable: "robotics-club"
  label: z.string(), // human label: "Robotics Club"
  aliases: z.array(z.string()).default([]), // spoken variants: ["robotics", "robot club"]
  kind: DirectoryKind,
  floor: z.number().int(),
  zone: z.string().optional(), // "east-wing"
  pose: Pose.default(null), // for the Go2; null until mapped from LiDAR/planimetry
  screen: ScreenContent,

  // Event-only optional fields (kind === "event"):
  startsAt: z.string().datetime().optional(), // ISO 8601
  endsAt: z.string().datetime().optional(),
  host: z.string().optional(), // person id or free text
});
export type DirectoryEntry = z.infer<typeof DirectoryEntry>;

export const DirectoryFile = z.array(DirectoryEntry);
export type DirectoryFile = z.infer<typeof DirectoryFile>;

/* ------------------------------------------------------------------ */
/* People (arbitrary for the demo) — people.json                       */
/* ------------------------------------------------------------------ */

export const Person = z.object({
  id: z.string(), // "gabriela-m"
  name: z.string(), // "Gabriela Müller"
  aliases: z.array(z.string()).default([]), // ["gabriela", "gaby"]
  role: z.string().optional(), // "Robotics Lead"
  locatedAt: z.string().nullable().default(null), // FK -> DirectoryEntry.id (their destination)
  event: z.string().nullable().default(null), // FK -> DirectoryEntry.id (a time-bound event)
});
export type Person = z.infer<typeof Person>;

export const PeopleFile = z.array(Person);
export type PeopleFile = z.infer<typeof PeopleFile>;

/* ------------------------------------------------------------------ */
/* Destination — the event the agent EMITS; every sink consumes it     */
/* ------------------------------------------------------------------ */

export const DestinationStatus = z.enum([
  "resolved", // matched a single destination
  "ambiguous", // multiple candidates -> triggers one CLARIFY turn
  "no_match", // nothing matched -> re-ask once, then human fallback
  "human_fallback", // giving up gracefully ("let me call someone for you")
]);
export type DestinationStatus = z.infer<typeof DestinationStatus>;

/** How the match was reached — drives the spoken reply and the screen subtitle. */
export const MatchVia = z.object({
  person: z.string().optional(), // matched a Person, resolved to their locatedAt
  event: z.string().optional(), // matched an event
  matchedAlias: z.string().optional(), // which alias/term hit
  // Populated by check_appointment so the orchestrator can detect early arrivals.
  startsAt: z.string().optional(), // ISO 8601 start time of the matched appointment
  minutesUntilStart: z.number().optional(),
});
export type MatchVia = z.infer<typeof MatchVia>;

export const Candidate = z.object({
  destinationId: z.string(),
  label: z.string(),
  reason: z.string().optional(), // disambiguation hint: "Gabriela in Marketing"
});
export type Candidate = z.infer<typeof Candidate>;

/** Stage timestamps in ms (epoch). Orchestrator fills these for the latency report. */
export const Timings = z
  .object({
    ringAt: z.number().optional(),
    welcomeAudioStartAt: z.number().optional(),
    speechCommitAt: z.number().optional(), // t0 for the headline KPI
    agentFirstTokenAt: z.number().optional(),
    destinationEmittedAt: z.number().optional(),
    screenRenderedAt: z.number().optional(), // headline KPI = this - speechCommitAt
    ttsFirstAudioAt: z.number().optional(),
  })
  .passthrough();
export type Timings = z.infer<typeof Timings>;

export const Destination = z.object({
  sessionId: z.string(),
  status: DestinationStatus,
  transcript: z.string(), // what the visitor said (committed)
  destinationId: z.string().nullable(), // null when status != resolved
  label: z.string().nullable(),
  via: MatchVia.default({}),
  screen: ScreenContent, // ALWAYS present — the screen is never blank
  /**
   * Whether the display should SURFACE the destination card. false => the screen
   * stays on Nera's idle face (e.g. trivial answers needing no directions). The
   * voice answer is the hero; the screen is ambient + informational-when-needed.
   */
  showOnScreen: z.boolean().default(true),
  pose: Pose.default(null), // for Go2Sink
  candidates: z.array(Candidate).default([]), // populated when status === "ambiguous"
  confidence: z.number().min(0).max(1).default(0),
  timings: Timings.default({}),
});
export type Destination = z.infer<typeof Destination>;

/* ------------------------------------------------------------------ */
/* Trigger + session (for reference; owned by the orchestrator)        */
/* ------------------------------------------------------------------ */

export const SessionState = z.enum([
  "IDLE",
  "WELCOME",
  "LISTEN",
  "PROCESS",
  "RESPOND",
  "CLARIFY",
  "DONE",
]);
export type SessionState = z.infer<typeof SessionState>;
