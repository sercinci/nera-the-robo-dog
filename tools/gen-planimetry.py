#!/usr/bin/env python3
"""
Generate per-location wayfinding planimetry images for the HOIV concierge screen.

We have no surveyed floor plan — only a coarse floor-4 LiDAR occupancy map. So this
draws a CLEAN SCHEMATIC plan and — per the team's decision — reuses the SAME layout
on every floor. Each floor's rooms (from data/directory.json) drop into the slots;
one PNG is rendered per location with a pin on its room, plus a per-floor overview.

Orientation (confirmed by the team): NORTH = top.
  - Stairs: north side, centre.
  - Lift:   north side, immediately right (east) of the stairs.
  - Main entrance: south side, GROUND FLOOR only.

  pip install pillow
  python3 tools/gen-planimetry.py
Output: assets/planimetry/<id>.png  and  assets/planimetry/floor-<n>.png

NOTE: room positions are illustrative (schematic), not a real survey of HOIV.
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "planimetry")
os.makedirs(OUT, exist_ok=True)

W, H = 1920, 1080
INK = (31, 41, 51)
PAPER = (247, 249, 251)
ROOM = (226, 232, 240)
ROOM_EDGE = (148, 163, 184)
CORRIDOR = (236, 240, 244)
CORE = (214, 222, 230)
ACCENT = (13, 148, 136)
ACCENT_FILL = (204, 240, 235)
PIN = (220, 38, 38)
MUTED = (148, 163, 184)
YOUARE = (37, 99, 235)
DOOR = (180, 83, 9)

def font(sz, bold=False):
    paths = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    for p in paths:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, sz)
            except Exception: pass
    return ImageFont.load_default()

F_TITLE = font(54, bold=True)
F_SUB = font(30)
F_ROOM = font(30, bold=True)
F_SMALL = font(24)
F_TAG = font(22, bold=True)

# --- plan geometry (shared by every floor); NORTH = top ---
PX0, PY0, PX1, PY1 = 150, 210, 1770, 980          # outer wall
NY0, NY1 = 236, 500                                 # north band (rooms + stair/lift core)
COR_Y0, COR_Y1 = 545, 615                           # horizontal corridor
SY0, SY1 = 660, 954                                 # south band (rooms)
COLS = [(176, 547), (575, 946), (974, 1345), (1373, 1744)]  # 4 columns
STAIRS = (COLS[1][0], NY0, COLS[1][1], NY1)         # north-centre
LIFT = (COLS[2][0], NY0, COLS[2][1], NY1)           # north, right of stairs
# 6 room slots: two north flanks (cols 0 & 3) + four along the south
SLOTS = [
    (COLS[0][0], NY0, COLS[0][1], NY1),  # NW
    (COLS[3][0], NY0, COLS[3][1], NY1),  # NE
    (COLS[0][0], SY0, COLS[0][1], SY1),  # S0
    (COLS[1][0], SY0, COLS[1][1], SY1),  # S1
    (COLS[2][0], SY0, COLS[2][1], SY1),  # S2
    (COLS[3][0], SY0, COLS[3][1], SY1),  # S3
]
DOOR_CX = (PX0 + PX1) // 2

FLOOR_NAMES = {1: "Ground floor", 2: "Second floor", 3: "Third floor", 4: "Fourth floor"}
EVENT_ROOM = {
    "evt-001": "room-atrium", "evt-002": "room-robotics", "evt-003": "room-board",
    "evt-004": "room-workshop", "evt-005": "room-cafe",
}

def rrect(d, box, radius, fill, outline=None, width=1):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

def ctext(d, cx, cy, text, fnt, fill, anchor="mm"):
    d.text((cx, cy), text, font=fnt, fill=fill, anchor=anchor)

def wrap(text, n):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 <= n: cur = (cur + " " + w).strip()
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def draw_pin(d, cx, cy):
    r = 26
    d.ellipse([cx - r, cy - r - 34, cx + r, cy + r - 34], fill=PIN, outline=(255, 255, 255), width=4)
    d.polygon([(cx - 16, cy - 24), (cx + 16, cy - 24), (cx, cy + 6)], fill=PIN)
    d.ellipse([cx - 9, cy - 44, cx + 9, cy - 26], fill=(255, 255, 255))

def badge(d, cx, cy, text, color):
    bb = d.textbbox((0, 0), text, font=F_TAG)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    padx, pady, dot = 22, 12, 12
    w = tw + padx * 2 + dot + 10
    h = th + pady * 2
    x0, y0 = cx - w // 2, cy - h // 2
    rrect(d, [x0, y0, x0 + w, y0 + h], h // 2, (255, 255, 255), outline=color, width=4)
    d.ellipse([x0 + padx - 2, cy - dot // 2, x0 + padx - 2 + dot, cy + dot // 2], fill=color)
    d.text((x0 + padx + dot + 8, cy), text, font=F_TAG, fill=color, anchor="lm")

def render(floor, rooms_on_floor, target_slot, header_main, header_sub, fname):
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    # title bar
    d.rectangle([0, 0, W, 150], fill=INK)
    d.text((60, 40), header_main, font=F_TITLE, fill=(255, 255, 255))
    d.text((62, 104), header_sub, font=F_SUB, fill=(160, 174, 192))
    ctext(d, W - 120, 75, f"F{floor}", font(64, bold=True), ACCENT)

    # outer wall + corridor
    rrect(d, [PX0, PY0, PX1, PY1], 18, (255, 255, 255), outline=INK, width=10)
    d.rectangle([PX0 + 12, COR_Y0, PX1 - 12, COR_Y1], fill=CORRIDOR)
    ctext(d, (PX0 + PX1) // 2, (COR_Y0 + COR_Y1) // 2, "C O R R I D O R", F_SMALL, MUTED)

    # stair + lift core (north)
    for box, label in ((STAIRS, "STAIRS"), (LIFT, "LIFT")):
        rrect(d, list(box), 12, CORE, outline=INK, width=4)
        ctext(d, (box[0] + box[2]) // 2, (box[1] + box[3]) // 2, label, F_ROOM, INK)

    # rooms into slots
    for i, (x0, y0, x1, y1) in enumerate(SLOTS):
        room = rooms_on_floor[i] if i < len(rooms_on_floor) else None
        is_t = (i == target_slot)
        fill = ACCENT_FILL if is_t else (ROOM if room else (242, 245, 248))
        edge = ACCENT if is_t else ROOM_EDGE
        rrect(d, [x0, y0, x1, y1], 12, fill, outline=edge, width=6 if is_t else 3)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        if room:
            lines = wrap(room["label"], 14)
            ty = cy - (len(lines) - 1) * 19 + (18 if is_t else 0)
            for ln in lines:
                ctext(d, cx, ty, ln, F_ROOM, (15, 80, 75) if is_t else INK)
                ty += 38
            if not is_t:
                ctext(d, cx, y1 - 30, room["id"], F_SMALL, MUTED)
        else:
            ctext(d, cx, cy, "—", F_ROOM, MUTED)
        if is_t:
            draw_pin(d, cx, y0 + 66)

    # arrival point: south entrance (ground floor) or the lift/stair core (upper floors)
    if floor == 1:
        d.rectangle([DOOR_CX - 95, PY1 - 12, DOOR_CX + 95, PY1 + 12], fill=PAPER)  # gap in south wall
        d.rectangle([DOOR_CX - 95, PY1 - 6, DOOR_CX + 95, PY1 + 6], fill=DOOR)
        d.arc([DOOR_CX - 95, PY1 - 190, DOOR_CX + 95, PY1 + 2], start=270, end=360, fill=DOOR, width=4)
        badge(d, DOOR_CX, PY1 - 40, "YOU ARE HERE · MAIN ENTRANCE (S)", YOUARE)
    else:
        badge(d, (STAIRS[2] + LIFT[0]) // 2, NY1 - 40, "YOU ARE HERE · LIFT / STAIRS (N)", YOUARE)

    # footer
    ctext(d, W - 130, 760, "N", font(34, bold=True), INK)  # compass
    d.line([W - 130, 740, W - 130, 700], fill=INK, width=4)
    d.polygon([(W - 130, 690), (W - 140, 712), (W - 120, 712)], fill=INK)
    d.text((W - 175, 772), "north", font=F_SMALL, fill=MUTED)
    d.text((60, H - 92), "Schematic wayfinding plan — illustrative layout (not a surveyed floor plan).",
           font=F_SMALL, fill=MUTED)
    d.text((60, H - 56), "● destination", font=F_TAG, fill=PIN)
    d.text((360, H - 56), "● you are here", font=F_TAG, fill=YOUARE)

    img.save(os.path.join(OUT, fname))
    return fname

def main():
    data = json.load(open(os.path.join(ROOT, "data", "directory.json")))
    items = data if isinstance(data, list) else next((v for v in data.values() if isinstance(v, list)), [])
    by_floor = {}
    for e in items:
        if e.get("kind") == "room":
            by_floor.setdefault(e["floor"], []).append(e)

    made = []
    for fl, rooms in sorted(by_floor.items()):
        made.append(render(fl, rooms, -1, f"{FLOOR_NAMES.get(fl, f'Floor {fl}')}",
                           "HOIV building directory", f"floor-{fl}.png"))
    for fl, rooms in by_floor.items():
        for slot, room in enumerate(rooms):
            made.append(render(fl, rooms, slot, room["label"],
                               f"{FLOOR_NAMES.get(fl, f'Floor {fl}')} · {room['id']}", f"{room['id']}.png"))
    for e in items:
        if e.get("kind") != "event":
            continue
        fl = e["floor"]; rooms = by_floor.get(fl, [])
        slot = next((i for i, r in enumerate(rooms) if r["id"] == EVENT_ROOM.get(e["id"])), 0)
        made.append(render(fl, rooms, slot, e["label"],
                           f"{FLOOR_NAMES.get(fl, f'Floor {fl}')} · event · {e['id']}", f"{e['id']}.png"))

    print(f"wrote {len(made)} images to assets/planimetry/")

if __name__ == "__main__":
    main()
