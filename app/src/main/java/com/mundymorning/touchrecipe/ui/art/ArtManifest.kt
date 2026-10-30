package com.mundymorning.touchrecipe.ui.art

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.serialization.json.*

/** Rectangle in 0..1 artwork space. */
data class NRect(val x: Float, val y: Float, val w: Float, val h: Float) {
    fun contains(px: Float, py: Float) = px >= x && px <= x + w && py >= y && py <= y + h
    val cx get() = x + w / 2
    val cy get() = y + h / 2
}

data class ArtTarget(val id: String, val label: String, val hint: String, val layer: String?, val box: NRect, val hit: NRect, val glow: Boolean)
data class DayRegions(val label: NRect, val date: NRect, val title: NRect, val cook: NRect, val servings: NRect, val photo: NRect, val card: NRect, val action: NRect)
data class GroceryCard(val key: String, val card: NRect, val head: NRect, val check: NRect, val qty: NRect)

data class ArtPageData(
    val key: String, val clean: String, val bg: Long,
    val targets: List<ArtTarget>, val regions: Map<String, NRect>, val days: List<DayRegions>, val cards: List<GroceryCard>,
) {
    fun region(name: String) = regions[name] ?: error("Missing art region '$name' on page '$key'")
    fun target(id: String) = targets.first { it.id == id }
}

class ArtManifest(val aspect: Float, val pages: Map<String, ArtPageData>) {
    fun page(key: String) = pages[key] ?: error("Unknown art page '$key'")

    companion object {
        fun parse(text: String): ArtManifest {
            val root = Json.parseToJsonElement(text).jsonObject
            val size = root["artSize"]!!.jsonArray
            fun rect(e: JsonElement): NRect { val a = e.jsonArray.map { it.jsonPrimitive.float }; return NRect(a[0], a[1], a[2], a[3]) }
            val pages = root["pages"]!!.jsonObject.mapValues { (key, v) ->
                val o = v.jsonObject
                ArtPageData(
                    key = key, clean = o["clean"]!!.jsonPrimitive.content,
                    bg = o["bg"]!!.jsonPrimitive.content.removePrefix("#").toLong(16) or 0xFF000000,
                    targets = o["targets"]!!.jsonArray.map { t ->
                        val to = t.jsonObject
                        ArtTarget(to["id"]!!.jsonPrimitive.content, to["label"]!!.jsonPrimitive.content, to["hint"]!!.jsonPrimitive.content,
                            to["layer"]?.jsonPrimitive?.content, rect(to["box"]!!), rect(to["hit"]!!), to["glow"]?.jsonPrimitive?.boolean ?: true)
                    },
                    regions = o["regions"]!!.jsonObject.mapValues { rect(it.value) },
                    days = o["days"]?.jsonArray?.map { d ->
                        val m = d.jsonObject
                        DayRegions(rect(m["label"]!!), rect(m["date"]!!), rect(m["title"]!!), rect(m["cook"]!!), rect(m["servings"]!!), rect(m["photo"]!!), rect(m["card"]!!), rect(m["action"]!!))
                    }.orEmpty(),
                    cards = o["cards"]?.jsonArray?.map { c ->
                        val m = c.jsonObject
                        GroceryCard(m["key"]!!.jsonPrimitive.content, rect(m["card"]!!), rect(m["head"]!!), rect(m["check"]!!), rect(m["qty"]!!))
                    }.orEmpty(),
                )
            }
            return ArtManifest(size[0].jsonPrimitive.float / size[1].jsonPrimitive.float, pages)
        }
    }
}

/** Loads artwork by slot path from assets, so replacing a file never needs a code change. Keeps a small cache. */
class ArtLoader(private val context: Context) {
    val manifest: ArtManifest by lazy { ArtManifest.parse(context.assets.open("art/manifest.json").bufferedReader().use { it.readText() }) }
    private val cache = object : LruCache<String, Bitmap>(24 * 1024 * 1024) { override fun sizeOf(key: String, value: Bitmap) = value.byteCount }

    fun bitmap(path: String): Bitmap? {
        cache.get(path)?.let { return it }
        return runCatching { context.assets.open(path).use { BitmapFactory.decodeStream(it) } }.getOrNull()?.also { cache.put(path, it) }
    }
    fun image(path: String): ImageBitmap? = bitmap(path)?.asImageBitmap()

    /** True when the cutout is opaque at the normalised point inside the target's box (physical-object hit testing). */
    fun opaqueAt(t: ArtTarget, nx: Float, ny: Float): Boolean {
        val layer = t.layer ?: return false
        if (!t.box.contains(nx, ny)) return false
        val bmp = bitmap(layer) ?: return false
        val px = ((nx - t.box.x) / t.box.w * bmp.width).toInt().coerceIn(0, bmp.width - 1)
        val py = ((ny - t.box.y) / t.box.h * bmp.height).toInt().coerceIn(0, bmp.height - 1)
        return (bmp.getPixel(px, py) ushr 24) > 24
    }

    /** Resolves a tap: opaque object pixels first (top-most wins), otherwise the nearest generous hit region. */
    fun resolve(page: ArtPageData, nx: Float, ny: Float): ArtTarget? {
        page.targets.asReversed().firstOrNull { opaqueAt(it, nx, ny) }?.let { return it }
        // a small control sitting on a larger one (e.g. a meal's options button on its card) wins over the larger one
        page.targets.filter { it.layer == null && it.box.contains(nx, ny) }.minByOrNull { it.box.w * it.box.h }?.let { return it }
        val inside = page.targets.filter { it.hit.contains(nx, ny) }
        if (inside.isEmpty()) return null
        return inside.minBy { t ->
            val dx = (nx - t.box.cx) / t.box.w; val dy = (ny - t.box.cy) / t.box.h
            dx * dx + dy * dy
        }
    }
}
