---
project: Nera the Robo Dog
hunter_id: HID-HACKATHON-ROBODOG-2026-06-06-ACTIVE-3F9A12-CLS46
event: START Hack Vienna '26 · HOIV "Robo Dog" track
deadline: 2026-06-07T14:00:00+02:00
repo: https://github.com/sercinci/nera-the-robo-dog
owner: Skills-Team
goal: Doorbell-triggered Voice Concierge → Destination on 4K display. Latency is the primary metric.
copyright: © Gerald Pögl
---

# AGENTS.md — Nera the Robo Dog
**Single Source of Truth · Skills-Team**

---

## Project

Nera is an AI-powered voice concierge running on a Unitree Go2 robot dog at HOIV (Home of Innovation Vienna). A visitor rings the doorbell, speaks in natural language, and Nera greets them by voice and shows their destination on a 4K screen — in seconds.

For the 24-hour hackathon, the dog is replaced by a fixed speaker and microphone. The winning team implements the same brain on the real Go2 afterwards.

---

## Team Split

| Role | Responsibility |
|---|---|
| Spine-Team | `apps/orchestrator`, `apps/kiosk`, `apps/display-pi`, `sinks/` |
| Skills-Team | `skills/`, `data/`, `contracts/` (read-only) |

**This AGENTS.md and all skill files are owned by the Skills-Team.**

---

## Repo Structure

```
contracts/          # Zod schemas — DO NOT MODIFY (Spine-Team owns)
  contracts.ts      # DirectoryEntry, Person, Destination, Timings
  skill.ts          # Skill, SkillCtx, MatchResult interface
  projection.ts     # projectDestination(), composeReply()

data/               # Seed data — Skills-Team maintains
  directory.json    # Rooms, zones, events (with startsAt/endsAt)
  people.json       # Persons, roles, locatedAt, event FK

skills/             # Skills — Skills-Team owns
  instructions.md   # Agent system prompt (loaded into LLM)
  registry.ts       # Skill registry (register all skills here)
  find-person.ts    # ✅ done
  find-place.ts     # ✅ done
  check-appointment.ts  # 🔲 to build (Use-Case 1)

assets/
  welcome.txt       # Pre-cached greeting text (for TTS generation)
```

---

## Documents Codex May Read

| File | Purpose |
|---|---|
| `contracts/contracts.ts` | Data model — reference only, do not modify |
| `contracts/skill.ts` | Skill interface — reference only |
| `data/directory.json` | Building directory |
| `data/people.json` | People directory |
| `skills/instructions.md` | Agent system prompt |
| `skills/registry.ts` | Skill registry |
| `skills/find-person.ts` | Reference implementation |
| `skills/find-place.ts` | Reference implementation |
| `ARCHITECTURE.md` | Full system architecture |

---

## Visitor Types & Scenarios

| Type | In Directory | Appointment | Status |
|---|---|---|---|
| Known + Appointment | Yes | Yes | **Use-Case 1 — active** |
| Known + no appointment | Yes | No | Use-Case 2 — planned |
| New + Appointment | No | Yes | Use-Case 3 — planned |
| New + no appointment | No | No | Use-Case 4 — planned |

---

## Access Rights

Person-based (not role-based). For PoC: flat list in the directory.
Extensible to RBAC. `check_access` skill → Use-Case 3+.

---

## Skill Routing (Orchestrator Logic)

```
Doorbell rings
  → [Phase 1] play welcome.txt (pre-cached, ~0ms)
  → [Phase 2 parallel] STT + Directory load

Visitor names a person:
  → find_person(name)
  → check_appointment(person_id, now)
       valid   → route_visitor() → Signage POST
       invalid → notify_host()

Visitor names a place/event:
  → find_place(query)
       resolved  → route_visitor() → Signage POST
       ambiguous → 1x CLARIFY → find_place()
       no_match  → human_fallback

No match after 1 clarify:
  → human_fallback ("Let me call someone for you")
```

