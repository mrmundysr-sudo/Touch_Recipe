package com.mundymorning.touchrecipe.ui.components

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import com.mundymorning.touchrecipe.data.PhotoStore
import com.mundymorning.touchrecipe.ui.theme.DisplayFont
import com.mundymorning.touchrecipe.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.max

private val bitmapCache = object : LruCache<String, Bitmap>(16 * 1024 * 1024) { override fun sizeOf(key: String, value: Bitmap) = value.byteCount }

/** Recipe photo with a safe placeholder: missing or unreadable files never break layout. */
@Composable
fun PhotoImage(store: PhotoStore, name: String?, modifier: Modifier, fallbackText: String = "", maxEdge: Int = 700, description: String? = null, scale: ContentScale = ContentScale.Crop) {
    val bmp by produceState<Bitmap?>(null, name, maxEdge) {
        value = if (name == null) null else {
            val key = "$name@$maxEdge"
            bitmapCache.get(key) ?: withContext(Dispatchers.IO) {
                runCatching {
                    val f = store.file(name)
                    val b = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(f.path, b)
                    var sample = 1
                    while (max(b.outWidth, b.outHeight) / (sample * 2) >= maxEdge) sample *= 2
                    BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample })
                }.getOrNull()
            }?.also { bitmapCache.put(key, it) }
        }
    }
    val m = if (description != null) modifier.semantics { contentDescription = description } else modifier
    val image = bmp
    if (image != null) Image(image.asImageBitmap(), null, m, contentScale = scale)
    else Box(m.background(Palette.Forest.copy(alpha = 0.88f)), contentAlignment = Alignment.Center) {
        Text(fallbackText.trim().take(1).uppercase().ifEmpty { "✦" }, color = Palette.Cream, fontFamily = DisplayFont, fontSize = 34.sp)
    }
}
