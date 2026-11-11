package com.mundymorning.touchrecipe.core.importer

import com.mundymorning.touchrecipe.core.model.*
import kotlinx.serialization.json.*
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import java.net.URI

/**
 * Extracts a recipe from page HTML. Order of trust: schema.org JSON-LD, microdata, then HTML heuristics.
 * It only reads what the user's own request returned; it does not bypass access controls.
 */
object WebRecipeExtractor {
    private val json = Json { isLenient = true; ignoreUnknownKeys = true }

    fun extract(html: String, pageUrl: String?): ImportDraft {
        val doc = try { Jsoup.parse(html, pageUrl ?: "") } catch (e: Exception) {
            return failed(pageUrl, "The page could not be read.")
        }
        val warnings = mutableListOf<ImportWarning>()

        val page = runCatching { PageScan.scan(doc) }.getOrDefault(PageScan.Result(null, null))
        val ld = jsonLdRecipes(doc)
        var draft: ImportDraft? = null
        if (ld.isNotEmpty()) {
            // Pages sometimes carry several recipes (roundups): prefer the one with the most content.
            val best = ld.maxBy { ingredientLines(it).size * 2 + (if (it["recipeInstructions"] != null) 1 else 0) }
            draft = fromJsonLd(best, doc, pageUrl)
            val distinct = ld.map { clean(it["name"].str()) }.distinct().size
            if (distinct > 1) draft = draft.copy(warnings = draft.warnings + ImportWarning("recipe", "This page contains $distinct recipes. We imported the most complete one; check that it's the one you wanted.", Severity.INFO))
        }
        if (draft == null || draft.recipe.ingredients.isEmpty() && draft.recipe.directions.isEmpty()) {
            val micro = microdata(doc, pageUrl)
            if (micro != null && (micro.recipe.ingredients.isNotEmpty() || micro.recipe.directions.isNotEmpty())) draft = if (draft == null) micro else mergeMissing(draft, micro).copy(method = ImportMethod.MICRODATA)
        }
        draft = if (draft == null) heuristic(doc, pageUrl, page) else crossCheck(draft, doc, pageUrl, page)
        val d = draft
        if (d.recipe.title.isBlank() || (d.recipe.ingredients.isEmpty() && d.recipe.directions.isEmpty())) {
            warnings += ImportWarning("recipe", "No recipe could be found on this page. It may need you to sign in, load more content, or block automatic access. You can paste the recipe text instead.", Severity.ERROR)
        }
        return ImportValidator.validate(d.copy(warnings = d.warnings + warnings))
    }

    /** Checks a data-block recipe against the visible page: fills gaps, prefers a fuller trustworthy page version, and reports suspected omissions. */
    private fun crossCheck(base: ImportDraft, doc: Document, pageUrl: String?, page: PageScan.Result): ImportDraft {
        val r = base.recipe
        val ing = Reconcile.ingredients(r.ingredients, page.ingredients)
        val dir = Reconcile.directions(r.directions, page.steps)
        var ingredients = ing.value; var directions = dir.value
        val extra = mutableListOf<ImportWarning>()
        var guessed = false
        // last resort for a section that is still empty: the older selector/heading guesses
        if (ingredients.isEmpty() || directions.none { !it.header }) {
            val h = heuristic(doc, pageUrl, PageScan.Result(null, null)).recipe
            if (ingredients.isEmpty() && h.ingredients.isNotEmpty()) { ingredients = h.ingredients; guessed = true }
            if (directions.none { !it.header } && h.directions.isNotEmpty()) { directions = h.directions; guessed = true }
        }
        val filledIng = r.ingredients.isEmpty() && ingredients.isNotEmpty(); val filledDir = r.directions.none { !it.header } && directions.any { !it.header }
        if (filledIng || filledDir) guessed = true
        if (guessed) extra += ImportWarning("recipe", "Some parts were guessed from the page layout. Please check them.", Severity.WARNING)
        val lm = if (r.servings == null || (r.prepMinutes == null && r.cookMinutes == null && r.totalMinutes == null)) labeledMeta(doc) else Labeled()
        val recipe = r.copy(ingredients = ingredients, directions = directions,
            prepMinutes = r.prepMinutes ?: lm.prep, cookMinutes = r.cookMinutes ?: lm.cook, totalMinutes = r.totalMinutes ?: lm.total, servings = r.servings ?: lm.servings)
        val kept = base.warnings.filterNot { (it.field == "ingredients" && ingredients.isNotEmpty() && it.message.contains("had no")) || (it.field == "directions" && directions.any { d -> !d.header } && it.message.contains("had no")) ||
            (it.field == "servings" && recipe.servings != null) || (it.field == "times" && recipe.effectiveTotal != null) }
        val changed = ing.changed || dir.changed || guessed
        return base.copy(recipe = recipe, warnings = kept + ing.warnings + dir.warnings + extra, unplaced = (base.unplaced + ing.unplaced + dir.unplaced).distinct(),
            confidence = if (changed && base.confidence == Confidence.HIGH) Confidence.MEDIUM else if (ing.unplaced.isNotEmpty() || dir.unplaced.isNotEmpty()) Confidence.MEDIUM else base.confidence)
    }

