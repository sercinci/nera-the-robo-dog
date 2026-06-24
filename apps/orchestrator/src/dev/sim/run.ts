/**
 * Concierge simulation runner — deterministic, no LLM, no Ring, no ElevenLabs.
 *
 * For each scenario it executes the REAL skills (find_person, check_appointment,
 * find_place) against the simulated world, applies the intended routing decision
 * tree (per skills/instructions.md), and asserts the outcome against `expect`.
 *
 * Run:
 *   npm run sim            # from apps/orchestrator
 *   SIM_DEBUG=1 npm run sim   # also dump raw MatchResult JSON per step
 *
 * Output: a strict pass/fail report to stdout AND log/sim/<ts>.{log,json}.
 * Exit code 0 = all green, 1 = at least one failure (CI-friendly).
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { skills } from "@nera/skills";
import { loadData } from "../../data.js";
import { buildWorld, describeWorld, type World } from "./world.js";
import { SCENARIOS, DEFAULT_NOW, type Scenario, type Decision, type ApptState } from "./scenarios.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");
const DEBUG = process.env.SIM_DEBUG === "1";

interface MatchResult {
  destinationId: string | null;
  confidence: number;
  via?: { person?: string; event?: string; matchedAlias?: string };
  candidates?: { destinationId: string; label: string; reason?: string }[];
}

/** Run one skill by name against the world; record the call for the trace. */
async function callSkill(name: string, args: unknown, world: World, now: string): Promise<MatchResult> {
  const skill = skills.find((s) => s.name === name);
  if (!skill) throw new Error(`Unknown skill: ${name}`);
  // check_appointment needs `now`; it reads it from args. Others ignore it.
  const result = (await (skill as { handler: Function }).handler(args, {
    directory: world.directory,
    people: world.people,
    session: { id: "sim", transcript: String((args as { query?: string }).query ?? "") },
    log: () => {},
  })) as MatchResult;
  return result;
}

interface Outcome {
  decision: Decision;
  destinationId?: string | null;
  appointment?: ApptState;
  present?: boolean;
  steps: string[]; // human-readable trace lines
}

/** The concierge decision tree — the intended Use-Case 1/2/3/4 logic. */
async function decide(s: Scenario, world: World, now: string): Promise<Outcome> {
  const steps: string[] = [];
  const dbg = (r: MatchResult) => (DEBUG ? `\n      ${JSON.stringify(r)}` : "");

  if (s.input.kind === "place") {
    const fp = await callSkill("find_place", { query: s.input.query }, world, now);
    steps.push(`→ find_place(query="${s.input.query}")  ⇒ ${summPlace(fp)}${dbg(fp)}`);
    if ((fp.candidates?.length ?? 0) > 1) {
      return { decision: "clarify", steps };
    }
    if (fp.destinationId) {
      return { decision: "route", destinationId: fp.destinationId, steps };
    }
    return { decision: "human_fallback", steps };
  }

  // PERSON
  const fp = await callSkill("find_person", { name: s.input.query }, world, now);
  steps.push(`→ find_person(name="${s.input.query}")  ⇒ ${summPerson(fp, world)}${dbg(fp)}`);

  if ((fp.candidates?.length ?? 0) > 1) {
    return { decision: "clarify", steps };
  }
  const personId = fp.via?.person;
  if (!personId) {
    return { decision: "human_fallback", steps }; // 0 matches → clarify-once-then-fallback
  }
  const person = world.people.find((p) => p.id === personId)!;
  const present = !!person.locatedAt;

  const appt = await callSkill("check_appointment", { person_id: personId, now }, world, now);
  steps.push(`→ check_appointment(${personId})  ⇒ ${summAppt(appt, person, world, now)}${dbg(appt)}`);

  if (appt.destinationId != null) {
    return { decision: "route", destinationId: appt.destinationId, appointment: "valid", present, steps };
  }
  if (person.event) {
    // an appointment exists but `now` is outside its window
    return { decision: "notify_host", appointment: "outside_window", present, steps };
  }
  if (present) {
    return { decision: "route", destinationId: person.locatedAt, appointment: "none", present: true, steps };
  }
  return { decision: "notify_host", appointment: "none", present: false, steps };
}

// ---- trace summaries --------------------------------------------------------
function summPerson(r: MatchResult, w: World): string {
  if ((r.candidates?.length ?? 0) > 1) return `AMBIGUOUS · ${r.candidates!.length} candidates`;
  if (!r.via?.person) return "no match";
  const p = w.people.find((x) => x.id === r.via!.person)!;
  return p.locatedAt ? `match ${p.id} · present@${p.locatedAt} · conf ${r.confidence}` : `match ${p.id} · NOT in today · conf ${r.confidence}`;
}
function summPlace(r: MatchResult): string {
  if ((r.candidates?.length ?? 0) > 1) return `AMBIGUOUS · ${r.candidates!.map((c) => c.destinationId).join(" | ")}`;
  if (!r.destinationId) return "no match";
  return `resolved ${r.destinationId} · conf ${r.confidence}`;
}
function summAppt(r: MatchResult, person: World["people"][number], w: World, now: string): string {
  if (r.destinationId == null) {
    if (!person.event) return "no appointment on file";
    const ev = w.directory.find((d) => d.id === person.event);
    return `OUTSIDE window (event ${ev?.label ?? person.event} ${ev?.startsAt ? hhmmRange(ev.startsAt, ev.endsAt) : "?"})`;
  }
  const ev = w.directory.find((d) => d.id === person.event);
  let when = "";
  if (ev?.startsAt) {
    const mins = Math.round((Date.parse(ev.startsAt) - Date.parse(now)) / 60000);
    when = mins > 0 ? ` · starts in ${mins} min` : ` · started ${-mins} min ago`;
  }
  return `VALID · dest ${r.destinationId} · conf ${r.confidence}${when}`;
}
function hhmmRange(a: string, b?: string): string {
  const t = (s?: string) => (s?.match(/T(\d{2}:\d{2})/)?.[1] ?? "?");
  return `${t(a)}–${t(b)}`;
}

