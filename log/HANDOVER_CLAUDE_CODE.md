# Handover: Nera the Robo Dog — Claude Code Context
**START Hack Vienna '26 · HOIV "Robo Dog" track**
**Deadline: Sunday June 7, 14:00**
**Repo: https://github.com/sercinci/nera-the-robo-dog**

---

## Team-Split

| Wer | Verantwortung |
|---|---|
| Spine-Team | `apps/orchestrator`, `apps/kiosk`, `apps/display-pi`, `sinks/` |
| Skills-Team | `skills/`, `data/`, `contracts/` (read-only für Skills-Team) |

Du arbeitest für das **Skills-Team**.

---

## Was bereits fertig ist (nicht anfassen)

- `contracts/contracts.ts` — Zod-Schemas: `DirectoryEntry`, `Person`, `Destination`, `MatchResult`, `Timings`. **Single source of truth. Nicht ändern.**
- `contracts/skill.ts` — `Skill`, `SkillCtx`, `MatchResult` Interface
- `contracts/projection.ts` — `projectDestination()`, `composeReply()` — fertig, nicht ändern
- `skills/find-person.ts` — Skill: Person per Name suchen → `locatedAt` zurückgeben
- `skills/find-place.ts` — Skill: Raum/Zone/Event per Query matchen
- `skills/registry.ts` — Skill-Registry (neuen Skill hier eintragen)
- `skills/instructions.md` — Agent-Systempromt
- `data/directory.json` — Seed-Daten: Räume, Zonen, Events
- `data/people.json` — Seed-Daten: Personen mit Rollen und Locations

---

## Deine Aufgabe: Use-Case 1 implementieren

### Use-Case Beschreibung
Eine bekannte Person (im Directory vorhanden) klingelt an der Tür und hat einen Termin.

### Ablauf
```
Klingel
  → [Phase 1 - sofort] Pre-cached Begrüßung abspielen (0ms Latenz)
  → [Phase 2 - parallel] STT ready + Directory geladen
  → find_person(name)          // bereits implementiert
  → check_appointment(person_id, now)   // NEU — du baust das
       → valid:   route_visitor() + Signage POST
       → invalid: notify_host() + Sprachantwort
```

### Pre-cached Begrüßungstext (Phase 1)
```
"Woof! Welcome to Home of Innovation — I'm Nera, your personal Assistant. 
Just tell me — who are you here to see, or where would you like to go?"
```
Dieser Text wird pre-generiert (ElevenLabs TTS, einmalig gecacht) und sofort abgespielt wenn die Klingel läutet. Während er läuft, startet der STT-Buffer. Das gibt ~3-4 Sekunden Puffer für Directory-Load + STT-Init.

---

## Was du bauen musst

### 1. `skills/check-appointment.ts` — neuer Skill

**Logik:**
- Input: `person_id` (string) + aktueller Timestamp
- Lookup: `person.event` → FK zu `DirectoryEntry.id` (kind: "event")
- Zeitfenster: `now >= startsAt - 30min` AND `now <= endsAt + 30min` → valid
- Zeitzone: **Europe/Vienna (UTC+2)**
- Output: `MatchResult` mit `destinationId` (bei valid) oder `null` (bei invalid)

**Rückgabewerte:**
- Termin valid + Person hat `locatedAt` → `{ destinationId: person.locatedAt, confidence: 0.95 }`
- Termin valid + kein `locatedAt` → `{ destinationId: event.id, confidence: 0.8 }` (zum Event-Raum routen)
- Kein Termin gefunden → `{ destinationId: null, confidence: 0 }`
- Termin außerhalb Zeitfenster → `{ destinationId: null, confidence: 0 }`

### 2. `skills/registry.ts` — `checkAppointment` eintragen

Import hinzufügen + in das `skills`-Array appenden.

### 3. `skills/instructions.md` — Agent-Prompt erweitern

Dem Agent erklären wann er `check_appointment` aufrufen soll:
- Nach `find_person` wenn eine Person gefunden wurde
- Argument: `person_id` aus dem `find_person`-Ergebnis

