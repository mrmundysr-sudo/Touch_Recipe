package com.mundymorning.touchrecipe.core.importer

import com.mundymorning.touchrecipe.core.model.*

/** Turns pasted, typed, OCR'd or caption text into a draft recipe. Heuristic, so confidence is never HIGH. */
object TextRecipeParser {
    private val ingHeader = Regex("""^\W*(ingredients?|what you.?ll need|you will need|for the .*)\W*:?\s*$""", RegexOption.IGNORE_CASE)
    private val dirHeader = Regex("""^\W*(directions?|instructions?|method|preparation|steps?|procedure|how to make( it)?)\W*:?\s*$""", RegexOption.IGNORE_CASE)
    private val noteHeader = Regex("""^\W*(notes?|tips?|substitutions?|variations?|cook'?s notes?)\W*:?\s*$""", RegexOption.IGNORE_CASE)
    private val bullet = Regex("""^[\s•·●○▪■□◦\-–—*+>]+""")
    private val stepNum = Regex("""^\s*(?:step\s*)?\d{1,2}\s*[.):\-]\s+""", RegexOption.IGNORE_CASE)
    private val qtyStart = Regex("""^\s*(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞]|a\s+(?:pinch|dash|handful|few)|one\s|two\s|three\s|half\s)""", RegexOption.IGNORE_CASE)
    private val unitWord = Regex("""\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g|kg|ml|l|cloves?|cans?|pinch|dash|slices?|sticks?|packages?|bunch|sprigs?)\b""", RegexOption.IGNORE_CASE)

