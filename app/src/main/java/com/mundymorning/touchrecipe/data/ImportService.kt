package com.mundymorning.touchrecipe.data

import android.content.Context
import android.net.Uri
import com.mundymorning.touchrecipe.core.importer.TextRecipeParser
import com.mundymorning.touchrecipe.core.importer.WebRecipeExtractor
import com.mundymorning.touchrecipe.core.model.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.net.URI

/** What the user handed us, e.g. from the Android share sheet. */
sealed interface ImportInput {
    data class Url(val url: String) : ImportInput
    data class Text(val text: String) : ImportInput
    data class Image(val uri: Uri) : ImportInput
    data class Pdf(val uri: Uri) : ImportInput
    data class File(val uri: Uri, val mime: String?) : ImportInput
}

class ImportFailure(val userMessage: String, val retryable: Boolean = false, val offline: Boolean = false, val blocked: Boolean = false) : Exception(userMessage)

/**
 * All import paths produce an [ImportDraft]; nothing is saved here. Network access happens only for
 * URL imports the user asked for.
 */
class ImportService(
    private val context: Context,
    private val fetcher: PageFetcher,
    private val ocr: OcrEngine,
    private val photos: PhotoStore,
) {
    private val urlRegex = Regex("""https?://[^\s<>"']+""", RegexOption.IGNORE_CASE)
    private val socialHosts = listOf("tiktok.com", "instagram.com", "facebook.com", "fb.watch", "fb.com")

    fun classify(text: String): ImportInput {
        val t = text.trim()
        val m = urlRegex.find(t)
        // shared text like "Great pasta! https://site/…" is a link; long multi-line text with a stray link is a recipe
        if (m != null && (t.lines().size <= 3 || m.range.first == 0 && t.length - m.value.length < 200)) return ImportInput.Url(m.value.trimEnd('.', ',', ')'))
        if (Regex("""^[\w.-]+\.[a-z]{2,}(/\S*)?$""", RegexOption.IGNORE_CASE).matches(t)) return ImportInput.Url("https://$t")
        return ImportInput.Text(t)
    }

    suspend fun import(input: ImportInput, onStatus: (String) -> Unit = {}): ImportDraft = when (input) {
        is ImportInput.Url -> fromUrl(input.url, onStatus)
        is ImportInput.Text -> TextRecipeParser.parse(input.text)
        is ImportInput.Image -> fromImages(listOf(input.uri), onStatus)
        is ImportInput.Pdf -> fromPdf(input.uri, onStatus)
        is ImportInput.File -> fromFile(input, onStatus)
    }

    suspend fun fromUrl(raw: String, onStatus: (String) -> Unit): ImportDraft {
        val url = normalizeUrl(raw) ?: throw ImportFailure("That doesn't look like a web link. Check the address and try again.")
        val host = runCatching { URI(url).host.orEmpty().lowercase() }.getOrDefault("")
        val social = socialHosts.any { host == it || host.endsWith(".$it") }
        onStatus("Contacting ${host.removePrefix("www.")}…")
        var caption: String? = null
        if (social && host.contains("tiktok")) caption = tiktokCaption(url)
        when (val r = fetcher.fetchPage(url)) {
            is FetchOutcome.Page -> {
                onStatus("Looking for recipe data…")
                var draft = WebRecipeExtractor.extract(r.body, r.finalUrl)
                if (social || draft.recipe.ingredients.isEmpty() && draft.recipe.directions.isEmpty()) {
                    val doc = org.jsoup.Jsoup.parse(r.body)
                    val og = caption ?: listOfNotNull(doc.selectFirst("meta[property=og:title]")?.attr("content"), doc.selectFirst("meta[property=og:description]")?.attr("content"))
                        .joinToString("\n").takeIf { it.length > 40 }
                    if (og != null && (social || draft.recipe.title.isBlank())) {
                        val t = TextRecipeParser.parse(og, ImportMethod.SOCIAL_CAPTION, r.finalUrl)
                        if (t.recipe.ingredients.isNotEmpty() || t.recipe.directions.isNotEmpty() || social) {
                            draft = t.copy(
                                recipe = t.recipe.copy(sourceUrl = r.finalUrl, sourceName = host.removePrefix("www."), title = t.recipe.title.ifBlank { draft.recipe.title }),
                                warnings = listOf(ImportWarning("recipe", "Social platforms rarely share full recipes. We used the post's public caption; the rest may need to be typed in or pasted.", Severity.WARNING)) + t.warnings.filter { it.severity != Severity.INFO },
                                imageCandidates = draft.imageCandidates, confidence = Confidence.LOW)
                        }
                    }
                }
                if (r.body.contains("Just a moment", true) && draft.recipe.ingredients.isEmpty())
                    throw ImportFailure("This site asked for a browser check, so the recipe couldn't be read. Open the page in your browser, copy the recipe text, and use Paste or Type Recipe.", blocked = true)
                return draft.copy(recipe = draft.recipe.copy(sourceUrl = draft.recipe.sourceUrl ?: r.finalUrl))
            }
            is FetchOutcome.Blocked -> throw ImportFailure("${r.message} Open the page in your browser, copy the recipe text, and use Paste or Type Recipe — your original link will be kept if you paste it in the source field.", blocked = true)
            is FetchOutcome.Failure -> throw ImportFailure(r.message, retryable = true, offline = r.offline)
        }
    }

    fun normalizeUrl(raw: String): String? {
        var t = raw.trim().trim('<', '>')
        if (t.isEmpty() || t.contains(' ')) {
            val m = urlRegex.find(t) ?: return null
            t = m.value
        }
        if (!t.startsWith("http://", true) && !t.startsWith("https://", true)) {
            if (t.contains("://")) return null
            t = "https://$t"
        }
        val u = runCatching { URI(t) }.getOrNull() ?: return null
        if (u.host.isNullOrBlank() || !u.host.contains('.')) return null
        return t
    }

    private suspend fun tiktokCaption(url: String): String? = runCatching {
        val r = fetcher.fetchPage("https://www.tiktok.com/oembed?url=" + java.net.URLEncoder.encode(url, "UTF-8")) as? FetchOutcome.Page ?: return null
        Json.parseToJsonElement(r.body).jsonObject["title"]?.jsonPrimitive?.contentOrNull
    }.getOrNull()

    /** Downloads the first usable image candidate into private storage; returns the stored file name. */
    suspend fun fetchPhoto(candidates: List<String>): String? {
        for (c in candidates.take(3)) { fetcher.fetchBytes(c)?.let { b -> photos.saveBytes(b)?.let { return it } } }
        return null
    }

    suspend fun fromImages(uris: List<Uri>, onStatus: (String) -> Unit): ImportDraft {
        val parts = mutableListOf<String>()
        uris.forEachIndexed { i, u ->
            onStatus("Reading text from the photo${if (uris.size > 1) " ${i + 1} of ${uris.size}" else ""}…")
            val bmp = ImageLoader.decode(context, u) ?: throw ImportFailure("That image could not be opened.")
            parts += try { ocr.recognize(bmp) } catch (e: OcrUnavailable) { throw ImportFailure((e.message ?: "Text recognition failed.") + " You can still use Paste or Type Recipe.", retryable = true) }
        }
        return ocrDraft(parts.joinToString("\n\n"))
    }

    suspend fun fromPdf(uri: Uri, onStatus: (String) -> Unit): ImportDraft {
        onStatus("Opening the PDF…")
        val pages = try { PdfPages.render(context, uri) } catch (e: Exception) { throw ImportFailure("That PDF could not be opened. It may be damaged or password protected.") }
        if (pages.isEmpty()) throw ImportFailure("That PDF has no pages we can read.")
        val parts = pages.mapIndexed { i, b ->
            onStatus("Reading page ${i + 1} of ${pages.size}…")
            try { ocr.recognize(b) } catch (e: OcrUnavailable) { throw ImportFailure((e.message ?: "Text recognition failed.") + " You can still use Paste or Type Recipe.", retryable = true) }
        }
        val d = ocrDraft(parts.joinToString("\n\n"))
        return if (pages.size >= PdfPages.MAX_PAGES) d.copy(warnings = d.warnings + ImportWarning("recipe", "Only the first ${PdfPages.MAX_PAGES} pages were read.", Severity.INFO)) else d
    }

    private fun ocrDraft(text: String): ImportDraft {
        if (text.isBlank()) throw ImportFailure("No text could be found. Try a sharper, well-lit photo, or use Paste or Type Recipe.", retryable = true)
        return TextRecipeParser.parse(text, ImportMethod.OCR)
    }

    suspend fun fromFile(f: ImportInput.File, onStatus: (String) -> Unit): ImportDraft {
        val mime = f.mime ?: context.contentResolver.getType(f.uri).orEmpty()
        val name = f.uri.lastPathSegment.orEmpty().lowercase()
        return when {
            mime == "application/pdf" || name.endsWith(".pdf") -> fromPdf(f.uri, onStatus)
            mime.startsWith("image/") -> fromImages(listOf(f.uri), onStatus)
            mime.contains("html") || name.endsWith(".html") || name.endsWith(".htm") -> {
                val text = readText(f.uri)
                WebRecipeExtractor.extract(text, null)
            }
            mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md") -> TextRecipeParser.parse(readText(f.uri))
            else -> throw ImportFailure("This file type isn't supported yet. Supported: PDF, images, text and web pages.")
        }
    }

    private fun readText(uri: Uri): String = try {
        context.contentResolver.openInputStream(uri)?.use { it.readBytes().also { b -> if (b.size > 5_000_000) throw ImportFailure("That file is too large.") }.toString(Charsets.UTF_8) } ?: throw ImportFailure("That file could not be opened.")
    } catch (e: ImportFailure) { throw e } catch (e: Exception) { throw ImportFailure("That file could not be read.") }
}
