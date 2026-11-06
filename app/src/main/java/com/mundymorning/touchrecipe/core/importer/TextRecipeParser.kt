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

    // ---- browser print / PDF furniture that must never become part of a recipe ----
    data class CleanedText(val text: String, val sourceUrl: String?)
    private val furniture = setOf("learn more", "print", "print recipe", "save", "save recipe", "share", "pin", "pin it", "jump to recipe", "advertisement", "skip to content", "menu")
    private val urlOnly = Regex("""^(?:https?://|www\.)\S+$""", RegexOption.IGNORE_CASE)
    private val anyUrl = Regex("""https?://\S+""")
    private val stamp = Regex("""^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}[,\s]+\d{1,2}[: ]\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?$""")
    private val pageNo = Regex("""^page\s+\d+\s*(?:of|/)\s*\d+$""", RegexOption.IGNORE_CASE)
    private val loneMark = Regex("""^[^\p{L}\p{N}]{1,3}$""")
    private val inlineFooter = Regex("""\s*(?:https?://\S+\s+)?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}[,\s]+\d{1,2}[: ]\d{2}(?:\s*[AaPp][Mm])?\b""")
    private val inlineUrlFragment = Regex("""\s*https?://\S*#\S*""")
    private val difficultyRe = Regex("""^di.{0,3}cult\w*\s*[:\-]\s*(\S.*)$""", RegexOption.IGNORE_CASE)
    private val bylineRe = Regex("""^by\s+(\S[^:]{1,40})$""", RegexOption.IGNORE_CASE)

    /** Removes page furniture (footers, stamps, page numbers, bare web addresses, lone punctuation, UI words) and reports the first page address. */
    fun cleanPageText(raw: String): CleanedText {
        var sourceUrl: String? = null
        val out = mutableListOf<String>()
        for (line0 in raw.replace("\r", "").split("\n")) {
            var line = line0.trim()
            if (line.isEmpty()) { out += ""; continue }
            val first = anyUrl.find(line)?.value
            line = line.replace(inlineFooter, " ").replace(inlineUrlFragment, " ").trim()
            if (urlOnly.matches(line)) { if (sourceUrl == null) sourceUrl = line.substringBefore('#').trimEnd('.', ',', ')'); continue }
            if (line.isEmpty()) { if (first != null && sourceUrl == null) sourceUrl = first.substringBefore('#').trimEnd('.', ',', ')'); continue }
            if (stamp.matches(line) || pageNo.matches(line) || loneMark.matches(line) || line.lowercase() in furniture) continue
            out += line
        }
        return CleanedText(out.joinToString("\n"), sourceUrl)
    }

    /** True when a PDF text layer looks damaged by web-font ligatures ("Di!iculty", an unmatched quote inside a word). */
    fun looksGarbled(text: String): Boolean {
        if (Regex("""[A-Za-z][!#%*][a-z]""").containsMatchIn(text) || text.contains('\uFFFD')) return true
        return text.lines().any { l -> l.count { it == '"' } % 2 == 1 && l.none { it == '\u201C' || it == '\u201D' } }
    }

    fun parse(raw: String, method: ImportMethod = ImportMethod.TEXT, sourceUrl: String? = null): ImportDraft {
        val warnings = mutableListOf<ImportWarning>()
        val cleaned = cleanPageText(raw.replace('\u00a0', ' '))
        val pageUrl = sourceUrl ?: cleaned.sourceUrl
        val extras = mutableListOf<String>(); var author: String? = null
        val lines = cleaned.text.lines().map { it.trim() }
        val nonEmpty = lines.filter { it.isNotEmpty() }
        if (nonEmpty.isEmpty()) {
            return ImportDraft(Recipe(sourceUrl = pageUrl, rawSource = raw), method, Confidence.LOW,
                listOf(ImportWarning("recipe", "No text was found to build a recipe from.", Severity.ERROR)))
        }

        var prep: Int? = null; var cook: Int? = null; var total: Int? = null; var servings: Int? = null
        val sections = mutableMapOf<String, MutableList<String>>("pre" to mutableListOf(), "ing" to mutableListOf(), "dir" to mutableListOf(), "note" to mutableListOf())
        var current = "pre"
        var sawIngHeader = false; var sawDirHeader = false
        val meta = Regex("""^\W*(prep(?:aration)?(?: time)?|cook(?:ing)?(?: time)?|total(?: time)?|ready in|serv(?:es|ings?)|yield|makes)\s*[:\-]?\s*(.*)$""", RegexOption.IGNORE_CASE)

        for (line in lines) {
            if (line.isEmpty()) continue
            if (current == "pre") {
                val dm = difficultyRe.find(line)
                if (dm != null && line.length < 60) { extras += "Difficulty: ${dm.groupValues[1].trim()}"; continue }
                val bm = bylineRe.find(line)
                if (bm != null && sections.getValue("pre").size <= 2 && line.none { it.isDigit() }) { author = bm.groupValues[1].trim(); continue }
            }
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
        val directions = mergeWrapped(sections.getValue("dir").map { l -> Pair(stepNum.replace(bullet.replace(l, ""), "").trim(), bullet.containsMatchIn(l) || stepNum.containsMatchIn(l)) }.filter { it.first.isNotEmpty() })
            .map { Direction(text = it, timerSeconds = Durations.timerSeconds(it)) }
        val host = pageUrl?.let { runCatching { java.net.URI(it).host?.removePrefix("www.") }.getOrNull() }
        val notes = (listOfNotNull(author?.takeIf { pageUrl != null }?.let { "By $it" }) + extras + sections.getValue("note").map { bullet.replace(it, "").trim() }).joinToString("\n")
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
            title = title, description = intro, notes = notes, sourceUrl = pageUrl, sourceName = host ?: author,
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

    private val terminal = Regex("""[.!?:;]$""")
    private val continuation = Regex("""^[a-z(\[,;)]""")

    /** Joins wrapped lines into steps. A line continues the previous one when that one has no sentence ending and it starts like a
     *  continuation (lowercase, an opening bracket or a comma); lines that carried their own bullet or number always start a new step. */
    private fun mergeWrapped(items: List<Pair<String, Boolean>>): List<String> {
        val out = mutableListOf<String>()
        for ((text, mark) in items) {
            val prev = out.lastOrNull()
            if (!mark && prev != null && !terminal.containsMatchIn(prev) && continuation.containsMatchIn(text))
                out[out.lastIndex] = if (prev.endsWith("-") && text.first().isLowerCase()) prev.dropLast(1) + text else "$prev $text"
            else out += text
        }
        return out
    }
}