    fun failed(url: String?, msg: String) = ImportDraft(Recipe(sourceUrl = url), ImportMethod.HTML, Confidence.LOW, listOf(ImportWarning("recipe", msg, Severity.ERROR)))

    // ---------- JSON-LD ----------
    fun jsonLdRecipes(doc: Document): List<JsonObject> {
        val out = mutableListOf<JsonObject>()
        for (el in doc.select("script[type*=ld+json]")) {
            for (parsed in parseLenientAll(el.data().ifBlank { el.html() })) collectRecipes(parsed, out)
        }
        return out
    }

    private fun fixJson(t: String) = t.replace(Regex("""[\u0000-\u001F]"""), " ").replace(Regex(""",\s*([}\]])"""), "$1")

    /** Splits text into its top-level {...} / [...] values (string-aware) so concatenated or junk-wrapped JSON can still be read. */
    private fun topLevelValues(t: String): List<String> {
        val out = mutableListOf<String>(); var depth = 0; var start = -1; var inStr = false; var esc = false
        for (i in t.indices) {
            val c = t[i]
            if (inStr) { if (esc) esc = false else if (c == '\\') esc = true else if (c == '"') inStr = false; continue }
            if (c == '"') { if (depth > 0) inStr = true; continue }
            if (c == '{' || c == '[') { if (depth == 0) start = i; depth++ }
            else if ((c == '}' || c == ']') && depth > 0) { depth--; if (depth == 0 && start >= 0) { out += t.substring(start, i + 1); start = -1 } }
        }
        return out
    }

    /** Reads every JSON value in a ld+json block, tolerating a BOM, comment/CDATA wrappers, `var x =` prefixes, trailing semicolons and commas,
     *  raw control characters, and several objects in one block. */
    fun parseLenientAll(raw: String): List<JsonElement> {
        var s = raw.removePrefix("\uFEFF").trim().removePrefix("<!--").removeSuffix("-->").replace("//<![CDATA[", "").replace("//]]>", "").trim()
        s = s.replace(Regex("""^(?:(?:var|let|const)\s+\w+\s*=|window\.[\w.]+\s*=)\s*"""), "").trimEnd { it == ';' || it.isWhitespace() }
        for (cand in listOf(s, fixJson(s))) { val v = runCatching { json.parseToJsonElement(cand) }.getOrNull(); if (v != null) return listOf(v) }
        val out = mutableListOf<JsonElement>()
        for (chunk in topLevelValues(s)) for (cand in listOf(chunk, fixJson(chunk))) { val v = runCatching { json.parseToJsonElement(cand) }.getOrNull(); if (v != null) { out += v; break } }
        return out
    }

