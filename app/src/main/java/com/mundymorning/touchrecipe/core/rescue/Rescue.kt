package com.mundymorning.touchrecipe.core.rescue

import com.mundymorning.touchrecipe.core.importer.Durations
import com.mundymorning.touchrecipe.core.importer.PageScan
import com.mundymorning.touchrecipe.core.importer.TextRecipeParser
import com.mundymorning.touchrecipe.core.model.*
import kotlinx.serialization.Serializable

/** An unfinished recipe: the fields as they stand, the original, open questions and the undo history. Saved after every change. */
@Serializable
data class RescueDraft(
    val id: String = newId(),
    val recipe: Recipe = Recipe(),
    val source: OriginalSource = OriginalSource(),
    val helpNotes: List<HelpNote> = emptyList(),
    /** What the import check reported; shown until dismissed. */
    val findings: List<String> = emptyList(),
    /** Set when repairing a recipe that is already in the collection: saving updates that recipe. Null for a new import. */
    val recipeId: String? = null,
    val undo: List<Recipe> = emptyList(),
    val redo: List<Recipe> = emptyList(),
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
) {
    val openQuestions: Int get() = helpNotes.count { !it.resolved }
}

/** Editing state on screen: the draft plus what is currently selected. */
data class RescueState(val draft: RescueDraft, val selecting: Boolean = false, val selection: Set<String> = emptySet()) {
    val recipe: Recipe get() = draft.recipe
    val canUndo: Boolean get() = draft.undo.isNotEmpty()
    val canRedo: Boolean get() = draft.redo.isNotEmpty()
}

/**
 * Every Recipe Rescue edit as a pure function, so each one can be undone and tested. Nothing here guesses: text is placed
 * only where the user sends it.
 */
object Rescue {
    const val TITLE = "f:title"; const val PHOTO = "f:photo"; const val SERVINGS = "f:servings"; const val TIMES = "f:times"
    const val NOTES = "f:notes"; const val DESCRIPTION = "f:description"; const val INGREDIENTS = "f:ingredients"; const val DIRECTIONS = "f:directions"
    private const val HISTORY = 40

    private val bullet = Regex("""^[^\p{L}\p{Nd}(\[¼½¾⅓⅔⅛⅜⅝⅞]+""")
    private val stepNum = Regex("""^\s*(?:step\s*)?\d{1,2}\s*[.):]\s+(?=\S)|^\s*step\s*\d{1,2}\s*[.):\-–—]?\s*""", RegexOption.IGNORE_CASE)

    /** Changes the recipe and remembers the previous version for Undo. An edit that changes nothing leaves the history alone. */
    fun edit(s: RescueState, f: (Recipe) -> Recipe): RescueState {
        val next = f(s.recipe)
        if (next == s.recipe) return s
        return s.copy(draft = s.draft.copy(recipe = next, undo = (s.draft.undo + s.recipe).takeLast(HISTORY), redo = emptyList()))
    }

    fun undo(s: RescueState): RescueState {
        val prev = s.draft.undo.lastOrNull() ?: return s
        return s.copy(draft = s.draft.copy(recipe = prev, undo = s.draft.undo.dropLast(1), redo = (s.draft.redo + s.recipe).takeLast(HISTORY)), selection = emptySet())
    }

    fun redo(s: RescueState): RescueState {
        val next = s.draft.redo.lastOrNull() ?: return s
        return s.copy(draft = s.draft.copy(recipe = next, redo = s.draft.redo.dropLast(1), undo = (s.draft.undo + s.recipe).takeLast(HISTORY)), selection = emptySet())
    }

    /** One entry per non-empty line; list marks are removed, amounts and wording are untouched. */
    fun ingredientLines(text: String): List<String> = text.lines().map { bullet.replace(it.trim(), "").trim() }.filter { it.isNotEmpty() }

    /** One step per line or paragraph; a wrapped sentence is joined to the line above it, and "1." / "Step 2" marks are removed. */
    fun stepLines(text: String): List<String> {
        val out = mutableListOf<String>()
        var blankBefore = true
        for (raw in text.lines()) {
            val t = raw.trim()
            if (t.isEmpty()) { blankBefore = true; continue }
            val marked = stepNum.containsMatchIn(t) || (bullet.containsMatchIn(t) && !t.first().isLetterOrDigit())
            val clean = stepNum.replace(bullet.replace(t, ""), "").trim()
            if (clean.isEmpty()) continue
            val prev = out.lastOrNull()
            if (prev != null && !marked && !blankBefore && !Regex("""[.!?:;]$""").containsMatchIn(prev) && clean.first().isLowerCase()) out[out.lastIndex] = "$prev $clean"
            else out += clean
            blankBefore = false
        }
        return out
    }

