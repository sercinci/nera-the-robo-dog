# find_person — Test Cases

Reference people.json:
- `gabriela-m` — "Gabriela Müller", aliases: ["gabriela", "gaby", "gabi"], locatedAt: "robotics-club"
- `alexander-s` — "Alexander Sanchez de la Cerda", aliases: ["alexander", "alex", "the founder"], locatedAt: "ministry-of-magic"
- `vlad-p` — "Vlad Petrea", aliases: ["vlad"], locatedAt: "makerspace"

---

## ✅ Single match — should return destinationId

| # | Input name | Expected destinationId | confidence | Matched via |
|---|---|---|---|---|
| 1 | "Gabriela" | `robotics-club` | 0.95 | alias exact |
| 2 | "gabriela müller" | `robotics-club` | 0.95 | name substring |
| 3 | "gaby" | `robotics-club` | 0.95 | alias exact |
| 4 | "Gabi" | `robotics-club` | 0.95 | alias case-insensitive |
| 5 | "Alex" | `ministry-of-magic` | 0.95 | alias exact |
| 6 | "the founder" | `ministry-of-magic` | 0.95 | alias exact |
| 7 | "Vlad" | `makerspace` | 0.95 | alias exact |
| 8 | "vlad petrea" | `makerspace` | 0.95 | name substring |

---

## ⚠️ Ambiguous — multiple matches, should return candidates

| # | Input name | Expected behavior |
|---|---|---|
| 9 | "Alex" (if another "Alex" is added) | `null` + candidates[] with both persons |

---

## ❌ No match — should return null

| # | Input name | Expected destinationId | confidence |
|---|---|---|---|
| 10 | "Marco" | `null` | 0 |
| 11 | "" (empty string) | `null` | 0 |
| 12 | "the robot" | `null` | 0 |

---

## Edge Cases

| # | Scenario | Expected behavior |
|---|---|---|
| 13 | Person found but locatedAt is null | `{ destinationId: null, confidence: 0.3 }` — person exists but no location |
| 14 | Partial name "sanchez" | Should match Alexander via substring on name |
| 15 | All caps "VLAD" | Should match — case-insensitive |
