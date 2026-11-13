// macOS PDFKit probe. Draws the invented page (spec.json) with Apple's Quartz PDF engine (the engine that made the owner's real PDF),
// opens it with PDFKit and runs EXACTLY the piece reader the iOS app ships (tools/swift/TextPieces.swift).
// Output: probe.pdf and bridge.json ({ text, lines, pages }) in the shape the app's native bridge returns.
//   swiftc -O tools/swift/TextPieces.swift tools/pdfkit-probe/probe.swift -o probe && ./probe spec.json outdir
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
ctx.endPDFPage(); ctx.closePDF()

guard let doc = PDFDocument(url: pdfURL), let page = doc.page(at: 0) else { print("pdfkit could not open the pdf"); exit(1) }
let text = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
let pieces = touchRecipeTextPieces(page, index: 0)
let answer: [String: Any] = ["text": text, "lines": pieces, "pages": doc.pageCount]
let json = try JSONSerialization.data(withJSONObject: answer, options: [.sortedKeys])
try json.write(to: out.appendingPathComponent("bridge.json"))
print("PDFKit: \(text.count) characters of text, \(pieces.count) pieces; wrote bridge.json")
