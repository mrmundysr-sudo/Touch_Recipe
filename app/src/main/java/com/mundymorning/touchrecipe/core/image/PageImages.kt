package com.mundymorning.touchrecipe.core.image

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** A small picture as plain numbers (ARGB), so the analysis below runs anywhere and can be tested without a phone. */
class Pixels(val w: Int, val h: Int, val argb: IntArray) {
    init { require(w > 0 && h > 0 && argb.size == w * h) { "bad image" } }
    fun lum(i: Int): Int { val c = argb[i]; return (((c shr 16) and 255) * 299 + ((c shr 8) and 255) * 587 + (c and 255) * 114) / 1000 }
    /** 0 (grey) to 255 (vivid). */
    fun sat(i: Int): Int { val c = argb[i]; val r = (c shr 16) and 255; val g = (c shr 8) and 255; val b = c and 255; val mx = max(r, max(g, b)); val mn = min(r, min(g, b)); return if (mx == 0) 0 else (mx - mn) * 255 / mx }
}

/** A point as fractions of the image (0..1 from the top-left). */
data class Pt(val x: Float, val y: Float)

/** Four corners of a page or card in a photograph, clockwise from the top-left. [confidence] is 0..1: how well a rectangle fits what was found. */
data class Quad(val tl: Pt, val tr: Pt, val br: Pt, val bl: Pt, val confidence: Float = 1f) {
    val points get() = listOf(tl, tr, br, bl)
    companion object { val FULL = Quad(Pt(0f, 0f), Pt(1f, 0f), Pt(1f, 1f), Pt(0f, 1f), 0f) }
}

/** An upright rectangle as fractions of the image. */
data class Region(val left: Float, val top: Float, val right: Float, val bottom: Float, val confidence: Float = 1f) {
    val width get() = right - left
    val height get() = bottom - top
    fun toQuad() = Quad(Pt(left, top), Pt(right, top), Pt(right, bottom), Pt(left, bottom), confidence)
}

/**
 * Finds a recipe card or page lying on a darker surface. It only answers when a light, four-sided shape clearly stands out;
 * anything doubtful returns null and the user is offered the manual corners instead. Works on a reduced copy (about 300 px).
 */
object DocumentFinder {
    fun find(p: Pixels): Quad? {
        val n = p.w * p.h
        val lum = IntArray(n) { p.lum(it) }
        val t = otsu(lum)
        // the surface around the page is what the picture's border shows
        var borderLight = 0; var border = 0
        val bx = max(1, p.w / 25); val by = max(1, p.h / 25)
        for (y in 0 until p.h) for (x in 0 until p.w) if (x < bx || y < by || x >= p.w - bx || y >= p.h - by) { border++; if (lum[y * p.w + x] > t) borderLight++ }
        if (borderLight > border * 0.6) return null          // light all the way to the edge: the page fills the picture, or there is no contrast to go on
        val spread = lum.maxOrNull()!! - lum.minOrNull()!!
        if (spread < 50) return null
        val mask = BooleanArray(n) { lum[it] > t }
        val comp = largestComponent(mask, p.w, p.h) ?: return null
        val area = comp.size
        if (area < n * 0.12) return null
        var tl = comp[0]; var br = comp[0]; var tr = comp[0]; var bl = comp[0]
        fun x(i: Int): Int = i % p.w
        fun y(i: Int): Int = i / p.w
        var sumMin = Int.MAX_VALUE; var sumMax = Int.MIN_VALUE; var diffMin = Int.MAX_VALUE; var diffMax = Int.MIN_VALUE
        for (i in comp) {
            val sum = x(i) + y(i); val diff = x(i) - y(i)
            if (sumMin > sum) { sumMin = sum; tl = i }
            if (sumMax < sum) { sumMax = sum; br = i }
            if (diffMax < diff) { diffMax = diff; tr = i }
            if (diffMin > diff) { diffMin = diff; bl = i }
        }
        val pts = listOf(tl, tr, br, bl).map { x(it).toFloat() to y(it).toFloat() }
        val quadArea = abs(shoelace(pts))
        if (quadArea < 1f) return null
        val fit = min(area / quadArea, quadArea / area)      // 1 when the light shape is exactly this four-sided figure
        val sides = pts.indices.map { i -> val (ax, ay) = pts[i]; val (bx2, by2) = pts[(i + 1) % 4]; sqrt((ax - bx2) * (ax - bx2) + (ay - by2) * (ay - by2)) }
        if (fit < 0.82f || sides.minOrNull()!! < min(p.w, p.h) * 0.2f) return null
        // the light shape must lie inside the four corners and fill them: an L or a ragged patch is not a card
        var inside = 0
        for (i in comp) {
            val px = x(i).toFloat(); val py = y(i).toFloat(); var ok = true
            for (k in 0 until 4) { val (ax, ay) = pts[k]; val (cx, cy) = pts[(k + 1) % 4]; if ((cx - ax) * (py - ay) - (cy - ay) * (px - ax) < -1.5f * sides[k]) { ok = false; break } }
            if (ok) inside++
        }
        if (inside < area * 0.93f || inside < quadArea * 0.86f) return null
        fun pt(i: Int) = Pt((x(i) + 0.5f) / p.w, (y(i) + 0.5f) / p.h)
        return Quad(pt(tl), pt(tr), pt(br), pt(bl), fit.coerceIn(0f, 1f))
    }

    private fun shoelace(p: List<Pair<Float, Float>>): Float { var s = 0f; for (i in p.indices) { val (x1, y1) = p[i]; val (x2, y2) = p[(i + 1) % p.size]; s += x1 * y2 - x2 * y1 }; return s / 2f }

