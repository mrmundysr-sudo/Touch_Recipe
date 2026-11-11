package com.mundymorning.touchrecipe.core.importer

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** A piece of text with its place on a page (any consistent unit; y grows downward). Comes from a PDF text layer or from OCR. */
data class TextLine(val text: String, val left: Float, val top: Float, val right: Float, val bottom: Float, val page: Int = 0, val confidence: Float? = null) {
    val height get() = bottom - top
    val width get() = right - left
    val midY get() = (top + bottom) / 2
}

/**
 * Puts positioned text back into reading order. Columns are read one after the other (never interleaved),
 * rows of a table ("2 cups | flour") stay together, and paragraph gaps become blank lines.
 */
object LayoutReader {
    fun read(lines: List<TextLine>): String {
        val out = StringBuilder()
        val pages = lines.filter { it.text.isNotBlank() }.groupBy { it.page }.toSortedMap().mapValues { mergeRows(it.value) }
        // running headers and footers: the same line (page numbers aside) at the edge of most pages
        val edgeKeys = pages.values.map { rows -> val s = rows.sortedBy { it.top }; (s.take(2) + s.takeLast(2)).map { furnitureKey(it.text) }.toSet() }
        val furniture = if (pages.size < 2) emptySet() else edgeKeys.flatten().groupingBy { it }.eachCount().filter { it.value >= maxOf(2, (pages.size * 0.6).toInt()) && it.key.length >= 4 }.keys
        val dropped = mutableListOf<String>()
        for ((_, allRows) in pages) {
            val sortedRows = allRows.sortedBy { it.top }
            val edge = (sortedRows.take(2) + sortedRows.takeLast(2)).filter { furnitureKey(it.text) in furniture }.toSet()
            dropped += edge.map { it.text }
            val rows = allRows.filter { it !in edge }
            if (rows.isEmpty()) continue
            val h = median(rows.map { it.height }).coerceAtLeast(0.001f)
            val ordered = mutableListOf<List<TextLine>>()
            cut(rows, h, ordered, 0)
            for (block in ordered) {
                var prev: TextLine? = null
                for (l in block) {
                    if (prev != null && l.top - prev.bottom > h * 0.9f) out.append('\n')
                    out.append(l.text.trim()).append('\n'); prev = l
                }
                out.append('\n')
            }
        }
        // a web address printed in the footer is the recipe's source: keep it once, on its own line
        Regex("""https?://\S+""").find(dropped.joinToString(" "))?.value?.let { out.append("\n").append(it).append("\n") }
        return out.toString().replace(Regex("""\n{3,}"""), "\n\n").trim()
    }

    private fun furnitureKey(s: String) = s.replace(Regex("""\d+"""), "#").replace(Regex("""\s+"""), " ").trim().lowercase()

    private fun median(v: List<Float>): Float = if (v.isEmpty()) 0f else v.sorted()[v.size / 2]

    /** Joins fragments that sit on one baseline with only a word gap between them. Wider gaps stay separate cells. */
    private fun mergeRows(src: List<TextLine>): List<TextLine> {
        val h = median(src.map { it.height }).coerceAtLeast(0.001f)
        val sorted = src.sortedWith(compareBy({ it.midY }, { it.left }))
        val bands = mutableListOf<MutableList<TextLine>>()
        for (l in sorted) {
            val band = bands.lastOrNull()
            if (band != null && abs(band.first().midY - l.midY) < h * 0.45f) band += l else bands += mutableListOf(l)
        }
        val out = mutableListOf<TextLine>()
        for (band in bands) {
            var cur: TextLine? = null
            for (l in band.sortedBy { it.left }) {
                val c = cur
                cur = if (c != null && l.left - c.right < h * 1.2f)
                    TextLine(if (l.left - c.right > h * 0.15f || c.text.endsWith(' ') || l.text.startsWith(' ')) c.text.trimEnd() + " " + l.text.trimStart() else c.text + l.text,
                        c.left, min(c.top, l.top), max(c.right, l.right), max(c.bottom, l.bottom), c.page, listOfNotNull(c.confidence, l.confidence).minOrNull())
                else { if (c != null) out += c; l }
            }
            cur?.let { out += it }
        }
        return out
    }

