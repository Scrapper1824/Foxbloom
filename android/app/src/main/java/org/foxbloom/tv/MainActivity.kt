package org.foxbloom.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader

/** The whole app: a full-screen WebView showing the TV web app (tv/dist, bundled in the APK's assets). */
class MainActivity : Activity() {
    private lateinit var root: FrameLayout
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)

        // Serves the bundled page from a real https origin (localStorage, fetch and modules behave as on a site).
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            // The page is https (appassets) but Foxbloom servers on the home network are plain http.
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            // The page is laid out for 1920x1080: scale it so 1920 CSS px is exactly the screen width (720p, 1080p, 4K).
            setInitialScale(resources.displayMetrics.widthPixels * 100 / PAGE_WIDTH)
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            // Transparent so a video surface underneath can show through.
            setBackgroundColor(Color.TRANSPARENT)
            addJavascriptInterface(createBridge(), "FoxbloomAndroid")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)

                // The app never navigates away from its own page; links to anywhere else are dropped.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.host != WebViewAssetLoader.DEFAULT_DOMAIN
            }
        }

        root = FrameLayout(this)
        root.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        webView.loadUrl(START_URL)
    }

    /** The object the page sees as `window.FoxbloomAndroid` (see AndroidBridge in tv/src/platform.ts). */
    private fun createBridge(): Any = AppBridge(this)

    /**
     * Back and the media keys become the Samsung key codes the page already handles (it decides what Back does,
     * including closing the app at its first screen). D-pad, OK and digits reach the WebView as usual.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = tizenKeyCode(event.keyCode) ?: return super.dispatchKeyEvent(event)
        // Holding Back must not pop screen after screen; a held fast-forward or rewind repeats like on Samsung.
        if (event.action == KeyEvent.ACTION_DOWN && (event.repeatCount == 0 || event.keyCode != KeyEvent.KEYCODE_BACK)) {
            webView.evaluateJavascript(keyDownScript(code), null)
        }
        return true
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        root.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val PAGE_WIDTH = 1920
        const val START_URL = "https://" + WebViewAssetLoader.DEFAULT_DOMAIN + "/assets/web/index.html"

        /**
         * A page keydown carrying a Samsung keyCode, sent to the focused element. Chromium ignores `keyCode` in the
         * KeyboardEvent constructor, so keyCode and which are defined on the event itself.
         */
        fun keyDownScript(keyCode: Int): String =
            "(function(c){var e=new KeyboardEvent('keydown',{bubbles:true,cancelable:true});" +
                "Object.defineProperty(e,'keyCode',{get:function(){return c}});" +
                "Object.defineProperty(e,'which',{get:function(){return c}});" +
                "(document.activeElement||document.body||document).dispatchEvent(e)})($keyCode)"
    }
}

/** The app-level part of the bridge: the device's name and leaving the app. */
class AppBridge(private val activity: Activity) {
    @JavascriptInterface
    fun model(): String = Build.MANUFACTURER + " " + Build.MODEL

    @JavascriptInterface
    fun exit() = activity.runOnUiThread { activity.finish() }
}
