# navigate_floor_3 — Floor 3: West Wing

## Purpose
Resolves a `destinationId` on Floor 3 to a (x, y, yaw) waypoint in the LiDAR map frame.

**Only call this skill for Floor 3 destinations.**

---

## When to Use
`DirectoryEntry.floor === 3`

---

## Floor 3 Destinations

| destinationId | Label | Status |
|---|---|---|
| `boardroom` | Boardroom | ⚠️ needs mapping |
| `pitch-day-1400` | Startup Pitch Day (event) | ⚠️ needs mapping |

---

## Coordinate System
- Frame: `map`, meters (x,y), degrees (yaw)
- Run `tools/extract-waypoints.py` to populate `waypoints.json`

## Reference Files
| File | Purpose |
|---|---|
| `waypoints.json` | destinationId → {x, y, yaw} for Floor 3 |
| `../navigate-floor-4/SKILL.md` | Floor 4 handoff reference |
