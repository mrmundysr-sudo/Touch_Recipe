// macOS PDFKit probe. Draws the invented page (spec.json) with Apple's Quartz PDF engine (the engine that made the owner's real PDF),
// opens it with PDFKit and runs EXACTLY the piece reader the iOS app ships (tools/swift/TextPieces.swift).
// Output: probe.pdf and bridge.json ({ text, lines, pages }) in the shape the app's native bridge returns.
//   swiftc -O tools/swift/TextPieces.swift tools/swift/PdfImages.swift tools/pdfkit-probe/main.swift -o probe && ./probe spec.json outdir
import Foundation
import CoreGraphics
import CoreText
import PDFKit

struct Item: Decodable { let text: String; let x: Double; let top: Double; let size: Double; let bold: Bool }
let args = CommandLine.arguments
guard args.count >= 3, let data = FileManager.default.contents(atPath: args[1]), let items = try? JSONDecoder().decode([Item].self, from: data) else { print("usage: probe spec.json outdir"); exit(2) }
let out = URL(fileURLWithPath: args[2], isDirectory: true)
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let pdfURL = out.appendingPathComponent("probe.pdf")

var box = CGRect(x: 0, y: 0, width: 612, height: 792)
guard let ctx = CGContext(pdfURL as CFURL, mediaBox: &box, [kCGPDFContextCreator as String: "pdfkit-probe"] as CFDictionary) else { print("no pdf context"); exit(1) }
ctx.beginPDFPage(nil)
ctx.translateBy(x: 0, y: 792); ctx.scaleBy(x: 1, y: -1)                       // y grows downward, like a web page printed by WebKit
for it in items {
    let font = CTFontCreateWithName((it.bold ? "Helvetica-Bold" : "Helvetica") as CFString, CGFloat(it.size), nil)
    let attr = NSAttributedString(string: it.text, attributes: [.font: font, .foregroundColor: CGColor(gray: 0.1, alpha: 1)])
    let line = CTLineCreateWithAttributedString(attr)
    ctx.saveGState()
    ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)                        // the second flip the real file has (cm -0.717 together with Tm -32)
    ctx.textPosition = CGPoint(x: it.x, y: it.top + it.size * 0.8)
    CTLineDraw(line, ctx)
    ctx.restoreGState()
}
// two pictures on the page: a colourful PHOTO (no mask) and a banner-shaped ADVERT with a see-through mask, like the owner's Veg-All PDF has
func makeImage(width: Int, height: Int, alpha: Bool, _ draw: (CGContext) -> Void) -> CGImage? {
    let info = alpha ? CGImageAlphaInfo.premultipliedLast.rawValue : CGImageAlphaInfo.noneSkipLast.rawValue
    guard let c = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: info) else { return nil }
    draw(c)
    return c.makeImage()
}
let photo = makeImage(width: 600, height: 450, alpha: false) { c in
    for i in 0..<60 {
        let t = CGFloat(i) / 60
        c.setFillColor(CGColor(red: 0.9 - 0.5 * t, green: 0.4 + 0.4 * t, blue: 0.2 + 0.6 * t, alpha: 1))
        c.fillEllipse(in: CGRect(x: 20 + CGFloat(i * 9).truncatingRemainder(dividingBy: 480), y: 20 + CGFloat(i * 17).truncatingRemainder(dividingBy: 330), width: 120, height: 100))
    }
}
let advert = makeImage(width: 750, height: 300, alpha: true) { c in
    c.setFillColor(CGColor(red: 0.8, green: 0.3, blue: 0.1, alpha: 0.5)); c.fill(CGRect(x: 0, y: 0, width: 750, height: 300))
    c.setFillColor(CGColor(red: 0.1, green: 0.1, blue: 0.1, alpha: 0.8)); c.fillEllipse(in: CGRect(x: 100, y: 50, width: 200, height: 200))
}
if let p = photo { ctx.draw(p, in: CGRect(x: 40, y: 560, width: 200, height: 150)) }
if let a = advert { ctx.draw(a, in: CGRect(x: 300, y: 560, width: 250, height: 100)) }
ctx.endPDFPage(); ctx.closePDF()

guard let doc = PDFDocument(url: pdfURL), let page = doc.page(at: 0) else { print("pdfkit could not open the pdf"); exit(1) }
let text = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
let pieces = touchRecipeTextPieces(page, index: 0)
let answer: [String: Any] = ["text": text, "lines": pieces, "pages": doc.pageCount]
let json = try JSONSerialization.data(withJSONObject: answer, options: [.sortedKeys])
try json.write(to: out.appendingPathComponent("bridge.json"))
print("PDFKit: \(text.count) characters of text, \(pieces.count) pieces; wrote bridge.json")

// the embedded pictures, taken out by the code the app ships
let found = touchRecipeExtractPdfImages(doc, maxPages: 6, maxImages: 12)
var summary: [[String: Any]] = []
for (i, item) in found.enumerated() {
    let b64 = item["image"] as? String ?? ""
    if let bytes = Data(base64Encoded: b64) { try? bytes.write(to: out.appendingPathComponent("image-\(i).jpg")) }
    summary.append(["width": item["width"] ?? 0, "height": item["height"] ?? 0, "page": item["page"] ?? 0, "hasMask": item["hasMask"] ?? false, "bytes": b64.count * 3 / 4])
}
try JSONSerialization.data(withJSONObject: summary, options: [.sortedKeys]).write(to: out.appendingPathComponent("images.json"))
print("PDF images: \(found.count) found")
