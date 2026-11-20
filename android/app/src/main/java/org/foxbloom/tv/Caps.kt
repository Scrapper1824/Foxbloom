package org.foxbloom.tv

/**
 * What this device plays without conversion, as the JSON the page reads from `FoxbloomAndroid.caps()` (TvCaps in
 * tv/src/player/caps.ts, minus switchesAudio/forceConvert which the page adds).
 *
 * @param decoders MIME types of the device's decoders (MediaCodecList, REGULAR_CODECS).
 * @param passthrough encodings the audio output passes through to an amplifier: "ac3", "eac3", "dts".
 */
fun capsJson(decoders: Set<String>, passthrough: Set<String>): String {
    val fields = linkedMapOf(
        // ExoPlayer reads these containers itself.
        "mp4" to true,
        "mkv" to true,
        "webm" to true,
        "h264" to ("video/avc" in decoders),
        "hevc" to ("video/hevc" in decoders),
        "av1" to ("video/av01" in decoders),
        "vp9" to ("video/x-vnd.on2.vp9" in decoders),
        // ExoPlayer decodes audio with the device's decoders: FLAC only from Android 8.1 or so, Opus from 5.0.
        "aac" to ("audio/mp4a-latm" in decoders),
        "mp3" to ("audio/mpeg" in decoders),
        "opus" to ("audio/opus" in decoders),
        "flac" to ("audio/flac" in decoders),
        "ac3" to ("audio/ac3" in decoders || "ac3" in passthrough),
        "eac3" to ("audio/eac3" in decoders || "eac3" in passthrough),
        "dts" to ("audio/vnd.dts" in decoders || "dts" in passthrough),
    )
    return fields.entries.joinToString(",", "{", "}") { (k, v) -> "\"$k\":$v" }
}
