# navigate_floor_0 — Floor 0: Lobby & Entrance

## Purpose
Resolves a `destinationId` on Floor 0 to a concrete (x, y, yaw) waypoint in the LiDAR map frame.
Returns the waypoint for the Spine-Team Go2 sink to publish on `/goal_pose`.

**Only call this skill for Floor 0 destinations.**
The orchestrator selects the correct floor skill based on `DirectoryEntry.floor` — no LLM decision needed.

---

## When to Use
After `find_person` + `check_appointment` or `find_place` resolves a `destinationId` where `DirectoryEntry.floor === 0`.

---

## Input
```
destinationId: string   — DirectoryEntry.id (floor 0 only)
currentPose:   { x: number, y: number, yaw: number }   — from /utlidar/robot_pose
```

## Output
```
{
  destinationId: string,
  waypoint: { x: number, y: number, yaw: number },   // map frame, meters + degrees
  floor: 0,
  confidence: number
}
```

## Logic
```
1. Lookup destinationId in waypoints.json (this directory)
2. Not found → return { destinationId: null, confidence: 0 }
3. Found → return waypoint + confidence 0.95
```

---

## Floor 0 Destinations

| destinationId | Label | Status |
|---|---|---|
| `lobby` | Lobby / Reception | ✅ mapped |

---

## Coordinate System
- Frame: `map` (Nav2 map frame from LiDAR SLAM)
- Units: meters (x, y), degrees (yaw)
- Origin: set by SLAM at bag start position
- Source: extracted from `/utlidar/robot_pose` in `debug_big_walkaround_20260514_184542_0.mcap`

→ Run `tools/extract-waypoints.py` to extract real coordinates from the bag.

---

## Reference Files
| File | Purpose |
|---|---|
| `waypoints.json` | destinationId → {x, y, yaw} for Floor 0 |
| `../navigate-floor-2/SKILL.md` | Hand off if destination is Floor 2 |
| `../navigate-floor-3/SKILL.md` | Hand off if destination is Floor 3 |
| `../navigate-floor-4/SKILL.md` | Hand off if destination is Floor 4 |
| `../../tools/extract-waypoints.py` | Extracts waypoints from MCAP bag |

## Handoff
Wrong floor? The orchestrator re-routes — never call a different floor's skill directly from here.
