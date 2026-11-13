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
# The app is declared portrait AND landscape so that ONE screen (Recipe Rescue) may rotate; MainViewController below answers "portrait only"
# for every other screen (the web layer asks for landscape through TouchRecipeOcr.setOrientation and turns it off again when it leaves).
pl["UISupportedInterfaceOrientations"] = ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"]
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
    /// Portrait only, except while the Recipe Rescue screen has asked for landscape too (TouchRecipeOcr.setOrientation).
    static var allowLandscape = false
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TouchRecipeOcrPlugin())
    }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        return MainViewController.allowLandscape ? [.portrait, .landscapeLeft, .landscapeRight] : .portrait
    }
    override var shouldAutorotate: Bool { return true }
}

/// Reads text from a photo or a PDF entirely on the device. Nothing is uploaded.
@objc(TouchRecipeOcrPlugin)
public class TouchRecipeOcrPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TouchRecipeOcrPlugin"
    public let jsName = "TouchRecipeOcr"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognizeImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognizePdf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "renderPdfPage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setOrientation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "extractPdfImages", returnType: CAPPluginReturnPromise)
    ]

    /// The pictures embedded in a PDF (JPEG, size, page, soft mask flag), taken out directly. The web layer decides which one, if any, is the recipe photo.
    @objc func extractPdfImages(_ call: CAPPluginCall) {
        guard let b64 = call.getString("pdf"), let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters), let doc = PDFDocument(data: data) else {
            call.reject("That PDF could not be opened.")
            return
        }
        let maxPages = call.getInt("maxPages") ?? 6
        let maxImages = call.getInt("maxImages") ?? 12
        DispatchQueue.global(qos: .userInitiated).async {
            call.resolve(["images": touchRecipeExtractPdfImages(doc, maxPages: maxPages, maxImages: maxImages)])
        }
    }

    /// Lets the web layer allow landscape for one screen. `landscape: false` puts the app back to portrait (and turns the screen upright if it was sideways).
    @objc func setOrientation(_ call: CAPPluginCall) {
        let landscape = call.getBool("landscape") ?? false
        DispatchQueue.main.async {
            MainViewController.allowLandscape = landscape
            let host = self.bridge?.viewController
            if #available(iOS 16.0, *) {
                host?.setNeedsUpdateOfSupportedInterfaceOrientations()
                if !landscape, let scene = host?.view.window?.windowScene {
                    scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { _ in }
                }
            } else {
                if !landscape { UIDevice.current.setValue(UIInterfaceOrientation.portrait.rawValue, forKey: "orientation") }
                UIViewController.attemptRotationToDeviceOrientation()
            }
            call.resolve()
        }
    }

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
                var found: [[String: Any]] = forceOcr ? [] : touchRecipeTextPieces(page, index: i)
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
        src = src.replace("import Capacitor", "import Capacitor\nimport Vision\nimport PDFKit\nimport ImageIO", 1)
    # the shared piece reader (tools/swift/TextPieces.swift): same file the macOS probe compiles; its import lines are already at the top
    shared = "\n".join(l for f in ("TextPieces.swift", "PdfImages.swift") for l in (ROOT / "tools" / "swift" / f).read_text().split("\n") if not l.startswith("import "))
    delegate.write_text(src.rstrip() + "\n" + SWIFT + "\n" + shared)
story = APP / "Base.lproj" / "Main.storyboard"
t = story.read_text()
if 'customClass="CAPBridgeViewController" customModule="Capacitor"' in t:
    t = t.replace('customClass="CAPBridgeViewController" customModule="Capacitor"', 'customClass="MainViewController" customModule="App" customModuleProvider="target"')
    story.write_text(t)
assert "MainViewController" in story.read_text(), "Main.storyboard was not pointed at MainViewController"
assert "TouchRecipeOcrPlugin" in delegate.read_text() and "func touchRecipeTextPieces" in delegate.read_text() and "setOrientation" in delegate.read_text() and "touchRecipeExtractPdfImages" in delegate.read_text(), "AppDelegate.swift was not patched"

print("iOS project patched; AppIcon is opaque RGB 1024x1024; text-recognition bridge installed.")
