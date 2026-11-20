package org.foxbloom.tv

import android.view.KeyEvent

/**
 * The Samsung (Tizen) keyCode the TV web app expects for an Android remote key, or null for keys the WebView
 * already delivers itself (D-pad, OK, digits) and keys the app doesn't use.
 */
fun tizenKeyCode(androidKeyCode: Int): Int? = when (androidKeyCode) {
    KeyEvent.KEYCODE_BACK -> 10009
    KeyEvent.KEYCODE_MEDIA_PLAY -> 415
    KeyEvent.KEYCODE_MEDIA_PAUSE -> 19
    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> 10252
    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> 417
    KeyEvent.KEYCODE_MEDIA_REWIND -> 412
    else -> null
}
