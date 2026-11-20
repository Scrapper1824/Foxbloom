package org.foxbloom.tv

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class KeysTest {
    @Test fun backIsTizenBack() = assertEquals(10009, tizenKeyCode(KeyEvent.KEYCODE_BACK))
    @Test fun play() = assertEquals(415, tizenKeyCode(KeyEvent.KEYCODE_MEDIA_PLAY))
    @Test fun pause() = assertEquals(19, tizenKeyCode(KeyEvent.KEYCODE_MEDIA_PAUSE))
    @Test fun playPause() = assertEquals(10252, tizenKeyCode(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
    @Test fun fastForward() = assertEquals(417, tizenKeyCode(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD))
    @Test fun rewind() = assertEquals(412, tizenKeyCode(KeyEvent.KEYCODE_MEDIA_REWIND))
    @Test fun dpadGoesToTheWebView() = assertNull(tizenKeyCode(KeyEvent.KEYCODE_DPAD_UP))
}
