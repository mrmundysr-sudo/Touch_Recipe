package com.mundymorning.touchrecipe.data

import android.content.Context
import android.net.Uri
import com.mundymorning.touchrecipe.core.importer.LayoutReader
import com.mundymorning.touchrecipe.core.importer.TextLine
import com.mundymorning.touchrecipe.core.importer.TextRecipeParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
    private val originals: OriginalStore? = null,
) {
    private fun now() = System.currentTimeMillis()
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
        is ImportInput.Text -> TextRecipeParser.parse(input.text).copy(source = OriginalSource(SourceKind.TEXT, text = input.text, capturedAt = now()))
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
                val snapshot = originals?.saveText(r.body, "html")
                val source = OriginalSource(SourceKind.WEB, r.finalUrl, listOfNotNull(snapshot), com.mundymorning.touchrecipe.core.rescue.Rescue.pageText(r.body), now())
                return draft.copy(recipe = draft.recipe.copy(sourceUrl = draft.recipe.sourceUrl ?: r.finalUrl), source = source)
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
        val lines = mutableListOf<TextLine>()
        uris.forEachIndexed { i, u ->
            onStatus("Reading text from the photo${if (uris.size > 1) " ${i + 1} of ${uris.size}" else ""}…")
            val bmp = ImageLoader.decode(context, u) ?: throw ImportFailure("That image could not be opened.")
            lines += try { ocr.recognizeLines(bmp, i) } catch (e: OcrUnavailable) { throw ImportFailure((e.message ?: "Text recognition failed.") + " You can still use Paste or Type Recipe.", retryable = true) }
        }
        val d = ocrDraft(lines)
        // the photographs themselves are kept, untouched: a handwritten card is worth more than its transcription
        val kept = uris.mapNotNull { originals?.copyFromUri(it, "jpg") }
        return d.copy(source = OriginalSource(SourceKind.IMAGE, files = kept, text = LayoutReader.read(lines), capturedAt = now()))
    }

    /**
     * A PDF is read from its own text wherever it has any: exact characters, no recognition errors. Pages that are
     * only pictures (scans), or whose text layer is damaged, are recognised on-device instead. Both kinds can be mixed
     * in one document, and the reading order is rebuilt from where the text sits on each page.
     */
    suspend fun fromPdf(uri: Uri, onStatus: (String) -> Unit): ImportDraft {
        onStatus("Opening the PDF…")
        val file = PdfPages.copyToCache(context, uri) ?: throw ImportFailure("That PDF could not be opened.")
        try {
            val layer = withContext(Dispatchers.IO) { readTextLayer(file) }
            val pageCount = layer?.pages?.size ?: PdfPages.pageCount(file)
            if (pageCount == 0) throw ImportFailure(if (layer?.locked == true) "That PDF is password protected, so it can't be read. Open it in a PDF app and use Print or Share to make an unlocked copy, or use Paste or Type Recipe."
                else "That PDF could not be opened. It may be damaged or password protected.")
            val lines = mutableListOf<TextLine>()
            val notes = mutableListOf<ImportWarning>()
            var ocrPages = 0; var skipped = 0
            val readable = minOf(pageCount, PdfPages.MAX_PAGES)
            for (i in 0 until readable) {
                val words = layer?.pages?.getOrNull(i).orEmpty()
                val text = words.joinToString(" ") { it.text }
                val usable = text.count { it.isLetterOrDigit() } >= 30 && !TextRecipeParser.looksGarbled(text)
                if (usable) { lines += words; continue }
                // a picture-only page, or a text layer damaged by web-font ligatures
                if (ocrPages >= PdfPages.MAX_OCR_PAGES) { skipped++; if (words.isNotEmpty()) lines += words; continue }
                onStatus("Reading page ${i + 1} of $readable…")
                val bmp = PdfPages.renderPage(file, i)
                val recognised = if (bmp == null) emptyList() else try { ocr.recognizeLines(bmp, i) } catch (e: OcrUnavailable) {
                    if (words.isEmpty() && lines.isEmpty() && i == readable - 1) throw ImportFailure((e.message ?: "Text recognition failed.") + " You can still use Paste or Type Recipe.", retryable = true)
                    emptyList()
                }
                ocrPages++
                val recognisedChars = recognised.sumOf { it.text.length }
                // keep the damaged layer when recognition found clearly less than it holds
                if (words.isNotEmpty() && recognisedChars < text.length * 0.8) {
                    lines += words
                    notes += ImportWarning("recipe", "Page ${i + 1} of the PDF has damaged text (some letters may be wrong or missing). Please check it against the original.")
                } else lines += recognised
            }
            if (lines.isEmpty()) throw ImportFailure("No text could be found in that PDF. If it is a scan, try a sharper copy, or use Paste or Type Recipe.", retryable = true)
            if (pageCount > readable) notes += ImportWarning("recipe", "This PDF has $pageCount pages; only the first $readable were read. The rest was not imported.")
            if (skipped > 0) notes += ImportWarning("recipe", "$skipped scanned page${if (skipped == 1) " was" else "s were"} not read (only ${PdfPages.MAX_OCR_PAGES} scanned pages are read per import).")
            val draft = if (ocrPages > 0) ocrDraft(lines, layer?.title) else TextRecipeParser.parse(LayoutReader.read(lines), ImportMethod.TEXT, titleHint = layer?.title)
            val kept = originals?.copyFromUri(Uri.fromFile(file), "pdf")
            return draft.copy(warnings = draft.warnings + notes, source = OriginalSource(SourceKind.PDF, draft.recipe.sourceUrl, listOfNotNull(kept), LayoutReader.read(lines), now()))
        } finally { file.delete() }
    }

    private class TextLayer(val pages: List<List<TextLine>>, val title: String?, val locked: Boolean)

    /** The PDF's own text, page by page. Null when the document cannot be parsed; the pages can then still be rendered and recognised. */
    private fun readTextLayer(file: java.io.File): TextLayer? = try {
        com.tom_roush.pdfbox.android.PDFBoxResourceLoader.init(context.applicationContext)
        com.tom_roush.pdfbox.pdmodel.PDDocument.load(file, com.tom_roush.pdfbox.io.MemoryUsageSetting.setupMixed(24L * 1024 * 1024)).use { doc ->
            if (doc.isEncrypted) runCatching { doc.setAllSecurityToBeRemoved(true) }
            val n = minOf(doc.numberOfPages, PdfPages.MAX_PAGES)
            val pages = (0 until n).map { i -> runCatching { PdfTextLayer.page(doc, i) }.getOrDefault(emptyList()) } + List(doc.numberOfPages - n) { emptyList() }
            val title = runCatching { doc.documentInformation?.title }.getOrNull()?.takeIf { it.isNotBlank() && !it.endsWith(".pdf", true) && !it.startsWith("Microsoft Word", true) }?.let { TextRecipeParser.pageTitle(it) }
            TextLayer(pages, title, false)
        }
    } catch (e: com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException) { TextLayer(emptyList(), null, true)
    } catch (e: Throwable) { null }

    private fun ocrDraft(lines: List<TextLine>, titleHint: String? = null): ImportDraft {
        val text = LayoutReader.read(lines)
        if (text.isBlank()) throw ImportFailure("No text could be found. Try a sharper, well-lit photo, or use Paste or Type Recipe.", retryable = true)
        val d = TextRecipeParser.parse(text, ImportMethod.OCR, titleHint = titleHint)
        // lines the recogniser itself was unsure of are named, so they are checked rather than trusted
        val unsure = lines.filter { (it.confidence ?: 1f) < 0.5f && it.text.trim().length >= 3 }.map { it.text.trim() }.distinct()
        return if (unsure.isEmpty()) d else d.copy(warnings = d.warnings + ImportWarning("recipe",
            "${unsure.size} line${if (unsure.size == 1) " was" else "s were"} hard to read and may be wrong: ${unsure.take(4).joinToString("; ")}${if (unsure.size > 4) "…" else ""}"))
    }

    suspend fun fromFile(f: ImportInput.File, onStatus: (String) -> Unit): ImportDraft {
        val mime = f.mime ?: context.contentResolver.getType(f.uri).orEmpty()
        val name = f.uri.lastPathSegment.orEmpty().lowercase()
        return when {
            mime == "application/pdf" || name.endsWith(".pdf") -> fromPdf(f.uri, onStatus)
            mime.startsWith("image/") -> fromImages(listOf(f.uri), onStatus)
            mime.contains("html") || name.endsWith(".html") || name.endsWith(".htm") -> {
                val text = readText(f.uri)
                WebRecipeExtractor.extract(text, null).copy(source = OriginalSource(SourceKind.WEB, null, listOfNotNull(originals?.saveText(text, "html")), com.mundymorning.touchrecipe.core.rescue.Rescue.pageText(text), now()))
            }
            mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md") -> readText(f.uri).let { t -> TextRecipeParser.parse(t).copy(source = OriginalSource(SourceKind.TEXT, text = t, capturedAt = now())) }
            else -> throw ImportFailure("This file type isn't supported yet. Supported: PDF, images, text and web pages.")
        }
    }

    private fun readText(uri: Uri): String = try {
        context.contentResolver.openInputStream(uri)?.use { it.readBytes().also { b -> if (b.size > 5_000_000) throw ImportFailure("That file is too large.") }.toString(Charsets.UTF_8) } ?: throw ImportFailure("That file could not be opened.")
    } catch (e: ImportFailure) { throw e } catch (e: Exception) { throw ImportFailure("That file could not be read.") }
}
