#!/usr/bin/env python3
"""Builds app/src/main/assets/art from the exported visual-asset package.

Usage:
    python3 -I tools/build_assets.py <extracted-package-dir> [out-dir]

The package is `touch_recipe_visual_assets.zip` (rebuild it with
`cat .touch-uploads/*/* > touch_recipe_visual_assets.zip`, sha256 in the .touchmanifest).
Needs: Pillow, psd-tools.
Output per page key: clean.webp, cutout_<N>.webp (PSD layers with alpha) and a single manifest.json.
"""
import json
import sys
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from art_map import ART_H, ART_W, PAGES  # noqa: E402


def norm(b):
    x0, y0, x1, y1 = b
    return [round(x0 / ART_W, 5), round(y0 / ART_H, 5), round((x1 - x0) / ART_W, 5), round((y1 - y0) / ART_H, 5)]


def pad_box(b, pad):
    x0, y0, x1, y1 = b
    return (max(0, x0 - pad), max(0, y0 - pad), min(ART_W, x1 + pad), min(ART_H, y1 + pad))


def xywh(b):
    x, y, w, h = b
    return (x, y, x + w, y + h)


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "app/src/main/assets/art"
    out.mkdir(parents=True, exist_ok=True)
    manifest = {"schema": "touch-recipe/art@1", "artSize": [ART_W, ART_H], "pages": {}}
    for key, page in PAGES.items():
        folder = src / "pages" / page["folder"]
        dest = out / key
        dest.mkdir(parents=True, exist_ok=True)
        clean = Image.open(folder / "clean.png").convert("RGB")
        assert clean.size == (ART_W, ART_H), (key, clean.size)
        clean.save(dest / "clean.webp", "WEBP", quality=90, method=6)
        entry = {"clean": f"art/{key}/clean.webp", "bg": page["bg"], "targets": [], "regions": {}}
        layers = {}
        psd_path = folder / "layers.psd"
        if psd_path.exists():
            psd = PSDImage.open(psd_path)
            for layer in psd:
                if layer.name.startswith("Cutout "):
                    layers[int(layer.name.split()[1])] = layer

        def export_layer(n):
            layer = layers[n]
            img = layer.composite()
            if img.mode != "RGBA":
                img = img.convert("RGBA")
            name = f"cutout_{n}.webp"
            img.save(dest / name, "WEBP", lossless=True, method=6)
            return layer.bbox, f"art/{key}/{name}"

        for t in page["targets"]:
            item = {"id": t["id"], "label": t["label"], "hint": t["hint"], "glow": t.get("glow", True)}
            if "layer" in t:
                bbox, rel = export_layer(t["layer"])
                item["layer"] = rel
                item["box"] = norm(bbox)
                item["hit"] = norm(pad_box(bbox, t.get("pad", 0)))
            else:
                bbox = xywh(t["box"])
                item["box"] = norm(bbox)
                item["hit"] = norm(pad_box(bbox, t.get("pad", 0)))
            entry["targets"].append(item)
        for name, r in page.get("regions", {}).items():
            entry["regions"][name] = norm(xywh(r))
        if "days" in page:
            d = page["days"]
            days = []
            for i in range(d["count"]):
                base = d["first"] + i * d["per"]
                bb = {n: layers[base + k].bbox for k, n in enumerate(["label", "date", "title", "cook", "servings"])}
                label_top = bb["label"][1]
                row = {n: norm(bb[n]) for n in bb}
                ph_x = d["photo_x"]  # the blank photo window sits between the day label and the title
                ph_y = label_top + d["photo_dy"]
                row["photo"] = norm((ph_x, ph_y, ph_x + d["photo_w"], ph_y + d["photo_h"]))
                tx0, ty0, tx1, ty1 = bb["title"]
                row["card"] = norm((20, label_top - 20, ART_W - 20, bb["servings"][3] + 26))
                ax, ay, aw, ah = d["action"]
                row["action"] = norm((ax, label_top + ay, ax + aw, label_top + ay + ah))
                days.append(row)
            entry["days"] = days
            for i, row in enumerate(days):
                entry["targets"].append({"id": f"day{i}", "label": f"Meal card {i + 1}", "hint": "Opens the meal", "glow": True, "box": row["card"], "hit": row["card"]})
                entry["targets"].append({"id": f"act{i}", "label": f"Meal options {i + 1}", "hint": "Assign, replace or remove the meal", "glow": True, "box": row["action"], "hit": row["action"]})
        if "cards" in page:
            cards = []
            for c in page["cards"]:
                cards.append({
                    "key": c["key"],
                    "card": norm(layers[c["card"]].bbox),
                    "head": norm(layers[c["head"]].bbox),
                    "check": norm(layers[c["check"]].bbox),
                    "qty": norm(layers[c["qty"]].bbox),
                })
            entry["cards"] = cards
            names = {"produce": "Produce", "meat": "Meat and Seafood", "dairy": "Dairy and Eggs", "pantry": "Pantry", "bakery": "Bakery"}
            for c in cards:
                x, y, w, h = c["card"]
                head = [x, y, w, round(84 / ART_H, 5)]
                entry["targets"].append({"id": f"head_{c['key']}", "label": f"{names[c['key']]} category", "hint": "Expands or collapses this category", "glow": True, "box": head, "hit": norm(pad_box((round(x * ART_W), round(y * ART_H), round((x + w) * ART_W), round((y + head[3]) * ART_H)), 12))})
        manifest["pages"][key] = entry
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print("wrote", out / "manifest.json")


if __name__ == "__main__":
    main()
