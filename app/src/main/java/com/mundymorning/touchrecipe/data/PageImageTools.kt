package com.mundymorning.touchrecipe.data

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import com.mundymorning.touchrecipe.core.image.DocumentFinder
import com.mundymorning.touchrecipe.core.image.Levels
import com.mundymorning.touchrecipe.core.image.PhotoRegionFinder
import com.mundymorning.touchrecipe.core.image.Pixels
import com.mundymorning.touchrecipe.core.image.Quad
import com.mundymorning.touchrecipe.core.image.Region
import java.io.ByteArrayOutputStream
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Cleans up photographs of recipe cards and pages on the device: straightening, cropping, brightening, and cutting the
 * dish photo out of a page. Every function returns a new picture; the one passed in is never changed.
 */
object PageImageTools {
    /** A reduced copy as plain numbers for the analysis in `core/image`. */
    fun pixels(bmp: Bitmap, maxEdge: Int): Pixels {
        val k = maxEdge.toFloat() / max(bmp.width, bmp.height)
        val small = if (k < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * k).roundToInt().coerceAtLeast(1), (bmp.height * k).roundToInt().coerceAtLeast(1), true) else bmp
        val px = IntArray(small.width * small.height)
        small.getPixels(px, 0, small.width, 0, 0, small.width, small.height)
        return Pixels(small.width, small.height, px)
    }

    fun findDocument(bmp: Bitmap): Quad? = runCatching { DocumentFinder.find(pixels(bmp, 300)) }.getOrNull()
    fun findDishPhoto(bmp: Bitmap): Region? = runCatching { PhotoRegionFinder.find(pixels(bmp, 240)) }.getOrNull()

    /** Cuts out the four-sided area and flattens it to an upright rectangle (perspective correction and straightening in one step). */
    fun warp(bmp: Bitmap, q: Quad, maxEdge: Int = 2400): Bitmap {
        val w = bmp.width.toFloat(); val h = bmp.height.toFloat()
        val p = q.points.map { it.x * w to it.y * h }
        fun d(a: Int, b: Int) = hypot(p[a].first - p[b].first, p[a].second - p[b].second)
        var outW = max(d(0, 1), d(3, 2)); var outH = max(d(0, 3), d(1, 2))
        val k = minOf(1f, maxEdge / max(outW, outH))
        outW = (outW * k).coerceAtLeast(8f); outH = (outH * k).coerceAtLeast(8f)
        val m = Matrix()
        m.setPolyToPoly(floatArrayOf(p[0].first, p[0].second, p[1].first, p[1].second, p[2].first, p[2].second, p[3].first, p[3].second), 0, floatArrayOf(0f, 0f, outW, 0f, outW, outH, 0f, outH), 0, 4)
        val out = Bitmap.createBitmap(outW.roundToInt(), outH.roundToInt(), Bitmap.Config.ARGB_8888)
        Canvas(out).drawBitmap(bmp, m, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        return out
    }

    fun crop(bmp: Bitmap, r: Region): Bitmap {
        val x = (r.left * bmp.width).roundToInt().coerceIn(0, bmp.width - 1); val y = (r.top * bmp.height).roundToInt().coerceIn(0, bmp.height - 1)
        val w = (r.width * bmp.width).roundToInt().coerceIn(1, bmp.width - x); val h = (r.height * bmp.height).roundToInt().coerceIn(1, bmp.height - y)
        return Bitmap.createBitmap(bmp, x, y, w, h)
    }

    fun rotate(bmp: Bitmap, degrees: Int): Bitmap = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(degrees.toFloat()) }, true)

    /** Brightness and contrast for reading: paper towards white, ink towards black. Optionally sharpened. */
    fun enhance(bmp: Bitmap, sharpen: Boolean = false): Bitmap {
        val (scale, offset) = Levels.auto(pixels(bmp, 300))
        val out = Bitmap.createBitmap(bmp.width, bmp.height, Bitmap.Config.ARGB_8888)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG)
        if (scale != 1f || offset != 0f) paint.colorFilter = ColorMatrixColorFilter(ColorMatrix(floatArrayOf(scale, 0f, 0f, 0f, offset, 0f, scale, 0f, 0f, offset, 0f, 0f, scale, 0f, offset, 0f, 0f, 0f, 1f, 0f)))
        Canvas(out).drawBitmap(bmp, 0f, 0f, paint)
        return if (sharpen) sharpened(out) else out
    }

    /** A light 3x3 sharpening pass, done row by row so a large page does not need a second full copy in memory. */
    private fun sharpened(bmp: Bitmap): Bitmap {
        val w = bmp.width; val h = bmp.height
        if (w < 3 || h < 3) return bmp
        val src = IntArray(w * h); bmp.getPixels(src, 0, w, 0, 0, w, h)
        val row = IntArray(w)
        val out = bmp.copy(Bitmap.Config.ARGB_8888, true)
        for (y in 1 until h - 1) {
            for (x in 1 until w - 1) {
                val i = y * w + x; var argb = 0xFF shl 24
                for (shift in intArrayOf(16, 8, 0)) {
                    val c = (src[i] shr shift) and 255
                    val v = c * 5 - ((src[i - 1] shr shift) and 255) - ((src[i + 1] shr shift) and 255) - ((src[i - w] shr shift) and 255) - ((src[i + w] shr shift) and 255)
                    argb = argb or ((c + (v - c) / 2).coerceIn(0, 255) shl shift)   // half strength: crisper strokes without halos
                }
                row[x] = argb
            }
            row[0] = src[y * w]; row[w - 1] = src[y * w + w - 1]
            out.setPixels(row, 0, w, 0, y, w, 1)
        }
        return out
    }

    fun jpeg(bmp: Bitmap, quality: Int = 90): ByteArray = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()
}
