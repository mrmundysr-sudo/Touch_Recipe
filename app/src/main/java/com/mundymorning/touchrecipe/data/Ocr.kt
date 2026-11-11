package com.mundymorning.touchrecipe.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.mundymorning.touchrecipe.core.importer.TextLine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.math.max

class OcrUnavailable(message: String) : Exception(message)

/** On-device text recognition. Nothing is uploaded; the model ships inside the app. */
interface OcrEngine {
    suspend fun recognize(bitmap: Bitmap): String
    /** Recognised lines with their place in the image, so columns can be read in order. Engines without positions return lines stacked top to bottom. */
    suspend fun recognizeLines(bitmap: Bitmap, page: Int = 0): List<TextLine> {
        var y = 0f
        return recognize(bitmap).lines().map { t -> (if (t.isBlank()) null else TextLine(t, 0f, y, 100f, y + 10f, page)).also { y += if (t.isBlank()) 14f else 12f } }.filterNotNull()
    }
}

class MlKitOcr : OcrEngine {
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    override suspend fun recognize(bitmap: Bitmap): String = suspendCancellableCoroutine { cont ->
        try {
            recognizer.process(InputImage.fromBitmap(bitmap, 0))
                .addOnSuccessListener { cont.resume(it.textBlocks.joinToString("\n") { b -> b.lines.joinToString("\n") { l -> l.text } }) }
                .addOnFailureListener { cont.resumeWith(Result.failure(OcrUnavailable("Text recognition isn't available right now."))) }
        } catch (e: Throwable) { cont.resumeWith(Result.failure(OcrUnavailable("Text recognition isn't available on this device."))) }
    }

    override suspend fun recognizeLines(bitmap: Bitmap, page: Int): List<TextLine> = suspendCancellableCoroutine { cont ->
        try {
            recognizer.process(InputImage.fromBitmap(bitmap, 0))
                .addOnSuccessListener { result ->
                    val out = ArrayList<TextLine>()
                    for (b in result.textBlocks) for (l in b.lines) {
                        val box = l.boundingBox ?: continue
                        out += TextLine(l.text, box.left.toFloat(), box.top.toFloat(), box.right.toFloat(), box.bottom.toFloat(), page, runCatching { l.confidence }.getOrNull())
                    }
                    cont.resume(out)
                }
                .addOnFailureListener { cont.resumeWith(Result.failure(OcrUnavailable("Text recognition isn't available right now."))) }
        } catch (e: Throwable) { cont.resumeWith(Result.failure(OcrUnavailable("Text recognition isn't available on this device."))) }
    }
}

object ImageLoader {
    fun decode(context: Context, uri: Uri, maxEdge: Int = 2200): Bitmap? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > maxEdge * 2) sample *= 2
        val bmp = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return null
        val exifRotation = context.contentResolver.openInputStream(uri)?.use { runCatching { androidx.exifinterface.media.ExifInterface(it).rotationDegrees }.getOrDefault(0) } ?: 0
        val scale = maxEdge.toFloat() / max(bmp.width, bmp.height)
        if (scale < 1f || exifRotation != 0) {
            val m = android.graphics.Matrix().apply { if (scale < 1f) postScale(scale, scale); if (exifRotation != 0) postRotate(exifRotation.toFloat()) }
            Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        } else bmp
    }.getOrNull()
}

object PdfPages {
    /** Most pages read from a PDF's own text. */
    const val MAX_PAGES = 40
    /** Most pages recognised from images (scanned PDFs): recognition is slow and memory-hungry. */
    const val MAX_OCR_PAGES = 12

    /** Copies the document into the app's cache so it can be opened by file. The caller deletes it. */
    suspend fun copyToCache(context: Context, uri: Uri): File? = withContext(Dispatchers.IO) {
        val tmp = File.createTempFile("import", ".pdf", context.cacheDir)
        val ok = runCatching { context.contentResolver.openInputStream(uri)?.use { i -> tmp.outputStream().use { o -> i.copyTo(o) } } != null }.getOrDefault(false)
        if (ok) tmp else { tmp.delete(); null }
    }

    /** Renders one page (0-based) for on-device recognition. */
    suspend fun renderPage(file: File, index: Int): Bitmap? = withContext(Dispatchers.IO) {
        runCatching {
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
                PdfRenderer(pfd).use { r ->
                    if (index >= r.pageCount) return@use null
                    r.openPage(index).use { p ->
                        val scale = 2200f / max(p.width, p.height)
                        val bmp = Bitmap.createBitmap((p.width * scale).toInt().coerceAtLeast(1), (p.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
                        bmp.eraseColor(Color.WHITE)
                        p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        bmp
                    }
                }
            }
        }.getOrNull()
    }

    suspend fun pageCount(file: File): Int = withContext(Dispatchers.IO) {
        runCatching { ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd -> PdfRenderer(pfd).use { it.pageCount } } }.getOrDefault(0)
    }
}