    /** Recursive XY-cut: split a region at a clear vertical gutter (columns) or else at its widest horizontal gap. */
    private fun cut(lines: List<TextLine>, h: Float, out: MutableList<List<TextLine>>, depth: Int) {
        if (lines.size <= 2 || depth > 12) { out += rowsInOrder(lines, h); return }
        val gutter = verticalGutter(lines, h)
        if (gutter != null) {
            val left = lines.filter { (it.left + it.right) / 2 < gutter }; val right = lines.filter { (it.left + it.right) / 2 >= gutter }
            if (left.isNotEmpty() && right.isNotEmpty() && !isTable(left, right, h)) { cut(left, h, out, depth + 1); cut(right, h, out, depth + 1); return }
        }
        // horizontal cut at a wide gap that leaves a part which can then be cut into columns
        val byTop = lines.sortedBy { it.top }
        val gaps = mutableListOf<Pair<Float, Int>>(); var bottom = byTop.first().bottom
        for (i in 1 until byTop.size) {
            val gap = byTop[i].top - bottom
            if (gap > h * 0.6f) gaps += gap to i
            bottom = max(bottom, byTop[i].bottom)
        }
        for ((_, at) in gaps.sortedByDescending { it.first }.take(8)) {
            val upper = byTop.subList(0, at); val lower = byTop.subList(at, byTop.size)
            if (verticalGutter(upper, h) != null || verticalGutter(lower, h) != null) { cut(upper, h, out, depth + 1); cut(lower, h, out, depth + 1); return }
        }
        out += rowsInOrder(lines, h)
    }

    /** x position of a gap that no line crosses, with at least three lines on each side. */
    private fun verticalGutter(lines: List<TextLine>, h: Float): Float? {
        if (lines.size < 6) return null
        val minX = lines.minOf { it.left }; val maxX = lines.maxOf { it.right }
        val spans = lines.map { it.left to it.right }.sortedBy { it.first }
        var reach = spans.first().second; var best: Float? = null; var bestW = h * 1.5f
        for (s in spans.drop(1)) {
            if (s.first > reach) {
                val w = s.first - reach; val x = (s.first + reach) / 2
                val l = lines.count { it.right <= x }; val r = lines.count { it.left >= x }
                if (w > bestW && l >= 3 && r >= 3 && x > minX + (maxX - minX) * 0.15f && x < minX + (maxX - minX) * 0.85f) { bestW = w; best = x }
            }
            reach = max(reach, s.second)
        }
        return best
    }

    /** True when the two sides are cells of the same rows (amount | ingredient) rather than independent columns. */
    private fun isTable(left: List<TextLine>, right: List<TextLine>, h: Float): Boolean {
        val paired = left.count { l -> right.any { abs(it.midY - l.midY) < h * 0.45f } }
        val l = left.map { it.text.length }.average(); val r = right.map { it.text.length }.average()
        val longer = if (l >= r) left else right
        // cells are short on both sides and are not sentences; a list beside running text is two columns, not a table
        return paired >= left.size * 0.7 && paired >= right.size * 0.6 && min(l, r) <= 14 && kotlin.math.max(l, r) <= 30 && longer.count { it.text.trimEnd().endsWith(".") } < longer.size * 0.3
    }

    private fun rowsInOrder(lines: List<TextLine>, h: Float): List<TextLine> {
        val sorted = lines.sortedWith(compareBy({ it.midY }, { it.left }))
        val out = mutableListOf<TextLine>()
        for (l in sorted) {
            val p = out.lastOrNull()
            if (p != null && abs(p.midY - l.midY) < h * 0.45f && l.left >= p.right)
                out[out.lastIndex] = TextLine(p.text.trimEnd() + " " + l.text.trimStart(), p.left, min(p.top, l.top), l.right, max(p.bottom, l.bottom), p.page, listOfNotNull(p.confidence, l.confidence).minOrNull())
            else out += l
        }
        return out
    }
}
