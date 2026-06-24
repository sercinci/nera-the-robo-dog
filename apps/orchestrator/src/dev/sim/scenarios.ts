/**
 * Concierge simulation scenarios — the four visitor types from CLAUDE.md plus edges.
 *
 * Each scenario is a real situation: a `now`, a visitor utterance, and the EXPECTED
 * concierge decision. The runner (run.ts) executes the actual skills against the
 * simulated world and asserts the outcome — strictly, with a pass/fail per scenario.
 */
import { SIM_NOW_ISO, type World } from "./world.js";

export type Decision = "route" | "notify_host" | "clarify" | "human_fallback";
export type ApptState = "valid" | "outside_window" | "none";

export interface Scenario {
  id: string;
  useCase: string; // UC1..UC4 / edge — for grouping in the report
  title: string; // the situation, human-readable
  utterance: string; // what the visitor says (logged verbatim)
  now?: string; // ISO Vienna; defaults to SIM_NOW
  input: { kind: "person" | "place"; query: string };
  patch?: (w: World) => void; // optional per-scenario tweak (move the clock is via `now`)
  expect: {
    decision: Decision;
    destinationId?: string | null;
    appointment?: ApptState;
    present?: boolean;
  };
}

export const SCENARIOS: Scenario[] = [
  // ---- Use-Case 1: Known visitor WITH an appointment --------------------------
  {
    id: "UC1-a-valid",
    useCase: "UC1",
    title: "Known visitor, appointment active right now",
    utterance: "Hi, I'm Jonas — I have the investor breakfast.",
    input: { kind: "person", query: "Jonas" },
    expect: { decision: "route", destinationId: "room-board", appointment: "valid" },
  },
  {
    id: "UC1-b-early-arrival",
    useCase: "UC1",
    title: "Known visitor arrives 10 min early (inside the 30-min grace window)",
    utterance: "I'm Tobias, here for the AI and ML workshop.",
    now: "2026-06-16T09:50:00+02:00", // workshop starts 10:00
    input: { kind: "person", query: "Tobias" },
    expect: { decision: "route", destinationId: "room-workshop", appointment: "valid" },
  },
  {
    id: "UC1-c-too-early",
    useCase: "UC1",
    title: "Known visitor for an event hours away (outside window) → notify host",
    utterance: "I'm Markus, here for the robotics meetup.",
    input: { kind: "person", query: "Markus" }, // meetup is at 17:00, now 10:00
    expect: { decision: "notify_host", appointment: "outside_window" },
  },
  {
    id: "UC1-d-too-late",
    useCase: "UC1",
    title: "Known visitor shows up 45 min after the event ended → notify host",
    utterance: "Jonas again — sorry I'm late for the breakfast.",
    now: "2026-06-16T11:45:00+02:00", // breakfast ended 11:00, grace to 11:30
    input: { kind: "person", query: "Jonas" },
    expect: { decision: "notify_host", appointment: "outside_window" },
  },

  // ---- Use-Case 2: Known visitor, NO appointment ------------------------------
  {
    id: "UC2-a-present-no-appt",
    useCase: "UC2",
    title: "Known person, no appointment, but in the building → route to them",
    utterance: "I'm here to see Vlad in the makerspace.",
    input: { kind: "person", query: "Vlad" },
    expect: { decision: "route", destinationId: "room-maker", appointment: "none", present: true },
  },
  {
    id: "UC2-b-absent",
    useCase: "UC2",
    title: "Known person who is NOT in today → notify host",
    utterance: "Is Gabriela around? I'd like to see her.",
    input: { kind: "person", query: "Gabriela" },
    expect: { decision: "notify_host", appointment: "none", present: false },
  },

  // ---- Use-Case 3: Place / event routing --------------------------------------
  {
    id: "UC3-a-place",
    useCase: "UC3",
    title: "Visitor names a room directly",
    utterance: "Where's the makerspace?",
    input: { kind: "place", query: "the makerspace" },
    expect: { decision: "route", destinationId: "room-maker" },
  },
  {
    id: "UC3-b-ambiguous",
    useCase: "UC3",
    title: "Ambiguous term (a room AND an event) → one clarify",
    utterance: "I'm here for robotics.",
    input: { kind: "place", query: "robotics" }, // room-robotics vs evt-002 tie
    expect: { decision: "clarify" },
  },
  {
    id: "UC3-c-event",
    useCase: "UC3",
    title: "Visitor names an event by name",
    utterance: "The investor breakfast, please.",
    input: { kind: "place", query: "investor breakfast" }, // find_place resolves the EVENT entry
    expect: { decision: "route", destinationId: "evt-003" },
  },

  // ---- Use-Case 4: No match ---------------------------------------------------
  {
    id: "UC4-a-no-match",
    useCase: "UC4",
    title: "Nothing in the building matches → human fallback",
    utterance: "Where's the swimming pool?",
    input: { kind: "place", query: "swimming pool" },
    expect: { decision: "human_fallback" },
  },

  // ---- Edge: known person, no appointment, founder present --------------------
  {
    id: "edge-founder",
    useCase: "edge",
    title: "Founder, no appointment, present → route",
    utterance: "I'm looking for Alexander.",
    input: { kind: "person", query: "Alexander" },
    expect: { decision: "route", destinationId: "room-4A", appointment: "none", present: true },
  },
];

export const DEFAULT_NOW = SIM_NOW_ISO;
