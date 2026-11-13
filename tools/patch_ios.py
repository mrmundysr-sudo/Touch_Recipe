#!/usr/bin/env python3
"""Run after `npx cap add ios` + `npx cap sync ios` (the portfolio TestFlight launcher does this when the file exists).
Portrait-only iPhone, hidden status bar (the artwork is full-bleed), export compliance, an OPAQUE app icon
(no alpha channel), a green launch screen, and the on-device text-recognition bridge (Apple Vision + PDFKit) that powers
Scan a Recipe and PDF import. The shared www/ folder is NOT edited; only the generated copy in ios/ is patched."""
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

# ---- native text recognition bridge (Apple Vision + PDFKit) ----
# Appended to AppDelegate.swift so the Xcode project file never needs editing (the app target already compiles that file).
SWIFT = r'''

// ===== Touch Recipe on-device text recognition (added by tools/patch_ios.py) =====
/// Bridge view controller that registers the local plugin below.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TouchRecipeOcrPlugin())
    }
}

/// Reads text from a photo or a PDF entirely on the device. Nothing is uploaded.
@objc(TouchRecipeOcrPlugin)
public class TouchRecipeOcrPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TouchRecipeOcrPlugin"
    public let jsName = "TouchRecipeOcr"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognizeImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognizePdf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "renderPdfPage", returnType: CAPPluginReturnPromise)
    ]

    /// Recognised lines with their boxes (Vision's normalised box: origin bottom-left).
    private func observations(_ image: CGImage) -> [(text: String, box: CGRect)] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do { try handler.perform([request]) } catch { return [] }
        var found: [(text: String, box: CGRect)] = []
        for observation in request.results ?? [] {
            if let top = observation.topCandidates(1).first { found.append((text: top.string, box: observation.boundingBox)) }
        }
        return found
    }

    private func recognize(_ image: CGImage) -> String {
        return observations(image).map { $0.text }.joined(separator: "\n")
    }

    /// The same lines as pieces with positions in pixels, y growing downward, for the layout reader in the app.
    private func recognizedPieces(_ found: [(text: String, box: CGRect)], _ image: CGImage, page: Int) -> [[String: Any]] {
        let w = Double(image.width)
        let h = Double(image.height)
        return found.map { o -> [String: Any] in
            return ["text": o.text,
                    "left": Double(o.box.minX) * w, "right": Double(o.box.maxX) * w,
                    "top": (1.0 - Double(o.box.maxY)) * h, "bottom": (1.0 - Double(o.box.minY)) * h,
                    "page": page]
        }
    }

    /// The text layer of one PDF page as pieces with positions (points, y growing downward). A piece is a run of characters on
    /// one baseline with no gap. PDFKit's own `string` follows the order the file draws things in, which on a page with columns
    /// or a table of amounts and ingredients is not the reading order; the app puts the pieces back in order (layout.js).
    /// A rotated page returns nothing, and the app then uses the plain text.
    private func textPieces(_ page: PDFPage, index: Int) -> [[String: Any]] {
        guard page.rotation == 0, let all = page.string else { return [] }
        let ns = all as NSString
        let box = page.bounds(for: .mediaBox)
        var pieces: [[String: Any]] = []
        var text = ""
        var rect = CGRect.null
        var prev = CGRect.null
        func flush() {
            if !text.isEmpty && !rect.isNull {
                pieces.append(["text": text,
                               "left": Double(rect.minX - box.minX), "right": Double(rect.maxX - box.minX),
                               "top": Double(box.maxY - rect.maxY), "bottom": Double(box.maxY - rect.minY),
                               "page": index])
            }
            text = ""
            rect = CGRect.null
            prev = CGRect.null
        }
        for i in 0..<ns.length {
            let ch = ns.substring(with: NSRange(location: i, length: 1))
            if ch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { flush(); continue }
            let r = page.characterBounds(at: i)
            if r.isNull || r.isInfinite { continue }
            if !prev.isNull {
                // A piece is a word: it ends at white space (handled above), never at a small gap between two characters.
                // PDFKit's character boxes are not exact (kerning, ligatures, web fonts), and cutting at a small gap
                // split words into pieces ("s poon", "chic ken") that the layout reader then joined with spaces.
                // Only a jump that cannot happen inside a word (a whole character height of gap, going backwards, or a new baseline) ends a piece.
                let h = max(prev.height, r.height)
                let gap = r.minX - prev.maxX
                if gap > h * 1.0 || gap < -h * 1.0 || abs(r.midY - prev.midY) > h * 0.6 { flush() }
            }
            text += ch
            rect = rect.isNull ? r : rect.union(r)
            prev = r
        }
        flush()
        return pieces
    }

    @objc func recognizeImage(_ call: CAPPluginCall) {
        guard let b64 = call.getString("image"),
              let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data),
              let cg = image.cgImage else {
            call.reject("The image could not be read.")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let text = self.recognize(cg)
            call.resolve(["text": text])
        }
    }

    @objc func recognizePdf(_ call: CAPPluginCall) {
        guard let b64 = call.getString("pdf"),
              let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let doc = PDFDocument(data: data) else {
            call.reject("That PDF could not be opened.")
            return
        }
        let maxPages = call.getInt("maxPages") ?? 6
        let forceOcr = call.getBool("forceOcr") ?? false
        DispatchQueue.global(qos: .userInitiated).async {
            let count = min(doc.pageCount, maxPages)
            var parts: [String] = []
            var pieces: [[String: Any]] = []
            for i in 0..<count {
                guard let page = doc.page(at: i) else { continue }
                var text = forceOcr ? "" : (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                var found: [[String: Any]] = forceOcr ? [] : self.textPieces(page, index: i)
                if text.count < 40 {
                    // a scanned page has no text layer: render it and recognise the picture
                    let box = page.bounds(for: .mediaBox)
                    let scale = 1800.0 / max(box.width, box.height)
                    let size = CGSize(width: box.width * scale, height: box.height * scale)
                    let rendered = page.thumbnail(of: size, for: .mediaBox)
                    if let cg = rendered.cgImage {
                        let seen = self.observations(cg)
                        text = seen.map { $0.text }.joined(separator: "\n")
                        found = self.recognizedPieces(seen, cg, page: i)
                    }
                }
                parts.append(text)
                pieces.append(contentsOf: found)
            }
            // `text` is the plain reading (fallback); `lines` are the pieces with positions for the layout reader
            call.resolve(["text": parts.joined(separator: "\n\n"), "lines": pieces, "pages": count])
        }
    }

    /// One PDF page as a JPEG, so the app can show it, clean it and look for the dish photo on it.
    @objc func renderPdfPage(_ call: CAPPluginCall) {
        guard let b64 = call.getString("pdf"),
              let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let doc = PDFDocument(data: data) else {
            call.reject("That PDF could not be opened.")
            return
        }
        let index = call.getInt("page") ?? 0
        let edge = call.getDouble("maxEdge") ?? 2000.0
        DispatchQueue.global(qos: .userInitiated).async {
            guard index >= 0, index < doc.pageCount, let page = doc.page(at: index) else {
                call.reject("That page does not exist.")
                return
            }
            let box = page.bounds(for: .mediaBox)
            let scale = edge / max(Double(box.width), Double(box.height))
            let size = CGSize(width: Double(box.width) * scale, height: Double(box.height) * scale)
            let rendered = page.thumbnail(of: size, for: .mediaBox)
            guard let jpeg = rendered.jpegData(compressionQuality: 0.9) else {
                call.reject("The page could not be drawn.")
                return
            }
            call.resolve(["image": jpeg.base64EncodedString()])
        }
    }
}
'''
delegate = APP / "AppDelegate.swift"
src = delegate.read_text()
if "TouchRecipeOcrPlugin" not in src:
    if "import Vision" not in src:
        src = src.replace("import Capacitor", "import Capacitor\nimport Vision\nimport PDFKit", 1)
    delegate.write_text(src.rstrip() + "\n" + SWIFT)
story = APP / "Base.lproj" / "Main.storyboard"
t = story.read_text()
if 'customClass="CAPBridgeViewController" customModule="Capacitor"' in t:
    t = t.replace('customClass="CAPBridgeViewController" customModule="Capacitor"', 'customClass="MainViewController" customModule="App" customModuleProvider="target"')
    story.write_text(t)
assert "MainViewController" in story.read_text(), "Main.storyboard was not pointed at MainViewController"
assert "TouchRecipeOcrPlugin" in delegate.read_text(), "AppDelegate.swift was not patched"

print("iOS project patched; AppIcon is opaque RGB 1024x1024; text-recognition bridge installed.")
