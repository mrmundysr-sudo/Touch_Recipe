package com.mundymorning.touchrecipe.core.timer

import com.mundymorning.touchrecipe.core.model.newId
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** One of several independent kitchen timers. Stores absolute end time while running, so it keeps counting when the app is closed. */
@Serializable
data class NamedTimer(
    val id: String = newId(),
    val name: String,
    val totalMs: Long,
    val remainingMs: Long = totalMs,
    val endAtMs: Long? = null,
) {
    val timer: CookTimer get() = CookTimer(totalMs, remainingMs, endAtMs)
    fun with(t: CookTimer) = copy(totalMs = t.totalMs, remainingMs = t.remainingMs, endAtMs = t.endAtMs)
    fun isDone(nowMs: Long) = endAtMs != null && timer.remaining(nowMs) == 0L
}

object NamedTimers {
    const val MAX = 10
    private val json = Json { ignoreUnknownKeys = true }

    fun encode(list: List<NamedTimer>): String = json.encodeToString(ListSerializer(NamedTimer.serializer()), list)
    fun decode(text: String?): List<NamedTimer> =
        if (text.isNullOrBlank()) emptyList() else runCatching { json.decodeFromString(ListSerializer(NamedTimer.serializer()), text) }.getOrDefault(emptyList())

    /** "Timer 1", "Timer 2"... first unused default name. */
    fun defaultName(existing: List<NamedTimer>): String {
        var i = 1
        while (existing.any { it.name.equals("Timer $i", true) }) i++
        return "Timer $i"
    }

    /** Adds a timer (optionally already running). Returns the unchanged list when the cap is reached or minutes is not positive. */
    fun add(list: List<NamedTimer>, name: String, minutes: Int, nowMs: Long, start: Boolean = true): List<NamedTimer> {
        if (list.size >= MAX || minutes <= 0) return list
        val base = NamedTimer(name = name.trim().take(40).ifEmpty { defaultName(list) }, totalMs = minutes * 60_000L)
        return list + if (start) base.with(base.timer.start(nowMs)) else base
    }

    /** Timers whose end time has passed become finished (stopped at 0) so they don't count as running. Returns the new list and those that just finished. */
    fun settle(list: List<NamedTimer>, nowMs: Long): Pair<List<NamedTimer>, List<NamedTimer>> {
        val finished = list.filter { it.isDone(nowMs) }
        if (finished.isEmpty()) return list to emptyList()
        return list.map { if (it.isDone(nowMs)) it.copy(remainingMs = 0L, endAtMs = null) else it } to finished
    }
}
