# find_place — Test Cases

Reference directory.json entries:
- `ministry-of-magic` — aliases: ["reception", "front desk", "not reception", "the desk", "help"]
- `robotics-club` — aliases: ["robotics", "robot club", "makerspace robots", "robotics meetup"]
- `makerspace` — aliases: ["maker space", "workshop", "hackerspace", "lab"]
- `robotics-meetup-1700` — aliases: ["the meetup", "robotics event", "robot talk"]

---

## ✅ Single match — should return destinationId

| # | Input query | Expected destinationId | confidence | Matched via |
|---|---|---|---|---|
| 1 | "robotics club" | `robotics-club` | 1.0 | alias exact |
| 2 | "the robotics club" | `robotics-club` | 0.85 | substring |
| 3 | "robotics" | `robotics-club` | 1.0 | alias exact |
| 4 | "makerspace" | `makerspace` | 1.0 | label exact |
| 5 | "workshop" | `makerspace` | 1.0 | alias exact |
| 6 | "lab" | `makerspace` | 1.0 | alias exact |
| 7 | "reception" | `ministry-of-magic` | 1.0 | alias exact |
| 8 | "front desk" | `ministry-of-magic` | 1.0 | alias exact |
| 9 | "the meetup" | `robotics-meetup-1700` | 1.0 | alias exact |
| 10 | "I'm going to the makerspace" | `makerspace` | 0.85 | substring |

---

## ⚠️ Ambiguous — should return candidates

| # | Input query | Expected behavior |
|---|---|---|
| 11 | "robotics" (if robotics-club AND robotics-meetup both score 1.0) | `null` + candidates[] |

---

## ❌ No match — should return null

| # | Input query | Expected destinationId | confidence |
|---|---|---|---|
| 12 | "sushi bar" | `null` | 0 |
| 13 | "parking" | `null` | 0 |
| 14 | "" (empty) | `null` | 0 |

---

## Edge Cases

| # | Scenario | Expected behavior |
|---|---|---|
| 15 | "MAKERSPACE" (all caps) | Should match — case-insensitive |
| 16 | "maker space" (with space) | Should match `makerspace` via alias |
| 17 | "I want to go to the lab please" | Should match `makerspace` via substring on alias "lab" |
