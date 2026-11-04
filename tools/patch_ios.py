#!/usr/bin/env python3
"""Run after `npx cap add ios` + `npx cap sync ios` (the portfolio TestFlight launcher does this when the file exists).
Portrait-only iPhone, hidden status bar (the artwork is full-bleed), export compliance, an OPAQUE app icon
(no alpha channel) and a green launch screen. The shared www/ folder is NOT edited; only the generated copy in ios/ is patched."""
import json
import plistlib
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "ios" / "App" / "App"
BG = (0x1F, 0x4D, 0x3A)

pl_path = APP / "Info.plist"
pl = plistlib.loads(pl_path.read_bytes())
pl["UISupportedInterfaceOrientations"] = ["UIInterfaceOrientationPortrait"]
pl.pop("UISupportedInterfaceOrientations~ipad", None)
pl["UIRequiredDeviceCapabilities"] = ["arm64"]
pl["UIRequiresFullScreen"] = True
pl["UIStatusBarHidden"] = True
pl["UIViewControllerBasedStatusBarAppearance"] = False
pl["ITSAppUsesNonExemptEncryption"] = False
pl["CFBundleDisplayName"] = "Touch Recipe"
pl["NSCameraUsageDescription"] = "Touch Recipe uses the camera to photograph a recipe or add a photo to one."
pl["NSPhotoLibraryUsageDescription"] = "Touch Recipe lets you choose a photo or scan for a recipe from your library."
pl["NSPhotoLibraryAddUsageDescription"] = "Touch Recipe can save recipe photos you take."
pl_path.write_bytes(plistlib.dumps(pl))

src = Image.open(ROOT / "tools" / "icons" / "icon-1024.png").convert("RGBA")
flat = Image.new("RGB", (1024, 1024), BG)
flat.paste(src, (0, 0), src)
iconset = APP / "Assets.xcassets" / "AppIcon.appiconset"
for f in iconset.glob("*"):
    f.unlink()
flat.save(iconset / "AppIcon-1024.png", "PNG")
(iconset / "Contents.json").write_text(json.dumps({
    "images": [{"filename": "AppIcon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
    "info": {"author": "xcode", "version": 1}}, indent=2))

splash = APP / "Assets.xcassets" / "Splash.imageset"
if splash.exists():
    for f in splash.glob("*.png"):
        Image.new("RGB", (2732, 2732), BG).save(f, "PNG")
for sb in APP.rglob("*.storyboard"):
    s = sb.read_text()
    s = s.replace('<color key="backgroundColor" red="1" green="1" blue="1" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>',
                  '<color key="backgroundColor" red="0.122" green="0.302" blue="0.227" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>')
    sb.write_text(s)

for p in iconset.glob("*.png"):
    im = Image.open(p)
    assert im.mode == "RGB" and "A" not in im.getbands(), f"{p} has alpha ({im.mode})"
    assert im.size == (1024, 1024)
print("iOS project patched; AppIcon is opaque RGB 1024x1024.")
