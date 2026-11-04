package com.mundymorning.touchrecipe.core.planner

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

object Planner {
    fun weekStart(date: LocalDate, first: DayOfWeek = DayOfWeek.MONDAY): LocalDate {
        var d = date
        while (d.dayOfWeek != first) d = d.minusDays(1)
        return d
    }

    fun days(weekStart: LocalDate): List<LocalDate> = (0L..6L).map { weekStart.plusDays(it) }

    fun dayLabel(date: LocalDate, locale: Locale = Locale.getDefault()): String =
        date.dayOfWeek.getDisplayName(TextStyle.FULL, locale)

    fun dateLabel(date: LocalDate, locale: Locale = Locale.getDefault()): String =
        date.format(DateTimeFormatter.ofPattern("MMM d", locale))

    fun rangeLabel(weekStart: LocalDate, locale: Locale = Locale.getDefault()): String {
        val end = weekStart.plusDays(6)
        val f = DateTimeFormatter.ofPattern("MMM d", locale)
        return if (weekStart.year == end.year) "${weekStart.format(f)} – ${end.format(f)}" else
            "${weekStart.format(DateTimeFormatter.ofPattern("MMM d, yyyy", locale))} – ${end.format(DateTimeFormatter.ofPattern("MMM d, yyyy", locale))}"
    }
}
