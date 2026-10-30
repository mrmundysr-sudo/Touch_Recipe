package com.mundymorning.touchrecipe.core.grocery

enum class Family { US_VOLUME, METRIC_VOLUME, US_WEIGHT, METRIC_WEIGHT, COUNT }

/** A canonical unit: [factor] converts one of it into the family's base unit (tsp, ml, oz, g, 1). */
data class Unit(val name: String, val family: Family, val factor: Double)

object Units {
    private val table = listOf(
        Unit("tsp", Family.US_VOLUME, 1.0), Unit("tbsp", Family.US_VOLUME, 3.0), Unit("fl oz", Family.US_VOLUME, 6.0),
        Unit("cup", Family.US_VOLUME, 48.0), Unit("pint", Family.US_VOLUME, 96.0), Unit("quart", Family.US_VOLUME, 192.0),
        Unit("gallon", Family.US_VOLUME, 768.0),
        Unit("ml", Family.METRIC_VOLUME, 1.0), Unit("l", Family.METRIC_VOLUME, 1000.0),
        Unit("oz", Family.US_WEIGHT, 1.0), Unit("lb", Family.US_WEIGHT, 16.0),
        Unit("g", Family.METRIC_WEIGHT, 1.0), Unit("kg", Family.METRIC_WEIGHT, 1000.0),
    )
    private val byName = table.associateBy { it.name }

    private val synonyms: Map<String, String> = buildMap {
        fun add(canon: String, vararg names: String) = names.forEach { put(it, canon) }
        add("tsp", "tsp", "tsps", "teaspoon", "teaspoons", "t")
        add("tbsp", "tbsp", "tbsps", "tbs", "tablespoon", "tablespoons", "tbl")
        add("fl oz", "floz", "fl.oz", "fluid ounce", "fluid ounces")
        add("cup", "cup", "cups", "c")
        add("pint", "pint", "pints", "pt")
        add("quart", "quart", "quarts", "qt")
        add("gallon", "gallon", "gallons", "gal")
        add("ml", "ml", "milliliter", "milliliters", "millilitre", "millilitres")
        add("l", "l", "liter", "liters", "litre", "litres")
        add("oz", "oz", "ounce", "ounces")
        add("lb", "lb", "lbs", "pound", "pounds")
        add("g", "g", "gram", "grams", "gramme", "grammes")
        add("kg", "kg", "kilogram", "kilograms", "kilo", "kilos")
    }

    private val countUnits = setOf(
        "clove", "cloves", "can", "cans", "pinch", "pinches", "dash", "dashes", "slice", "slices", "bunch", "bunches",
        "package", "packages", "pkg", "packet", "packets", "stick", "sticks", "head", "heads", "sprig", "sprigs",
        "stalk", "stalks", "jar", "jars", "bottle", "bottles", "bag", "bags", "box", "boxes", "piece", "pieces",
        "fillet", "fillets", "handful", "handfuls", "sheet", "sheets", "loaf", "loaves", "bulb", "bulbs",
    )

    /** Display form of a canonical unit for a given amount: cup/cups, clove/cloves; abbreviations stay as they are. */
    fun display(unit: String, amount: Double): String = when (unit) {
        "cup", "pint", "quart", "gallon", "lb" -> if (amount > 1.0 && unit != "lb") unit + "s" else unit
        "fl oz", "tsp", "tbsp", "oz", "ml", "l", "g", "kg" -> unit
        else -> if (amount > 1.0 && !unit.endsWith("s")) (if (unit.endsWith("ch") || unit.endsWith("sh") || unit.endsWith("x")) unit + "es" else if (unit == "loaf") "loaves" else unit + "s") else unit
    }

    fun lookup(token: String): Unit? = synonyms[token.lowercase().trimEnd('.')]?.let { byName[it] }
    fun isCountUnit(token: String) = token.lowercase().trimEnd('.') in countUnits
    fun byCanonical(name: String): Unit? = byName[name]

    /** Picks the friendliest unit for a total expressed in the family's base unit. */
    fun best(family: Family, base: Double): Pair<Double, String> = when (family) {
        Family.US_VOLUME -> when {
            base >= 48 -> base / 48 to "cup"
            base >= 3 -> base / 3 to "tbsp"
            else -> base to "tsp"
        }
        Family.METRIC_VOLUME -> if (base >= 1000) base / 1000 to "l" else base to "ml"
        Family.US_WEIGHT -> if (base >= 16) base / 16 to "lb" else base to "oz"
        Family.METRIC_WEIGHT -> if (base >= 1000) base / 1000 to "kg" else base to "g"
        Family.COUNT -> base to ""
    }
}