    private fun collectRecipes(e: JsonElement, out: MutableList<JsonObject>) {
        when (e) {
            is JsonArray -> e.forEach { collectRecipes(it, out) }
            is JsonObject -> {
                val type = e["@type"]
                val types = when (type) { is JsonArray -> type.map { it.str() }; null -> emptyList(); else -> listOf(type.str()) }
                if (types.any { it.equals("Recipe", true) || it.endsWith("/Recipe", true) }) out += e
                (e["@graph"])?.let { collectRecipes(it, out) }
                (e["mainEntity"])?.let { collectRecipes(it, out) }
                (e["itemListElement"])?.let { collectRecipes(it, out) }
                (e["item"])?.let { collectRecipes(it, out) }
            }
            else -> {}
        }
    }

    private fun JsonElement?.str(): String = when (this) {
        null, JsonNull -> ""
        is JsonPrimitive -> content
        is JsonArray -> firstOrNull().str()
        is JsonObject -> (this["name"] ?: this["text"] ?: this["@value"] ?: this["url"]).str()
    }

    private fun clean(s: String?): String {
        if (s.isNullOrBlank()) return ""
        var text = if (s.contains('<') && s.contains('>')) Jsoup.parse(s).text() else Jsoup.parse("<p>$s</p>").text()
        // data blocks are sometimes escaped twice ("&amp;ouml;", "&lt;p&gt;")
        if (Regex("""&(?:[a-zA-Z]{2,8}|#\d{2,5});|</?[a-zA-Z][^>]{0,40}>""").containsMatchIn(text)) text = Jsoup.parse(text).text()
        return text.replace(' ', ' ').replace(Regex("""\s+"""), " ").trim()
    }

    private fun images(node: JsonElement?, base: String?): List<String> {
        val urls = mutableListOf<String>()
        fun walk(e: JsonElement?) {
            when (e) {
                is JsonPrimitive -> if (e.content.isNotBlank()) urls += e.content
                is JsonArray -> e.forEach { walk(it) }
                is JsonObject -> walk(e["url"] ?: e["contentUrl"] ?: e["@id"])
                else -> {}
            }
        }
        walk(node)
        return urls.mapNotNull { absolute(it, base) }.distinct()
    }

    private fun absolute(u: String, base: String?): String? = try {
        val t = u.trim()
        val r = if (t.startsWith("//")) "https:$t" else if (base != null && !t.startsWith("http")) URI(base).resolve(t).toString() else t
        if (r.startsWith("http://") || r.startsWith("https://")) r else null
    } catch (e: Exception) { null }

    private fun instructionSteps(node: JsonElement?, ingredientsSections: MutableList<String>? = null): List<String> {
        val steps = mutableListOf<String>()
        fun walk(e: JsonElement?) {
            when (e) {
                null, JsonNull -> {}
                is JsonPrimitive -> {
                    val lines = Jsoup.parse(unescapeTwice(e.content).replace(Regex("""(?i)<br\s*/?>|</p>|</li>"""), "\n")).wholeText().lines().map { clean(it) }.filter { it.isNotEmpty() }
                    steps += lines
                }
                is JsonArray -> e.forEach { walk(it) }
                is JsonObject -> {
                    val type = e["@type"].str()
                    when {
                        type.equals("HowToSection", true) || e["itemListElement"] != null -> {
                            val name = clean(e["name"].str())
                            if (name.isNotEmpty()) steps += "§$name"
                            walk(e["itemListElement"])
                        }
                        else -> {
                            val raw = unescapeTwice((e["text"] ?: e["description"] ?: e["name"]).str())
                            // one HowToStep holding several paragraphs or list items is several steps
                            if (Regex("""(?i)</p>\s*<p|</li>\s*<li|<br\s*/?>\s*<br""").containsMatchIn(raw)) steps += Jsoup.parse(raw.replace(Regex("""(?i)<br\s*/?>|</p>|</li>"""), "\n")).wholeText().lines().map { clean(it) }.filter { it.isNotEmpty() }
                            else { val t = clean(raw); if (t.isNotEmpty()) steps += t }
                        }
                    }
                }
            }
        }
        walk(node)
        return steps
    }

    private fun unescapeTwice(s: String) = if (Regex("""&lt;/?[a-zA-Z]""").containsMatchIn(s)) org.jsoup.parser.Parser.unescapeEntities(s, false) else s

