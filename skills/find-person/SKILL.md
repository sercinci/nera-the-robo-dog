# find-person Skill

## Purpose
Finds a person in the building directory by name or nickname and resolves to their
current location. This is typically the first skill called when a visitor asks for
a specific person.

---

## When to Use
When the visitor mentions a person's name — e.g.:
- "I'm here to see Gabriela"
- "Where is Alex?"
- "I have a meeting with the founder"
- "Can you find Vlad for me?"

Do NOT use for room/zone/event queries — use `find_place` instead.

---

## Input
```
name: string   — the person's name or nickname, exactly as the visitor said it
```

## Logic
```
1. Normalize query to lowercase
2. Match against Person.name and Person.aliases in people.json
3. No match          → { destinationId: null, confidence: 0 }
4. Multiple matches  → return candidates (ambiguous) → orchestrator runs 1 CLARIFY turn
5. Single match:
     Person.locatedAt exists → { destinationId: person.locatedAt, confidence: 0.95 }
     Person.locatedAt null   → { destinationId: null, confidence: 0.3 }
```

## After This Skill
Always follow with `check_appointment(person_id, now)` before routing.

## No-Match Handoff (important)
This skill only IDENTIFIES — it does not fetch a human. When it returns
`{ destinationId: null, confidence: 0 }` (no match), the **orchestrator** is what
actually pages a person: the deterministic `notify-host` sink fires on the terminal
give-up state (after Nera's one clarifying question), so the spoken promise
"let me get someone for you" is backed by a real staff notification (`HOST_NOTIFY_URL`,
or a dry-run log when unset). Do NOT add human-fetching logic to this skill — it would
break the identify-only contract and wouldn't fire reliably under the single-round agent.
See `apps/orchestrator/src/notify-host.ts`.

---

## Return Values

| Condition | destinationId | confidence |
|---|---|---|
| Single match + locatedAt | `person.locatedAt` | 0.95 |
| Single match + no locatedAt | `null` | 0.3 |
| Multiple matches | `null` + candidates[] | 0.5 |
| No match | `null` | 0 |

---

## Reference Files
| File | Purpose |
|---|---|
| `contracts/contracts.ts` | Person schema |
| `contracts/skill.ts` | MatchResult interface |
| `data/people.json` | Person records |
| `skills/find-person.ts` | Implementation (✅ done) |

---

## Constraints
- Only `zod` + Node stdlib — no external dependencies
- Returns only `MatchResult` — never screen content, never speech text
- Alias matching is case-insensitive substring match
