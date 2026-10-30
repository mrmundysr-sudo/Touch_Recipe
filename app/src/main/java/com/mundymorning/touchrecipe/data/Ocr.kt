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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.math.max

class OcrUnavailable(message: String) : Exception(message)

/** On-device text recognition. Nothing is uploaded; the model ships inside the app. */
interface OcrEngine { suspend fun recognize(bitmap: Bitmap): String }

class MlKitOcr : OcrEngine {
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    override suspend fun recognize(bitmap: Bitmap): String = suspendCancellableCoroutine { cont ->
        try {
            recognizer.process(InputImage.fromBitmap(bitmap, 0))
                .addOnSuccessListener { cont.resume(it.textBlocks.joinToString("\n") { b -> b.lines.joinToString("\n") { l -> l.text } }) }
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
    const val MAX_PAGES = 6
    /** Renders the first pages of a PDF so they can be recognised on-device. */
    suspend fun render(context: Context, uri: Uri): List<Bitmap> = withContext(Dispatchers.IO) {
        val tmp = File.createTempFile("import", ".pdf", context.cacheDir)
        try {
            context.contentResolver.openInputStream(uri)?.use { i -> tmp.outputStream().use { o -> i.copyTo(o) } } ?: return@withContext emptyList()
            ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
                PdfRenderer(pfd).use { r ->
                    (0 until minOf(r.pageCount, MAX_PAGES)).map { i ->
                        r.openPage(i).use { p ->
                            val scale = 1800f / max(p.width, p.height)
                            val bmp = Bitmap.createBitmap((p.width * scale).toInt().coerceAtLeast(1), (p.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
                            bmp.eraseColor(Color.WHITE)
                            p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            bmp
                        }
                    }
                }
            }
        } finally { tmp.delete() }
    }
}
