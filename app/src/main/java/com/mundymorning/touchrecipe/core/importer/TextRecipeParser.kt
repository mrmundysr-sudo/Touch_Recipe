package com.mundymorning.touchrecipe.core.importer

import com.mundymorning.touchrecipe.core.model.*

/** Turns pasted, typed, OCR'd or caption text into a draft recipe. Heuristic, so confidence is never HIGH. */
object TextRecipeParser {
    // a heading may carry a count or the scale buttons of a recipe card: "Ingredients (12)", "Ingredients 1x 2x 3x", "Ingredients: 10"
    private const val headTail = """(?:\s*\(?\d{1,3}\)?|(?:\s+\d(?:/\d)?\s?x)+|\s+(?:us customary|metric|scale|cook mode)(?:\s.*)?)?"""
    private val ingHeader = Regex("""^\W*(ingredients?|what you.?ll need|you will need|for the .*)\W*""" + headTail + """\W*$""", RegexOption.IGNORE_CASE)
    private val dirHeader = Regex("""^\W*(directions?|instructions?|method|preparation|steps?|procedure|how to make( it)?)\W*""" + headTail + """\W*$""", RegexOption.IGNORE_CASE)
    private val noteHeader = Regex("""^\W*(notes?|tips?|substitutions?|variations?|cook'?s notes?)\W*:?\s*$""", RegexOption.IGNORE_CASE)
    // any leading marks (bullets, tick boxes, circled numbers, private-use glyphs) that are not text, a digit, a fraction or a bracket
    private val bullet = Regex("""^[^\p{L}\p{Nd}(\[¼½¾⅓⅔⅛⅜⅝⅞]+""")
    private val stepNum = Regex("""^\s*(?:step\s*)?\d{1,2}\s*[.):\-]\s+""", RegexOption.IGNORE_CASE)
    private val qtyStart = Regex("""^\s*(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞]|a\s+(?:pinch|dash|handful|few)|one\s|two\s|three\s|half\s)""", RegexOption.IGNORE_CASE)
    private val unitWord = Regex("""\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g|kg|ml|l|cloves?|cans?|pinch|dash|slices?|sticks?|packages?|bunch|sprigs?)\b""", RegexOption.IGNORE_CASE)

    // ---- browser print / PDF furniture that must never become part of a recipe ----
    data class CleanedText(val text: String, val sourceUrl: String?, val titleHint: String? = null)
    private val furniture = setOf("learn more", "print", "print recipe", "save", "save recipe", "share", "pin", "pin it", "jump to recipe", "advertisement", "skip to content", "menu")
    private val urlOnly = Regex("""^(?:https?://|www\.)\S+$""", RegexOption.IGNORE_CASE)
    private val anyUrl = Regex("""https?://\S+""")
    private val stamp = Regex("""^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}[,\s]+\d{1,2}[: ]\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?$""")
    private val pageNo = Regex("""^page\s+\d+\s*(?:of|/)\s*\d+$""", RegexOption.IGNORE_CASE)
    private val loneMark = Regex("""^[^\p{L}\p{N}]{1,3}$""")
    private val inlineFooter = Regex("""\s*(?:https?://\S+\s+)?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}[,\s]+\d{1,2}[: ]\d{2}(?:\s*[AaPp][Mm])?\b""")
    private val inlineUrlFragment = Regex("""\s*https?://\S*#\S*""")
    /** Chrome/Safari print header: "11/6/26, 3:04 PM  Page title". */
    private val stampedHeader = Regex("""^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}[:\s\u2236]\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?\s+\S.*$""")
    private val stampPrefix = Regex("""^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}[:\s\u2236]\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?\s+""")
    /** "Best Banana Bread Recipe - Site Name" -> "Best Banana Bread Recipe". */
    fun pageTitle(t: String): String? {
        val parts = t.trim().split(Regex("""\s+[|\-–—•·:]\s+"""))
        val best = (if (parts.size > 1 && parts.first().length >= 6) parts.first() else t.trim()).replace(Regex("""(?i)\s+recipe$"""), "").trim()
        return best.takeIf { it.length in 3..120 }
    }
    private val pageMark = Regex("""\s*\bpage\s+\d+\s*(?:of|/)\s*\d+\b\s*""", RegexOption.IGNORE_CASE)
    private val pageFraction = Regex("""\s+\d{1,3}/\d{1,3}$""")
    private val endHeader = Regex("""^\W*(nutrition(?:al)?(?: facts| information| info)?(?: \(?per serving\)?)?|comments?|reviews?|leave a (?:reply|comment|review)|you (?:may|might) also (?:like|enjoy)|related recipes|more recipes|did you make this(?: recipe)?\??|share this recipe|about the author|popular recipes)\W*:?\s*$""", RegexOption.IGNORE_CASE)
    private val difficultyRe = Regex("""^di.{0,3}cult\w*\s*[:\-]\s*(\S.*)$""", RegexOption.IGNORE_CASE)
    private val bylineRe = Regex("""^by\s+(\S[^:]{1,40})$""", RegexOption.IGNORE_CASE)

