# navigate_floor_4 — Floor 4: East Wing

## Purpose
Resolves a `destinationId` on Floor 4 to a (x, y, yaw) waypoint in the LiDAR map frame.

**Only call this skill for Floor 4 destinations.**
This is the primary floor for the Robotics Meetup (Use-Case 1 demo target).

---

## When to Use
`DirectoryEntry.floor === 4`

---

## Floor 4 Destinations

| destinationId | Label | Status |
|---|---|---|
| `robotics-club` | Robotics Club | ⚠️ needs mapping |
| `robotics-meetup-1700` | Robotics Meetup (event) | ⚠️ needs mapping — same room as robotics-club |

---

## Coordinate System
- Frame: `map`, meters (x,y), degrees (yaw)
- Run `tools/extract-waypoints.py` to populate `waypoints.json`

## Priority
Floor 4 is the **Use-Case 1 demo floor** (Robotics Meetup). Map this floor first.

## Reference Files
| File | Purpose |
|---|---|
| `waypoints.json` | destinationId → {x, y, yaw} for Floor 4 |
| `../../tools/extract-waypoints.py` | Extract waypoints from MCAP bag |
| `../../LiDAR data/metadata.yaml` | Bag file metadata (topics, message counts) |
