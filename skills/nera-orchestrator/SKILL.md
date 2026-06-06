# Nera Orchestrator Skill

## Purpose
This skill is the routing brain for the Nera concierge agent. It does NOT contain implementation logic. It defines WHEN to use which skill and WHICH documents Claude may read.

Use this skill whenever working on the Nera robodog concierge system — authoring skills, extending data, or debugging the agent flow.

---

## When to Use Which Skill

| Situation | Skill to invoke |
|---|---|
| Visitor names a person ("I'm here to see Gabriela") | `find_person` |
| Visitor names a place, room, or event ("Where's the makerspace?") | `find_place` |
| Person found via `find_person` → validate their appointment | `check_appointment` |
| Appointment invalid or no appointment → alert the host | `notify_host` (Spine-Team) |
| New visitor, access rights unclear → check permissions | `check_access` (Use-Case 3+) |
| New visitor not in directory → capture their details | `register_visitor` (Use-Case 3+) |
| No match after 1 clarify turn | `human_fallback` — say "Let me call someone for you" |

### Decision Flow

```
Doorbell rings
  → [Phase 1] Play welcome.txt (~0ms, pre-cached)
  → [Phase 2, parallel] STT ready + Directory loaded

Visitor speaks:
  → mentions a person?   → find_person → check_appointment
  → mentions a place?    → find_place
  → unclear after 1 clarify? → human_fallback
```

---

## Documents Claude May Read

| File | Purpose | May Modify? |
|---|---|---|
| `contracts/contracts.ts` | Zod schemas — DirectoryEntry, Person, Destination, MatchResult | ❌ No |
| `contracts/skill.ts` | Skill + SkillCtx interface | ❌ No |
| `contracts/projection.ts` | projectDestination(), composeReply() | ❌ No |
| `data/directory.json` | Building directory — rooms, zones, events | ✅ Yes |
| `data/people.json` | People directory — persons, roles, locations | ✅ Yes |
| `skills/instructions.md` | Agent system prompt | ✅ Yes |
| `skills/registry.ts` | Skill registry | ✅ Yes (add new skills here) |
| `skills/find-person.ts` | Reference implementation | ✅ Yes |
| `skills/find-place.ts` | Reference implementation | ✅ Yes |
| `skills/check-appointment.ts` | Appointment validation skill | ✅ Yes (to build) |
| `ARCHITECTURE.md` | Full system architecture | ❌ No |
| `CLAUDE.md` | Single source of truth for this project | ❌ No |

---

## Hard Rules

- Skills return only `MatchResult` — never screen content, never speech text
- Only `zod` + Node stdlib — no external dependencies in skills
- Timezone always explicit — `Europe/Vienna`, never assumed UTC
- No credentials in repo — `.env.example` for secrets
- One clarification turn maximum — then `human_fallback`