    fun addIngredients(s: RescueState, text: String): RescueState {
        val lines = ingredientLines(text); if (lines.isEmpty()) return s
        return edit(s) { r -> r.copy(ingredients = r.ingredients + lines.map { Ingredient(text = it.trimEnd(':'), header = it.endsWith(":") && it.length < 50) }) }
    }

    fun addSteps(s: RescueState, text: String): RescueState {
        val lines = stepLines(text); if (lines.isEmpty()) return s
        return edit(s) { r -> r.copy(directions = r.directions + lines.map { Direction(text = it, timerSeconds = Durations.timerSeconds(it)) }) }
    }

    fun setTitle(s: RescueState, text: String) = edit(s) { it.copy(title = text.lines().firstOrNull { l -> l.isNotBlank() }?.trim().orEmpty().take(200)) }
    fun setDescription(s: RescueState, text: String) = edit(s) { it.copy(description = text.trim()) }
    fun addNotes(s: RescueState, text: String) = edit(s) { r -> r.copy(notes = listOf(r.notes, text.trim()).filter { it.isNotBlank() }.joinToString("\n")) }
    fun setNotes(s: RescueState, text: String) = edit(s) { it.copy(notes = text) }
    /** Reads the first whole number in the text ("Serves 6 to 8" gives 6). Text without a number changes nothing. */
    fun setServings(s: RescueState, text: String): RescueState { val n = Regex("""\d{1,3}""").find(text)?.value?.toIntOrNull()?.takeIf { it in 1..999 } ?: return s; return edit(s) { it.copy(servings = n) } }
    fun clearServings(s: RescueState) = edit(s) { it.copy(servings = null) }
    /** [which] is "prep", "cook" or "total". Accepts "45", "45 min", "1 hr 10 min", "PT1H". Text with no time in it changes nothing. */
    fun setTime(s: RescueState, which: String, text: String): RescueState {
        val t = text.trim()
        val m = (if (t.isEmpty()) null else t.toIntOrNull() ?: Durations.toMinutes(t) ?: Durations.looseMinutes(t))
        if (t.isNotEmpty() && m == null) return s
        return edit(s) { r -> when (which) { "prep" -> r.copy(prepMinutes = m); "cook" -> r.copy(cookMinutes = m); else -> r.copy(totalMinutes = m) } }
    }
    fun setPhoto(s: RescueState, name: String?) = edit(s) { it.copy(photo = name) }

    fun editIngredient(s: RescueState, id: String, text: String) = edit(s) { r -> r.copy(ingredients = r.ingredients.map { if (it.id == id) it.copy(text = text.trim()) else it }) }
    fun editStep(s: RescueState, id: String, text: String) = edit(s) { r -> r.copy(directions = r.directions.map { if (it.id == id) it.copy(text = text.trim(), timerSeconds = if (it.header) null else Durations.timerSeconds(text)) else it }) }
    fun toggleHeader(s: RescueState, id: String) = edit(s) { r -> r.copy(ingredients = r.ingredients.map { if (it.id == id) it.copy(header = !it.header) else it }, directions = r.directions.map { if (it.id == id) it.copy(header = !it.header, timerSeconds = null) else it }) }
    fun delete(s: RescueState, id: String) = edit(s) { r -> r.copy(ingredients = r.ingredients.filter { it.id != id }, directions = r.directions.filter { it.id != id }) }.let { it.copy(selection = it.selection - id) }
    fun move(s: RescueState, id: String, delta: Int) = edit(s) { r ->
        fun <T> shift(l: List<T>, i: Int): List<T> { val j = i + delta; if (i < 0 || j !in l.indices) return l; val m = l.toMutableList(); m.add(j, m.removeAt(i)); return m }
        r.copy(ingredients = shift(r.ingredients, r.ingredients.indexOfFirst { it.id == id }), directions = shift(r.directions, r.directions.indexOfFirst { it.id == id }))
    }

