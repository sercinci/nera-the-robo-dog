#!/usr/bin/env python3
# © Gerald Pögl / Hunter-ID MemoryBlock BG FlexCo (FN 658892i)
#
# Extract named waypoints from a ROS 2 MCAP bag by interactively
# walking through the bag's /utlidar/robot_pose stream.
#
# Usage:
#   pip install mcap mcap-ros2-support
#   python3 tools/extract-waypoints.py --bag "LiDAR data/debug_big_walkaround_20260514_184542_0.mcap"
#
# The script prints poses at regular intervals. You walk the building,
# stop at each destination, note the timestamp, then label it here.
#
# Output: prints a JSON block ready to paste into the relevant
#         skills/navigate-floor-X/waypoints.json

import argparse
import json
import math
import sys

def yaw_from_quaternion(x, y, z, w):
    return math.degrees(math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))

def extract_poses(bag_path: str, topic: str = "/utlidar/robot_pose", sample_every: int = 50):
    """Read all poses from the bag and print a sampled list with timestamps."""
    try:
        from mcap_ros2.reader import McapReader
    except ImportError:
        print("Install: pip install mcap mcap-ros2-support", file=sys.stderr)
        sys.exit(1)

    poses = []
    with open(bag_path, "rb") as f:
        reader = McapReader(f)
        for schema, channel, message, ros_msg in reader.iter_decoded_messages(topics=[topic]):
            p = ros_msg.pose.position
            o = ros_msg.pose.orientation
            t = ros_msg.header.stamp.sec + ros_msg.header.stamp.nanosec * 1e-9
            poses.append({
                "t": round(t, 2),
                "x": round(p.x, 3),
                "y": round(p.y, 3),
                "yaw": round(yaw_from_quaternion(o.x, o.y, o.z, o.w), 1)
            })

    print(f"Total pose messages: {len(poses)}", file=sys.stderr)
    print(f"Duration: {poses[-1]['t'] - poses[0]['t']:.1f}s", file=sys.stderr)
    print(f"\nSampled poses (every {sample_every}):", file=sys.stderr)
    print(f"{'#':>5}  {'t':>10}  {'x':>8}  {'y':>8}  {'yaw':>8}")
    for i, p in enumerate(poses[::sample_every]):
        print(f"{i*sample_every:>5}  {p['t']:>10.1f}  {p['x']:>8.3f}  {p['y']:>8.3f}  {p['yaw']:>8.1f}")
    return poses

def interactive_label(poses):
    """
    Interactively label waypoints by timestamp.
    Run this after reviewing the sampled output above.
    """
    print("\n--- WAYPOINT LABELING ---")
    print("Enter timestamp (t) and destinationId for each waypoint.")
    print("Type 'done' when finished.\n")

    labeled = {}
    while True:
        t_str = input("Timestamp (or 'done'): ").strip()
        if t_str.lower() == "done":
            break
        try:
            t = float(t_str)
        except ValueError:
            print("Invalid timestamp.")
            continue

        # Find closest pose
        closest = min(poses, key=lambda p: abs(p["t"] - t))
        print(f"  → Closest pose: x={closest['x']}, y={closest['y']}, yaw={closest['yaw']}")

        dest_id = input("  destinationId (e.g. 'robotics-club'): ").strip()
        label   = input("  label (e.g. 'Robotics Club'): ").strip()
        floor   = input("  floor (0/2/3/4): ").strip()

        labeled[dest_id] = {
            "x": closest["x"],
            "y": closest["y"],
            "yaw": closest["yaw"],
            "label": label,
            "floor": int(floor)
        }
        print(f"  ✅ Saved: {dest_id}\n")

    return labeled

def output_by_floor(labeled: dict):
    """Print waypoints.json content grouped by floor."""
    floors = {}
    for dest_id, wp in labeled.items():
        f = wp.pop("floor")
        floors.setdefault(f, {})[dest_id] = wp

    for floor, waypoints in sorted(floors.items()):
        print(f"\n--- skills/navigate-floor-{floor}/waypoints.json ---")
        out = {
            "_comment": f"Floor {floor} waypoints in Nav2 map frame.",
            "_status": "extracted from MCAP bag",
            "waypoints": waypoints
        }
        print(json.dumps(out, indent=2))

def main():
    parser = argparse.ArgumentParser(description="Extract waypoints from ROS2 MCAP bag")
    parser.add_argument("--bag", required=True, help="Path to .mcap file")
    parser.add_argument("--topic", default="/utlidar/robot_pose")
    parser.add_argument("--sample-every", type=int, default=50,
                        help="Print every Nth pose for orientation (default: 50)")
    parser.add_argument("--non-interactive", action="store_true",
                        help="Just print sampled poses, no labeling")
    args = parser.parse_args()

    poses = extract_poses(args.bag, args.topic, args.sample_every)

    if not args.non_interactive:
        labeled = interactive_label(poses)
        if labeled:
            output_by_floor(labeled)
    else:
        print(json.dumps(poses[::args.sample_every], indent=2))

if __name__ == "__main__":
    main()
