# navigate_floor_2 — Floor 2: South Wing

## Purpose
Resolves a `destinationId` on Floor 2 to a (x, y, yaw) waypoint in the LiDAR map frame.
Returns the waypoint for the Spine-Team Go2 sink to publish on `/goal_pose`.

**Only call this skill for Floor 2 destinations.**

---

## When to Use
After `find_person` + `check_appointment` or `find_place` resolves a `destinationId` where `DirectoryEntry.floor === 2`.

---

## Input
```
destinationId: string
currentPose:   { x: number, y: number, yaw: number }
```

## Output
```
{
  destinationId: string,
  waypoint: { x: number, y: number, yaw: number },
  floor: 2,
  confidence: number
}
```

---

## Floor 2 Destinations

| destinationId | Label | Status |
|---|---|---|
| `coworking-a` | Coworking Space A | ⚠️ needs mapping |
| `interview-1030` | HR Interview (event) | ⚠️ needs mapping |

---

## Coordinate System
- Frame: `map` (Nav2), meters (x,y), degrees (yaw)
- Source: `/utlidar/robot_pose` from MCAP bag
- Run `tools/extract-waypoints.py` to populate `waypoints.json`

## Reference Files
| File | Purpose |
|---|---|
| `waypoints.json` | destinationId → {x, y, yaw} for Floor 2 |
| `../navigate-floor-0/SKILL.md` | Floor 0 handoff reference |
| `../navigate-floor-3/SKILL.md` | Floor 3 handoff reference |
| `../navigate-floor-4/SKILL.md` | Floor 4 handoff reference |