### 4. `data/directory.json` — Timestamps prüfen/ergänzen

Sicherstellen dass das Event `robotics-meetup-1700` korrekte `startsAt`/`endsAt` hat:
```json
"startsAt": "2026-06-07T15:00:00+02:00",
"endsAt":   "2026-06-07T17:00:00+02:00"
```
(Vienna local = UTC+2, ISO 8601 mit Offset)

### 5. `assets/welcome.txt` — Begrüßungstext dokumentieren

Datei anlegen mit dem Begrüßungstext (für TTS-Generierung durch Spine-Team).

---

## Datenmodell-Referenz (aus contracts.ts)

```typescript
// Person
{
  id: string,           // "gabriela-m"
  name: string,         // "Gabriela Müller"
  aliases: string[],    // ["gabriela", "gaby"]
  role?: string,
  locatedAt: string | null,   // FK → DirectoryEntry.id
  event: string | null,       // FK → DirectoryEntry.id (kind: "event")
}

// DirectoryEntry (Event)
{
  id: string,
  label: string,
  kind: "event",
  floor: number,
  startsAt?: string,    // ISO 8601
  endsAt?: string,      // ISO 8601
  host?: string,        // person id
  pose: Pose | null,
  screen: ScreenContent,
}

// MatchResult (was ein Skill zurückgibt)
{
  destinationId: string | null,
  via?: MatchVia,
  confidence: number,   // 0..1
  candidates?: Candidate[],
}
```

---

## Wichtige Constraints

- **Nur `zod` und Node-Stdlib** — keine externen Dependencies in Skills
- **Skill gibt nur `MatchResult` zurück** — nie entscheiden was auf dem Screen steht, nie Sprachtext generieren. Das macht `projection.ts`.
- **Keine echten Credentials im Repo** — `.env.example` für Secrets
- **Deterministisch** — kein randomness in Skills
- **Zeitzone immer explizit** — `Europe/Vienna`, nie assumed UTC

---

## Skill-Template zum Kopieren

```typescript
import { z } from "zod";
import type { Skill, MatchResult } from "../contracts/skill.js";

const Args = z.object({
  // deine Parameter
});

export const mySkill: Skill<z.infer<typeof Args>, MatchResult> = {
  name: "my_skill",
  description: "Wann der Agent diesen Skill aufrufen soll — konkret und präzise.",
  parameters: Args,

  async handler({ /* args */ }, ctx) {
    ctx.log("my_skill");
    // ctx.directory — alle DirectoryEntries
    // ctx.people    — alle Persons
    // ctx.session   — { id, transcript }
    
    return { destinationId: null, confidence: 0 };
  },
};
```

---

## Commit-Konventionen

```
feat(skills): add check-appointment skill
feat(data): update event timestamps to Vienna timezone  
feat(skills): register check-appointment in registry
docs(skills): extend agent instructions for appointment flow
feat(assets): add cached welcome audio text
```

---

## Was NICHT deine Aufgabe ist

- `apps/` — Orchestrator, Kiosk, Pi Display → Spine-Team
- `sinks/` — Go2, Yodeck → Spine-Team
- `contracts/` — nicht ändern, nur lesen

---

## Offene Fragen / Nice-to-have nach Use-Case 1

- Use-Case 2: New Visitor (kein Directory-Eintrag, mit oder ohne Termin)
- Use-Case 3: Access Control (`check_access` Skill)
- Use-Case 4: Delivery / Walk-in ohne Termin

---

## Local Skills Directory

A local `skills/` directory is committed to the repo at root level. Each subdirectory contains a `SKILL.md` (Claude Code skill) plus reference files. These are **not** the TypeScript agent skills in `skills/*.ts` — they are Claude Code context files for the development team.

Install: point Claude Code's skills path to this directory so any team member gets the same context.