    fun parse(raw: String, method: ImportMethod = ImportMethod.TEXT, sourceUrl: String? = null): ImportDraft {
        val warnings = mutableListOf<ImportWarning>()
        val lines = raw.replace("\r", "").replace(' ', ' ').lines().map { it.trim() }
        val nonEmpty = lines.filter { it.isNotEmpty() }
        if (nonEmpty.isEmpty()) {
            return ImportDraft(Recipe(sourceUrl = sourceUrl, rawSource = raw), method, Confidence.LOW,
                listOf(ImportWarning("recipe", "No text was found to build a recipe from.", Severity.ERROR)))
        }

        var prep: Int? = null; var cook: Int? = null; var total: Int? = null; var servings: Int? = null
        val sections = mutableMapOf<String, MutableList<String>>("pre" to mutableListOf(), "ing" to mutableListOf(), "dir" to mutableListOf(), "note" to mutableListOf())
        var current = "pre"
        var sawIngHeader = false; var sawDirHeader = false
        val meta = Regex("""^\W*(prep(?:aration)?(?: time)?|cook(?:ing)?(?: time)?|total(?: time)?|ready in|serv(?:es|ings?)|yield|makes)\s*[:\-]?\s*(.*)$""", RegexOption.IGNORE_CASE)

        for (line in lines) {
            if (line.isEmpty()) continue
            val mm = meta.find(line)
            if (mm != null && mm.groupValues[2].isNotBlank() && line.length < 70) {
                val key = mm.groupValues[1].lowercase(); val v = mm.groupValues[2]
                when {
                    key.startsWith("prep") -> prep = Durations.looseMinutes(v) ?: prep
                    key.startsWith("cook") -> cook = Durations.looseMinutes(v) ?: cook
                    key.startsWith("total") || key.startsWith("ready") -> total = Durations.looseMinutes(v) ?: total
                    else -> servings = firstInt(v) ?: servings
                }
                continue
            }
            when {
                ingHeader.matches(line) && !line.startsWith("For the ", true) -> { current = "ing"; sawIngHeader = true; continue }
                dirHeader.matches(line) -> { current = "dir"; sawDirHeader = true; continue }
                noteHeader.matches(line) -> { current = "note"; continue }
            }
            sections.getValue(current).add(line)
        }

        // Headerless text: classify lines
        if (!sawIngHeader && !sawDirHeader) {
            val pre = sections.getValue("pre")
            val title = pre.firstOrNull { !looksLikeIngredient(it) && it.length < 100 }
            val body = pre.filter { it != title }
            sections.getValue("pre").clear(); title?.let { sections.getValue("pre").add(it) }
            body.forEach { if (looksLikeIngredient(it) && it.length < 120) sections.getValue("ing").add(it) else sections.getValue("dir").add(it) }
        } else if (sawIngHeader && !sawDirHeader && sections.getValue("dir").isEmpty()) {
            // Directions without a header: trailing long sentences in the ingredient block
            val ing = sections.getValue("ing")
            val split = ing.indexOfFirst { !looksLikeIngredient(it) && it.length > 40 }
            if (split > 0) { val tail = ing.subList(split, ing.size).toList(); repeat(tail.size) { ing.removeAt(ing.size - 1) }; sections.getValue("dir").addAll(tail) }
        }

        val title = sections.getValue("pre").firstOrNull { it.length < 120 }?.let { cleanTitle(it) }.orEmpty()
        val ingredients = mutableListOf<Ingredient>()
        for (l in sections.getValue("ing")) {
            val t = bullet.replace(l, "").trim()
            if (t.isEmpty()) continue
            val isHeader = t.endsWith(":") || (t.length < 40 && t == t.uppercase() && t.any { it.isLetter() } && !qtyStart.containsMatchIn(t))
            ingredients += Ingredient(text = if (isHeader) t.trimEnd(':').trim() else t, header = isHeader)
        }
        val directions = mergeWrapped(sections.getValue("dir").map { stepNum.replace(bullet.replace(it, ""), "").trim() }.filter { it.isNotEmpty() })
            .map { Direction(text = it, timerSeconds = Durations.timerSeconds(it)) }
        val notes = sections.getValue("note").joinToString("\n") { bullet.replace(it, "").trim() }
        val intro = sections.getValue("pre").drop(1).joinToString(" ").trim()

        if (title.isEmpty()) warnings += ImportWarning("title", "We couldn't tell what this recipe is called. Please add a title.")
        if (ingredients.none { !it.header }) warnings += ImportWarning("ingredients", "No ingredients were recognised. Check the ingredients list.")
        if (directions.isEmpty()) warnings += ImportWarning("directions", "No directions were recognised. Check the directions.")
        warnings += ImportWarning("recipe", if (method == ImportMethod.OCR) "Text was read from a photo or file and may contain mistakes. Please check quantities and steps." else "Recipe text was interpreted automatically. Please check each field.", Severity.INFO)

        val confidence = when {
            title.isNotEmpty() && ingredients.isNotEmpty() && directions.isNotEmpty() && (sawIngHeader || sawDirHeader) && method != ImportMethod.OCR -> Confidence.MEDIUM
            else -> Confidence.LOW
        }
        val recipe = Recipe(
            title = title, description = intro, notes = notes, sourceUrl = sourceUrl,
            prepMinutes = prep, cookMinutes = cook, totalMinutes = total, servings = servings,
            ingredients = ingredients, directions = directions, rawSource = raw,
        )
        return ImportDraft(recipe, method, confidence, warnings)
    }

    private fun cleanTitle(s: String) = bullet.replace(s, "").trim().trim('#', '*', ' ').trim()

    private fun firstInt(s: String): Int? = Regex("""\d+""").find(s)?.value?.toIntOrNull()

    fun looksLikeIngredient(line: String): Boolean {
        val t = bullet.replace(line, "").trim()
        if (t.length > 120 || t.isEmpty()) return false
        if (stepNum.containsMatchIn(t) && !qtyStart.containsMatchIn(t.replace(stepNum, ""))) return false
        if (qtyStart.containsMatchIn(t) && (unitWord.containsMatchIn(t) || t.split(' ').size <= 6)) return !endsLikeSentence(t) || unitWord.containsMatchIn(t)
        return t.split(' ').size <= 4 && unitWord.containsMatchIn(t)
    }

    private fun endsLikeSentence(t: String) = t.endsWith(".") && t.split(' ').size > 8

    /** OCR often breaks sentences across lines: join a line into the previous one when it clearly continues it. */
    private fun mergeWrapped(lines: List<String>): List<String> {
        val out = mutableListOf<String>()
        for (l in lines) {
            val prev = out.lastOrNull()
            if (prev != null && !prev.last().let { it == '.' || it == '!' || it == '?' || it == ':' || it == ')' } && l.first().isLowerCase()) {
                out[out.lastIndex] = if (prev.endsWith("-")) prev.dropLast(1) + l else "$prev $l"
            } else out += l
        }
        return out
    }
}