    /** Removes page furniture (footers, stamps, page numbers, bare web addresses, lone punctuation, UI words) and reports the first page address. */
    fun cleanPageText(raw: String): CleanedText {
        var sourceUrl: String? = null
        var titleHint: String? = null
        val out = mutableListOf<String>()
        for (line0 in raw.replace("\r", "").split("\n")) {
            var line = line0.trim()
            if (line.isEmpty()) { out += ""; continue }
            val first = anyUrl.find(line)?.value
            if (first != null && pageMark.containsMatchIn(line)) line = line.replace(pageMark, " ").trim()
            if (first != null && line.startsWith(first) ) line = line.replace(pageFraction, "")
            if (stampedHeader.matches(line) && first == null) {
                // the browser prints the page title beside the date: the best title a printed page has
                if (titleHint == null) titleHint = pageTitle(line.replace(stampPrefix, ""))
                continue
            }
            line = line.replace(inlineFooter, " ").replace(inlineUrlFragment, " ").trim()
            if (urlOnly.matches(line)) { if (sourceUrl == null) sourceUrl = line.substringBefore('#').trimEnd('.', ',', ')'); continue }
            if (line.isEmpty()) { if (first != null && sourceUrl == null) sourceUrl = first.substringBefore('#').trimEnd('.', ',', ')'); continue }
            if (stamp.matches(line) || pageNo.matches(line) || loneMark.matches(line) || line.lowercase() in furniture) continue
            out += line
        }
        return CleanedText(out.joinToString("\n"), sourceUrl, titleHint)
    }

    /** True when a PDF text layer looks damaged by web-font ligatures ("Di!iculty", an unmatched quote inside a word). */
    fun looksGarbled(text: String): Boolean {
        if (Regex("""[A-Za-z][!#%*][a-z]""").containsMatchIn(text) || text.contains('\uFFFD')) return true
        return text.lines().any { l -> l.count { it == '"' } % 2 == 1 && l.none { it == '\u201C' || it == '\u201D' } }
    }