    // ---- selection ----
    fun startSelecting(s: RescueState) = s.copy(selecting = true)
    fun cancelSelection(s: RescueState) = s.copy(selecting = false, selection = emptySet())
    fun toggle(s: RescueState, id: String) = s.copy(selecting = true, selection = if (id in s.selection) s.selection - id else s.selection + id)
    fun selectAllIngredients(s: RescueState) = s.copy(selecting = true, selection = s.selection + s.recipe.ingredients.map { it.id })
    fun selectAllSteps(s: RescueState) = s.copy(selecting = true, selection = s.selection + s.recipe.directions.map { it.id })

    /** Removes exactly what is selected: lines by id, and whole fields by their field key. Everything else is kept. One Undo restores it. */
    fun removeSelected(s: RescueState): RescueState {
        if (s.selection.isEmpty()) return s
        val sel = s.selection
        return edit(s) { r -> r.copy(
            title = if (TITLE in sel) "" else r.title, photo = if (PHOTO in sel) null else r.photo, servings = if (SERVINGS in sel) null else r.servings,
            prepMinutes = if (TIMES in sel) null else r.prepMinutes, cookMinutes = if (TIMES in sel) null else r.cookMinutes, totalMinutes = if (TIMES in sel) null else r.totalMinutes,
            notes = if (NOTES in sel) "" else r.notes, description = if (DESCRIPTION in sel) "" else r.description,
            ingredients = r.ingredients.filter { it.id !in sel }, directions = r.directions.filter { it.id !in sel },
        ) }.copy(selection = emptySet(), selecting = false)
    }

    /**
     * Puts new text where the selected lines were. Selected ingredients are replaced by ingredient lines, selected steps by steps;
     * when both kinds are selected each new line goes to the list it reads like. Unselected lines keep their place and order.
     */
    fun replaceSelected(s: RescueState, text: String): RescueState {
        val sel = s.selection
        val ingSel = s.recipe.ingredients.any { it.id in sel }; val dirSel = s.recipe.directions.any { it.id in sel }
        if (!ingSel && !dirSel) return s
        val newIng: List<String>; val newDir: List<String>
        when {
            ingSel && !dirSel -> { newIng = ingredientLines(text); newDir = emptyList() }
            dirSel && !ingSel -> { newIng = emptyList(); newDir = stepLines(text) }
            else -> { val all = ingredientLines(text); newIng = all.filter { PageScan.ingredientLike(it) }; newDir = stepLines(all.filter { !PageScan.ingredientLike(it) }.joinToString("\n\n")) }
        }
        return edit(s) { r ->
            fun <T> splice(list: List<T>, isSel: (T) -> Boolean, fresh: List<T>): List<T> {
                val at = list.indexOfFirst(isSel); if (at < 0) return list
                val kept = list.filterNot(isSel); val before = list.take(at).count { !isSel(it) }
                return kept.take(before) + fresh + kept.drop(before)
            }
            r.copy(ingredients = splice(r.ingredients, { it.id in sel }, newIng.map { Ingredient(text = it) }),
                directions = splice(r.directions, { it.id in sel }, newDir.map { Direction(text = it, timerSeconds = Durations.timerSeconds(it)) }))
        }.copy(selection = emptySet(), selecting = false)
    }

    /** Clears the editable fields for a badly damaged import. Fields named in [keep] stay; the original is never touched; one Undo brings it all back. */
    fun startFresh(s: RescueState, keep: Set<String>): RescueState = edit(s) { r -> r.copy(
        title = if (TITLE in keep) r.title else "", photo = if (PHOTO in keep) r.photo else null, servings = if (SERVINGS in keep) r.servings else null,
        prepMinutes = if (TIMES in keep) r.prepMinutes else null, cookMinutes = if (TIMES in keep) r.cookMinutes else null, totalMinutes = if (TIMES in keep) r.totalMinutes else null,
        notes = if (NOTES in keep) r.notes else "", description = if (DESCRIPTION in keep) r.description else "",
        ingredients = if (INGREDIENTS in keep) r.ingredients else emptyList(), directions = if (DIRECTIONS in keep) r.directions else emptyList(),
    ) }.copy(selection = emptySet(), selecting = false)