| Directory | SKILL.md | Reference files | Status |
|---|---|---|---|
| `skills/nera-orchestrator/` | ✅ | — | done |
| `skills/check-appointment/` | ✅ | `example-data.json`, `test-cases.md` | done |
| `skills/find-person/` | ✅ | `test-cases.md` | done |
| `skills/find-place/` | ✅ | `test-cases.md` | done |
| `skills/doorguard/` | ✅ | `refusal-examples.md` | done |

---

## What Still Needs to Be Done (in order)

1. **`skills/check-appointment.ts`** — implement the TypeScript skill (spec is in `skills/check-appointment/SKILL.md`)
2. **`skills/registry.ts`** — add `checkAppointment` import + entry
3. **`data/directory.json`** — verify/fix event timestamps to ISO 8601 with explicit `+02:00` offset
4. **`skills/instructions.md`** — add Out-of-Scope / guardrail block (reference: `skills/doorguard/refusal-examples.md`)
5. **`assets/welcome.txt`** — create file with pre-cached greeting text (for Spine-Team TTS generation)

---

## Session Log

### [2026-06-06 Session-Init] Projekt-Setup & Log-Struktur
- Handover-Datei in `log/` verschoben
- CLAUDE.md um Session-Log-Konvention erweitert
- Status: ✅ done

### [2026-06-06 Brainstorming & Documentation] Skills-Team Architecture
- Full Use-Case 1 spec finalized (known visitor + appointment)
- Pre-cached greeting pattern defined (Phase 1 / Phase 2 parallel)
- CLAUDE.md written in English with YAML frontmatter
- All Claude Code skills created in local `skills/` directory (5 skills, 10 files)
- check-appointment: SKILL.md + example-data.json + test-cases.md (14 cases)
- find-person: SKILL.md + test-cases.md (15 cases)
- find-place: SKILL.md + test-cases.md (17 cases)
- doorguard: SKILL.md + refusal-examples.md (tone reference, 10 examples)
- nera-orchestrator: SKILL.md (routing table)
- Status: ✅ done — documentation complete, TypeScript implementation is next

### [2026-06-06 Implementation] Use-Case 1 — Skills-Team Deliverables
- `skills/check-appointment.ts` — neu implementiert (ISO 8601 Zeitfenster-Logik, Europe/Vienna, kein externer Dep)
- `skills/registry.ts` — neu angelegt, importiert findPerson + findPlace + checkAppointment
- `data/directory.json` — neu angelegt mit 7 Einträgen (rooms, zones, events); robotics-meetup-1700 + interview-1030 + pitch-day-1400 mit korrekten +02:00 Offsets
- `data/people.json` — neu angelegt mit 5 Personen (Seed-Daten aus example-data.json + 2 weitere)
- `skills/instructions.md` — neu angelegt: Agent-Systempromt mit Routing-Flow, check_appointment Aufruflogik, Out-of-Scope Guardrails (Tone aus doorguard/refusal-examples.md)
- `assets/welcome.txt` — neu angelegt mit pre-cached Begrüßungstext für Spine-Team TTS
- Status: ✅ done — alle 5 "What Still Needs to Be Done" Items erledigt

### [2026-06-06 Navigation Skills] Per-Floor LiDAR Waypoint Skills
- LiDAR data analysiert: ROS 2 MCAP bag (Jazzy), Topics /utlidar/robot_pose + /utlidar/cloud, 4494 Pose-Messages, ~240s
- Occupancy Map (2D floor plan) aus WhatsApp Image — nur 1 Floor aktuell gemappt
- `skills/navigate-floor.ts` — generischer Skill: lädt floor-spezifische waypoints.json, gibt (x,y,yaw) zurück für Go2 sink
- `skills/navigate-floor-{0,2,3,4}/` — je SKILL.md + waypoints.json (alle Koordinaten PLACEHOLDER)
- `tools/extract-waypoints.py` — interaktives Skript: liest MCAP, Team labelt Waypoints, gibt waypoints.json aus
- `skills/registry.ts` + `skills/instructions.md` aktualisiert
- ACHTUNG: Floor 4 (Robotics Club) hat Priorität für on-site Mapping — Use-Case 1 Demo
- Status: ✅ Skill-Struktur done — Waypoints brauchen on-site Mapping