    fun parse(raw: String, method: ImportMethod = ImportMethod.TEXT, sourceUrl: String? = null, titleHint: String? = null): ImportDraft {
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

        val metaEach = Regex("""(prep(?:aration)?(?: time)?|cook(?:ing)?(?: time)?|total(?: time)?|ready in|serv(?:es|ings?)|yield|makes)\s*[:\-]?\s*(.*?)(?=\s+(?:prep(?:aration)?(?: time)?|cook(?:ing)?(?: time)?|total(?: time)?|ready in|serv(?:es|ings?)|yield|makes)\s*[:\-]|$)""", RegexOption.IGNORE_CASE)
        val stepNumbers = mutableListOf<Int>()
        // every "Ingredients" / "Directions" heading starts its own block; the best block of each kind is chosen afterwards,
        // so a printed web page's menus and sidebars do not end up in the recipe
        val ingBlocks = mutableListOf<Pair<Int, MutableList<String>>>(); val dirBlocks = mutableListOf<Pair<Int, MutableList<String>>>()
        var order = 0
        for (line in lines) {
            if (line.isEmpty()) continue
            order++
            if (current == "pre") {
                val dm = difficultyRe.find(line)
                if (dm != null && line.length < 60) { extras += "Difficulty: ${dm.groupValues[1].trim()}"; continue }
                val bm = bylineRe.find(line)
                if (bm != null && sections.getValue("pre").size <= 2 && line.none { it.isDigit() }) { author = bm.groupValues[1].trim(); continue }
            }
            val mm = meta.find(line)
            if (mm != null && mm.groupValues[2].isNotBlank() && line.length < 140 && current != "dir") {
                // one line may carry several values: "Servings: 36  Prep time: 20 minutes  Cook time: 11 minutes"
                val parts = metaEach.findAll(line).toList()
                if (line.length < 70 || parts.size >= 2) {
                    for (m in parts.ifEmpty { listOf(mm) }) {
                        val key = m.groupValues[1].lowercase(); val v = m.groupValues[2]
                        when {
                            key.startsWith("prep") -> prep = Durations.looseMinutes(v) ?: prep
                            key.startsWith("cook") -> cook = Durations.looseMinutes(v) ?: cook
                            key.startsWith("total") || key.startsWith("ready") -> total = Durations.looseMinutes(v) ?: total
                            else -> servings = firstInt(v) ?: servings
                        }
                    }
                    continue
                }
            }
            when {
                ingHeader.matches(line) && !line.startsWith("For the ", true) -> { current = "ing"; sawIngHeader = true; ingBlocks += order to mutableListOf(); continue }
                dirHeader.matches(line) && !stepLabel.containsMatchIn(line) -> { current = "dir"; sawDirHeader = true; dirBlocks += order to mutableListOf(); continue }
                noteHeader.matches(line) -> { current = "note"; continue }
                (sawIngHeader || sawDirHeader) && endHeader.matches(line) -> { current = "post"; continue }
            }
            if (current == "post") continue   // page furniture after the recipe; the full text is still kept in rawSource
            when (current) { "ing" -> ingBlocks.last().second.add(line); "dir" -> dirBlocks.last().second.add(line); else -> sections.getValue(current).add(line) }
        }
        val unplaced = mutableListOf<String>()
        fun ingLike(l: String) = looksLikeIngredient(l) || PageScan.ingredientLike(bullet.replace(l, ""))
        fun subHeader(l: String) = l.length < 50 && (l.endsWith(":") || (l.startsWith("For ", true) && l.split(' ').size <= 4 && l.none { it.isDigit() || it == ',' }))
        if (ingBlocks.isNotEmpty()) {
            val best = ingBlocks.maxBy { b -> ingScore(b, dirBlocks, ::ingLike) }
            var chosen: List<String> = best.second
            if (sawDirHeader) {
                // cut the block where ingredient lines stop (three other lines in a row); a few cut lines are kept for review
                var miss = 0; var cutAt = chosen.size
                for ((i, l) in chosen.withIndex()) { if (ingLike(l) || subHeader(l)) miss = 0 else if (l.length > 140 || ++miss == 5) { cutAt = i - (if (l.length > 140) 0 else 4); break } }
                if (cutAt < chosen.size && chosen.take(cutAt).count { ingLike(it) } >= 2) { unplaced += chosen.drop(cutAt).filter { ingLike(it) }.take(8); chosen = chosen.take(cutAt) }
                // further blocks that are clearly ingredient lists (a recipe in parts), unless they repeat the chosen one
                val seen = chosen.toSet()
                ingBlocks.filter { it !== best && it.second.size >= 2 && it.second.count { l -> ingLike(l) } >= it.second.size * 0.7 && it.second.size <= 40 && it.second.count { l -> l in seen } < it.second.size * 0.5 }
                    .sortedBy { it.first }.forEach { b -> chosen = if (b.first < best.first) b.second + chosen else chosen + b.second }
            }
            sections.getValue("ing").addAll(chosen)
        }
        if (dirBlocks.isNotEmpty()) {
            fun stepChars(b: List<String>) = b.filter { PageScan.stepLike(it) }.sumOf { it.length }
            val ingAt = ingBlocks.maxByOrNull { b -> ingScore(b, dirBlocks, ::ingLike) }?.first ?: 0
            val after = dirBlocks.filter { it.first > ingAt && stepChars(it.second) > 0 }
            val best = after.firstOrNull() ?: dirBlocks.maxBy { stepChars(it.second) }
            var chosen: List<String> = best.second
            // trailing menu-like lines (short, not sentences) after the last real step are page furniture
            val lastStep = chosen.indexOfLast { PageScan.stepLike(it) || stepNum.containsMatchIn(it) }
            if (lastStep >= 0 && chosen.size - lastStep > 4) chosen = chosen.take(lastStep + 1)
            // a long run of short lines in the middle is a menu or an advert block, not a step
            var run = 0; var cut = -1
            for ((i, l) in chosen.withIndex()) { if (l.length < 25 && !stepNum.containsMatchIn(l) && !subHeader(l)) { if (++run == 6) { cut = i - 5; break } } else run = 0 }
            if (cut > 0 && chosen.take(cut).any { PageScan.stepLike(it) }) chosen = chosen.take(cut)
            chosen.forEach { l -> leadingStepNumber.find(l)?.groupValues?.get(1)?.toIntOrNull()?.let { stepNumbers += it } }
            sections.getValue("dir").addAll(chosen)
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

        val hint = titleHint ?: cleaned.titleHint
        val pagePrint = sections.getValue("pre").size > 12   // a whole printed page: what precedes the recipe is mostly menus
        val title = (hint?.let { cleanTitle(it) } ?: sections.getValue("pre").firstOrNull { it.length < 120 }?.let { cleanTitle(it) }).orEmpty()
        val ingredients = mutableListOf<Ingredient>()
        for (l in sections.getValue("ing")) {
            val t = bullet.replace(l, "").trim()
            if (t.isEmpty()) continue
            // a wrapped line ("1 cup butter," / "softened") continues the ingredient above it
            val prevIng = ingredients.lastOrNull()
            if (prevIng != null && !prevIng.header && !bullet.containsMatchIn(l) && !qtyStart.containsMatchIn(t) && (t.first().isLowerCase() || t.first() == '(' || prevIng.text.endsWith(",") || prevIng.text.endsWith(" and") || prevIng.text.endsWith(" or")) && t.length < 80 && !t.endsWith(":")) {
                ingredients[ingredients.lastIndex] = prevIng.copy(text = prevIng.text + " " + t); continue
            }
            val isHeader = t.endsWith(":") || (t.length < 40 && t.startsWith("For ", true) && t.split(' ').size <= 4 && t.none { it.isDigit() || it == ',' }) || (t.length < 40 && t == t.uppercase() && t.any { it.isLetter() } && !qtyStart.containsMatchIn(t))
            ingredients += Ingredient(text = if (isHeader) t.trimEnd(':').trim() else t, header = isHeader)
        }
        val directions = mergeWrapped(sections.getValue("dir").map { l -> Pair(stepNum.replace(bullet.replace(l, ""), "").trim(), bullet.containsMatchIn(l) || stepNum.containsMatchIn(l)) }.filter { it.first.isNotEmpty() })
            .map { Direction(text = it, timerSeconds = Durations.timerSeconds(it)) }
        val host = pageUrl?.let { runCatching { java.net.URI(it).host?.removePrefix("www.") }.getOrNull() }
        val notes = (listOfNotNull(author?.takeIf { pageUrl != null }?.let { "By $it" }) + extras + sections.getValue("note").map { bullet.replace(it, "").trim() }).joinToString("\n")
        val intro = if (pagePrint) "" else sections.getValue("pre").filter { cleanTitle(it) != title }.let { if (hint == null) sections.getValue("pre").drop(1) else it }.joinToString(" ").trim()

        if (title.isEmpty()) warnings += ImportWarning("title", "We couldn't tell what this recipe is called. Please add a title.")
        if (ingredients.none { !it.header }) warnings += ImportWarning("ingredients", "No ingredients were recognised. Check the ingredients list.")
        if (directions.isEmpty()) warnings += ImportWarning("directions", "No directions were recognised. Check the directions.")
        warnings += ImportWarning("recipe", if (method == ImportMethod.OCR) "Text was read from a photo or file and may contain mistakes. Please check quantities and steps." else "Recipe text was interpreted automatically. Please check each field.", Severity.INFO)

        // numbered steps that skip a number mean a step was lost on the way in
        val distinct = stepNumbers.distinct()
        if (distinct.size >= 3 && distinct == distinct.sorted() && distinct.first() == 1) {
            val missing = (1..distinct.last()).filter { it !in distinct }
            if (missing.isNotEmpty() && missing.size <= 5) warnings += ImportWarning("directions", "Step${if (missing.size == 1) "" else "s"} ${missing.joinToString(", ")} ${if (missing.size == 1) "seems" else "seem"} to be missing: the numbering jumps. Compare with the original.")
        }
        val confidence = when {
            title.isNotEmpty() && ingredients.isNotEmpty() && directions.isNotEmpty() && (sawIngHeader || sawDirHeader) && method != ImportMethod.OCR -> Confidence.MEDIUM
            else -> Confidence.LOW
        }
        val recipe = Recipe(
            title = title, description = intro, notes = notes, sourceUrl = pageUrl, sourceName = host ?: author,
            prepMinutes = prep, cookMinutes = cook, totalMinutes = total, servings = servings,
            ingredients = ingredients, directions = directions, rawSource = raw,
        )
        return ImportValidator.validate(ImportDraft(recipe, method, confidence, warnings, unplaced = unplaced.distinct()))
    }

    /** How convincing a block under an "Ingredients" heading is: many ingredient lines, few others, directions right after it. */
    private fun ingScore(b: Pair<Int, List<String>>, dirBlocks: List<Pair<Int, List<String>>>, like: (String) -> Boolean): Double {
        val n = b.second.size; if (n == 0) return -1.0
        val head = b.second.take(40); val l = head.count(like)
        val next = dirBlocks.map { it.first }.filter { it > b.first }.minOrNull()
        return l * Math.sqrt(l.toDouble() / head.size) + (if (next != null && next - b.first <= n + 2) 2.0 else 0.0)
    }

    /** "Step 1", "Step 2:" label a single step; they are not the Directions heading. */
    private val stepLabel = Regex("""^\W*steps?\s*\d""", RegexOption.IGNORE_CASE)
    private val leadingStepNumber = Regex("""^\s*(?:step\s*)?(\d{1,2})\s*[.):\-]\s+""", RegexOption.IGNORE_CASE)
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
