package com.mundymorning.touchrecipe.core.importer

import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element

/**
 * Reads the ingredient list and the directions from the *visible* page, independently of any recipe data block.
 * The result is used two ways: to fill in what the data block lacks, and to check the data block for omissions.
 */
object PageScan {
    /** How much a section can be relied on: recipe-card markup, a container named for the section, or a guess from headings and lists. */
    enum class Trust { STRONG, MEDIUM, WEAK }
    data class Line(val text: String, val header: Boolean = false)
    data class Section(val lines: List<Line>, val trust: Trust, val how: String) {
        val items: List<String> get() = lines.filter { !it.header }.map { it.text }
    }
    data class Result(val ingredients: Section?, val steps: Section?)

    private val ingWords = "ingredients?|ingredientes?|ingr[ée]dients?|ingredienti|ingredi[ëe]nten|ingredienser|ingredienten|zutaten|sk[łl]adniki|ainekset|hozz[áa]val[óo]k|suroviny|ingredience|sastojci|what you.?ll need|you.?ll need|you will need|what you need|shopping list|ингредиенты|υλικά|malzemeler|材料"
    private val stepWords = "directions?|instructions?|method|preparation|steps?|procedure|how to make(?: it| this)?|how to prepare|cooking instructions|recipe instructions|zubereitung|anleitung|so geht.?s|pr[ée]paration|preparaci[óo]n|elaboraci[óo]n|preparazione|procedimento|bereiding|bereidingswijze|tillagning|g[öo]r s[åa] h[äa]r|fremgangsm[åa]de|s[åa]dan g[øo]r du|przygotowanie|spos[óo]b przygotowania|postup|elk[ée]sz[íi]t[ée]s|modo de preparo|preparo|valmistus|приготовление|εκτέλεση|hazırlanışı|作り方"
    private val ingHeading = Regex("""^\W*(?:the |for the )?(?:$ingWords)\W*$""", RegexOption.IGNORE_CASE)
    private val stepHeading = Regex("""^\W*(?:the )?(?:$stepWords)\W*$""", RegexOption.IGNORE_CASE)
    private val endHeading = Regex("""^\W*(?:notes?|recipe notes?|tips?|nutrition(?:al)?(?: facts| information| info)?|video|equipment|tools|comments?|reviews?|related|you (?:may|might) also like|more recipes|leave a (?:reply|comment)|faq|frequently asked questions|storage|substitutions?|variations?)\b.*$""", RegexOption.IGNORE_CASE)
    private val ingName = Regex("""ingredi|zutat|ainekset|skladnik|sastojci|hozzaval|surovin""", RegexOption.IGNORE_CASE)
    private val stepName = Regex("""instruction|direction|method|preparation|prepara[ct]i|procedure|procedim|(?:^|[-_ ])steps?(?:$|[-_ ])|recipe-?steps|zubereitung|anleitung|bereiding|tillagning|fremgangs|postup|elkeszit|how-?to""", RegexOption.IGNORE_CASE)
    private val notStepName = Regex("""payment|shipping|prep-?time|time|nutrition|comment|share|social|rating|review|print|video|jump|toc|breadcrumb|nav|menu|sidebar|widget|footer|header""", RegexOption.IGNORE_CASE)
    private val notIngName = Regex("""comment|share|social|rating|review|nav|menu|sidebar|widget|footer|search|filter|tag-?cloud|related""", RegexOption.IGNORE_CASE)

    private val qtyStart = Regex("""^\s*(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚]|a\s+(?:pinch|dash|handful|few|splash|drizzle|couple)\b|an?\s+\d|one\b|two\b|three\b|four\b|half\b|juice of|zest of|pinch\b|dash\b|handful\b|salt\b|pepper\b|kosher salt|sea salt|freshly|olive oil|vegetable oil|cooking spray|oil for|butter for|water\b)""", RegexOption.IGNORE_CASE)
    private val unitWord = Regex("""\b(?:cups?|c\.|tbsps?|tsps?|tablespoons?|teaspoons?|tbs|oz|ounces?|lbs?|pounds?|grams?|g|gr|kg|ml|cl|dl|l|liters?|litres?|cloves?|cans?|pinch|dash|slices?|sticks?|packages?|pkgs?|bunch|sprigs?|stalks?|heads?|quarts?|pints?|gallons?|el|tl|stück|prise|bund|dose|msk|tsk|krm|st|dkg|dag|szt|ks|pcs?|pieces?)\b""", RegexOption.IGNORE_CASE)

