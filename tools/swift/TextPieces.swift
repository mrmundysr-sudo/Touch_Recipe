// The text layer of a PDF page as pieces with positions. Shared by the iOS app (appended to AppDelegate.swift by tools/patch_ios.py)
// and by the macOS PDFKit probe (tools/pdfkit-probe), so the probe runs exactly the code that ships.
import Foundation
import PDFKit

/// The text layer of one PDF page as pieces with positions (points, y growing downward). A piece is one WORD of PDFKit's own text,
/// with the box PDFKit gives that word's range (the same ranges PDFKit uses for text selection).
///
/// Why not per-character boxes: `characterBounds(at:)` was tried first. On a Quartz-made PDF (macOS 26 probe, 2026-11-13) its boxes drift
/// away from the string: the "N" of "CHICKEN" got the position of the next line, and by the middle of the page "Combine" came out as
/// "Com", "m", "bine" at wrong places. PDFKit's `string` itself is clean, so words are cut from the string at white space and each
/// word's box comes from `selection(for: range)`. A fraction slash (U+2044) is cut into its own piece, because the numerator, the
/// slash and the denominator of a fraction are drawn at three heights and the layout reader joins them back into "1/2".
/// PDFKit's `string` follows the order the file draws things in, which on a page with columns or a table of amounts and ingredients is not
/// the reading order; the app puts the pieces back in order (layout.js). A rotated page returns nothing, and the app then uses the plain text.
func touchRecipeTextPieces(_ page: PDFPage, index: Int) -> [[String: Any]] {
    guard page.rotation == 0, let all = page.string else { return [] }
    let ns = all as NSString
    let box = page.bounds(for: .mediaBox)
    let white = CharacterSet.whitespacesAndNewlines
    let slash: unichar = 0x2044
    var pieces: [[String: Any]] = []

    func isWhite(_ i: Int) -> Bool {
        guard let u = UnicodeScalar(ns.character(at: i)) else { return false }
        return white.contains(u)
    }
    func add(_ range: NSRange) {
        guard range.length > 0, let selection = page.selection(for: range) else { return }
        let r = selection.bounds(for: page)
        if r.isNull || r.isInfinite || r.width <= 0 || r.height <= 0 { return }
        pieces.append(["text": ns.substring(with: range),
                       "left": Double(r.minX - box.minX), "right": Double(r.maxX - box.minX),
                       "top": Double(box.maxY - r.maxY), "bottom": Double(box.maxY - r.minY),
                       "page": index])
    }
    func addWord(_ start: Int, _ end: Int) {
        var from = start
        var k = start
        while k < end {
            if ns.character(at: k) == slash {
                if k > from { add(NSRange(location: from, length: k - from)) }
                add(NSRange(location: k, length: 1))
                from = k + 1
            }
            k += 1
        }
        if from < end { add(NSRange(location: from, length: end - from)) }
    }

    let n = ns.length
    var i = 0
    while i < n {
        while i < n && isWhite(i) { i += 1 }
        let start = i
        while i < n && !isWhite(i) { i += 1 }
        if i > start { addWord(start, i) }
    }
    return pieces
}