    internal fun otsu(lum: IntArray): Int {
        val hist = IntArray(256); for (v in lum) hist[v]++
        val total = lum.size; var sum = 0.0; for (i in 0..255) sum += i * hist[i].toDouble()
        var sumB = 0.0; var wB = 0; var best = 0.0; var t = 127
        for (i in 0..255) {
            wB += hist[i]; if (wB == 0) continue
            val wF = total - wB; if (wF == 0) break
            sumB += i * hist[i].toDouble()
            val mB = sumB / wB; val mF = (sum - sumB) / wF
            val between = wB.toDouble() * wF * (mB - mF) * (mB - mF)
            if (between > best) { best = between; t = i }
        }
        return t
    }

    internal fun largestComponent(mask: BooleanArray, w: Int, h: Int): IntArray? {
        val seen = BooleanArray(mask.size); var best: IntArray? = null
        val queue = IntArray(mask.size)
        for (start in mask.indices) {
            if (!mask[start] || seen[start]) continue
            var head = 0; var tail = 0; queue[tail++] = start; seen[start] = true
            while (head < tail) {
                val i = queue[head++]; val x = i % w; val y = i / w
                if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = true; queue[tail++] = i - 1 }
                if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = true; queue[tail++] = i + 1 }
                if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = true; queue[tail++] = i - w }
                if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = true; queue[tail++] = i + w }
            }
            if (best == null || tail > best.size) best = queue.copyOf(tail)
        }
        return best
    }
}

/**
 * Finds a photograph of the dish printed on a cookbook page or recipe card: a solid block of picture among lines of text.
 * Text is mostly paper with thin strokes; a photograph is dense and usually coloured. Returns the block as a rectangle with a
 * confidence, or null when there is no clear single picture (the user can then cut it out by hand). Works on about 240 px.
 */
object PhotoRegionFinder {
    private const val CELL = 6

    fun find(p: Pixels): Region? {
        val n = p.w * p.h
        val hist = IntArray(256); for (i in 0 until n) hist[p.lum(i)]++
        // paper is the most common brightness on a page of text
        var paper = 0; var peak = -1
        for (v in 0..255) { val around = (max(0, v - 6)..min(255, v + 6)).sumOf { hist[it] }; if (around > peak) { peak = around; paper = v } }
        if (peak < n * 0.25) return null                      // no dominant paper tone: this is a photograph, not a page
        var paperSat = 0L; var paperCount = 0
        for (i in 0 until n) if (abs(p.lum(i) - paper) <= 12) { paperSat += p.sat(i); paperCount++ }
        val baseSat = if (paperCount == 0) 0 else (paperSat / paperCount).toInt()
        val cw = p.w / CELL; val ch = p.h / CELL
        if (cw < 6 || ch < 6) return null
        val cells = BooleanArray(cw * ch)
        for (cy in 0 until ch) for (cx in 0 until cw) {
            var off = 0; var sat = 0
            for (y in cy * CELL until (cy + 1) * CELL) for (x in cx * CELL until (cx + 1) * CELL) { val i = y * p.w + x; if (abs(p.lum(i) - paper) > 30) off++; sat += p.sat(i) }
            val count = CELL * CELL
            // dense with non-paper tones, or clearly more colourful than the paper itself
            cells[cy * cw + cx] = off > count * 0.7 || (sat / count > baseSat + 45 && off > count * 0.35)
        }
        val comp = DocumentFinder.largestComponent(cells, cw, ch) ?: return null
        var l = cw; var r = -1; var t = ch; var b = -1
        for (i in comp) { val x = i % cw; val y = i / cw; if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y }
        val bw = r - l + 1; val bh = b - t + 1
        val fill = comp.size.toFloat() / (bw * bh)
        val share = (bw * bh).toFloat() / (cw * ch)
        val aspect = bw.toFloat() / bh
        if (fill < 0.72f || share < 0.04f || share > 0.8f || bw < cw * 0.15f || bh < ch * 0.1f || aspect < 0.35f || aspect > 3.2f) return null
        // other sizeable picture blocks make the choice uncertain
        val second = comp.toSet().let { main -> BooleanArray(cells.size) { cells[it] && it !in main } }.let { rest -> DocumentFinder.largestComponent(rest, cw, ch)?.size ?: 0 }
        val confidence = (fill * (if (second > comp.size * 0.5) 0.5f else 1f) * min(1f, share / 0.08f)).coerceIn(0f, 1f)
        return Region(l * CELL.toFloat() / p.w, t * CELL.toFloat() / p.h, min(1f, (r + 1) * CELL.toFloat() / p.w), min(1f, (b + 1) * CELL.toFloat() / p.h), confidence)
    }
}

/** Brightness and contrast for a cleaned page: stretches the paper towards white and the ink towards black without clipping detail. */
object Levels {
    /** Returns (scale, offset) for each colour channel: out = in * scale + offset. Identity when the picture already uses the full range. */
    fun auto(p: Pixels): Pair<Float, Float> {
        val hist = IntArray(256); val n = p.w * p.h; for (i in 0 until n) hist[p.lum(i)]++
        fun percentile(q: Double): Int { var acc = 0; val target = (n * q).toInt(); for (v in 0..255) { acc += hist[v]; if (acc >= target) return v }; return 255 }
        val lo = percentile(0.02); val hi = percentile(0.92)
        if (hi - lo < 40) return 1f to 0f
        val scale = (245f / (hi - lo)).coerceIn(1f, 2.4f)
        return scale to (-lo * scale + 5f)
    }
}
