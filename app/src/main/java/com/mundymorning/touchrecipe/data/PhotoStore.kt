package com.mundymorning.touchrecipe.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import kotlin.math.max

/** Recipe photos live in the app's private storage, downscaled to keep the library fast and small. */
class PhotoStore(private val context: Context) {
    private val dir = File(context.filesDir, "photos").apply { mkdirs() }
    fun file(name: String) = File(dir, name)
    fun exists(name: String?) = name != null && file(name).exists()

    fun saveFromUri(uri: Uri): String? = runCatching {
        context.contentResolver.openInputStream(uri)?.use { saveBytes(it.readBytes().also { b -> require(b.size < MAX_BYTES) }) }
    }.getOrNull()

    fun saveBytes(bytes: ByteArray): String? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > MAX_EDGE * 2) sample *= 2
        var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val rotation = runCatching { ExifInterface(bytes.inputStream()).rotationDegrees }.getOrDefault(0)
        val scale = MAX_EDGE.toFloat() / max(bmp.width, bmp.height)
        if (scale < 1f || rotation != 0) {
            val m = android.graphics.Matrix().apply { if (scale < 1f) postScale(scale, scale); if (rotation != 0) postRotate(rotation.toFloat()) }
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 86, out)
        val name = UUID.randomUUID().toString() + ".jpg"
        file(name).writeBytes(out.toByteArray())
        name
    }.getOrNull()

    fun delete(name: String?) { if (name != null) file(name).delete() }

    /** Removes photo files no recipe refers to (called at startup; old files only so undo windows are safe). */
    fun sweep(referenced: Set<String>) {
        val cutoff = System.currentTimeMillis() - 24 * 3600 * 1000
        dir.listFiles()?.filter { it.name !in referenced && it.lastModified() < cutoff }?.forEach { it.delete() }
    }

    fun all(): List<File> = dir.listFiles()?.toList().orEmpty()

    companion object { const val MAX_EDGE = 1600; const val MAX_BYTES = 25 * 1024 * 1024 }
}