    fun servingsFrom(node: JsonElement?): Int? {
        val s = when (node) { is JsonArray -> node.map { it.str() }.firstOrNull { Regex("""\d""").containsMatchIn(it) } ?: node.firstOrNull().str(); else -> node.str() }
        return Regex("""\d+""").find(s)?.value?.toIntOrNull()?.takeIf { it in 1..999 }
    }

    private fun fromJsonLd(r: JsonObject, doc: Document, pageUrl: String?): ImportDraft {
        val warnings = mutableListOf<ImportWarning>()
        val title = clean(r["name"].str()).ifEmpty { clean(doc.title()) }
        val ingredientLines = ingredientLines(r)
        val ingredients = dedupeConsecutive(ingredientLines).map { Ingredient(text = it) }
        val stepsRaw = instructionSteps(r["recipeInstructions"])
        val directions = mutableListOf<Direction>()
        val ingredientSections = mutableListOf<Ingredient>()
        stepsRaw.forEach { s ->
            if (s.startsWith("§")) directions += Direction(text = s.drop(1).trim().trimEnd(':'), header = true)
            else directions += Direction(text = s, timerSeconds = Durations.timerSeconds(s))
        }
        val author = r["author"].let { a -> when (a) { is JsonArray -> a.firstOrNull().str(); else -> a.str() } }
        val publisher = clean(r["publisher"].str())
        val host = pageUrl?.let { runCatching { URI(it).host?.removePrefix("www.") }.getOrNull() }
        val sourceName = listOf(clean(author), publisher).firstOrNull { it.isNotEmpty() && !it.startsWith("http") } ?: host
        val cats = (r["recipeCategory"]).let { c -> when (c) { is JsonArray -> c.map { it.str() }; null -> emptyList(); else -> c.str().split(",") } }.map { clean(it) }.filter { it.isNotEmpty() }
        val cuisine = (r["recipeCuisine"]).let { c -> when (c) { is JsonArray -> c.firstOrNull().str(); else -> c.str() } }.let(::clean).ifEmpty { null }
        val prep = Durations.toMinutes(r["prepTime"].str()); val cook = Durations.toMinutes(r["cookTime"].str()); val total = Durations.toMinutes(r["totalTime"].str())
        val imgs = (images(r["image"], pageUrl) + listOfNotNull(doc.selectFirst("meta[property=og:image]")?.attr("content")?.let { absolute(it, pageUrl) })).distinct()
        val servings = servingsFrom(r["recipeYield"])
        val metaDesc = clean(doc.selectFirst("meta[property=og:description]")?.attr("content") ?: doc.selectFirst("meta[name=description]")?.attr("content"))
        val description = clean(r["description"].str()).ifEmpty { metaDesc }
        val notes = clean((r["recipeNotes"] ?: r["notes"]).str())

        if (ingredients.isEmpty()) warnings += ImportWarning("ingredients", "The page's recipe data had no ingredients. Please add them.")
        if (directions.isEmpty()) warnings += ImportWarning("directions", "The page's recipe data had no directions. Please add them.")
        if (servings == null) warnings += ImportWarning("servings", "Servings were not given.", Severity.INFO)
        if (prep == null && cook == null && total == null) warnings += ImportWarning("times", "No times were given.", Severity.INFO)
        if (imgs.isEmpty()) warnings += ImportWarning("photo", "No photo was found.", Severity.INFO)
        if (sourceName == null && pageUrl == null) warnings += ImportWarning("source", "Source is unknown.", Severity.INFO)
        if (looksTruncated(directions.map { it.text })) warnings += ImportWarning("directions", "Some directions look incomplete. Compare with the original page.")

        val recipe = Recipe(
            title = title, description = description, notes = notes, sourceUrl = pageUrl, sourceName = sourceName, cuisine = cuisine,
            prepMinutes = prep, cookMinutes = cook, totalMinutes = total, servings = servings,
            ingredients = ingredients + ingredientSections, directions = directions,
            rawSource = (r.toString()).take(60_000),
        )
        val ok = title.isNotEmpty() && ingredients.isNotEmpty() && directions.any { !it.header }
        return ImportDraft(recipe, ImportMethod.JSON_LD, if (ok) Confidence.HIGH else Confidence.MEDIUM, warnings, imgs).withSuggestedCategories(cats)
    }

