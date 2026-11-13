// The pictures EMBEDDED in a PDF, taken out directly from its structure (not cut from a rendered page). Shared by the iOS app (appended to AppDelegate.swift by
// tools/patch_ios.py) and by the macOS PDFKit probe (tools/pdfkit-probe), so the probe runs exactly the code that ships.
// Each picture comes back as JPEG with its pixel size, its page and whether it carries a soft mask (see-through areas: adverts and logos usually do, photos rarely do).
import Foundation
import PDFKit
import ImageIO
import CoreGraphics

private func pdfName(_ dict: CGPDFDictionaryRef, _ key: String) -> String? {
    var value: UnsafePointer<CChar>? = nil
    return CGPDFDictionaryGetName(dict, key, &value) ? value.map { String(cString: $0) } : nil
}

/// The number of colour components of an image's colour space when it is plain RGB or grey (3 or 1); nil for anything else (indexed, CMYK, ...).
private func pdfComponents(_ dict: CGPDFDictionaryRef) -> Int? {
    if let name = pdfName(dict, "ColorSpace") { return name == "DeviceRGB" ? 3 : (name == "DeviceGray" ? 1 : nil) }
    var array: CGPDFArrayRef? = nil
    guard CGPDFDictionaryGetArray(dict, "ColorSpace", &array), let arr = array else { return nil }
    var first: UnsafePointer<CChar>? = nil
    guard CGPDFArrayGetName(arr, 0, &first), let f = first else { return nil }
    let kind = String(cString: f)
    if kind == "ICCBased" {
        var stream: CGPDFStreamRef? = nil
        guard CGPDFArrayGetStream(arr, 1, &stream), let st = stream, let sd = CGPDFStreamGetDictionary(st) else { return nil }
        var n: CGPDFInteger = 0
        guard CGPDFDictionaryGetInteger(sd, "N", &n) else { return nil }
        return (n == 3 || n == 1) ? Int(n) : nil
    }
    return kind == "CalRGB" ? 3 : (kind == "CalGray" ? 1 : nil)
}

private func jpegData(_ image: CGImage) -> Data? {
    let out = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(out, "public.jpeg" as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
    return CGImageDestinationFinalize(dest) ? out as Data : nil
}

private func pdfImage(_ stream: CGPDFStreamRef, _ dict: CGPDFDictionaryRef, width: Int, height: Int) -> Data? {
    var format = CGPDFDataFormat.raw
    guard let cf = CGPDFStreamCopyData(stream, &format) else { return nil }
    let data = cf as Data
    switch format {
    case .jpegEncoded:
        return data                                        // already a JPEG file
    case .JPEG2000:
        guard let src = CGImageSourceCreateWithData(data as CFData, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
        return jpegData(img)
    default:                                               // decoded bytes: rebuild the picture from them (8 bits, RGB or grey)
        var bpc: CGPDFInteger = 8
        _ = CGPDFDictionaryGetInteger(dict, "BitsPerComponent", &bpc)
        guard bpc == 8, let n = pdfComponents(dict), data.count >= width * height * n, let provider = CGDataProvider(data: data as CFData) else { return nil }
        let space = n == 3 ? CGColorSpaceCreateDeviceRGB() : CGColorSpaceCreateDeviceGray()
        guard let img = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 8 * n, bytesPerRow: width * n, space: space,
                                bitmapInfo: CGBitmapInfo(rawValue: 0), provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { return nil }
        return jpegData(img)
    }
}

private func collect(_ xobjects: CGPDFDictionaryRef, page: Int, depth: Int, limit: Int, into out: inout [[String: Any]]) {
    var found: [(CGPDFStreamRef, CGPDFDictionaryRef)] = []
    CGPDFDictionaryApplyBlock(xobjects, { _, object, info in
        var stream: CGPDFStreamRef? = nil
        if CGPDFObjectGetValue(object, .stream, &stream), let st = stream, let d = CGPDFStreamGetDictionary(st) {
            info!.assumingMemoryBound(to: [(CGPDFStreamRef, CGPDFDictionaryRef)].self).pointee.append((st, d))
        }
        return true
    }, &found)
    for (stream, dict) in found {
        if out.count >= limit { return }
        let subtype = pdfName(dict, "Subtype")
        if subtype == "Form", depth < 2 {                  // a picture can sit inside a form
            var res: CGPDFDictionaryRef? = nil, inner: CGPDFDictionaryRef? = nil
            if CGPDFDictionaryGetDictionary(dict, "Resources", &res), let r = res, CGPDFDictionaryGetDictionary(r, "XObject", &inner), let x = inner { collect(x, page: page, depth: depth + 1, limit: limit, into: &out) }
            continue
        }
        guard subtype == "Image" else { continue }
        var w: CGPDFInteger = 0, h: CGPDFInteger = 0; var stencil: CGPDFBoolean = 0
        guard CGPDFDictionaryGetInteger(dict, "Width", &w), CGPDFDictionaryGetInteger(dict, "Height", &h), w >= 80, h >= 80, w * h <= 40_000_000 else { continue }
        if CGPDFDictionaryGetBoolean(dict, "ImageMask", &stencil), stencil != 0 { continue }
        var mask: CGPDFStreamRef? = nil
        let hasMask = CGPDFDictionaryGetStream(dict, "SMask", &mask) || CGPDFDictionaryGetStream(dict, "Mask", &mask)
        guard let jpeg = pdfImage(stream, dict, width: Int(w), height: Int(h)) else { continue }
        out.append(["image": jpeg.base64EncodedString(), "width": Int(w), "height": Int(h), "page": page, "hasMask": hasMask])
    }
}

/// Up to `maxImages` pictures embedded in the first `maxPages` pages, in page order.
func touchRecipeExtractPdfImages(_ document: PDFDocument, maxPages: Int, maxImages: Int) -> [[String: Any]] {
    guard let cg = document.documentRef else { return [] }
    var out: [[String: Any]] = []
    let pages = min(cg.numberOfPages, maxPages)
    if pages < 1 { return [] }
    for p in 1...pages {
        guard let page = cg.page(at: p), let dict = page.dictionary else { continue }
        var res: CGPDFDictionaryRef? = nil, xo: CGPDFDictionaryRef? = nil
        guard CGPDFDictionaryGetDictionary(dict, "Resources", &res), let r = res, CGPDFDictionaryGetDictionary(r, "XObject", &xo), let x = xo else { continue }
        collect(x, page: p - 1, depth: 0, limit: maxImages, into: &out)
        if out.count >= maxImages { break }
    }
    return out
}
