#!/usr/bin/env python3
"""Draws touch targets and dynamic regions over the artwork so cut pieces can be verified.

    python3 -I tools/mapping_sheet.py [assets-art-dir] [out-dir]

red = glow/object box, blue = hit region, green = code-rendered content window.
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
art = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "app/src/main/assets/art"
out = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "docs/art-map"
out.mkdir(parents=True, exist_ok=True)
m = json.loads((art / "manifest.json").read_text())
W, H = m["artSize"]


def rect(d, b, color, width=3):
    x, y, w, h = b
    d.rectangle([x * W, y * H, (x + w) * W, (y + h) * H], outline=color, width=width)


for key, p in m["pages"].items():
    im = Image.open(art / key / "clean.webp").convert("RGB")
    d = ImageDraw.Draw(im, "RGBA")
    for t in p["targets"]:
        rect(d, t["hit"], (30, 90, 255, 255))
        rect(d, t["box"], (255, 40, 40, 255), 2)
        d.text((t["hit"][0] * W + 4, t["hit"][1] * H + 4), t["id"], fill=(255, 255, 255, 255))
    for n, r in p["regions"].items():
        rect(d, r, (0, 200, 60, 255))
        d.text((r[0] * W + 4, r[1] * H + 4), n, fill=(0, 120, 0, 255))
    for i, day in enumerate(p.get("days", [])):
        for n, r in day.items():
            rect(d, r, (0, 200, 60, 255), 2)
    for c in p.get("cards", []):
        for n, r in c.items():
            if n != "key":
                rect(d, r, (200, 0, 200, 255), 2)
    im.save(out / f"{key}.png")
    print("wrote", out / f"{key}.png")
