# check_appointment — Test Cases

All times in Europe/Vienna (UTC+2).
Event: `robotics-meetup-1700` → startsAt 17:00, endsAt 19:00
Time window: ±30min → valid from 16:30 to 19:30

---

## ✅ Valid — should return destinationId

| # | person_id | now (Vienna) | Expected destinationId | confidence | Reason |
|---|---|---|---|---|---|
| 1 | `gabriela-m` | 17:00 | `robotics-club` | 0.95 | Exact start, has locatedAt |
| 2 | `gabriela-m` | 16:30 | `robotics-club` | 0.95 | Edge: startsAt - 30min |
| 3 | `gabriela-m` | 19:30 | `robotics-club` | 0.95 | Edge: endsAt + 30min |
| 4 | `gabriela-m` | 18:15 | `robotics-club` | 0.95 | Mid-event |
| 5 | `max-b` | 10:30 | `interview-1030` | 0.8 | Valid, no locatedAt → use event.id |

---

## ❌ Invalid — should return null

| # | person_id | now (Vienna) | Expected destinationId | confidence | Reason |
|---|---|---|---|---|---|
| 6 | `gabriela-m` | 16:29 | `null` | 0 | 1 min before window opens |
| 7 | `gabriela-m` | 19:31 | `null` | 0 | 1 min after window closes |
| 8 | `gabriela-m` | 09:00 | `null` | 0 | Wrong time of day |
| 9 | `lisa-w` | 17:00 | `null` | 0 | No event FK on person |
| 10 | `unknown-id` | 17:00 | `null` | 0 | Person not found |

---

## Edge Cases

| # | Scenario | Expected behavior |
|---|---|---|
| 11 | Person.event FK points to non-existent entry | Return `{ destinationId: null, confidence: 0 }` |
| 12 | Event missing startsAt | Return `{ destinationId: null, confidence: 0 }` |
| 13 | Event missing endsAt | Return `{ destinationId: null, confidence: 0 }` |
| 14 | Timezone mismatch (UTC vs Vienna) | Must normalize to Vienna before comparing — 17:00 UTC ≠ 17:00 Vienna |