---

## Skills Overview

| Skill | File | Status | When to use |
|---|---|---|---|
| `find_person` | `skills/find-person.ts` | ✅ done | Visitor names a person |
| `find_place` | `skills/find-place.ts` | ✅ done | Visitor names a room, zone, or event |
| `check_appointment` | `skills/check-appointment.ts` | 🔲 build | After find_person — validate appointment |
| `notify_host` | — | 🔲 Spine-Team | No appointment / fallback |
| `check_access` | — | 🔲 Use-Case 3 | Validate access rights |
| `register_visitor` | — | 🔲 Use-Case 3 | Register new visitor |

---

## check_appointment — Specification

**Input:** `person_id` (string), `now` (timestamp)
**Time window:** `now >= startsAt - 30min` AND `now <= endsAt + 30min`
**Timezone:** Europe/Vienna (UTC+2)

**Lookup path:**
```
person_id → Person.event → DirectoryEntry.id (kind: "event") → startsAt / endsAt
```

**Return values:**
- Appointment valid + `locatedAt` present → `{ destinationId: person.locatedAt, confidence: 0.95 }`
- Appointment valid + no `locatedAt` → `{ destinationId: event.id, confidence: 0.8 }`
- No event FK → `{ destinationId: null, confidence: 0 }`
- Outside time window → `{ destinationId: null, confidence: 0 }`

---

## Pre-cached Greeting (Phase 1)

```
"Woof! Welcome to Home of Innovation — I'm Nera, your personal Assistant.
Just tell me — who are you here to see, or where would you like to go?"
```

File: `assets/welcome.txt`
Generation: ElevenLabs TTS (Spine-Team, one-time)
Purpose: Instant response on doorbell trigger (~0ms). Provides ~3-4s buffer for STT-init + Directory-load.

---

## Data Model Quick Reference

```typescript
Person      { id, name, aliases[], role?, locatedAt, event }
                                                  ↓FK          ↓FK
DirectoryEntry { id, label, aliases[], kind, floor, zone,
                 startsAt?, endsAt?, host?,
                 pose, screen }

MatchResult { destinationId, via?, confidence, candidates? }
```

---

## Conventions

- **Only `zod` + Node stdlib** in skills — no external dependencies
- **Skills return only `MatchResult`** — never screen content, never speech text
- **Timezone always explicit** — `Europe/Vienna`, never assumed UTC
- **Deterministic** — no randomness in skills
- **No credentials in repo** — use `.env.example` for secrets
- **Skill filename:** kebab-case → export: camelCase → `name`: snake_case

---

## Commit Conventions

```
feat(skills): add check-appointment skill
feat(data): update event timestamps to Vienna timezone
feat(skills): register check-appointment in registry
docs(skills): extend agent instructions for appointment flow
feat(assets): add cached welcome audio text
```

---

## Session-Log / Handover

**Datei:** `log/HANDOVER_CLAUDE_CODE.md`

**Pflicht am Sessionstart:** Lies `log/HANDOVER_CLAUDE_CODE.md` bevor du irgendeine Aufgabe anfängst. Sie ist der aktuelle Arbeitsstand.

**Pflicht nach jedem abgeschlossenen Schritt:** Trage den Fortschritt am Ende der Datei ein:
```
### [YYYY-MM-DD HH:MM] <kurzer Titel>
- Was wurde gemacht (1–3 Punkte)
- Status: ✅ done / 🔲 offen / ⚠️ blockiert
```

**Zweck:** Übergabedokument + Arbeitslog. Nach jeder Session muss die Datei den exakten Stand abbilden, damit die nächste Session ohne Rückfragen weitermachen kann.

---

## Open Items

- LiDAR coordinates for `pose` in `directory.json` (coming from HOIV team)
- Yodeck account + player setup (Spine-Team)
- Real directory content (current rooms/events/people from HOIV)
- AP client isolation test on-site (Spine-Team)