### [2026-06-06 Hospitality Logic] Kontextabhängiges Coffee/Water-Angebot
- Doorguard-Regel verfeinert: Kaffee/Wasser-Angebot ist NICHT generell verboten
- Regel: An der Tür (vor Routing) → Refusal. Nach Routing + Wartezeit > 5min → Angebot erlaubt
- `skills/instructions.md` — neuer Abschnitt `# Hospitality after routing` mit Bedingung + Formulierung
- `skills/doorguard/refusal-examples.md` — Coffee-Beispiel in zwei Kontexte aufgeteilt (Tür vs. nach Routing)
- `skills/check-appointment.ts` — gibt jetzt `via: { startsAt, minutesUntilStart }` zurück, damit Orchestrator deterministisch entscheidet ob Hospitality-Offer getriggert wird (kein extra LLM-Call)
- Nera macht das Angebot, ein Mensch liefert — Nera fetcht physisch nichts
- Status: ✅ done
- Nächste Schritte: find-person.ts + find-place.ts aus GitHub-Repo ergänzen (waren lokal nicht vorhanden)

### [2026-06-06 Prompt Refinement] ElevenLabs Best Practices applied to instructions.md
- ElevenLabs Guardrails + Prompting Guide gelesen (elevenlabs.io/docs)
- instructions.md vollständig nach ElevenLabs-Schema restrukturiert:
  - `# Guardrails` als eigener Heading (Modelle priorisieren diesen Header)
  - "This step is important" bei check_appointment-Pflichtaufruf und Routing
  - Tool-Sections mit When/Parameters/Result-Handling/Error-Handling
  - Streaming-Mode-kompatibel (keine blocking-Retry-Logik im Prompt)
- Status: ✅ done

### [2026-06-06 Fix] find-person.ts + find-place.ts aus GitHub geholt
- Beide Dateien fehlten lokal (registry.ts importierte sie, Build wäre gebrochen)
- Von https://github.com/sercinci/nera-the-robo-dog geholt, Exports passen zu registry.ts
- Status: ✅ done — alle Skills-Team Deliverables vollständig und konsistent

### [2026-06-06 Agent Runner] apps/agent-runner/ implementiert
- `apps/agent-runner/src/agent.ts` — LLM-Loop: Skills → Anthropic Tools (via zod-to-json-schema), agentic tool-use Loop (max 5 turns), MatchResult tracking, Timings
- `apps/agent-runner/src/loader.ts` — lädt directory.json, people.json, instructions.md von Disk; validiert mit Zod-Schemas aus contracts.ts
- `apps/agent-runner/src/server.ts` — HTTP-Server (Node stdlib, kein Framework); POST /session → Agent → JSON; GET /health; fire-and-forget forward an Spine-Team ORCHESTRATOR_URL
- `apps/agent-runner/package.json` — deps: @anthropic-ai/sdk, zod, zod-to-json-schema; Model: claude-haiku-4-5 (Latenz)
- `apps/agent-runner/.env.example` — ANTHROPIC_API_KEY, PORT=3100, ORCHESTRATOR_URL, Datei-Pfade
- Branch: agentic-skills (manuell pushen — git läuft auf dem Host, nicht in der Sandbox)
- Status: ✅ done

### What still needs to be done
1. `git push origin agentic-skills` auf dem Host ausführen (Befehl: siehe unten)
2. Spine-Team: ORCHESTRATOR_URL in .env setzen + /destination Endpoint implementieren
3. On-site: Waypoints in navigate-floor-{0,2,3,4}/waypoints.json mappen (tools/extract-waypoints.py)
4. Use-Case 2–4 (optional, nach Demo)

**Push-Befehl für Host:**
```bash
cd "C:\Users\gpoeg\Arbeitsplatz neu organisieren\07_DEV\_projekte\hackathons\Hackathon Robodog"
git checkout -b agentic-skills
git add .
git commit -m "feat(agent-runner): LLM agent loop — skills as Anthropic tools, HTTP server"
git push -u origin agentic-skills
```
