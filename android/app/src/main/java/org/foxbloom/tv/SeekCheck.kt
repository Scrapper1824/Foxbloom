package org.foxbloom.tv

import kotlin.math.abs

/**
 * Decides whether the page's jump landed, for the 'seeked' event.
 *
 * ExoPlayer reports a seek at once with the requested position (it masks seeks), so that report proves nothing.
 * Where playback really ends up shows later: a SEEK_ADJUSTMENT (e.g. a file without an index restarting at 0) or
 * the next READY/ENDED. Pure, so it can be unit tested; the bridge calls it on the main thread.
 */
class SeekCheck(private val toleranceMs: Long = TOLERANCE_MS) {
    private var target: Long? = null

    /**
     * A new seek to [targetMs]; it supersedes any seek still unsettled. Returns false when it can't land at all
     * (the stream isn't seekable), or null when the answer comes later from [landed].
     */
    fun start(targetMs: Long, seekable: Boolean): Boolean? {
        if (!seekable) {
            target = null
            return false
        }
        target = targetMs
        return null
    }

    /** Playback settled at [positionMs] (SEEK_ADJUSTMENT, READY or ENDED): the verdict for the pending seek, if any. */
    fun landed(positionMs: Long): Boolean? {
        val t = target ?: return null
        target = null
        return abs(positionMs - t) <= toleranceMs
    }

    fun clear() {
        target = null
    }

    companion object {
        /** A seek counts as landed when playback ends up this close to where it was asked to go. */
        const val TOLERANCE_MS = 5000L
    }
}
