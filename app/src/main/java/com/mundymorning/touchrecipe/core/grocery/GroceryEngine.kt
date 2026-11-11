package com.mundymorning.touchrecipe.core.grocery

import com.mundymorning.touchrecipe.core.model.Recipe
import com.mundymorning.touchrecipe.core.quantity.Quantities
import com.mundymorning.touchrecipe.core.model.GroceryItem
import com.mundymorning.touchrecipe.core.model.SourceRef
import com.mundymorning.touchrecipe.core.model.newId

const val AISLE_PRODUCE = "produce"
const val AISLE_MEAT = "meat"
const val AISLE_DAIRY = "dairy"
const val AISLE_PANTRY = "pantry"
const val AISLE_BAKERY = "bakery"
val DEFAULT_AISLES = listOf(AISLE_PRODUCE, AISLE_MEAT, AISLE_DAIRY, AISLE_PANTRY, AISLE_BAKERY)

/** One merged line produced from planned meals. [key] is stable across regenerations. */
data class GeneratedItem(
    val key: String,
    val name: String,
    val quantity: Double?,
    val unit: String,
    val family: Family,
    val aisle: String,
    val sources: List<SourceRef>,
) {
    val quantityText: String
        get() = if (quantity == null) "" else (Quantities.format(quantity) + if (unit.isNotEmpty()) " " + Units.display(unit, quantity) else "")
}

data class PlannedMeal(val recipe: Recipe, val servings: Int?)

data class ParsedIngredient(val quantity: Double?, val unit: Unit?, val unitText: String, val name: String)

object GroceryEngine {
    private val prepWords = Regex(
        """\b(fresh|freshly|large|small|medium|big|extra|ripe|raw|chopped|minced|diced|sliced|grated|shredded|peeled|""" +
            """softened|melted|divided|packed|optional|finely|roughly|thinly|boneless|skinless|cold|warm|hot|room temperature|to taste|""" +
            """for serving|for garnish|plus more|about|approximately|cut into[^,]*)\b""", RegexOption.IGNORE_CASE)

    fun parse(line: String): ParsedIngredient {
        val text = line.trim()
        val q = Quantities.parseLeading(text)
        if (q == null) return ParsedIngredient(null, null, "", text)
        var rest = text.substring(q.endIndex).trim()
        val amount = q.high ?: q.low
        // optional "(14 oz)" size note directly after the amount: keep it in the name, e.g. "1 (14 oz) can tomatoes"
        val paren = Regex("""^\(([^)]*)\)\s*""").find(rest)
        var sizeNote = ""
        if (paren != null) { sizeNote = paren.groupValues[1]; rest = rest.substring(paren.range.last + 1) }
        val tokenMatch = Regex("""^([A-Za-z.]+(?:\s?oz)?)\b""").find(rest)
        var unit: Unit? = null
        var unitText = ""
        if (tokenMatch != null) {
            val tok = tokenMatch.groupValues[1]
            val two = Regex("""^(fl\.?\s?oz|fluid ounces?)""", RegexOption.IGNORE_CASE).find(rest)
            val u = if (two != null) Units.byCanonical("fl oz") else Units.lookup(tok)
            when {
                u != null -> { unit = u; unitText = u.name; rest = rest.substring(two?.value?.length ?: tok.length).trim().removePrefix("of ").trim() }
                Units.isCountUnit(tok) -> { unitText = tok.lowercase().trimEnd('.').let(::singularUnit); rest = rest.substring(tok.length).trim().removePrefix("of ").trim() }
            }
        }
        if (sizeNote.isNotEmpty() && unit == null && unitText.isEmpty()) rest = "$rest ($sizeNote)"
        else if (sizeNote.isNotEmpty()) rest = "$rest ($sizeNote)"
        return ParsedIngredient(amount * 1.0, unit, unitText, rest.trim())
    }

    private fun singularUnit(u: String) = when {
        u == "pinches" -> "pinch"; u == "dashes" -> "dash"; u == "bunches" -> "bunch"; u == "loaves" -> "loaf"
        u.endsWith("es") && u.length > 4 && (u.endsWith("ches") || u.endsWith("xes")) -> u.dropLast(2)
        u.endsWith("s") -> u.dropLast(1)
        else -> u
    }

    fun displayName(raw: String): String {
        val noParen = raw.replace(Regex("""\([^)]*\)"""), " ")
        val head = noParen.substringBefore(",")
        val cleaned = head.replace(Regex("""\s+"""), " ").trim().trim('-', '–', ' ')
            .replace(Regex("""^((large|small|medium|big|extra|ripe|fresh|freshly)\s+)+""", RegexOption.IGNORE_CASE), "")
        return cleaned.ifEmpty { raw.trim() }
    }

    fun normalizeKey(name: String): String {
        var s = displayName(name).lowercase()
        s = s.replace(prepWords, " ").replace(Regex("""[^a-z\s]"""), " ").replace(Regex("""\s+"""), " ").trim()
        s = s.split(' ').filter { it.isNotEmpty() && it !in setOf("of", "and", "or", "the", "a") }.joinToString(" ") { singular(it) }
        return s
    }

