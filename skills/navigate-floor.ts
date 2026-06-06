// © Gerald Pögl / Hunter-ID MemoryBlock BG FlexCo (FN 658892i)
//
// navigate_floor — resolves destinationId → (x, y, yaw) waypoint from the
// floor-specific waypoints.json. One skill, floor-scoped reference data.
// The Spine-Team Go2 sink consumes the returned waypoint and publishes
// it on /goal_pose via Foxglove WebSocket (ws://robot.local:8765).

import { z } from "zod";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill, MatchResult } from "../contracts/skill.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PoseSchema = z.object({
  x: z.number(),
  y: z.number(),
  yaw: z.number(),
});

const WaypointsFileSchema = z.object({
  waypoints: z.record(z.object({
    x: z.number().nullable(),
    y: z.number().nullable(),
    yaw: z.number().nullable(),
    label: z.string().optional(),
  })),
});

// Extend MatchResult with waypoint for the Go2 sink
export type NavResult = MatchResult & {
  waypoint?: z.infer<typeof PoseSchema>;
  floor?: number;
};

const Args = z.object({
  destinationId: z.string().describe("DirectoryEntry.id to navigate to"),
  floor: z.number().int().describe("Floor number (0, 2, 3, or 4)"),
  currentPose: PoseSchema.optional().describe("Robot's current pose from /utlidar/robot_pose"),
});

export const navigateFloor: Skill<z.infer<typeof Args>, NavResult> = {
  name: "navigate_floor",
  description:
    "Resolves a destinationId to a (x, y, yaw) waypoint for the Go2 robot. " +
    "Call this after find_person+check_appointment or find_place returns a destinationId. " +
    "Requires the floor number from DirectoryEntry.floor. " +
    "Returns the waypoint for the Spine-Team sink to publish on /goal_pose.",
  parameters: Args,

  async handler({ destinationId, floor, currentPose }, ctx) {
    ctx.log(`navigate_floor dest=${destinationId} floor=${floor}`);

    // Load floor-specific waypoints.json
    const waypointsPath = join(
      __dirname,
      `navigate-floor-${floor}`,
      "waypoints.json"
    );

    let waypointsFile: z.infer<typeof WaypointsFileSchema>;
    try {
      const raw = readFileSync(waypointsPath, "utf-8");
      waypointsFile = WaypointsFileSchema.parse(JSON.parse(raw));
    } catch {
      ctx.log(`navigate_floor: waypoints file not found floor=${floor} path=${waypointsPath}`);
      return { destinationId: null, confidence: 0 };
    }

    const wp = waypointsFile.waypoints[destinationId];
    if (!wp) {
      ctx.log(`navigate_floor: destinationId not in waypoints dest=${destinationId} floor=${floor}`);
      return { destinationId: null, confidence: 0 };
    }

    // Null coords = floor not yet mapped
    if (wp.x === null || wp.y === null || wp.yaw === null) {
      ctx.log(`navigate_floor: waypoint not yet mapped dest=${destinationId} floor=${floor}`);
      return { destinationId: null, confidence: 0 };
    }

    return {
      destinationId,
      confidence: 0.95,
      waypoint: { x: wp.x, y: wp.y, yaw: wp.yaw },
      floor,
    };
  },
};
