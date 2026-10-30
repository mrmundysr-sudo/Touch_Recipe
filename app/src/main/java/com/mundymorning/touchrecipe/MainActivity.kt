package com.mundymorning.touchrecipe

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import com.mundymorning.touchrecipe.data.ImportInput
import com.mundymorning.touchrecipe.ui.TouchRecipeRoot

class MainActivity : ComponentActivity() {
    private val container get() = (application as TouchRecipeApplication).container

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (savedInstanceState == null) handleIntent(intent)
        setContent { TouchRecipeRoot(container, activity = this) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    /** "Import to Touch Recipe" (Android Share): text/links, images and PDFs go to the Import screen, never straight to the library. */
    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val input: ImportInput? = when (intent.action) {
            Intent.ACTION_SEND -> {
                val type = intent.type.orEmpty()
                val stream: Uri? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                when {
                    stream != null && type == "application/pdf" -> ImportInput.Pdf(stream)
                    stream != null && type.startsWith("image/") -> ImportInput.Image(stream)
                    stream != null -> ImportInput.File(stream, type)
                    !text.isNullOrBlank() -> container.importer.classify(text)
                    else -> null
                }
            }
            Intent.ACTION_VIEW -> intent.data?.let { if (it.scheme == "http" || it.scheme == "https") ImportInput.Url(it.toString()) else null }
            else -> null
        }
        if (input != null) { container.pendingShare.value = input; intent.action = null }
    }
}