// ---- assertion --------------------------------------------------------------
function check(s: Scenario, o: Outcome): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (o.decision !== s.expect.decision) reasons.push(`decision ${o.decision} ≠ ${s.expect.decision}`);
  if (s.expect.destinationId !== undefined && o.destinationId !== s.expect.destinationId)
    reasons.push(`destinationId ${o.destinationId ?? "null"} ≠ ${s.expect.destinationId ?? "null"}`);
  if (s.expect.appointment !== undefined && o.appointment !== s.expect.appointment)
    reasons.push(`appointment ${o.appointment ?? "—"} ≠ ${s.expect.appointment}`);
  if (s.expect.present !== undefined && o.present !== s.expect.present)
    reasons.push(`present ${o.present ?? "—"} ≠ ${s.expect.present}`);
  return { pass: reasons.length === 0, reasons };
}

function fmtExpect(e: Scenario["expect"]): string {
  const bits = [`${e.decision}${e.destinationId !== undefined ? ` → ${e.destinationId ?? "null"}` : ""}`];
  if (e.appointment) bits.push(`appt:${e.appointment}`);
  if (e.present !== undefined) bits.push(`present:${e.present}`);
  return bits.join("  ");
}
function fmtOutcome(o: Outcome): string {
  const bits = [`${o.decision}${o.destinationId !== undefined ? ` → ${o.destinationId ?? "null"}` : ""}`];
  if (o.appointment) bits.push(`appt:${o.appointment}`);
  if (o.present !== undefined) bits.push(`present:${o.present}`);
  return bits.join("  ");
}

// ---- main -------------------------------------------------------------------
async function main() {
  const base = await loadData(resolve(repoRoot, "data"));
  const out: string[] = [];
  const log = (line = "") => {
    out.push(line);
    console.log(line);
  };

  log("════════════════ NERA CONCIERGE SIMULATION ════════════════");
  const baseWorld = buildWorld(base);
  for (const l of describeWorld(baseWorld)) log(l);
  log("════════════════════════════════════════════════════════════");
  log("");

  const results: { s: Scenario; pass: boolean; reasons: string[] }[] = [];
  for (const s of SCENARIOS) {
    const now = s.now ?? DEFAULT_NOW;
    // fresh world per scenario so a patch never leaks into the next one
    const world = buildWorld(base);
    s.patch?.(world);

    const o = await decide(s, world, now);
    const v = check(s, o);
    results.push({ s, ...v });

    log(`[${s.useCase}] ${s.id}   @ ${now}`);
    log(`  Visitor: "${s.utterance}"`);
    for (const step of o.steps) log(`  ${step}`);
    log(`  DECISION: ${fmtOutcome(o)}`);
    log(`  EXPECT:   ${fmtExpect(s.expect)}`);
    log(`  ${v.pass ? "✅ PASS" : "❌ FAIL — " + v.reasons.join("; ")}`);
    log("");
  }

  // summary
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  const byUC = new Map<string, [number, number]>();
  for (const r of results) {
    const [p, t] = byUC.get(r.s.useCase) ?? [0, 0];
    byUC.set(r.s.useCase, [p + (r.pass ? 1 : 0), t + 1]);
  }
  log("───────────────────────── SUMMARY ─────────────────────────");
  log(`${results.length} scenarios · ${pass} ✅ · ${fail} ❌`);
  log("By use-case: " + [...byUC].map(([k, [p, t]]) => `${k} ${p}/${t}`).join(" · "));
  if (fail) log("FAILURES: " + results.filter((r) => !r.pass).map((r) => r.s.id).join(", "));
  log("────────────────────────────────────────────────────────────");

  // write artifacts
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const logDir = resolve(repoRoot, "log/sim");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(resolve(logDir, `${ts}-sim.log`), out.join("\n"), "utf8");
  writeFileSync(
    resolve(logDir, `${ts}-sim.json`),
    JSON.stringify(
      { ranAt: ts, total: results.length, pass, fail, results: results.map((r) => ({ id: r.s.id, useCase: r.s.useCase, pass: r.pass, reasons: r.reasons })) },
      null,
      2,
    ),
    "utf8",
  );
  log(`\nArtifacts: log/sim/${ts}-sim.log  +  .json`);

  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
