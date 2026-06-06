/**
 * Projection — the "something else" that turns a bare destinationId (from a skill)
 * into the full Destination the sinks consume, and into the spoken reply.
 *
 * Two pure functions:
 *   projectDestination()  -> WHAT TO DISPLAY / NAVIGATE (screen assets + pose + status)
 *   composeReply()        -> WHAT TO SAY (spoken text; template by default)
 *
 * Both are deterministic and depend only on the data files — no model call, no I/O.
 * The orchestrator calls projectDestination(), validates with Destination.parse(),
 * then fires the result to every sink; composeReply() feeds ElevenLabs TTS.
 */
import { Destination, type DirectoryEntry, type Person } from "./contracts.js";
import type { MatchResult } from "./skill.js";

export interface DataCtx {
  directory: DirectoryEntry[];
  people: Person[];
}

/** Build the full Destination from a skill's MatchResult. Always returns a valid
 *  object with a non-empty `screen` — the display is never blank. */
export function projectDestination(
  match: MatchResult,
  data: DataCtx,
  meta: { sessionId: string; transcript: string },
): Destination {
  const entry = match.destinationId
    ? data.directory.find((e) => e.id === match.destinationId)
    : undefined;

  // Ambiguous: a clarify turn is needed.
  if (match.candidates && match.candidates.length > 1) {
    return Destination.parse({
      sessionId: meta.sessionId,
      status: "ambiguous",
      transcript: meta.transcript,
      destinationId: null,
      label: null,
      via: match.via ?? {},
      screen: { title: "Which one?", subtitle: "I found a few — could you be more specific?" },
      candidates: match.candidates,
      confidence: match.confidence,
    });
  }

  // No match (or unknown id): graceful, screen still populated.
  if (!entry) {
    return Destination.parse({
      sessionId: meta.sessionId,
      status: "no_match",
      transcript: meta.transcript,
      destinationId: null,
      label: null,
      via: match.via ?? {},
      screen: {
        title: "Let me find someone for you",
        subtitle: "Head to the Ministry of Magic desk and we'll help.",
        routeAssetId: "route-entrance",
        mapMarker: "M0",
      },
      confidence: match.confidence,
    });
  }

  // Resolved.
  return Destination.parse({
    sessionId: meta.sessionId,
    status: "resolved",
    transcript: meta.transcript,
    destinationId: entry.id,
    label: entry.label,
    via: match.via ?? {},
    screen: entry.screen,
    pose: entry.pose,
    confidence: match.confidence,
  });
}

/** Derive the spoken reply from a resolved Destination. Template-based: fast and
 *  deterministic. Swap this for a small LLM call later if you want more charm. */
export function composeReply(d: Destination, data: DataCtx): string {
  switch (d.status) {
    case "resolved": {
      const entry = data.directory.find((e) => e.id === d.destinationId);
      const who = d.via.person
        ? data.people.find((p) => p.id === d.via.person)?.name
        : undefined;
      const where = entry
        ? `${entry.label}${entry.floor ? `, floor ${entry.floor}` : ""}${entry.zone ? `, ${entry.zone.replace("-", " ")}` : ""}`
        : d.label;
      return who
        ? `${who} is at the ${where}. I've put the way up on the screen — right this way!`
        : `Right this way — ${where} is on the screen for you.`;
    }
    case "ambiguous":
      return `I found a few — could you tell me a little more?`;
    case "no_match":
      return `Hmm, I didn't catch where you'd like to go — could you say that once more?`;
    case "human_fallback":
      return `No problem — let me call someone over to help you.`;
  }
}
