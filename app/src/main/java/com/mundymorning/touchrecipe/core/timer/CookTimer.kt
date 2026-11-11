package com.mundymorning.touchrecipe.core.timer

/**
 * Wall-clock based countdown. Because it stores the absolute end time while running, it survives
 * leaving the screen, process death and device sleep: remaining time is always recomputed from [nowMs].
 */
data class CookTimer(
    val totalMs: Long = 0L,
    val remainingMs: Long = 0L,
    val endAtMs: Long? = null,
) {
    val running: Boolean get() = endAtMs != null
    val configured: Boolean get() = totalMs > 0

    fun remaining(nowMs: Long): Long = if (endAtMs != null) (endAtMs - nowMs).coerceAtLeast(0) else remainingMs
    fun finished(nowMs: Long): Boolean = configured && remaining(nowMs) == 0L && (endAtMs != null || remainingMs == 0L)

    fun start(nowMs: Long): CookTimer {
        if (!configured) return this
        val left = if (remainingMs <= 0L) totalMs else remainingMs
        return copy(remainingMs = left, endAtMs = nowMs + left)
    }

    fun pause(nowMs: Long): CookTimer = if (endAtMs == null) this else copy(remainingMs = remaining(nowMs), endAtMs = null)
    fun reset(): CookTimer = copy(remainingMs = totalMs, endAtMs = null)
    fun withDuration(seconds: Int?): CookTimer = if (seconds == null || seconds <= 0) CookTimer() else CookTimer(seconds * 1000L, seconds * 1000L, null)

    companion object {
        fun format(ms: Long): String {
            val total = (ms + 999) / 1000
            val h = total / 3600
            val m = (total % 3600) / 60
            val s = total % 60
            return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
        }
    }
}