    private fun singular(w: String): String = when {
        w.length <= 3 -> w
        w.endsWith("ies") -> w.dropLast(3) + "y"
        w.endsWith("oes") -> w.dropLast(2)
        w.endsWith("ches") || w.endsWith("shes") || w.endsWith("sses") -> w.dropLast(2)
        w.endsWith("ss") || w.endsWith("us") -> w
        w.endsWith("s") -> w.dropLast(1)
        else -> w
    }

    fun aisleFor(key: String): String {
        val k = key.lowercase()
        fun has(vararg words: String) = words.any { Regex("""\b$it(s|es)?\b""").containsMatchIn(k) }
        return when {
            has("chicken", "beef", "pork", "turkey", "bacon", "sausage", "ham", "lamb", "steak", "salmon", "shrimp", "tuna", "cod", "fish", "crab", "lobster", "scallop", "prosciutto", "anchovy", "mince") -> AISLE_MEAT
            has("milk", "cream", "butter", "cheese", "yogurt", "yoghurt", "egg", "parmesan", "mozzarella", "cheddar", "ricotta", "feta", "sour cream", "buttermilk", "ghee") -> AISLE_DAIRY
            has("bread", "bun", "roll", "baguette", "tortilla", "pita", "naan", "bagel", "croissant", "brioche", "ciabatta", "loaf") -> AISLE_BAKERY
            has("onion", "garlic", "tomato", "potato", "carrot", "celery", "lettuce", "spinach", "kale", "pepper", "lemon", "lime", "apple", "banana", "basil", "parsley", "cilantro", "mint", "thyme", "rosemary", "ginger", "cucumber", "zucchini", "mushroom", "broccoli", "cauliflower", "cabbage", "avocado", "orange", "berry", "strawberry", "blueberry", "scallion", "shallot", "leek", "corn", "pea", "bean sprout", "squash", "eggplant", "asparagus", "dill", "chive", "sage", "fruit", "herb", "arugula", "beet", "radish") && !has("sauce", "paste", "powder", "flake", "dried", "ground", "canned", "juice") -> AISLE_PRODUCE
            else -> AISLE_PANTRY
        }
    }

    /** Combines the ingredients of all planned meals, scaling each recipe to its planned servings. */
    fun generate(meals: List<PlannedMeal>): List<GeneratedItem> {
        class Acc(val key: String, var name: String, val family: Family, var unitLabel: String) {
            var base: Double? = 0.0
            val sources = LinkedHashMap<String, SourceRef>()
        }
        val acc = LinkedHashMap<String, Acc>()
        for (meal in meals) {
            val factor = Quantities.factor(meal.recipe.servings, meal.servings)
            val ref = SourceRef(meal.recipe.id, meal.recipe.title)
            for (ing in meal.recipe.ingredients) {
                if (ing.header || ing.text.isBlank()) continue
                val p = parse(ing.text)
                val nameKey = normalizeKey(p.name)
                if (nameKey.isEmpty()) continue
                val family = p.unit?.family ?: Family.COUNT
                val unitLabel = if (p.unit == null) p.unitText else ""
                val key = "$nameKey|${if (p.unit == null) p.unitText else family.name}"
                val a = acc.getOrPut(key) { Acc(nameKey, displayName(p.name), family, unitLabel) }
                a.sources[meal.recipe.id] = ref
                val q = p.quantity
                if (q == null) { if (a.base == 0.0) a.base = null } else {
                    val scaled = q * factor * (p.unit?.factor ?: 1.0)
                    a.base = (a.base ?: 0.0) + scaled
                }
            }
        }
        return acc.map { (k, a) ->
            val (qty, unit) = if (a.base == null || a.base == 0.0) null to a.unitLabel
            else if (a.family == Family.COUNT) a.base to a.unitLabel
            else Units.best(a.family, a.base!!).let { it.first to it.second }
            GeneratedItem(k, a.name.replaceFirstChar { it.uppercase() }, qty, unit, a.family, aisleFor(a.key), a.sources.values.toList())
        }
    }
}

object GroceryMerge {
    /**
     * Refreshes [existing] items of one week from [generated] without losing user work:
     * purchased state and edited lines are preserved, custom items are untouched,
     * stale unchecked generated items are dropped.
     */
    fun merge(weekStart: String, existing: List<GroceryItem>, generated: List<GeneratedItem>): List<GroceryItem> {
        val byKey = existing.filter { it.generated }.associateBy { it.key }
        val out = mutableListOf<GroceryItem>()
        out += existing.filter { !it.generated }
        val seen = HashSet<String>()
        var next = (existing.maxOfOrNull { it.sortIndex } ?: -1) + 1
        for (g in generated) {
            seen += g.key
            val old = byKey[g.key]
            if (old == null) out += GroceryItem(id = newId(), weekStart = weekStart, name = g.name, quantityText = g.quantityText, aisle = g.aisle,
                sortIndex = next++, key = g.key, generated = true, sources = g.sources)
            else out += if (old.edited) old.copy(sources = g.sources) else old.copy(name = g.name, quantityText = g.quantityText, sources = g.sources)
        }
        // keep purchased history and user-edited lines even when the meal was removed
        out += existing.filter { it.generated && it.key !in seen && (it.checked || it.edited) }
        return out
    }
}
