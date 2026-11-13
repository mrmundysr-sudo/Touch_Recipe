// The text layer of a PDF page as pieces with positions. Shared by the iOS app (appended to AppDelegate.swift by tools/patch_ios.py)
// and by the macOS PDFKit probe (tools/pdfkit-probe), so the probe runs exactly the code that ships.
import Foundation
import PDFKit

/// The text layer of one PDF page as pieces with positions (points, y growing downward). A piece is a run of characters on
/// one baseline with no gap. PDFKit's own `string` follows the order the file draws things in, which on a page with columns
/// or a table of amounts and ingredients is not the reading order; the app puts the pieces back in order (layout.js).
/// A rotated page returns nothing, and the app then uses the plain text.
func touchRecipeTextPieces(_ page: PDFPage, index: Int) -> [[String: Any]] {
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
