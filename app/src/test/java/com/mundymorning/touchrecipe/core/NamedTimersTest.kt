package com.mundymorning.touchrecipe.core

import com.mundymorning.touchrecipe.core.timer.NamedTimers
import org.junit.Assert.*
import org.junit.Test

class NamedTimersTest {
    @Test fun twoTimersRunIndependentlyAndSurviveEncoding() {
        var l = NamedTimers.add(emptyList(), "Biscuits", 12, 1_000L)
        l = NamedTimers.add(l, "", 5, 1_000L)
        assertEquals(listOf("Biscuits", "Timer 1"), l.map { it.name })
        val back = NamedTimers.decode(NamedTimers.encode(l))   // what the app stores so timers persist across exit
        assertEquals(l, back)
        assertEquals(12 * 60_000L - 60_000L, back[0].timer.remaining(1_000L + 60_000L))
        assertEquals(5 * 60_000L - 60_000L, back[1].timer.remaining(1_000L + 60_000L))
    }

    @Test fun settleFinishesOnlyExpiredTimers() {
        val l = NamedTimers.add(NamedTimers.add(emptyList(), "Short", 1, 0L), "Long", 30, 0L)
        val (settled, finished) = NamedTimers.settle(l, 61_000L)
        assertEquals(listOf("Short"), finished.map { it.name })
        assertEquals(0L, settled[0].remainingMs); assertNull(settled[0].endAtMs)
        assertNotNull(settled[1].endAtMs)
    }

    @Test fun capAndBadInput() {
        var l = emptyList<com.mundymorning.touchrecipe.core.timer.NamedTimer>()
        repeat(NamedTimers.MAX + 3) { l = NamedTimers.add(l, "T$it", 1, 0L) }
        assertEquals(NamedTimers.MAX, l.size)
        assertEquals(l, NamedTimers.add(l, "x", 0, 0L))
        assertTrue(NamedTimers.decode("not json").isEmpty())
    }
}
