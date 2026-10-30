package com.mundymorning.touchrecipe.data

import android.content.Context
import android.net.Uri
import com.mundymorning.touchrecipe.BuildConfig
import com.mundymorning.touchrecipe.core.backup.*
import com.mundymorning.touchrecipe.core.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

enum class RestoreMode { MERGE, REPLACE }
data class RestoreSummary(val recipes: Int, val categories: Int, val meals: Int, val groceries: Int, val photos: Int)

/** Local backup/restore. Files only move when the user picks a destination or source (Storage Access Framework). */
class BackupManager(private val context: Context, private val repo: Repository, private val photos: PhotoStore, private val prefs: Prefs) {
    suspend fun snapshot(): BackupFile = withContext(Dispatchers.IO) {
        val db = repo.db
        BackupFile(
            exportedAt = System.currentTimeMillis(), appVersion = BuildConfig.VERSION_NAME,
            recipes = db.recipes().all().map { it.toModel() }, categories = db.categories().all().map { it.toModel() },
            mealPlan = db.meals().all().map { it.toModel() }, groceryItems = db.grocery().all().map { it.toModel() },
            preferences = prefs.exportable(),
        )
    }

    suspend fun export(uri: Uri, withPhotos: Boolean = true): Int = withContext(Dispatchers.IO) {
        val file = snapshot()
        var count = 0
        context.contentResolver.openOutputStream(uri, "w")?.use { raw ->
            ZipOutputStream(raw).use { z ->
                z.putNextEntry(ZipEntry("data.json")); z.write(BackupCodec.encode(file).toByteArray()); z.closeEntry()
                if (withPhotos) file.recipes.mapNotNull { it.photo }.distinct().forEach { name ->
                    val f = photos.file(name)
                    if (f.exists()) { z.putNextEntry(ZipEntry("photos/$name")); f.inputStream().use { it.copyTo(z) }; z.closeEntry(); count++ }
                }
            }
        } ?: throw BackupException("The backup file could not be created.")
        file.recipes.size
    }

    suspend fun exportRecipesJson(uri: Uri): Int = withContext(Dispatchers.IO) {
        val file = snapshot().copy(categories = emptyList(), mealPlan = emptyList(), groceryItems = emptyList(), preferences = emptyMap())
        context.contentResolver.openOutputStream(uri, "w")?.use { it.write(BackupCodec.encode(file).toByteArray()) } ?: throw BackupException("The file could not be created.")
        file.recipes.size
    }

    /** Reads and validates the whole backup before touching any existing data. */
    suspend fun restore(uri: Uri, mode: RestoreMode): RestoreSummary = withContext(Dispatchers.IO) {
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: throw BackupException("The backup could not be opened.")
        if (bytes.size > 400 * 1024 * 1024) throw BackupException("This backup is too large.")
        var json: String? = null
        val photoData = HashMap<String, ByteArray>()
        if (bytes.size > 4 && bytes[0] == 'P'.code.toByte() && bytes[1] == 'K'.code.toByte()) {
            ZipInputStream(bytes.inputStream()).use { z ->
                var e: ZipEntry? = z.nextEntry
                while (e != null) {
                    val name = e.name
                    if (name == "data.json") json = z.readBytes().toString(Charsets.UTF_8)
                    else if (name.startsWith("photos/") && !name.contains("..") && name.length > 7) { val out = ByteArrayOutputStream(); z.copyTo(out); photoData[name.removePrefix("photos/")] = out.toByteArray() }
                    e = z.nextEntry
                }
            }
        } else json = bytes.toString(Charsets.UTF_8)
        val file = BackupCodec.decode(json ?: throw BackupException("This archive has no recipe data."))

        val db = repo.db
        if (mode == RestoreMode.REPLACE) { db.recipes().clear(); db.meals().clear(); db.grocery().clear(); db.cook().clear() }
        var photoCount = 0
        for ((name, data) in photoData) {
            val target = photos.file(name)
            if (name.endsWith(".jpg") && !name.contains('/') && !target.exists()) { target.writeBytes(data); photoCount++ }
        }
        if (file.categories.isNotEmpty()) {
            val existing = db.categories().all().associateBy { it.id }
            db.categories().upsertAll(file.categories.map { c -> if (mode == RestoreMode.MERGE && existing[c.id] != null) existing.getValue(c.id).toModel().copy(enabled = existing.getValue(c.id).enabled || c.enabled).toEntity() else c.toEntity() })
        }
        val have = db.recipes().all().associateBy { it.id }
        db.recipes().upsertAll(file.recipes.filter { mode == RestoreMode.REPLACE || have[it.id] == null || have.getValue(it.id).updatedAt < it.updatedAt }.map { it.toEntity() })
        db.meals().upsertAll(file.mealPlan.map { it.toEntity() })
        db.grocery().upsertAll(file.groceryItems.map { it.toEntity() })
        if (mode == RestoreMode.REPLACE) prefs.restore(file.preferences)
        RestoreSummary(file.recipes.size, file.categories.size, file.mealPlan.size, file.groceryItems.size, photoCount)
    }
}
