package com.mundymorning.touchrecipe.data

import com.mundymorning.touchrecipe.core.importer.TextLine
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition

/**
 * Reads the text a PDF already contains, with each word's place on the page, so the reading order can be rebuilt
 * by [com.mundymorning.touchrecipe.core.importer.LayoutReader]. No rendering and no recognition is involved:
 * a digital recipe PDF keeps its exact characters, amounts and fractions.
 */
object PdfTextLayer {
    private class Stripper(val page: Int) : PDFTextStripper() {
        val words = ArrayList<TextLine>()
        override fun writeString(text: String, textPositions: MutableList<TextPosition>) {
            if (text.isBlank() || textPositions.isEmpty()) return
            val left = textPositions.minOf { it.xDirAdj }
            val right = textPositions.maxOf { it.xDirAdj + it.widthDirAdj }
            val base = textPositions.maxOf { it.yDirAdj }
            val h = textPositions.maxOf { maxOf(it.fontSizeInPt * 0.72f, it.heightDir) }.coerceAtLeast(1f)
            words += TextLine(text, left, base - h, right, base, page)
        }
    }

    /** Words of one page (0-based) with positions in PDF points, origin at the top-left. Empty for an image-only page. */
    fun page(doc: PDDocument, index: Int): List<TextLine> {
        val s = Stripper(index)
        s.sortByPosition = false
        s.startPage = index + 1; s.endPage = index + 1
        s.getText(doc)
        return s.words
    }
}