    /** True for a line that reads like one ingredient ("2 cups flour", "Salt, to taste"), in any language that leads with a number. */
    fun ingredientLike(line: String): Boolean {
        val t = line.trim()
        if (t.length < 2 || t.length > 200) return false
        val words = t.split(Regex("""\s+""")).size
        if (t.endsWith(".") && words > 14) return false
        if (qtyStart.containsMatchIn(t)) return true
        return words <= 6 && unitWord.containsMatchIn(t)
    }

    /** True for a line that reads like a cooking step: a sentence of some length that is not an ingredient line. */
    fun stepLike(line: String): Boolean {
        val t = line.trim()
        return t.length >= 25 && t.count { it == ' ' } >= 4 && !(ingredientLike(t) && t.length < 60)
    }

    private val inlineJoin = setOf("b", "i", "em", "strong", "a", "sup", "sub", "u", "small", "mark", "font", "abbr")
    /** Element text with a space between neighbouring pieces, so "<span>1</span><span>cup</span>" reads "1 cup" rather than "1cup". */
    fun text(el: Element): String {
        val sb = StringBuilder()
        fun walk(n: org.jsoup.nodes.Node) {
            when (n) {
                is org.jsoup.nodes.TextNode -> sb.append(n.wholeText)
                is Element -> {
                    val glue = n.tagName() in inlineJoin
                    if (!glue && sb.isNotEmpty() && !sb.last().isWhitespace()) sb.append(' ')
                    n.childNodes().forEach { walk(it) }
                    if (!glue && sb.isNotEmpty() && !sb.last().isWhitespace()) sb.append(' ')
                }
                else -> {}
            }
        }
        walk(el)
        return sb.toString().replace('\u00a0', ' ').replace(Regex("""\s+"""), " ").replace(Regex(""" ([,.;:)])"""), "$1").replace("( ", "(").trim()
    }
    private fun norm(s: String) = s.replace(' ', ' ').replace(Regex("""\s+"""), " ").trim()
    private val bulletRe = Regex("""^[^\p{L}\p{Nd}(\[¼½¾⅓⅔⅛⅜⅝⅞]+(?=\S)""")
    private val stepNumRe = Regex("""^\s*(?:step\s*)?\d{1,2}\s*[.):]\s+(?=\S)|^\s*step\s*\d{1,2}\s*[.):\-–—]?\s*""", RegexOption.IGNORE_CASE)
    private fun cleanIng(s: String) = norm(s).replace(bulletRe, "").trim()
    private fun cleanStep(s: String) = norm(s).replace(bulletRe, "").replace(stepNumRe, "").trim()

    fun scan(source: Document): Result {
        val doc = source.clone()
        doc.select("script, style, noscript, template, svg, iframe, select, button, nav, form, footer, aside, [hidden], [role=contentinfo], [role=navigation], [role=dialog], .screen-reader-text, .sr-only, .visually-hidden, .wprm-screen-reader-text").remove()
        // page furniture, matched by exact class or id so a wrapper such as "has-sidebar" is never removed
        doc.select("#comments, #respond, #disqus_thread, #sidebar, #footer, .comments, .comments-area, .comment-list, .commentlist, .comment-respond, .sidebar, .widget-area, .related-posts, .related-recipes, .site-footer, .newsletter, .newsletter-signup, .cookie-banner, .cookie-notice, .modal, .popup, .social-share, .share-buttons, .breadcrumbs, .breadcrumb")
            .filter { it.tagName() !in setOf("body", "html", "main", "article") }.forEach { it.remove() }
        val ing = ingredients(doc)
        val steps = steps(doc, ing?.second)
        return Result(ing?.first, steps)
    }

