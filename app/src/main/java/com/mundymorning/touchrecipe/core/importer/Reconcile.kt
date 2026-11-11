package com.mundymorning.touchrecipe.core.importer

import com.mundymorning.touchrecipe.core.model.*
import java.text.Normalizer

/**
 * Compares a recipe read from a page's data block with what the visible page shows, so an import is never
 * accepted as complete just because the data block parsed. Trustworthy page content fills gaps; anything
 * that cannot be placed with confidence is kept in [ImportDraft.unplaced] and reported, never dropped.
 */
object Reconcile {
    private fun norm(s: String) = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFKD).replace(Regex("""[^\p{L}\p{N} ]+"""), " ").replace(Regex("""\s+"""), " ").trim()
    fun tokens(s: String): List<String> = norm(s).split(' ').filter { it.isNotEmpty() && !it.all(Char::isDigit) }
    private val leadingQty = Regex("""^\s*(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞])""")

    /** 0..1 likeness of two lines; 1 when one line's words are all contained in the other. */
    private fun squash(s: String) = norm(s).replace(" ", "")
    fun similarity(a: String, b: String): Double {
        val qa = squash(a); val qb = squash(b)
        if (qa.isNotEmpty() && qa == qb) return 1.0
        val x = tokens(a).toSet(); val y = tokens(b).toSet()
        if (x.isEmpty() || y.isEmpty()) return if (norm(a) == norm(b) && norm(a).isNotEmpty()) 1.0 else 0.0
        val common = x.count { it in y }.toDouble()
        return maxOf(common / maxOf(x.size, y.size), if (common == minOf(x.size, y.size).toDouble() && minOf(x.size, y.size) >= 1) 0.8 else 0.0)
    }

    class Outcome<T>(val value: List<T>, val warnings: List<ImportWarning>, val unplaced: List<String>, val changed: Boolean)

    /** Greedy one-to-one matching of [a] onto [b]; returns for each a-index the matched b-index or -1. */
    private fun match(a: List<String>, b: List<String>): IntArray {
        val used = BooleanArray(b.size); val out = IntArray(a.size) { -1 }
        a.forEachIndexed { i, s ->
            var best = -1; var bs = 0.0
            b.forEachIndexed { j, t -> if (!used[j]) { val v = similarity(s, t); if (v > bs) { bs = v; best = j } } }
            if (best >= 0 && bs >= 0.6) { used[best] = true; out[i] = best }
        }
        return out
    }

    private fun PageScan.Section.toIngredients() = lines.map { Ingredient(text = it.text, header = it.header) }
    private fun PageScan.Section.toDirections() = lines.map { if (it.header) Direction(text = it.text, header = true) else Direction(text = it.text, timerSeconds = Durations.timerSeconds(it.text)) }

    fun ingredients(data: List<Ingredient>, page: PageScan.Section?): Outcome<Ingredient> {
        val s = data.filter { !it.header }.map { it.text }
        if (page == null) return Outcome(data, emptyList(), emptyList(), false)
        val p = page.items
        if (s.isEmpty()) {
            if (p.isEmpty()) return Outcome(data, emptyList(), emptyList(), false)
            val w = ImportWarning("ingredients", if (page.trust == PageScan.Trust.STRONG) "Ingredients were read from the recipe card on the page." else "Ingredients were guessed from the page layout. Please check them against the original.",
                if (page.trust == PageScan.Trust.STRONG) Severity.INFO else Severity.WARNING)
            return Outcome(page.toIngredients(), listOf(w), emptyList(), true)
        }
        val m = match(s, p)
        val covered = m.count { it >= 0 }.toDouble() / s.size
        val matchedP = m.filter { it >= 0 }.toSet()
        val extra = p.filterIndexed { j, _ -> j !in matchedP }
        val richer = m.withIndex().count { (i, j) -> j >= 0 && !leadingQty.containsMatchIn(s[i]) && leadingQty.containsMatchIn(p[j]) && tokens(p[j]).containsAll(tokens(s[i])) }
        val collapsed = s.size <= 2 && p.size >= 3 && s.any { it.length > 120 } && tokens(s.joinToString(" ")).toSet().let { st -> p.count { l -> tokens(l).all { it in st } } >= p.size * 0.7 }
        val trusted = page.trust != PageScan.Trust.WEAK
        // where the page line and the data line say the same thing, the data line's cleaner text is kept
        fun pageList(): List<Ingredient> { val back = HashMap<Int, Int>(); m.forEachIndexed { i, j -> if (j >= 0) back[j] = i }; var k = -1
            return page.lines.map { l -> if (l.header) Ingredient(text = l.text, header = true) else { k++; val i = back[k]; Ingredient(text = if (i != null && squash(s[i]) == squash(l.text)) s[i] else l.text) } } }
        if (trusted && s.size <= 2 && p.size >= 4 && p.count { PageScan.ingredientLike(it) } >= p.size * 0.6)
            return Outcome(pageList(), listOf(ImportWarning("ingredients", "The page's recipe data held only ${s.size} ingredient line${if (s.size == 1) "" else "s"}, so the ${p.size} shown on the page were used.", Severity.INFO)), s.filterIndexed { i, _ -> m[i] < 0 }, true)
        if (collapsed) return Outcome(page.toIngredients(), listOf(ImportWarning("ingredients", "The page's recipe data ran the ingredients together, so they were read from the page itself.", Severity.INFO)), emptyList(), true)
        if (trusted && covered >= 0.8 && richer >= maxOf(2, (s.size * 0.3).toInt()))
            return Outcome(pageList(), listOf(ImportWarning("ingredients", "The page's recipe data left out some amounts, so ingredients were read from the page itself.", Severity.INFO)), emptyList(), true)
        val extraLike = extra.filter { PageScan.ingredientLike(it) }
        if (extra.isNotEmpty() && covered >= 0.8 && p.size <= s.size * 2 + 3 && (page.trust == PageScan.Trust.STRONG || (trusted && extraLike.size >= extra.size * 0.6)))
            return Outcome(pageList(), listOf(ImportWarning("ingredients", "The page shows ${p.size} ingredient lines but its recipe data had ${s.size}; the fuller list from the page was used.", Severity.INFO)), emptyList(), true)
        if (extraLike.isNotEmpty() && covered >= 0.5) {
            val w = ImportWarning("ingredients", "The page appears to list ${p.size} ingredient lines but ${s.size} were imported. Possibly missing: ${extraLike.take(4).joinToString("; ")}${if (extraLike.size > 4) "…" else ""}")
            return Outcome(data, listOf(w), extraLike, false)
        }
        return Outcome(data, emptyList(), emptyList(), false)
    }

    fun directions(data: List<Direction>, page: PageScan.Section?): Outcome<Direction> {
        val s = data.filter { !it.header }.map { it.text }
        if (page == null) return Outcome(data, emptyList(), emptyList(), false)
        val p = page.items
        if (p.isEmpty()) return Outcome(data, emptyList(), emptyList(), false)
        if (s.isEmpty()) {
            val w = ImportWarning("directions", if (page.trust == PageScan.Trust.STRONG) "Directions were read from the recipe card on the page." else "Directions were guessed from the page layout. Please check them against the original.",
                if (page.trust == PageScan.Trust.STRONG) Severity.INFO else Severity.WARNING)
            return Outcome(page.toDirections(), listOf(w), emptyList(), true)
        }
        val st = tokens(s.joinToString(" ")); val pt = tokens(p.joinToString(" "))
        if (st.isEmpty() || pt.isEmpty()) return Outcome(data, emptyList(), emptyList(), false)
        val sSet = st.toSet(); val pSet = pt.toSet()
        val sInP = st.count { it in pSet }.toDouble() / st.size   // how much of the data block the page also shows
        val pInS = pt.count { it in sSet }.toDouble() / pt.size   // how much of the page text the data block has
        val trusted = page.trust != PageScan.Trust.WEAK
        if (trusted && s.sumOf { it.length } / s.size < 45 && pt.size >= st.size * 3 && p.count { PageScan.stepLike(it) } >= 2)
            return Outcome(page.toDirections(), listOf(ImportWarning("directions", "The page's recipe data held only step titles, so the full directions were read from the page itself.", Severity.INFO)), s.filter { t -> p.none { similarity(t, it) >= 0.6 } }, true)
        if (pInS >= 0.9) {
            // same words; prefer the page only when the data block ran several steps into one
            if (trusted && s.size == 1 && p.size >= 2 && sInP >= 0.9 && pt.size <= st.size * 1.2)
                return Outcome(page.toDirections(), listOf(ImportWarning("directions", "The page's recipe data ran the steps together, so they were read from the page itself.", Severity.INFO)), emptyList(), true)
            return Outcome(data, emptyList(), emptyList(), false)
        }
        if (trusted && sInP >= 0.85 && pt.size >= st.size * 1.1 && pt.size <= st.size * 2.5)
            return Outcome(page.toDirections(), listOf(ImportWarning("directions", "The page shows more direction text than its recipe data had; the fuller version from the page was used.", Severity.INFO)), emptyList(), true)
        if (sInP >= 0.5 && pt.size >= st.size * 1.2) {
            val m = match(p, s)
            val missing = p.filterIndexed { i, t -> m[i] < 0 && PageScan.stepLike(t) }
            if (missing.isNotEmpty())
                return Outcome(data, listOf(ImportWarning("directions", "The page appears to have more direction text than was imported (${missing.size} passage${if (missing.size == 1) "" else "s"}). Compare with the original.")), missing, false)
        }
        return Outcome(data, emptyList(), emptyList(), false)
    }
}