    /** Ingredient lines of a data block. A single string holding the whole list (line breaks, `<br>` or list markup) is split into lines. */
    private fun ingredientLines(r: JsonObject): List<String> {
        val node = r["recipeIngredient"] ?: r["ingredients"]
        val raw = when (node) { is JsonArray -> node.map { it.str() }; is JsonPrimitive -> listOf(node.content); else -> emptyList() }
        return raw.flatMap { s ->
            if (s.contains('\n') || Regex("""(?i)<br|<li|</p>""").containsMatchIn(s))
                Jsoup.parse(s.replace(Regex("""(?i)<br\s*/?>|</p>|</li>"""), "\n")).wholeText().lines()
            else listOf(s)
        }.map { clean(it) }.filter { it.isNotEmpty() }.flatMap { splitRunTogether(it) }
    }

    private val qtyUnit = Regex("""(?<=[\p{L})]) (?=(?:\d+(?:[.,/]\d+)?(?: \d/\d)?|[¼½¾⅓⅔⅛⅜⅝⅞]) ?(?:cups?|tbsps?|tsps?|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l|cloves?|cans?|sticks?|slices?|pinch|large|medium|small)\b)""", RegexOption.IGNORE_CASE)
    /** One line that clearly holds several measured ingredients ("3 tbsp oil 2 cups flour 1 tsp salt ...") is split before each amount. */
    private fun splitRunTogether(line: String): List<String> {
        if (line.length < 110) return listOf(line)
        val parts = line.split(qtyUnit).map { it.trim() }.filter { it.isNotEmpty() }
        return if (parts.size >= 4 && parts.all { it.length < 140 }) parts else listOf(line)
    }

    private fun ImportDraft.withSuggestedCategories(cats: List<String>): ImportDraft =
        if (cats.isEmpty()) this else copy(warnings = warnings + ImportWarning("categories", "Suggested categories from the page: ${cats.joinToString(", ")}", Severity.INFO))

    private fun looksTruncated(steps: List<String>) = steps.isNotEmpty() && steps.all { it.length < 4 }

    private fun dedupeConsecutive(lines: List<String>): List<String> = lines.fold(mutableListOf()) { acc, l -> if (acc.lastOrNull() != l) acc += l; acc }

    // ---------- Microdata ----------
    private fun microdata(doc: Document, pageUrl: String?): ImportDraft? {
        val root = doc.selectFirst("[itemtype*=schema.org/Recipe]") ?: return null
        fun prop(name: String) = root.select("[itemprop=$name]")
        fun text(name: String) = prop(name).firstOrNull()?.let { clean(it.attr("content").ifBlank { it.text() }) }.orEmpty()
        val ingredients = (prop("recipeIngredient") + prop("ingredients")).map { clean(it.text()) }.filter { it.isNotEmpty() }.map { Ingredient(text = it) }
        val steps = prop("recipeInstructions").flatMap { el ->
            val lis = el.select("li, p")
            if (lis.isNotEmpty()) lis.map { clean(it.text()) } else clean(el.wholeText()).split(Regex("""(?<=\.)\s{2,}|\n""")).map { clean(it) }
        }.filter { it.isNotEmpty() }
        val img = prop("image").firstOrNull()?.let { it.attr("src").ifBlank { it.attr("content") }.ifBlank { it.attr("href") } }?.let { absolute(it, pageUrl) }
        val recipe = Recipe(
            title = text("name"), description = text("description"), sourceUrl = pageUrl,
            sourceName = pageUrl?.let { runCatching { URI(it).host?.removePrefix("www.") }.getOrNull() },
            prepMinutes = Durations.toMinutes(prop("prepTime").firstOrNull()?.let { it.attr("datetime").ifBlank { it.attr("content") }.ifBlank { it.text() } }),
            cookMinutes = Durations.toMinutes(prop("cookTime").firstOrNull()?.let { it.attr("datetime").ifBlank { it.attr("content") }.ifBlank { it.text() } }),
            servings = Regex("""\d+""").find(text("recipeYield"))?.value?.toIntOrNull(),
            ingredients = ingredients, directions = steps.map { Direction(text = it, timerSeconds = Durations.timerSeconds(it)) },
        )
        val w = mutableListOf(ImportWarning("recipe", "Read from the page's embedded recipe markup. Please check each field.", Severity.INFO))
        return ImportDraft(recipe, ImportMethod.MICRODATA, if (ingredients.isNotEmpty() && steps.isNotEmpty()) Confidence.MEDIUM else Confidence.LOW, w, listOfNotNull(img))
    }