    // ---------------- ingredients ----------------
    private fun ingredients(doc: Document): Pair<Section, Element?>? {
        plugin(doc, ".wprm-recipe-ingredients-container", ".wprm-recipe-ingredient-group", ".wprm-recipe-group-name", "li.wprm-recipe-ingredient, .wprm-recipe-ingredient", ::cleanIng)?.let { return Section(it.first, Trust.STRONG, "recipe card") to it.second }
        for (sel in listOf(".tasty-recipes-ingredients", ".tasty-recipe-ingredients", ".mv-create-ingredients", ".wpurp-recipe-ingredients", ".ERSIngredients", ".easyrecipe .ingredients", "#zlrecipe-ingredients-list", ".zlrecipe-ingredients", ".jetpack-recipe-ingredients", ".recipe-card-ingredients", ".wp-block-recipe-card-ingredients", ".cooked-recipe-ingredients", ".simple-recipe-pro .ingredients", ".wpzoom-recipe-card .recipe-card-ingredients, .ingredients-list")) {
            val root = doc.selectFirst(sel) ?: continue
            val lines = listLines(root, ::cleanIng)
            if (lines.count { !it.header } >= 2) return Section(lines, Trust.STRONG, "recipe card") to root
        }
        val props = doc.select("[itemprop=recipeIngredient], [itemprop=ingredients], [property=recipeIngredient], [property=ingredients], [property$=schema.org/recipeIngredient]")
        if (props.size >= 2) {
            val lines = dedupe(props.map { Line(cleanIng(it.attr("content").ifBlank { text(it) })) }.filter { it.text.isNotEmpty() })
            if (lines.size >= 2) return Section(lines, Trust.STRONG, "recipe markup") to commonAncestor(props)
        } else if (props.size == 1) {
            val lines = listLines(props[0], ::cleanIng)
            if (lines.count { !it.header } >= 2) return Section(lines, Trust.STRONG, "recipe markup") to props[0]
        }
        // a container named for ingredients
        var best: Triple<List<Line>, Element, Double>? = null
        for (el in doc.select("[class], [id]")) {
            val name = el.className() + " " + el.id()
            if (!ingName.containsMatchIn(name) || notIngName.containsMatchIn(name)) continue
            if (el.tagName() in setOf("li", "a", "span", "label", "input", "h1", "h2", "h3", "h4", "h5", "h6", "body", "html", "main", "article")) continue
            val lines = listLines(el, ::cleanIng)
            val items = lines.filter { !it.header }.map { it.text }
            if (items.size < 2 || items.size > 120) continue
            val like = items.count { ingredientLike(it) }
            val long = items.count { it.length > 160 }
            if (like < 2 || like < items.size * 0.5) continue
            val score = like - 2.0 * long - (items.size - like) * 0.5
            val b = best
            if (b == null || score > b.third + 0.01 || (kotlin.math.abs(score - b.third) <= 0.01 && el.text().length < b.second.text().length)) best = Triple(lines, el, score)
        }
        best?.let { return Section(it.first, Trust.MEDIUM, "ingredients section") to it.second }
        // a heading that says "Ingredients"
        val byHeading = headings(doc, ingHeading).map { h -> h to following(h, ::cleanIng, { isStepHeading(it) || endHeading.matches(it) }, { ingredientLike(it) }, minRatio = 0.5) }
            .filter { it.second.first.count { l -> !l.header } >= 2 }
        if (byHeading.size >= 2 && byHeading.sumOf { it.second.first.size } <= 80 && byHeading.map { it.second.first.map { l -> l.text } }.distinct().size == byHeading.size) {
            // a recipe in several parts, each with its own "Ingredients" heading
            val out = mutableListOf<Line>()
            byHeading.forEach { (h, r) -> precedingHeading(h)?.let { t -> if (!ingHeading.matches(t)) out += Line(t.trimEnd(':'), header = true) }; out += r.first }
            return Section(dedupe(out), Trust.WEAK, "ingredient headings") to byHeading.last().second.second
        }
        byHeading.maxByOrNull { it.second.first.count { l -> !l.header && ingredientLike(l.text) } }?.let { return Section(it.second.first, Trust.MEDIUM, "ingredients heading") to it.second.second }
        // lists that are mostly ingredient lines (several short lists under their own sub-headings are joined)
        val lists = doc.select("ul, ol").map { l -> l to l.children().filter { it.tagName() == "li" }.map { cleanIng(text(it)) }.filter { it.isNotEmpty() } }
            .filter { (_, items) -> items.size >= 2 && items.count { ingredientLike(it) && it.length < 140 } >= items.size * 0.7 && items.count { qtyStart.containsMatchIn(it) } >= items.size * 0.5 }
        val total = lists.sumOf { it.second.size }
        if (total >= 3 && lists.isNotEmpty()) {
            val biggest = lists.maxBy { it.second.size }
            val group = if (lists.size > 1 && total <= 60) lists else listOf(biggest)
            val out = mutableListOf<Line>()
            for ((el, items) in group) {
                if (group.size > 1) precedingHeading(el)?.let { h -> if (!ingHeading.matches(h) && h.length < 60) out += Line(h.trimEnd(':'), header = true) }
                items.forEach { out += Line(it) }
            }
            return Section(dedupe(out), Trust.WEAK, "list") to group.last().first
        }
        return null
    }

