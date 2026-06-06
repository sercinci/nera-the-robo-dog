# check-appointment Skill

## Purpose
Validates whether a known visitor has a currently active appointment.
Called after `find_person` returns a match. Returns a `MatchResult` with the destination
if the appointment is valid, or null if not.

---

## When to Use
After `find_person` has resolved a person — always run `check_appointment` before routing.
Do NOT skip this step even if the person is well known.

---

## Input
```
person_id: string   — the Person.id returned by find_person
now: timestamp      — current time (provided by orchestrator)
```

## Logic
```
1. Load Person by person_id from people.json
2. Read Person.event (FK → DirectoryEntry.id, kind: "event")
3. If no event FK → return { destinationId: null, confidence: 0 }
4. Load DirectoryEntry by event FK
5. Check time window:
     now >= startsAt - 30min  AND  now <= endsAt + 30min
6. If outside window → return { destinationId: null, confidence: 0 }
7. If valid:
     Person.locatedAt exists → { destinationId: person.locatedAt, confidence: 0.95 }
     Person.locatedAt null   → { destinationId: event.id, confidence: 0.8 }
```

## Timezone
**Always Europe/Vienna (UTC+2).** Never assume UTC.
`startsAt` and `endsAt` in `directory.json` are stored as ISO 8601 with explicit offset:
`2026-06-07T17:00:00+02:00`

---

## Return Values

| Condition | destinationId | confidence |
|---|---|---|
| Valid appointment + locatedAt | `person.locatedAt` | 0.95 |
| Valid appointment + no locatedAt | `event.id` | 0.8 |
| No event FK on person | `null` | 0 |
| Outside time window (±30min) | `null` | 0 |

---

## What Happens Next
- `destinationId` not null → orchestrator calls `route_visitor()` + Signage POST
- `destinationId` null → orchestrator calls `notify_host()`

---

## Reference Files
| File | Purpose |
|---|---|
| `contracts/contracts.ts` | Person + DirectoryEntry schema |
| `contracts/skill.ts` | MatchResult interface |
| `data/people.json` | Person records with event FK |
| `data/directory.json` | Event entries with startsAt/endsAt |
| `skills/find-person.ts` | Called before this skill |
| `skills/check-appointment.ts` | Implementation file (to build) |

---

## Constraints
- Only `zod` + Node stdlib — no external dependencies
- Returns only `MatchResult` — never screen content, never speech text
- Deterministic — no randomness