    /** What Smart Paste would do with a block of text. Nothing is changed until [applySmartPaste] is called with the user's confirmation. */
    class PastePlan(val title: String, val ingredients: List<Ingredient>, val directions: List<Direction>, val servings: Int?, val prep: Int?, val cook: Int?, val total: Int?, val notes: String, val leftover: List<String>) {
        val isEmpty: Boolean get() = title.isBlank() && ingredients.isEmpty() && directions.isEmpty() && servings == null && prep == null && cook == null && total == null && notes.isBlank()
    }

    fun planSmartPaste(text: String): PastePlan {
        val d = TextRecipeParser.parse(text); val r = d.recipe
        val looksLikeList = text.lines().count { it.isNotBlank() }.let { n -> n > 0 && r.ingredients.count { !it.header } + r.directions.count { !it.header } >= n - 1 }
        return PastePlan(if (looksLikeList && r.ingredients.isEmpty() && r.directions.size <= 1) "" else r.title, r.ingredients, r.directions, r.servings, r.prepMinutes, r.cookMinutes, r.totalMinutes, r.notes, d.unplaced)
    }

    /** Adds the planned lines to the lists and fills only fields that are still empty: nothing already in the recipe is overwritten. */
    fun applySmartPaste(s: RescueState, p: PastePlan): RescueState = edit(s) { r -> r.copy(
        title = r.title.ifBlank { p.title }, servings = r.servings ?: p.servings, prepMinutes = r.prepMinutes ?: p.prep, cookMinutes = r.cookMinutes ?: p.cook, totalMinutes = r.totalMinutes ?: p.total,
        ingredients = r.ingredients + p.ingredients.map { it.copy(id = newId(), checked = false) }, directions = r.directions + p.directions.map { it.copy(id = newId()) },
        notes = listOf(r.notes, p.notes).filter { it.isNotBlank() }.joinToString("\n"),
    ) }

    // ---- questions for the family ----
    fun addHelp(s: RescueState, target: String, text: String, page: Int = 0, x: Float? = null, y: Float? = null): RescueState =
        if (text.isBlank()) s else s.copy(draft = s.draft.copy(helpNotes = s.draft.helpNotes + HelpNote(target = target, text = text.trim(), page = page, x = x, y = y)))
    fun resolveHelp(s: RescueState, id: String, resolved: Boolean = true) = s.copy(draft = s.draft.copy(helpNotes = s.draft.helpNotes.map { if (it.id == id) it.copy(resolved = resolved) else it }))
    fun editHelp(s: RescueState, id: String, text: String) = s.copy(draft = s.draft.copy(helpNotes = s.draft.helpNotes.map { if (it.id == id) it.copy(text = text.trim()) else it }))
    fun deleteHelp(s: RescueState, id: String) = s.copy(draft = s.draft.copy(helpNotes = s.draft.helpNotes.filter { it.id != id }))
    fun helpFor(s: RescueState, target: String) = s.draft.helpNotes.filter { it.target == target && !it.resolved }

    /** What still stands between this draft and a saved recipe. Empty means it can be saved. */
    fun problems(r: Recipe): List<String> = buildList {
        if (r.title.isBlank()) add("Add a title before saving.")
        if (r.ingredients.none { !it.header && it.text.isNotBlank() } && r.directions.none { !it.header && it.text.isNotBlank() }) add("Add at least one ingredient or one direction before saving.")
    }

    /** The recipe as it will be saved: blank lines dropped, text trimmed. */
    fun cleaned(r: Recipe): Recipe = r.copy(title = r.title.trim(), ingredients = r.ingredients.filter { it.text.isNotBlank() }, directions = r.directions.filter { it.text.isNotBlank() })

    /** The readable text of a web page, one line per block, for the Text view of the original. Menus, scripts and forms are left out. */
    fun pageText(html: String, maxLines: Int = 1500): String = runCatching {
        val doc = org.jsoup.Jsoup.parse(html)
        doc.select("script, style, noscript, template, svg, iframe, nav, form, footer, header nav, select, button").remove()
        val out = ArrayList<String>()
        for (el in doc.select("h1, h2, h3, h4, h5, h6, li, p, td, dt, dd, blockquote")) {
            if (el.select("li, p").isNotEmpty() && el.tagName() !in setOf("li", "p")) continue
            if (el.tagName() == "li" && el.select("li").size > 1) continue
            val t = PageScan.text(el)
            if (t.length >= 2 && out.lastOrNull() != t) out += t
            if (out.size >= maxLines) break
        }
        out.joinToString("\n")
    }.getOrDefault("")
}