    // ---------------- directions ----------------
    private fun steps(doc: Document, ingredientRoot: Element?): Section? {
        plugin(doc, ".wprm-recipe-instructions-container", ".wprm-recipe-instruction-group", ".wprm-recipe-group-name", ".wprm-recipe-instruction-text", ::cleanStep, fallbackItems = "li.wprm-recipe-instruction")?.let { return Section(it.first, Trust.STRONG, "recipe card") }
        for (sel in listOf(".tasty-recipes-instructions", ".tasty-recipe-instructions", ".mv-create-instructions", ".wpurp-recipe-instructions", ".ERSInstructions", ".easyrecipe .instructions", "#zlrecipe-instructions-list", ".zlrecipe-instructions", ".jetpack-recipe-directions", ".recipe-card-directions", ".wp-block-recipe-card-directions", ".cooked-recipe-directions", ".directions-list, .instructions-list")) {
            val root = doc.selectFirst(sel) ?: continue
            val lines = listLines(root, ::cleanStep, paragraphs = true)
            if (lines.any { !it.header }) return Section(lines, Trust.STRONG, "recipe card")
        }
        val props = doc.select("[itemprop=recipeInstructions], [property=recipeInstructions], [property$=schema.org/recipeInstructions]")
        if (props.isNotEmpty()) {
            val lines = dedupe(props.flatMap { p ->
                val texts = p.select("[itemprop=text], [property=text]")
                if (props.size == 1 || texts.isNotEmpty() || p.select("li, p").isNotEmpty()) (if (texts.isNotEmpty()) texts.map { Line(cleanStep(text(it))) } else listLines(p, ::cleanStep, paragraphs = true))
                else listOf(Line(cleanStep(p.attr("content").ifBlank { p.text() })))
            }.filter { it.text.isNotEmpty() })
            if (lines.any { !it.header && it.text.length >= 15 }) return Section(lines, Trust.STRONG, "recipe markup")
        }
        val stepProps = doc.select("[itemprop=step] [itemprop=text], [itemprop=itemListElement] [itemprop=text]")
        if (stepProps.size >= 2) return Section(dedupe(stepProps.map { Line(cleanStep(text(it))) }.filter { it.text.isNotEmpty() }), Trust.STRONG, "recipe markup")
        // a container named for directions
        var best: Triple<List<Line>, Element, Int>? = null
        val bodyLen = doc.body()?.text()?.length ?: 0
        for (el in doc.select("[class], [id]")) {
            val name = el.className() + " " + el.id()
            if (!stepName.containsMatchIn(name) || notStepName.containsMatchIn(name) || ingName.containsMatchIn(name)) continue
            if (el.tagName() in setOf("li", "a", "span", "label", "input", "p", "h1", "h2", "h3", "h4", "h5", "h6", "body", "html", "main", "article")) continue
            if (ingredientRoot != null && (el === ingredientRoot || ingredientRoot.parents().contains(el))) continue
            val len = el.text().length
            if (len < 40 || (bodyLen > 3000 && len > bodyLen * 0.7)) continue
            val lines = listLines(el, ::cleanStep, paragraphs = true)
            val items = lines.filter { !it.header }.map { it.text }
            if (items.isEmpty() || items.size > 80) continue
            val like = items.filter { stepLike(it) }
            if (like.isEmpty() || like.size < items.size * 0.5) continue
            val score = like.sumOf { it.length }
            val b = best
            if (b == null || score > b.third || (score == b.third && len < b.second.text().length)) best = Triple(lines, el, score)
        }
        best?.let { return Section(it.first, Trust.MEDIUM, "directions section") }
        val stepsByHeading = headings(doc, stepHeading).map { h -> h to following(h, ::cleanStep, { endHeading.matches(it) || ingHeading.matches(it) }, { stepLike(it) }, minRatio = 0.34, paragraphs = true).first }
            .filter { it.second.any { l -> !l.header && stepLike(l.text) } }
        if (stepsByHeading.size >= 2 && stepsByHeading.sumOf { it.second.size } <= 80 && stepsByHeading.map { it.second.map { l -> l.text } }.distinct().size == stepsByHeading.size) {
            val out = mutableListOf<Line>()
            stepsByHeading.forEach { (h, r) -> precedingHeading(h)?.let { t -> if (!stepHeading.matches(t) && !ingHeading.matches(t)) out += Line(t.trimEnd(':'), header = true) }; out += r }
            return Section(dedupe(out), Trust.WEAK, "direction headings")
        }
        stepsByHeading.map { it.second }.maxByOrNull { it.sumOf { l -> if (!l.header && stepLike(l.text)) l.text.length else 0 } }
            ?.let { return Section(it, Trust.MEDIUM, "directions heading") }
        headings(doc, looseStepHeading).map { h -> following(h, ::cleanStep, { endHeading.matches(it) || ingHeading.matches(it) }, { stepLike(it) }, minRatio = 0.5, paragraphs = true).first }
            .filter { it.any { l -> !l.header && stepLike(l.text) } }.maxByOrNull { it.sumOf { l -> if (!l.header && stepLike(l.text)) l.text.length else 0 } }
            ?.let { return Section(it, Trust.WEAK, "directions heading") }
        // no heading at all: the first run of step-like list items or paragraphs after the ingredients
        if (ingredientRoot != null) {
            val after = doc.allElements.dropWhile { it !== ingredientRoot }.drop(1).filter { el -> el.parents().none { it === ingredientRoot } }
            after.firstOrNull { it.tagName() == "ol" && it.children().count { c -> c.tagName() == "li" && stepLike(c.text()) } >= 2 }?.let { ol ->
                return Section(ol.children().filter { it.tagName() == "li" }.map { Line(cleanStep(text(it))) }.filter { it.text.isNotEmpty() }, Trust.WEAK, "list after ingredients")
            }
            val run = mutableListOf<Line>()
            for (el in after) {
                if (el.tagName() !in setOf("p", "li")) { if (el.tagName() in headingTags && run.size >= 2) break else continue }
                val t = cleanStep(text(el))
                if (stepLike(t)) run += Line(t) else if (run.size >= 2) break else if (t.length > 3) run.clear()
                if (run.size >= 40) break
            }
            if (run.size >= 2) return Section(dedupe(run), Trust.WEAK, "text after ingredients")
        }
        return null
    }

