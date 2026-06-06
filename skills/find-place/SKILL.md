# find-place Skill

## Purpose
Matches a room, zone, or event in the building directory from a natural language query.
The most common skill call — covers the majority of visitor requests.

---

## When to Use
When the visitor names a destination directly — e.g.:
- "Where's the robotics club?"
- "I'm going to the makerspace"
- "The 5pm meetup"
- "Can you show me the entrance?"

Do NOT use when the visitor asks for a person by name — use `find_person` instead.

---

## Input
```
query: string   — the place, room, or event the visitor asked for, as spoken
```

## Logic
```
1. Normalize query to lowercase
2. Score each DirectoryEntry:
     exact match (label or alias)    → 1.0
     substring match (either way)    → 0.85
     no match                        → 0
3. No matches          → { destinationId: null, confidence: 0 }
4. Multiple top scores → return candidates (ambiguous) → orchestrator runs 1 CLARIFY turn
5. Single clear winner → { destinationId: entry.id, confidence: score }
```

---

## Return Values

| Condition | destinationId | confidence |
|---|---|---|
| Single exact match | `entry.id` | 1.0 |
| Single substring match | `entry.id` | 0.85 |
| Multiple tied matches | `null` + candidates[] | 0.5 |
| No match | `null` | 0 |

---

## After This Skill
- `resolved` → orchestrator calls `route_visitor()` + Signage POST
- `ambiguous` → orchestrator asks 1 clarifying question, then calls `find_place` again
- `no_match` → orchestrator calls `human_fallback`

---

## Reference Files
| File | Purpose |
|---|---|
| `contracts/contracts.ts` | DirectoryEntry schema |
| `contracts/skill.ts` | MatchResult interface |
| `data/directory.json` | Building directory with aliases |
| `skills/find-place.ts` | Implementation (✅ done) |

---

## Constraints
- Only `zod` + Node stdlib — no external dependencies
- Returns only `MatchResult` — never screen content, never speech text
- Alias matching is case-insensitive
- Maximum 1 clarify turn before human_fallback
