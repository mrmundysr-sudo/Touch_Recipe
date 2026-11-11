package com.mundymorning.touchrecipe.core.quantity

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToInt

/** Leading quantity of an ingredient line, e.g. "1 1/2" or "2-3". [high] is non-null for ranges. */
data class LeadingQuantity(val low: Double, val high: Double?, val endIndex: Int)

object Quantities {
    private val vulgar = mapOf(
        '¼' to 0.25, '½' to 0.5, '¾' to 0.75, '⅐' to 1 / 7.0, '⅑' to 1 / 9.0, '⅒' to 0.1,
        '⅓' to 1 / 3.0, '⅔' to 2 / 3.0, '⅕' to 0.2, '⅖' to 0.4, '⅗' to 0.6, '⅘' to 0.8,
        '⅙' to 1 / 6.0, '⅚' to 5 / 6.0, '⅛' to 0.125, '⅜' to 0.375, '⅝' to 0.625, '⅞' to 0.875,
    )

    /** Parses a single number token at [start]: "2", "1.5", "1,5", "1/2", "1 1/2", "1½", "½". Returns value and end index. */
    private fun number(s: String, start: Int): Pair<Double, Int>? {
        var i = start
        var whole: Double? = null
        val m = Regex("""\G(\d+)""").find(s, i)
        if (m != null) {
            i = m.range.last + 1
            var v = m.value.toDouble()
            // decimal: 1.5 or european 1,5 (but not 1,500)
            val dec = Regex("""\G[.,](\d{1,2})(?!\d)""").find(s, i)
            if (dec != null) { v += ("0." + dec.groupValues[1]).toDouble(); i = dec.range.last + 1; return v to i }
            // plain fraction a/b
            val fr = Regex("""\G\s?/\s?(\d+)""").find(s, i)
            if (fr != null) {
                val d = fr.groupValues[1].toDouble()
                if (d == 0.0) return null
                return v / d to (fr.range.last + 1)
            }
            // vulgar attached: 1½
            if (i < s.length && vulgar.containsKey(s[i])) return v + vulgar.getValue(s[i]) to i + 1
            whole = v
            // mixed number: "1 1/2" or "1 ½"
            val mixed = Regex("""\G[  -](\d+)\s?/\s?(\d+)""").find(s, i)
            if (mixed != null) {
                val d = mixed.groupValues[2].toDouble()
                if (d != 0.0) return v + mixed.groupValues[1].toDouble() / d to (mixed.range.last + 1)
            }
            val mv = Regex("""\G[  ]([¼½¾⅐-⅞])""").find(s, i)
            if (mv != null) return v + vulgar.getValue(mv.groupValues[1][0]) to (mv.range.last + 1)
            return v to i
        }
        if (start < s.length && vulgar.containsKey(s[start])) return vulgar.getValue(s[start]) to start + 1
        if (start < s.length && s[start] == '.' ) {
            val d = Regex("""\G\.(\d+)""").find(s, start)
            if (d != null) return ("0." + d.groupValues[1]).toDouble() to d.range.last + 1
        }
        return whole?.let { it to i }
    }

    fun parseLeading(line: String): LeadingQuantity? {
        val s = line.trimStart()
        val offset = line.length - s.length
        val first = number(s, 0) ?: return null
        var low = first.first
        var end = first.second
        var high: Double? = null
        val range = Regex("""\G\s*(?:-|–|—|to|or)\s*""", RegexOption.IGNORE_CASE).find(s, end)
        if (range != null) {
            val second = number(s, range.range.last + 1)
            if (second != null && second.first >= low) { high = second.first; end = second.second }
        }
        // a quantity glued to letters ("2x4", "350F") is not an amount we should scale
        if (end < s.length && s[end].isLetter() && s[end] != ' ') {
            val unitGlued = Regex("""\G(g|kg|ml|l|oz|lb|lbs|cl|dl|tsp|tbsp)\b""", RegexOption.IGNORE_CASE).find(s, end)
            if (unitGlued == null) return null
        }
        return LeadingQuantity(low, high, end + offset)
    }

    fun format(value: Double): String {
        if (value <= 0.0) return "0"
        if (value >= 100) return value.roundToInt().toString()
        val whole = floor(value).toInt()
        val frac = value - whole
        if (frac < 0.02) return whole.toString()
        if (frac > 0.98) return (whole + 1).toString()
        if (value < 10) {
            val eighths = frac * 8
            val nearest = eighths.roundToInt()
            if (abs(eighths - nearest) < 0.16) {
                val (n, d) = reduce(nearest, 8)
                return when {
                    n == 0 -> whole.toString()
                    n == d -> (whole + 1).toString()
                    whole == 0 -> "$n/$d"
                    else -> "$whole $n/$d"
                }
            }
            val thirds = frac * 3
            val t = thirds.roundToInt()
            if (abs(thirds - t) < 0.06 && t in 1..2) return if (whole == 0) "$t/3" else "$whole $t/3"
        }
        val r = (value * 10).roundToInt() / 10.0
        return if (r == floor(r)) r.toInt().toString() else r.toString()
    }

    private fun reduce(n: Int, d: Int): Pair<Int, Int> {
        var a = n; var b = d
        while (b != 0) { val t = a % b; a = b; b = t }
        return if (a == 0) n to d else n / a to d / a
    }

    /** Scales only the leading amount of [line]; text such as "a pinch" or "to taste" is returned unchanged. */
    fun scale(line: String, factor: Double): String {
        if (factor == 1.0 || factor <= 0.0 || factor.isNaN() || factor.isInfinite()) return line
        val q = parseLeading(line) ?: return line
        val lead = line.substring(0, line.length - line.trimStart().length)
        val rest = line.substring(q.endIndex)
        val scaledLow = q.low * factor
        val low = format(scaledLow)
        val scaledTop = (q.high ?: q.low) * factor
        val text = if (q.high != null) "$low-${format(q.high * factor)}" else low
        return lead + text + adjustUnitNumber(rest, scaledTop)
    }

    private val regular = setOf("cup", "tablespoon", "teaspoon", "ounce", "pound", "clove", "can", "slice", "stick", "package", "head", "sprig", "stalk", "jar", "bottle", "piece", "fillet", "bag", "box")

    /** "2 cup" -> "2 cups", "1 cups" -> "1 cup" for the unit word right after the amount; abbreviations (tsp, g) never change. */
    fun adjustUnitNumber(rest: String, amount: Double): String {
        val m = Regex("""^(\s+)([A-Za-z]+)(?=[\s,.;)]|$)""").find(rest) ?: return rest
        val word = m.groupValues[2]
        val lower = word.lowercase()
        val singular = if (lower.endsWith("s") && lower.dropLast(1) in regular) lower.dropLast(1) else lower
        if (singular !in regular) return rest
        val plural = amount > 1.0
        val out = if (plural) singular + "s" else singular
        val cased = if (word.first().isUpperCase()) out.replaceFirstChar { it.uppercase() } else out
        return m.groupValues[1] + cased + rest.substring(m.range.last + 1)
    }

    fun factor(baseServings: Int?, targetServings: Int?): Double =
        if (baseServings == null || baseServings <= 0 || targetServings == null || targetServings <= 0) 1.0
        else targetServings.toDouble() / baseServings
}
