package com.mundymorning.touchrecipe.data

import android.content.Context
import android.net.Uri
import com.mundymorning.touchrecipe.core.model.HelpNote
import com.mundymorning.touchrecipe.core.model.OriginalSource
import com.mundymorning.touchrecipe.core.rescue.RescueDraft
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID

/** The original kept with a saved recipe, and the questions still open on it. */
@Serializable
data class RecipeOriginal(val recipeId: String, val source: OriginalSource = OriginalSource(), val helpNotes: List<HelpNote> = emptyList())

/**
 * Private storage for originals: page snapshots, imported PDFs and recipe photos or scans, exactly as they were given.
 * Nothing here is ever removed automatically. A file goes only when the user deletes the draft or the stored original it belongs to.
 */
class OriginalStore(context: Context) {
    private val dir = File(context.filesDir, "originals").apply { mkdirs() }
    private val links = File(dir, "recipes").apply { mkdirs() }
    private val resolver = context.contentResolver
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    /** Bumped whenever a recipe's stored original changes, so screens showing it refresh. */
    val changes = MutableStateFlow(0)

    fun file(name: String) = File(dir, name)
    fun exists(name: String) = name.isNotBlank() && file(name).isFile

    fun saveBytes(bytes: ByteArray, extension: String, maxBytes: Int = MAX_FILE): String? = runCatching {
        if (bytes.isEmpty() || bytes.size > maxBytes) return null
        val name = UUID.randomUUID().toString() + "." + extension.trimStart('.').lowercase().filter { it.isLetterOrDigit() }.take(5).ifEmpty { "bin" }
        file(name).writeBytes(bytes); name
    }.getOrNull()

    fun saveText(text: String, extension: String): String? = saveBytes(text.take(MAX_TEXT).toByteArray(Charsets.UTF_8), extension)

    /** Copies the document or picture the user chose, unchanged. Returns null when it cannot be read or is too large to keep. */
    fun copyFromUri(uri: Uri, extension: String): String? = runCatching {
        val name = UUID.randomUUID().toString() + "." + extension.trimStart('.').lowercase().filter { it.isLetterOrDigit() }.take(5).ifEmpty { "bin" }
        val target = file(name)
        val ok = resolver.openInputStream(uri)?.use { input -> target.outputStream().use { out ->
            val buf = ByteArray(64 * 1024); var total = 0L
            while (true) { val n = input.read(buf); if (n < 0) break; total += n; if (total > MAX_FILE) return@use false; out.write(buf, 0, n) }
            total > 0
        } } ?: false
        if (ok) name else { target.delete(); null }
    }.getOrNull()

    // ---- originals of saved recipes ----
    fun forRecipe(recipeId: String): RecipeOriginal? = runCatching { json.decodeFromString<RecipeOriginal>(File(links, "$recipeId.json").readText()) }.getOrNull()

    fun link(recipeId: String, source: OriginalSource, helpNotes: List<HelpNote>) {
        if (source.isEmpty && helpNotes.isEmpty()) return
        runCatching { File(links, "$recipeId.json").writeText(json.encodeToString(RecipeOriginal(recipeId, source, helpNotes))) }
        changes.value++
    }

    fun updateHelp(recipeId: String, f: (List<HelpNote>) -> List<HelpNote>) { forRecipe(recipeId)?.let { link(recipeId, it.source, f(it.helpNotes)) } }

    /** Removes the stored original of one recipe (the user asked for it). Files still used by a draft or another recipe are left alone. */
    fun unlink(recipeId: String, drafts: DraftStore? = null) {
        val o = forRecipe(recipeId) ?: return
        File(links, "$recipeId.json").delete()
        deleteUnreferenced(o.source.allFiles, drafts)
        changes.value++
    }

    fun deleteUnreferenced(names: List<String>, drafts: DraftStore?) {
        val used = allLinked().flatMap { it.source.allFiles }.toSet() + drafts?.all().orEmpty().flatMap { it.source.allFiles }
        names.filter { it !in used }.forEach { file(it).delete() }
    }

    fun allLinked(): List<RecipeOriginal> = links.listFiles()?.mapNotNull { f -> runCatching { json.decodeFromString<RecipeOriginal>(f.readText()) }.getOrNull() }.orEmpty()
    fun bytesUsed(): Long = dir.listFiles()?.filter { it.isFile }?.sumOf { it.length() } ?: 0L
    fun bytesOf(names: List<String>): Long = names.sumOf { file(it).takeIf { f -> f.isFile }?.length() ?: 0L }

    companion object { const val MAX_FILE = 40 * 1024 * 1024; const val MAX_TEXT = 2_000_000 }
}

/** Unfinished recipes, one small file each, rewritten after every change so nothing is lost to an interruption. */
class DraftStore(context: Context) {
    private val dir = File(context.filesDir, "drafts").apply { mkdirs() }
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    val changes = MutableStateFlow(0)

    @Synchronized fun save(d: RescueDraft) {
        runCatching {
            val tmp = File(dir, d.id + ".tmp")
            tmp.writeText(json.encodeToString(d))
            val target = File(dir, d.id + ".json")
            if (!tmp.renameTo(target)) { target.writeText(tmp.readText()); tmp.delete() }
        }
        changes.value++
    }
    fun get(id: String): RescueDraft? = runCatching { json.decodeFromString<RescueDraft>(File(dir, "$id.json").readText()) }.getOrNull()
    fun all(): List<RescueDraft> = dir.listFiles { f -> f.name.endsWith(".json") }?.mapNotNull { f -> runCatching { json.decodeFromString<RescueDraft>(f.readText()) }.getOrNull() }.orEmpty().sortedByDescending { it.updatedAt }
    fun count(): Int = dir.listFiles { f -> f.name.endsWith(".json") }?.size ?: 0
    /** Removes the draft record only; the caller decides what happens to its original files. */
    @Synchronized fun delete(id: String) { File(dir, "$id.json").delete(); changes.value++ }
}