    // ---------- HTML heuristics ----------
    private val ingredientSelectors = listOf(
        ".wprm-recipe-ingredient", ".tasty-recipes-ingredients li", ".mv-create-ingredients li", ".recipe-ingredients li",
        "[class*=ingredients] li", "[id*=ingredients] li", "[class*=ingredient] li", "li[class*=ingredient]", "li[itemprop=recipeIngredient]",
    )
    private val directionSelectors = listOf(
        ".wprm-recipe-instruction-text", ".tasty-recipes-instructions li", ".mv-create-instructions li", ".recipe-directions li", ".recipe-instructions li",
        "[class*=instructions] li", "[class*=directions] li", "[id*=instructions] li", "[class*=method] li", "[class*=steps] li", "[class*=instruction] p",
    )

    private val labelRe = Regex("""^\W*(prep(?:aration)?(?: time)?|cook(?:ing)?(?: time)?|total(?: time)?|ready in|serv(?:es|ings?)|yield|makes)\s*[:\-]?\s*(.*)$""", RegexOption.IGNORE_CASE)
    class Labeled { var prep: Int? = null; var cook: Int? = null; var total: Int? = null; var servings: Int? = null }

    /** Visible "Servings: 10", "Prep time: 10 minutes" ... labels (used when a page has no recipe data block). */
    fun labeledMeta(doc: Document): Labeled {
        val out = Labeled()
        for (el in doc.select("li, p, div, span, td, dd, dt, strong, b, h4, h5, h6")) {
            val t = el.text().trim()
            if (t.length < 5 || t.length > 60) continue
            val m = labelRe.find(t) ?: continue
            val v = m.groupValues[2]
            if (v.none { it.isDigit() }) continue
            val key = m.groupValues[1].lowercase()
            when {
                key.startsWith("prep") -> if (out.prep == null) out.prep = Durations.looseMinutes(v)
                key.startsWith("cook") -> if (out.cook == null) out.cook = Durations.looseMinutes(v)
                key.startsWith("total") || key.startsWith("ready") -> if (out.total == null) out.total = Durations.looseMinutes(v)
                else -> if (out.servings == null) out.servings = Regex("""\d+""").find(v)?.value?.toIntOrNull()?.takeIf { it > 0 }
            }
        }
        return out
    }

