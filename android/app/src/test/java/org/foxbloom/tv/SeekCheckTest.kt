package org.foxbloom.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SeekCheckTest {
    @Test fun unseekableFailsAtOnce() {
        val s = SeekCheck()
        assertEquals(false, s.start(60_000, seekable = false))
        // Nothing left to settle afterwards.
        assertNull(s.landed(0))
    }

    @Test fun readyNearTargetLanded() {
        val s = SeekCheck()
        assertNull(s.start(60_000, seekable = true))
        assertEquals(true, s.landed(61_200))
        assertNull(s.landed(61_300)) // settled once
    }

    @Test fun adjustedToStartFailed() {
        val s = SeekCheck()
        assertNull(s.start(60_000, seekable = true))
        assertEquals(false, s.landed(0))
    }

    @Test fun justOutsideToleranceFailed() {
        val s = SeekCheck()
        s.start(60_000, seekable = true)
        assertEquals(false, s.landed(65_001))
    }

    @Test fun newerSeekSupersedes() {
        val s = SeekCheck()
        s.start(60_000, seekable = true)
        s.start(120_000, seekable = true)
        assertEquals(true, s.landed(120_500))
        assertNull(s.landed(60_000))
    }

    @Test fun nothingPendingNothingToSay() = assertNull(SeekCheck().landed(1000))

    @Test fun clearDropsPending() {
        val s = SeekCheck()
        s.start(60_000, seekable = true)
        s.clear()
        assertNull(s.landed(60_000))
    }
}
