package org.foxbloom.tv

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.media.MediaCodecList
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioCapabilities
import androidx.media3.exoplayer.util.EventLogger
import androidx.media3.ui.PlayerView
import java.util.Locale
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * The object the page sees as `window.FoxbloomAndroid` (AndroidBridge in tv/src/platform.ts): ExoPlayer drawn in
 * [playerView] under the transparent page, plus the device's name and leaving the app. Times are in milliseconds.
 *
 * JavaScript calls arrive on the WebView's bridge thread; everything touching the player hops to the main thread.
 * The player answers by calling `window.__foxbloomPlayer(event, arg)` (see tv/src/player/android.ts).
 */
@OptIn(UnstableApi::class)
class PlayerBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val playerView: PlayerView,
) {
    private val main = Handler(Looper.getMainLooper())

    // ---- main thread only ----
    private var player: ExoPlayer? = null
    /** Bumped on every open and close, so events from an older stream never reach the page. */
    private var generation = 0
    /** Where the page's last seek was aimed, until its discontinuity arrives. */
    private var seekTarget: Long? = null

    @JavascriptInterface
    fun open(url: String, startMs: Long) = onMain {
        release()
        val gen = ++generation
        val p = ExoPlayer.Builder(activity, DefaultRenderersFactory(activity).setEnableDecoderFallback(true))
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
                /* handleAudioFocus = */ true,
            )
            .build()
        player = p
        p.addListener(Events(gen))
        // Debug builds log tracks, selections and errors to logcat (tag EventLogger).
        if (activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) p.addAnalyticsListener(EventLogger())
        playerView.player = p
        playerView.visibility = View.VISIBLE
        // Starting at startMs is part of preparing, so the first READY is already at the start point.
        p.setMediaItem(MediaItem.fromUri(url), maxOf(0L, startMs))
        p.playWhenReady = false // the page calls play() once open has resolved
        p.prepare()
    }

    @JavascriptInterface
    fun play() = onMain { player?.playWhenReady = true }

    @JavascriptInterface
    fun pause() = onMain { player?.playWhenReady = false }

    @JavascriptInterface
    fun seek(ms: Long) = onMain {
        val p = player ?: return@onMain
        val target = maxOf(0L, ms)
        seekTarget = target
        p.seekTo(target)
    }

    @JavascriptInterface
    fun time(): Long = fromMain(0L) { player?.currentPosition ?: 0L }

    @JavascriptInterface
    fun duration(): Long = fromMain(0L) {
        val d = player?.duration ?: C.TIME_UNSET
        if (d == C.TIME_UNSET) 0L else d
    }

    /** `[{"index":n,"language":"xx"}]`, the file's audio tracks in file order; `index` is what setAudio takes. */
    @JavascriptInterface
    fun audioTracks(): String = fromMain("[]") {
        audioTrackList().mapIndexed { i, t -> "{\"index\":$i,\"language\":\"${jsonEscape(t.language)}\"}" }
            .joinToString(",", "[", "]")
    }

    @JavascriptInterface
    fun setAudio(index: Int) = onMain {
        val p = player ?: return@onMain
        val t = audioTrackList().getOrNull(index) ?: return@onMain
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false)
            .setOverrideForType(TrackSelectionOverride(t.group, t.trackInGroup))
            .build()
    }

    @JavascriptInterface
    fun close() = onMain {
        generation++
        release()
    }

    @JavascriptInterface
    fun caps(): String {
        val decoders = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
            .filter { !it.isEncoder }
            .flatMap { info -> info.supportedTypes.map { it.lowercase() } }
            .toSet()
        val audio = AudioCapabilities.getCapabilities(activity, AudioAttributes.DEFAULT, null)
        val passthrough = buildSet {
            if (audio.supportsEncoding(C.ENCODING_AC3)) add("ac3")
            if (audio.supportsEncoding(C.ENCODING_E_AC3)) add("eac3")
            if (audio.supportsEncoding(C.ENCODING_DTS)) add("dts")
        }
        return capsJson(decoders, passthrough)
    }

    @JavascriptInterface
    fun model(): String = Build.MANUFACTURER + " " + Build.MODEL

    @JavascriptInterface
    fun exit() = onMain { activity.finish() }

    /** The app went to the background (Home): stop playing; the page resumes with play(). */
    fun onStop() = onMain { player?.playWhenReady = false }

    /** The activity is going away. */
    fun destroy() = onMain {
        generation++
        release()
    }

    private class AudioTrack(val group: TrackGroup, val trackInGroup: Int, val language: String)

    private fun audioTrackList(): List<AudioTrack> {
        val p = player ?: return emptyList()
        val out = ArrayList<AudioTrack>()
        for (g in p.currentTracks.groups) {
            if (g.type != C.TRACK_TYPE_AUDIO) continue
            for (i in 0 until g.length) out.add(AudioTrack(g.mediaTrackGroup, i, g.getTrackFormat(i).language ?: ""))
        }
        return out
    }

    private fun release() {
        seekTarget = null
        player?.release()
        player = null
        playerView.player = null
        playerView.visibility = View.GONE
        activity.window.decorView.keepScreenOn = false
    }

    private fun emit(event: String, arg: String) {
        webView.evaluateJavascript("window.__foxbloomPlayer&&window.__foxbloomPlayer('$event','${jsString(arg)}')", null)
    }

    /** Player events for the stream of one open(); silent once a newer open or a close has happened. */
    private inner class Events(private val gen: Int) : Player.Listener {
        private var ready = false
        private val current get() = gen == generation

        override fun onPlaybackStateChanged(state: Int) {
            if (!current) return
            when (state) {
                Player.STATE_BUFFERING -> if (ready) emit("buffering", "1")
                Player.STATE_READY -> if (!ready) {
                    ready = true
                    emit("ready", "")
                } else {
                    emit("buffering", "0")
                }
                Player.STATE_ENDED -> emit("ended", "")
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            if (!current) return
            emit("error", error.errorCodeName)
        }

        override fun onPositionDiscontinuity(old: Player.PositionInfo, new: Player.PositionInfo, reason: Int) {
            if (!current || reason != Player.DISCONTINUITY_REASON_SEEK) return
            val target = seekTarget ?: return
            seekTarget = null
            emit("seeked", if (abs(new.positionMs - target) <= SEEK_TOLERANCE_MS) "1" else "0")
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (!current) return
            // The TV must not dim or start its screensaver mid-film.
            activity.window.decorView.keepScreenOn = isPlaying
        }
    }

    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
    }

    /** Runs [block] on the main thread and waits for its answer (the page's getters are synchronous). */
    private fun <T> fromMain(fallback: T, block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        val task = FutureTask(block)
        main.post(task)
        return try {
            task.get(1, TimeUnit.SECONDS)
        } catch (_: Exception) {
            fallback
        }
    }

    companion object {
        /** A seek counts as landed when the player ends up this close to where it was asked to go. */
        const val SEEK_TOLERANCE_MS = 5000L

        /** [s] escaped for a JSON string (also safe inside a JavaScript string). */
        fun jsonEscape(s: String): String = buildString {
            for (c in s) when {
                c == '"' -> append("\\\"")
                c == '\\' -> append("\\\\")
                c < ' ' || c.code == 0x2028 || c.code == 0x2029 -> append(String.format(Locale.ROOT, "\\u%04x", c.code))
                else -> append(c)
            }
        }

        /** [s] escaped for a single-quoted JavaScript string. */
        fun jsString(s: String): String = jsonEscape(s).replace("'", "\\'")
    }
}
