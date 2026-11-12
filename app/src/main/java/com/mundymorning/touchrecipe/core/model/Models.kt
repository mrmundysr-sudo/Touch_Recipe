package com.mundymorning.touchrecipe.core.model

import kotlinx.serialization.Serializable
import java.util.UUID

fun newId(): String = UUID.randomUUID().toString()

/** One ingredient line. [text] is the user-visible line ("1 1/2 cups flour"); [header] marks a section title. */
@Serializable
data class Ingredient(
    val id: String = newId(),
    val text: String,
    val header: Boolean = false,
    val checked: Boolean = false,
)

@Serializable
data class Direction(
    val id: String = newId(),
    val text: String,
    val timerSeconds: Int? = null,
    /** Section title ("For the sauce"); not numbered and skipped by Cook Mode. */
    val header: Boolean = false,
    /** Optional step photo (file name in the photo store) shown in Cook Mode when present. */
    val image: String? = null,
)

@Serializable
data class Recipe(
    val id: String = newId(),
    val title: String = "",
    val description: String = "",
    val notes: String = "",
    /** File name inside the private photo store (never a public path). */
    val photo: String? = null,
    val sourceUrl: String? = null,
    val sourceName: String? = null,
    val cuisine: String? = null,
    val prepMinutes: Int? = null,
    val cookMinutes: Int? = null,
    val totalMinutes: Int? = null,
    val servings: Int? = null,
    val ingredients: List<Ingredient> = emptyList(),
    val directions: List<Direction> = emptyList(),
    val categoryIds: List<String> = emptyList(),
    val favorite: Boolean = false,
    /** Raw imported text / structured data kept so extraction mistakes can be corrected later. */
    val rawSource: String? = null,
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
) {
    val effectiveTotal: Int? get() = totalMinutes ?: if (prepMinutes != null || cookMinutes != null) (prepMinutes ?: 0) + (cookMinutes ?: 0) else null
    val searchText: String
        get() = buildString {
            append(title).append('\n').append(description).append('\n').append(notes).append('\n')
            append(sourceUrl.orEmpty()).append('\n').append(sourceName.orEmpty()).append('\n').append(cuisine.orEmpty()).append('\n')
            ingredients.forEach { append(it.text).append('\n') }
        }.lowercase()
}

/** Where an imported recipe came from. */
@Serializable enum class SourceKind { WEB, PDF, IMAGE, TEXT, NONE }

/**
 * The original a recipe was made from, kept so it can be compared and repaired later.
 * [files] are names in the app's private originals store (a page snapshot, the PDF, the photos); [text] is the text read from it.
 */
@Serializable
data class OriginalSource(val kind: SourceKind = SourceKind.NONE, val url: String? = null, val files: List<String> = emptyList(), val text: String = "", val capturedAt: Long = 0L) {
    val isEmpty: Boolean get() = kind == SourceKind.NONE || (url == null && files.isEmpty() && text.isBlank())
    val lines: List<String> get() = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
}

/** "Ask Mom whether this says 1 cup or 1/2 cup": a question attached to a line, a field or a spot on the original, kept until resolved. */
@Serializable
data class HelpNote(val id: String = newId(), val target: String, val text: String, val resolved: Boolean = false, val page: Int = 0, val x: Float? = null, val y: Float? = null)

enum class Confidence { HIGH, MEDIUM, LOW }
enum class ImportMethod { JSON_LD, MICRODATA, HTML, TEXT, OCR, SOCIAL_CAPTION, MANUAL }
enum class Severity { INFO, WARNING, ERROR }

data class ImportWarning(val field: String, val message: String, val severity: Severity = Severity.WARNING)

/** Result of any import path. Never saved directly: it always goes through Import Review. */
data class ImportDraft(
    val recipe: Recipe,
    val method: ImportMethod,
    val confidence: Confidence,
    val warnings: List<ImportWarning> = emptyList(),
    val imageCandidates: List<String> = emptyList(),
    /** Source text that looked like recipe content but could not be placed with confidence. Shown at review and kept with the recipe; never dropped. */
    val unplaced: List<String> = emptyList(),
    /** The original this draft was read from (page snapshot, PDF, photos, text). */
    val source: OriginalSource = OriginalSource(),
) {
    fun hasWarning(field: String) = warnings.any { it.field == field }
}

@Serializable
data class Category(
    val id: String,
    val name: String,
    val group: String,
    val builtIn: Boolean,
    val enabled: Boolean,
    val sortOrder: Int,
)

/** A planned meal for one calendar day (ISO date). One recipe per day. */
@Serializable
data class MealEntry(val date: String, val recipeId: String, val servings: Int? = null)

@Serializable
data class SourceRef(val recipeId: String, val title: String)

/** A grocery line. [generated] items come from the meal plan; [edited] ones are protected from regeneration. */
@Serializable
data class GroceryItem(
    val id: String = newId(),
    val weekStart: String,
    val name: String,
    val quantityText: String = "",
    val aisle: String,
    val checked: Boolean = false,
    val sortIndex: Int = 0,
    val key: String = "",
    val generated: Boolean = false,
    val edited: Boolean = false,
    val sources: List<SourceRef> = emptyList(),
)
