#!/usr/bin/env python3
"""
Inspect a Ship Map topology fixture (or any v.topology capture).

Subcommands:
  parts <file>                — full per-part dump (name, category, pos, size,
                                 up, modules truncated).
  modules <file> <substring>  — list parts whose modules include <substring>.
  name <file> <substring>     — list parts whose name contains <substring>
                                 (case-insensitive).
  radial <file>               — radial-mount summary: parts whose `up` is
                                 within ±15° of axial vs. those that aren't.
  fuel-lines <file>           — fuel-line linkages (source → target).
  field <file> <fid> <key>    — dump a single part's value for a single key
                                 (use dotted paths like `bounds.size.x`).
  bounds <file>               — for every part, print orgPos vs. computed
                                 body box (lat / axial extents). Catches the
                                 case where orgPos != mesh center.

Accepts both raw v.topology JSON and the `{"v.topology": {...}}` envelope.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any


def load(path: str) -> dict[str, Any]:
    raw = json.loads(Path(path).read_text())
    if "v.topology" in raw:
        return raw["v.topology"]
    return raw


def short(s: str, n: int = 26) -> str:
    return s if len(s) <= n else f"{s[: n - 1]}…"


def round_vec(v: list[float], dp: int = 3) -> list[float]:
    return [round(x, dp) for x in v]


def cmd_parts(path: str) -> None:
    topo = load(path)
    parts = topo["parts"]
    print(f"{len(parts)} parts, seq={topo.get('topologySeq', '?')}")
    print(
        f"{'name':<28} {'cat':<11} {'pos':<27} "
        f"{'size':<22} {'up':<22} modules"
    )
    for p in parts:
        s = p["bounds"]["size"]
        size = f"({s['x']:.2f},{s['y']:.2f},{s['z']:.2f})"
        pos = "(" + ",".join(f"{v:5.2f}" for v in p["orgPos"]) + ")"
        up_raw = p.get("up")
        up = "(" + ",".join(f"{v:5.2f}" for v in up_raw) + ")" if up_raw else "—"
        mods = ",".join(m for m in p["modules"][:3])
        print(
            f"{short(p['name'], 28):<28} {short(p['category'], 11):<11} "
            f"{pos:<27} {size:<22} {up:<22} {short(mods, 80)}"
        )


def cmd_modules(path: str, needle: str) -> None:
    topo = load(path)
    needle_lc = needle.lower()
    for p in topo["parts"]:
        matched = [m for m in p["modules"] if needle_lc in m.lower()]
        if matched:
            print(f"{p['name']:<28} fid={p['flightId']:<11} {matched}")


def cmd_name(path: str, needle: str) -> None:
    topo = load(path)
    needle_lc = needle.lower()
    for p in topo["parts"]:
        if needle_lc in p["name"].lower() or needle_lc in p["title"].lower():
            s = p["bounds"]["size"]
            up_raw = p.get("up", [0, 1, 0])
            print(
                f"{p['name']:<28} fid={p['flightId']:<11} "
                f"pos={round_vec(p['orgPos'], 2)} "
                f"size={round_vec([s['x'], s['y'], s['z']], 2)} "
                f"up={round_vec(up_raw, 3)}"
            )


def cmd_radial(path: str) -> None:
    topo = load(path)
    axial = []
    radial = []
    inverted = []
    for p in topo["parts"]:
        up = p.get("up")
        if up is None:
            continue
        # Angle from vessel +Y. cos(theta) = up[1] for unit vectors.
        cos_y = max(-1.0, min(1.0, up[1]))
        angle_deg = math.degrees(math.acos(cos_y))
        bucket = (
            "axial" if angle_deg < 15
            else "inverted" if angle_deg > 165
            else "radial"
        )
        (axial if bucket == "axial" else
         inverted if bucket == "inverted" else radial).append(
            (p["name"], angle_deg, round_vec(up, 3))
        )
    print(f"axial ({len(axial)}): up within 15° of +Y")
    for name, deg, up in sorted(axial, key=lambda r: r[1]):
        print(f"  {name:<26} {deg:6.2f}°  up={up}")
    print(f"\nradial ({len(radial)}): up between 15° and 165° from +Y")
    for name, deg, up in sorted(radial, key=lambda r: r[1]):
        print(f"  {name:<26} {deg:6.2f}°  up={up}")
    print(f"\ninverted ({len(inverted)}): up within 15° of −Y")
    for name, deg, up in sorted(inverted, key=lambda r: r[1]):
        print(f"  {name:<26} {deg:6.2f}°  up={up}")


def cmd_fuel_lines(path: str) -> None:
    topo = load(path)
    by_id = {p["flightId"]: p for p in topo["parts"]}
    lines = [p for p in topo["parts"] if p.get("fuelLineTarget") is not None]
    if not lines:
        print("(no fuel lines)")
        return
    for line in lines:
        src = by_id.get(line["parentFlightId"])
        tgt = by_id.get(line["fuelLineTarget"])
        src_pos = round_vec(src["orgPos"], 2) if src else "?"
        tgt_pos = round_vec(tgt["orgPos"], 2) if tgt else "?"
        print(
            f"fuelLine fid={line['flightId']:<11} "
            f"source={src['name'] if src else '?'} @ {src_pos} "
            f"→ target={tgt['name'] if tgt else '?'} @ {tgt_pos}"
        )


def cmd_field(path: str, fid_arg: str, key: str) -> None:
    topo = load(path)
    fid = int(fid_arg)
    for p in topo["parts"]:
        if p["flightId"] != fid:
            continue
        cur: Any = p
        for tok in key.split("."):
            if isinstance(cur, dict) and tok in cur:
                cur = cur[tok]
            else:
                print(f"  (key '{key}' not found on this part)")
                return
        print(cur)
        return
    print(f"  (no part with flightId={fid})")


def cmd_bounds(path: str) -> None:
    """Print orgPos vs. computed body box for every part. Catches cases where
    orgPos is the attach-node anchor rather than the mesh center."""
    topo = load(path)
    print(
        f"{'name':<26} "
        f"{'pos(z|axial|x)':<24} {'size(x|y|z)':<22} "
        f"box-lat-range box-axial-range  notes"
    )
    # Lateral axis pick (same logic as pickLateralAxis)
    x_lo = min(p["orgPos"][0] for p in topo["parts"])
    x_hi = max(p["orgPos"][0] for p in topo["parts"])
    z_lo = min(p["orgPos"][2] for p in topo["parts"])
    z_hi = max(p["orgPos"][2] for p in topo["parts"])
    use_x = (x_hi - x_lo) >= (z_hi - z_lo)
    print(f"  picked lateral axis: {'X' if use_x else 'Z'} "
          f"(X spread {x_hi - x_lo:.2f}, Z spread {z_hi - z_lo:.2f})")
    for p in topo["parts"]:
        s = p["bounds"]["size"]
        lat = p["orgPos"][0] if use_x else p["orgPos"][2]
        axial = p["orgPos"][1]
        lat_half = (s["x"] if use_x else s["z"]) / 2
        axial_half = s["y"] / 2
        box_lat = f"[{lat - lat_half:.2f},{lat + lat_half:.2f}]"
        box_axial = f"[{axial - axial_half:.2f},{axial + axial_half:.2f}]"
        pos = f"({lat:5.2f},{axial:5.2f})"
        size = f"({s['x']:.2f},{s['y']:.2f},{s['z']:.2f})"
        # Note when orgPos sits near the EDGE of the box on either axis,
        # which is the giveaway for orgPos = attach-node rather than centre.
        lat_offset_frac = abs(lat - 0) / (lat_half + 1e-9)
        notes = []
        if lat_half > 0.05 and abs(lat - 0) > 0.5 * lat_half and use_x:
            notes.append("lat-off-center")
        print(
            f"{short(p['name'], 26):<26} {pos:<24} {size:<22} "
            f"{box_lat:<16}{box_axial:<16} {' '.join(notes)}"
        )


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    sub, *rest = argv[1:]
    if sub == "parts" and len(rest) == 1:
        cmd_parts(rest[0])
    elif sub == "modules" and len(rest) == 2:
        cmd_modules(*rest)
    elif sub == "name" and len(rest) == 2:
        cmd_name(*rest)
    elif sub == "radial" and len(rest) == 1:
        cmd_radial(*rest)
    elif sub == "fuel-lines" and len(rest) == 1:
        cmd_fuel_lines(*rest)
    elif sub == "field" and len(rest) == 3:
        cmd_field(*rest)
    elif sub == "bounds" and len(rest) == 1:
        cmd_bounds(*rest)
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