    // ---------------- helpers ----------------
    private fun dedupe(lines: List<Line>): List<Line> {
        // a list rendered twice (desktop and mobile copies) is kept once
        val n = lines.size
        if (n >= 4 && n % 2 == 0 && lines.subList(0, n / 2).map { it.text } == lines.subList(n / 2, n).map { it.text }) return lines.subList(0, n / 2)
        return lines.fold(mutableListOf()) { acc, l -> if (acc.lastOrNull()?.text != l.text) acc += l; acc }
    }

    private fun plugin(doc: Document, container: String, group: String, groupName: String, item: String, clean: (String) -> String, fallbackItems: String? = null): Pair<List<Line>, Element>? {
        val root = doc.selectFirst(container) ?: return null
        val out = mutableListOf<Line>()
        val groups = root.select(group).ifEmpty { listOf(root) }
        for (g in groups) {
            g.selectFirst(groupName)?.let { n -> clean(n.text()).trimEnd(':').takeIf { it.isNotEmpty() }?.let { out += Line(it, header = true) } }
            var items = g.select(item)
            if (items.isEmpty() && fallbackItems != null) items = g.select(fallbackItems)
            // nested matches (li.x containing span.x) would repeat text: keep outermost only
            items.filter { el -> el.parents().none { it in items } }.forEach { el -> clean(text(el)).takeIf { it.isNotEmpty() }?.let { out += Line(it) } }
        }
        return if (out.any { !it.header }) dedupe(out) to root else null
    }

