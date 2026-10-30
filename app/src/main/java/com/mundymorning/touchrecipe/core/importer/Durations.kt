package com.mundymorning.touchrecipe.core.importer

import kotlin.math.roundToInt

object Durations {
    /** ISO-8601 ("PT1H30M", "P0DT0H20M") or loose text ("1 hr 15 min", "45 minutes") to whole minutes. */
    fun toMinutes(raw: String?): Int? {
        val s = raw?.trim().orEmpty()
        if (s.isEmpty()) return null
        val iso = Regex("""^P(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$""", RegexOption.IGNORE_CASE).find(s)
        if (iso != null && s.length > 1) {
            fun g(i: Int) = iso.groupValues[i].replace(',', '.').toDoubleOrNull() ?: 0.0
            val minutes = g(1) * 7 * 24 * 60 + g(2) * 24 * 60 + g(3) * 60 + g(4) + g(5) / 60
            return if (minutes > 0) minutes.roundToInt().coerceAtLeast(1) else null
        }
        return looseMinutes(s)
    }

    fun looseMinutes(s: String): Int? {
        var total = 0.0
        var found = false
        Regex("""(\d+(?:[.,]\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b""", RegexOption.IGNORE_CASE).findAll(s).forEach {
            val v = it.groupValues[1].replace(',', '.').toDouble()
            val u = it.groupValues[2].lowercase()
            total += when {
                u.startsWith("d") -> v * 1440
                u.startsWith("h") -> v * 60
                u.startsWith("m") -> v
                else -> v / 60
            }
            found = true
        }
        if (!found) {
            val plain = Regex("""^\d+$""").find(s.trim())
            if (plain != null) return plain.value.toInt()
            return null
        }
        return if (total > 0) total.roundToInt().coerceAtLeast(1) else null
    }

    /** Finds a countdown worth offering in Cook Mode, e.g. "simmer for 10-15 minutes" -> 600 s (lower bound). */
    fun timerSeconds(direction: String): Int? {
        val m = Regex("""(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to|or)\s*(\d+(?:[.,]\d+)?))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b""", RegexOption.IGNORE_CASE).find(direction) ?: return null
        val v = m.groupValues[1].replace(',', '.').toDouble()
        val u = m.groupValues[3].lowercase()
        val seconds = when {
            u.startsWith("h") -> v * 3600
            u.startsWith("m") -> v * 60
            else -> v
        }
        val r = seconds.roundToInt()
        return if (r in 5..(24 * 3600)) r else null
    }
}
