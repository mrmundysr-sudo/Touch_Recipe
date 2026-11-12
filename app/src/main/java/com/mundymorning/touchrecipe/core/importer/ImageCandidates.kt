package com.mundymorning.touchrecipe.core.importer

import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import java.net.URI

/**
 * Chooses the recipe's photograph from a web page, best first: the picture named in the recipe data, then the page's
 * declared main image, then pictures inside the recipe itself. Logos, avatars, adverts, icons and tracking pixels are
 * left out. The list keeps several good candidates so the user can switch when the first is not the dish.
 */
object ImageCandidates {
    private val junk = Regex("""logo|icon|avatar|gravatar|sprite|spacer|pixel|blank|placeholder|loading|spinner|badge|banner|advert|/ads?/|doubleclick|emoji|smil(?:e|ies)|button|share|social|pinterest|facebook|twitter|instagram|youtube|rating|star|print|author|profile|1x1|data:image""", RegexOption.IGNORE_CASE)
    private val notPhoto = Regex("""\.(?:svg|gif|ico)(?:[?#].*)?$""", RegexOption.IGNORE_CASE)
    private val badContainer = Regex("""comment|sidebar|related|author|avatar|advert|sponsor|social|share|footer|nav|menu|widget|newsletter|popup|modal|breadcrumb|logo""", RegexOption.IGNORE_CASE)

    fun usable(url: String): Boolean = url.length in 12..2000 && !junk.containsMatchIn(url.substringAfterLast('/').ifEmpty { url }) && !notPhoto.containsMatchIn(url) && !url.startsWith("data:")

    fun absolute(u: String, base: String?): String? = try {
        val t = u.trim()
        val r = if (t.startsWith("//")) "https:$t" else if (base != null && !t.startsWith("http")) URI(base).resolve(t).toString() else t
        if (r.startsWith("http://") || r.startsWith("https://")) r else null
    } catch (e: Exception) { null }

    /** The widest entry of a `srcset`. */
    private fun fromSrcset(s: String): String? = s.split(",").mapNotNull { part ->
        val bits = part.trim().split(Regex("""\s+""")); val url = bits.firstOrNull()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
        url to (bits.getOrNull(1)?.removeSuffix("w")?.removeSuffix("x")?.toFloatOrNull() ?: 1f)
    }.maxByOrNull { it.second }?.first

    private fun imageUrl(img: Element): String? {
        for (a in listOf("data-pin-media", "data-lazy-src", "data-src", "data-original", "data-orig-file", "data-large-file")) img.attr(a).takeIf { it.isNotBlank() && !it.startsWith("data:") }?.let { return it }
        for (a in listOf("data-lazy-srcset", "data-srcset", "srcset")) img.attr(a).takeIf { it.isNotBlank() }?.let { s -> fromSrcset(s)?.let { return it } }
        return img.attr("src").takeIf { it.isNotBlank() && !it.startsWith("data:") }
    }

    fun rank(doc: Document, structured: List<String>, pageUrl: String?): List<String> {
        val out = LinkedHashSet<String>()
        fun add(u: String?) { val a = u?.let { absolute(it, pageUrl) } ?: return; if (usable(a)) out += a }
        // 1. the picture the recipe data names (sites often list the same photo in several crops: the first is the main one)
        structured.forEach { add(it) }
        // 2. the page's declared main image
        for (sel in listOf("meta[property=og:image:secure_url]", "meta[property=og:image]", "meta[name=twitter:image]", "meta[name=twitter:image:src]", "meta[itemprop=image]")) doc.select(sel).forEach { add(it.attr("content")) }
        doc.select("link[rel=image_src]").forEach { add(it.attr("href")) }
        doc.select("[itemprop=image]").forEach { e -> add(e.attr("src").ifBlank { e.attr("content") }.ifBlank { e.attr("href") }) }
        // 3. pictures inside the recipe itself, in page order
        val scopes = doc.select(".wprm-recipe-container, .tasty-recipes, .mv-create-card, [itemtype*=schema.org/Recipe], [class*=recipe-card], [class*=recipe-content], [class*=recipe__], article, main").ifEmpty { doc.select("body") }
        var taken = 0
        for (scope in scopes) for (img in scope.select("img")) {
            if (taken >= 8) break
            if (img.parents().any { p -> p !== scope && badContainer.containsMatchIn(p.className() + " " + p.id()) && p.tagName() !in setOf("body", "html", "main", "article") }) continue
            val w = img.attr("width").toIntOrNull(); val h = img.attr("height").toIntOrNull()
            if ((w != null && w < 240) || (h != null && h < 160)) continue                       // thumbnails, icons, pixels
            if (w != null && h != null && (w.toFloat() / h > 3.2f || h.toFloat() / w > 2.6f)) continue   // banners and strips
            val before = out.size
            add(imageUrl(img)); if (out.size > before) taken++
        }
        return out.toList().take(10)
    }
}