    private val headingTags = setOf("h1", "h2", "h3", "h4", "h5", "h6")
    private fun isSubHeading(el: Element) = el.tagName() in headingTags || (el.tagName() in setOf("strong", "b", "dt") && el.text().length < 60) ||
        (el.tagName() == "p" && el.children().size == 1 && el.child(0).tagName() in setOf("strong", "b") && el.text() == el.child(0).text() && el.text().length < 60)

    /** Lines of a section: list items, table rows, paragraphs, or `<br>`-separated text, with short headings kept as sub-headers. */
    private fun listLines(root: Element, clean: (String) -> String, paragraphs: Boolean = false): List<Line> {
        val out = mutableListOf<Line>()
        val lis = root.select("li").filter { li -> li.select("li").size <= 1 }
        val rows = if (lis.isEmpty()) root.select("tr").filter { it.select("tr").size <= 1 } else emptyList()
        val blocks: List<Element> = when {
            lis.isNotEmpty() -> lis
            rows.size >= 2 -> rows
            else -> root.select("p, div, dd").filter { el -> el.ownText().isNotBlank() || (el.tagName() == "p") }.filter { el -> el.select("p, div, dd").size <= 1 }
        }
        if (lis.isEmpty() && rows.size < 2 && blocks.size >= 4) {
            // amount and name in separate small boxes: the row that holds them is the line
            val parents = blocks.mapNotNull { it.parent() }.filter { it !== root }.distinct()
            val rowLike = parents.filter { p -> p.text().length in 2..160 && blocks.count { it.parent() === p } in 2..4 }
            if (rowLike.size >= 2 && rowLike.size * 2 >= parents.size) {
                val out2 = parents.map { p -> if (p in rowLike) listOf(clean(text(p))) else blocks.filter { it.parent() === p }.map { clean(text(it)) } }.flatten().filter { it.isNotEmpty() }.map { Line(it) }
                return dedupe(out2)
            }
        }
        if (blocks.isEmpty()) {
            brLines(root).map(clean).filter { it.isNotEmpty() }.forEach { out += Line(it) }
            return dedupe(out)
        }
        val set = blocks.toSet()
        // walk in document order so sub-headings land between the right items
        for (el in root.allElements) {
            if (el === root) continue
            if (el in set) {
                if (isSubHeading(el) && lis.isEmpty()) { clean(text(el)).trimEnd(':').takeIf { it.isNotEmpty() }?.let { out += Line(it, header = true) }; continue }
                val pieces = if (el.select("br").isNotEmpty() && lis.isEmpty()) brLines(el) else listOf(text(el))
                pieces.map(clean).filter { it.isNotEmpty() }.forEach { out += Line(it) }
            } else if (el.tagName() in headingTags || (el.tagName() in setOf("strong", "b") && el.parents().none { it in set } && el.text().length < 60)) {
                if (el.parents().none { it in set }) clean(text(el)).trimEnd(':').takeIf { it.isNotEmpty() && it.length < 80 }?.let { out += Line(it, header = true) }
            }
        }
        if (!paragraphs) {
            var i = 0
            while (i < out.size - 1) { if (!out[i].header && !out[i + 1].header && onlyQty.matches(out[i].text)) { out[i] = Line(out[i].text + " " + out[i + 1].text); out.removeAt(i + 1) } else i++ }
        }
        // a leading header that just names the section ("Ingredients") is not a sub-header
        while (out.isNotEmpty() && out.first().header && (ingHeading.matches(out.first().text) || stepHeading.matches(out.first().text))) out.removeAt(0)
        while (out.isNotEmpty() && out.last().header) out.removeAt(out.lastIndex)
        return dedupe(out)
    }

    private fun brLines(el: Element): List<String> =
        Jsoup.parse(el.html().replace(Regex("""(?i)<br\s*/?>|</p>|</div>|</li>"""), "\n")).wholeText().lines().map { norm(it) }.filter { it.isNotEmpty() }

