package com.mundymorning.touchrecipe.core.backup

import com.mundymorning.touchrecipe.core.model.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Documented backup format (see docs/BACKUP_FORMAT.md). A backup is a ZIP archive:
 *   data.json           this structure
 *   photos/<file>       recipe photos referenced by Recipe.photo
 * `data.json` alone is also accepted on import ("recipes only" export).
 */
@Serializable
data class BackupFile(
    val format: String = FORMAT,
    val version: Int = VERSION,
    val exportedAt: Long,
    val appVersion: String = "",
    val recipes: List<Recipe> = emptyList(),
    val categories: List<Category> = emptyList(),
    val mealPlan: List<MealEntry> = emptyList(),
    val groceryItems: List<GroceryItem> = emptyList(),
    val preferences: Map<String, String> = emptyMap(),
) {
    companion object { const val FORMAT = "touch-recipe-backup"; const val VERSION = 1 }
}

class BackupException(message: String) : Exception(message)

object BackupCodec {
    val json = Json { prettyPrint = true; ignoreUnknownKeys = true; encodeDefaults = true; coerceInputValues = true }

    fun encode(file: BackupFile): String = json.encodeToString(BackupFile.serializer(), file)

    fun decode(text: String): BackupFile {
        val file = try { json.decodeFromString(BackupFile.serializer(), text) } catch (e: Exception) {
            throw BackupException("This file is not a Touch Recipe backup, or it is damaged.")
        }
        if (file.format != BackupFile.FORMAT) throw BackupException("This file is not a Touch Recipe backup.")
        if (file.version > BackupFile.VERSION) throw BackupException("This backup was made by a newer version of Touch Recipe. Please update the app first.")
        return file
    }
}