    private fun heuristic(doc: Document, pageUrl: String?, page: PageScan.Result): ImportDraft {
        val title = clean(doc.selectFirst("meta[property=og:title]")?.attr("content") ?: doc.selectFirst("h1")?.text() ?: doc.title())
            .replace(Regex("""\s*[|\-–—]\s*[^|\-–—]{0,40}$"""), "").trim()
        fun pick(selectors: List<String>): List<String> {
            for (s in selectors) {
                val els = doc.select(s)
                val texts = els.map { clean(it.text()) }.filter { it.isNotEmpty() }.distinct()
                if (texts.size >= 2) return texts
            }
            return emptyList()
        }
        val pageIng = page.ingredients?.lines?.map { Ingredient(text = it.text, header = it.header) }
        val pageSteps = page.steps?.lines?.map { if (it.header) Direction(text = it.text, header = true) else Direction(text = it.text, timerSeconds = Durations.timerSeconds(it.text)) }
        var ingredients = if (pageIng != null) emptyList() else pick(ingredientSelectors)
        var steps = if (pageSteps != null) emptyList() else pick(directionSelectors)
        if ((pageIng == null && ingredients.isEmpty()) || (pageSteps == null && steps.isEmpty())) {
            // Heading-based: <h2>Ingredients</h2> followed by a list
            fun listAfter(heading: Regex): List<String> {
                val h = doc.select("h1,h2,h3,h4,h5,strong,b").firstOrNull { heading.matches(it.text().trim().trimEnd(':')) } ?: return emptyList()
                var n: Element? = h.parent()?.takeIf { it.tagName() in listOf("div", "section") && it.children().size == 1 } ?: h
                var hops = 0
                var sib = n?.nextElementSibling()
                while (sib != null && hops < 6) {
                    val items = if (sib.tagName() in listOf("ul", "ol")) sib.select("li") else sib.select("li, p")
                    val t = items.map { clean(it.text()) }.filter { it.isNotEmpty() }
                    if (t.size >= 2) return t
                    sib = sib.nextElementSibling(); hops++
                }
                return emptyList()
            }
            if (pageIng == null && ingredients.isEmpty()) ingredients = listAfter(Regex("""(?i)ingredients?"""))
            if (pageSteps == null && steps.isEmpty()) steps = listAfter(Regex("""(?i)(directions?|instructions?|method|preparation|steps?)"""))
        }
        val img = doc.selectFirst("meta[property=og:image]")?.attr("content")?.let { absolute(it, pageUrl) }
        val desc = clean(doc.selectFirst("meta[property=og:description]")?.attr("content") ?: doc.selectFirst("meta[name=description]")?.attr("content"))
        val lm = labeledMeta(doc)
        val recipe = Recipe(
            title = title, description = desc, sourceUrl = pageUrl,
            sourceName = pageUrl?.let { runCatching { URI(it).host?.removePrefix("www.") }.getOrNull() },
            prepMinutes = lm.prep, cookMinutes = lm.cook, totalMinutes = lm.total, servings = lm.servings,
            ingredients = pageIng ?: ingredients.map { Ingredient(text = it) }, directions = pageSteps ?: steps.map { Direction(text = it, timerSeconds = Durations.timerSeconds(it)) },
        )
        val w = mutableListOf(ImportWarning("recipe", "This page has no standard recipe data, so we guessed from its layout. Please check every field.", Severity.WARNING))
        if (recipe.ingredients.none { !it.header }) w += ImportWarning("ingredients", "No ingredients were found.")
        if (recipe.directions.none { !it.header }) w += ImportWarning("directions", "No directions were found.")
        return ImportDraft(recipe, ImportMethod.HTML, Confidence.LOW, w, listOfNotNull(img))
    }

    private fun mergeMissing(base: ImportDraft, fill: ImportDraft): ImportDraft {
        val b = base.recipe; val f = fill.recipe
        val r = b.copy(
            title = b.title.ifBlank { f.title }, description = b.description.ifBlank { f.description },
            ingredients = b.ingredients.ifEmpty { f.ingredients }, directions = b.directions.ifEmpty { f.directions },
            prepMinutes = b.prepMinutes ?: f.prepMinutes, cookMinutes = b.cookMinutes ?: f.cookMinutes, totalMinutes = b.totalMinutes ?: f.totalMinutes, servings = b.servings ?: f.servings,
        )
        val filled = (b.ingredients.isEmpty() && f.ingredients.isNotEmpty()) || (b.directions.isEmpty() && f.directions.isNotEmpty())
        val warnings = base.warnings.filterNot { (it.field == "ingredients" && r.ingredients.isNotEmpty()) || (it.field == "directions" && r.directions.isNotEmpty()) } +
            if (filled) listOf(ImportWarning("recipe", "Some parts were guessed from the page layout. Please check them.", Severity.WARNING)) else emptyList()
        return base.copy(recipe = r, warnings = warnings, imageCandidates = (base.imageCandidates + fill.imageCandidates).distinct(),
            confidence = if (filled) Confidence.MEDIUM else base.confidence)
    }
}