    private val looseStepHeading = Regex("""^.{0,30}(?:how to make|how to cook|here.?s how|let.?s get started|let.?s (?:make|cook|bake)|step.by.step|what to do|to make (?:the|this|it)|make it|assembly|to assemble|putting it together).{0,40}$""", RegexOption.IGNORE_CASE)
    private fun isStepHeading(t: String) = stepHeading.matches(t) || looseStepHeading.matches(t)
    private val onlyQty = Regex("""^[\d\s/.,¼½¾⅓⅔⅛⅜⅝⅞-]+$""")

    private fun headings(doc: Document, re: Regex): List<Element> {
        val all = doc.select("h1, h2, h3, h4, h5, h6, strong, b, p, div, span, dt, legend, th").filter { el ->
            val t = el.text().trim()
            t.length in 3..70 && re.matches(t.trimEnd(':')) && (el.tagName() in headingTags || el.children().none { it.isBlock })
        }
        // the same heading text is matched on a wrapper and its inner element: keep the innermost
        return all.filter { el -> all.none { o -> o !== el && o.parents().contains(el) } }.take(8)
    }

    private fun precedingHeading(el: Element): String? {
        var cur: Element? = el; var hops = 0
        while (cur != null && hops < 4) {
            var sib = cur.previousElementSibling(); var n = 0
            while (sib != null && n < 2) {
                val h = if (sib.tagName() in headingTags || isSubHeading(sib)) sib else sib.select("h1, h2, h3, h4, h5, h6").lastOrNull()
                if (h != null) return norm(h.text()).takeIf { it.length in 2..60 }
                if (sib.text().length > 80) return null
                sib = sib.previousElementSibling(); n++
            }
            cur = cur.parent(); hops++
        }
        return null
    }

    private fun commonAncestor(els: List<Element>): Element? {
        var a: Element? = els.firstOrNull()?.parent()
        while (a != null && !els.all { e -> e.parents().contains(a) }) a = a.parent()
        return a
    }

    /** Collects the content that follows a section heading, up to the next unrelated heading. */
    private fun following(h: Element, clean: (String) -> String, stop: (String) -> Boolean, good: (String) -> Boolean, minRatio: Double, paragraphs: Boolean = false): Pair<List<Line>, Element?> {
        var start: Element = h
        var climbs = 0
        while (start.nextElementSibling() == null && start.parent() != null && climbs < 4) { start = start.parent()!!; climbs++ }
        // a heading wrapped alone in a div/header: step out so its siblings are the content
        while (climbs < 4 && start.parent() != null && start.parent()!!.children().size == 1) { start = start.parent()!!; climbs++ }
        val hLevel = if (h.tagName() in headingTags) h.tagName().drop(1).toInt() else 7
        val out = mutableListOf<Line>()
        var sib = start.nextElementSibling(); var misses = 0; var last: Element? = null
        while (sib != null && misses < 4) {
            val t = sib.text().trim()
            if (t.isEmpty()) { sib = sib.nextElementSibling(); continue }
            val isHeading = sib.tagName() in headingTags
            if (t.length < 70 && stop(t.trimEnd(':'))) break
            if (isHeading) {
                val level = sib.tagName().drop(1).toInt()
                if (level <= hLevel && out.any { !it.header }) break
                if (t.length < 80) { out += Line(clean(t).trimEnd(':'), header = true); sib = sib.nextElementSibling(); continue }
            }
            val inner = sib.select("h1, h2, h3, h4, h5, h6, strong, b").firstOrNull { it.text().length < 60 && stop(it.text().trim().trimEnd(':')) }
            val lines = if (sib.tagName() in setOf("ul", "ol", "div", "section", "table", "dl")) listLines(sib, clean, paragraphs) else if (sib.select("br").isNotEmpty()) brLines(sib).map { Line(clean(it)) } else listOf(Line(clean(t), header = isSubHeading(sib)))
            val kept = if (inner != null) lines.takeWhile { !stop(it.text) } else lines
            val items = kept.filter { !it.header }.map { it.text }
            val ok = items.isNotEmpty() && items.count(good) >= items.size * minRatio
            if (ok || (kept.isNotEmpty() && kept.all { it.header })) { out += kept; last = sib; misses = 0 }
            else if (out.any { !it.header }) break
            else misses++
            if (inner != null) break
            sib = sib.nextElementSibling()
        }
        while (out.isNotEmpty() && out.last().header) out.removeAt(out.lastIndex)
        return dedupe(out) to (last?.parent() ?: start.parent())
    }
}
