package org.foxbloom.tv

import org.junit.Assert.assertEquals
import org.junit.Test

class CapsTest {
    /** The caps JSON as field -> value (it is a flat object of booleans). */
    private fun fields(json: String): Map<String, Boolean> {
        val body = json.trim().removePrefix("{").removeSuffix("}")
        return body.split(",").associate { pair ->
            val (k, v) = pair.split(":")
            k.trim().removeSurrounding("\"") to v.trim().toBooleanStrict()
        }
    }

    @Test fun hevcButNoAv1OrDolby() {
        val c = fields(capsJson(setOf("video/avc", "video/hevc"), emptySet()))
        assertEquals(true, c["h264"])
        assertEquals(true, c["hevc"])
        assertEquals(false, c["av1"])
        assertEquals(false, c["vp9"])
        assertEquals(false, c["ac3"])
        assertEquals(false, c["eac3"])
        assertEquals(false, c["dts"])
    }

    @Test fun containersAlwaysOn() {
        val c = fields(capsJson(emptySet(), emptySet()))
        for (k in listOf("mp4", "mkv", "webm")) assertEquals(k, true, c[k])
        assertEquals(false, c["h264"])
    }

    // ExoPlayer has no FLAC/Opus/AAC/MP3 decoder of its own (without extensions): each needs the platform's.
    @Test fun audioCodecsFollowTheDecoders() {
        val none = fields(capsJson(emptySet(), emptySet()))
        for (k in listOf("aac", "mp3", "opus", "flac")) assertEquals(k, false, none[k])
        val all = fields(capsJson(setOf("audio/mp4a-latm", "audio/mpeg", "audio/opus", "audio/flac"), emptySet()))
        for (k in listOf("aac", "mp3", "opus", "flac")) assertEquals(k, true, all[k])
    }

    @Test fun noFlacOnOldAndroid() {
        val c = fields(capsJson(setOf("video/avc", "audio/mp4a-latm", "audio/mpeg", "audio/opus"), emptySet()))
        assertEquals(false, c["flac"])
        assertEquals(true, c["opus"])
    }

    @Test fun eac3Passthrough() {
        val c = fields(capsJson(setOf("video/avc"), setOf("eac3")))
        assertEquals(true, c["eac3"])
        assertEquals(false, c["ac3"])
    }

    @Test fun ac3Decoder() {
        val c = fields(capsJson(setOf("video/avc", "audio/ac3"), emptySet()))
        assertEquals(true, c["ac3"])
        assertEquals(false, c["eac3"])
    }

    @Test fun dtsFromDecoderOrPassthrough() {
        assertEquals(true, fields(capsJson(setOf("audio/vnd.dts"), emptySet()))["dts"])
        assertEquals(true, fields(capsJson(emptySet(), setOf("dts")))["dts"])
    }

    @Test fun av1AndVp9() {
        val c = fields(capsJson(setOf("video/av01", "video/x-vnd.on2.vp9"), emptySet()))
        assertEquals(true, c["av1"])
        assertEquals(true, c["vp9"])
    }
}
