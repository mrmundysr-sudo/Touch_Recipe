package com.mundymorning.touchrecipe.core.importer

import com.mundymorning.touchrecipe.core.model.*

/**
 * Completeness checks applied to every import, whatever its source. It only adds findings; it never changes
 * or removes recipe content. WARNING means something is probably missing or wrong; INFO means "worth a look".
 */
object ImportValidator {
    private val qty = Regex("""(?<![\p{L}\d/])(?:\d+(?:[.,/]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])\s*(?:cups?|tbsps?|tsps?|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l)\b""", RegexOption.IGNORE_CASE)
    private val dangling = Regex("""(?:,|;|\b(?:and|or|the|to|with|of|until|a|an|in|for|into|about)|…|\.\.\.)$""", RegexOption.IGNORE_CASE)
    private val leadingQty = Regex("""^\s*(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞])""")

    fun validate(d: ImportDraft): ImportDraft {
        val r = d.recipe
        val out = d.warnings.toMutableList()
        fun add(field: String, msg: String, sev: Severity = Severity.WARNING) { if (out.none { it.field == field && it.message == msg }) out += ImportWarning(field, msg, sev) }
        val ings = r.ingredients.filter { !it.header }; val steps = r.directions.filter { !it.header }

        if (r.title.isBlank() && out.none { it.field == "title" }) add("title", "No title was found. Please add one.")
        if (ings.isEmpty() && out.none { it.field == "ingredients" && it.severity != Severity.INFO }) add("ingredients", "No ingredients were found. Compare with the original and add them.")
        if (steps.isEmpty() && out.none { it.field == "directions" && it.severity != Severity.INFO }) add("directions", "No directions were found. Compare with the original and add them.")

        val runTogether = ings.filter { it.text.length > 110 && qty.findAll(it.text).count() >= 3 }
        if (runTogether.isNotEmpty()) add("ingredients", "${runTogether.size} ingredient line${if (runTogether.size == 1) " looks" else "s look"} like several ingredients run together. Please split ${if (runTogether.size == 1) "it" else "them"}.")
        if (ings.size == 1 && steps.size >= 2) add("ingredients", "Only one ingredient was found, which is unusual. Compare with the original.")
        if (ings.size >= 5 && ings.none { leadingQty.containsMatchIn(it.text) }) add("ingredients", "None of the ingredients has an amount. The amounts may not have been captured.", Severity.WARNING)

        steps.lastOrNull()?.text?.trim()?.let { last -> if (last.split(' ').size >= 4 && dangling.containsMatchIn(last)) add("directions", "The last direction seems to stop mid-sentence. Some text may be missing.") }
        if (steps.isNotEmpty() && steps.all { it.text.length < 4 }) add("directions", "Some directions look incomplete. Compare with the original page.")
        if (steps.isNotEmpty() && ings.size >= 6 && steps.sumOf { it.text.length } < 60) add("directions", "The directions are very short for this many ingredients. Some text may be missing.")
        if (steps.size == 1 && ings.size >= 5 && steps[0].text.length < 200) add("directions", "Only one short direction was found for ${ings.size} ingredients. Some steps may be missing.")
        if (steps.size == 1 && steps[0].text.length > 700) add("directions", "All the directions arrived as one long step. You may want to split it.", Severity.INFO)

        if (d.unplaced.isNotEmpty()) add("recipe", "${d.unplaced.size} line${if (d.unplaced.size == 1) "" else "s"} from the source could not be placed and ${if (d.unplaced.size == 1) "is" else "are"} kept for you to review.")
        return d.copy(warnings = out)
    }
}
