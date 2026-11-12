package com.mundymorning.touchrecipe.ui.screens

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavController
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.importer.WebRecipeExtractor
import com.mundymorning.touchrecipe.core.model.*
import com.mundymorning.touchrecipe.core.rescue.Rescue
import com.mundymorning.touchrecipe.core.rescue.RescueDraft
import com.mundymorning.touchrecipe.core.rescue.RescueState
import com.mundymorning.touchrecipe.data.ImageLoader
import com.mundymorning.touchrecipe.data.PdfPages
import com.mundymorning.touchrecipe.ui.Routes
import com.mundymorning.touchrecipe.ui.components.*
import com.mundymorning.touchrecipe.ui.theme.BodyFont
import com.mundymorning.touchrecipe.ui.theme.DisplayFont
import com.mundymorning.touchrecipe.ui.theme.Palette
import com.mundymorning.touchrecipe.ui.vmOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.text.DateFormat
import java.util.Date

// ---------------------------------------------------------------------------------------------------------------------
// Recipe Rescue: the original on one side, the recipe on the other. Temporary code-drawn visuals throughout; see
// docs/ART_WIRING.md for the artwork slots this screen will take.
// ---------------------------------------------------------------------------------------------------------------------

/** Turns the import that is waiting for review into an unfinished recipe, so it can be repaired now or later. */
fun draftFromImport(c: AppContainer): RescueDraft? {
    val d = c.importSession.draft.value ?: return null
    val src = (if (d.source.isEmpty) OriginalSource(if (d.recipe.rawSource.isNullOrBlank()) SourceKind.NONE else SourceKind.TEXT, d.recipe.sourceUrl, emptyList(), d.recipe.rawSource.orEmpty(), c.clock()) else d.source)
        .let { it.copy(text = it.text.take(300_000)) }
    val draft = RescueDraft(
        // the raw text lives once, in the source, not in every undo step
        recipe = d.recipe.copy(photo = c.importSession.photoFile ?: d.recipe.photo, rawSource = null), source = src,
        findings = d.warnings.filter { it.severity != Severity.INFO }.map { it.message } + d.unplaced.map { "Found in the original but not placed: $it" },
        imageCandidates = d.imageCandidates,
        createdAt = c.clock(), updatedAt = c.clock(),
    )
    c.drafts.save(draft); c.importSession.clear()
    return draft
}

/** A page that would not import by link can still be opened here and read from the screen the user is looking at. */
fun draftForPage(c: AppContainer, url: String): RescueDraft =
    RescueDraft(recipe = Recipe(sourceUrl = url), source = OriginalSource(SourceKind.WEB, url, capturedAt = c.clock()), createdAt = c.clock(), updatedAt = c.clock()).also { c.drafts.save(it) }

class RescueViewModel(private val c: AppContainer, private val draftId: String) : ViewModel() {
    val state = MutableStateFlow<RescueState?>(null)
    val missing = MutableStateFlow(false)
    private val pending = MutableStateFlow<RescueDraft?>(null)
    private var closed = false

    init {
        val d = c.drafts.get(draftId)
        if (d == null) missing.value = true else state.value = RescueState(d)
        // every change is written a moment later; flush() writes at once when the screen is left or the app is stopped
        viewModelScope.launch(Dispatchers.IO) { pending.collectLatest { d2 -> if (d2 != null) { delay(300); if (!closed) c.drafts.save(d2) } } }
    }

    fun update(f: (RescueState) -> RescueState) {
        val s = state.value ?: return
        val n = f(s)
        if (n == s) return
        val out = if (n.draft != s.draft) n.copy(draft = n.draft.copy(updatedAt = c.clock())) else n
        state.value = out
        if (out.draft != s.draft) pending.value = out.draft
    }

    fun flush() { if (!closed) state.value?.let { c.drafts.save(it.draft) } }
    override fun onCleared() { flush() }

    /** Sends text from the original into one field. Returns what happened, in words, for the user. */
    fun transfer(target: String, text: String): String {
        val before = state.value?.recipe ?: return ""
        update { st -> when (target) {
            "ingredients" -> Rescue.addIngredients(st, text); "steps" -> Rescue.addSteps(st, text); "title" -> Rescue.setTitle(st, text); "notes" -> Rescue.addNotes(st, text)
            "servings" -> Rescue.setServings(st, text); "prep", "cook", "total" -> Rescue.setTime(st, target, text); "description" -> Rescue.setDescription(st, text); else -> st
        } }
        val after = state.value!!.recipe
        return when {
            after == before -> "Nothing in the selected text could be used there."
            target == "ingredients" -> (after.ingredients.size - before.ingredients.size).let { "Added $it ingredient line${if (it == 1) "" else "s"}." }
            target == "steps" -> (after.directions.size - before.directions.size).let { "Added $it step${if (it == 1) "" else "s"}." }
            target == "title" -> "Title set."
            target == "notes" -> "Added to the notes."
            target == "servings" -> "Servings set to ${after.servings}."
            target == "description" -> "Description set."
            else -> "Time set."
        }
    }

    /** Saves the finished recipe. A new import becomes a new recipe; a repair updates the recipe it was opened from. */
    fun saveRecipe(onDone: (String) -> Unit) {
        val d = state.value?.draft ?: return
        viewModelScope.launch {
            val r = Rescue.cleaned(d.recipe).let { it.copy(rawSource = d.source.text.take(60_000).ifBlank { null }, sourceUrl = it.sourceUrl ?: d.source.url) }
            val saved = c.repo.saveRecipe(if (d.recipeId != null) r.copy(id = d.recipeId) else r)
            c.originals.link(saved.id, d.source, d.helpNotes)   // the original and any open questions stay with the recipe
            closed = true; pending.value = null
            c.drafts.delete(d.id)
            onDone(saved.id)
        }
    }

    /** Deletes the draft. Its original files go too unless a saved recipe still uses them. */
    fun deleteDraft() {
        val d = state.value?.draft ?: return
        closed = true; pending.value = null
        c.drafts.delete(d.id)
        c.originals.deleteUnreferenced(d.source.allFiles, c.drafts)
    }
}

private fun Context.findActivity(): Activity? { var x: Context? = this; while (x is ContextWrapper) { if (x is Activity) return x; x = x.baseContext }; return null }

private val fieldText = TextStyle(fontFamily = BodyFont, fontSize = 17.sp, lineHeight = 23.sp, color = Palette.Ink)
private val paneHead = TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Palette.Forest)

/** A text field that hands its text over when it is left or when Done is pressed: one edit, one undo step. */
@Composable
private fun CommitField(
    value: String, onCommit: (String) -> Unit, modifier: Modifier = Modifier, hint: String = "", style: TextStyle = fieldText,
    singleLine: Boolean = false, keyboardType: KeyboardType = KeyboardType.Text, tag: String? = null, label: String? = null,
) {
    var text by remember(value) { mutableStateOf(value) }
    var focused by remember { mutableStateOf(false) }
    val commit by rememberUpdatedState(onCommit)
    val shape = RoundedCornerShape(8.dp)
    BasicTextField(
        text, { text = it },
        modifier.then(if (tag != null) Modifier.testTag(tag) else Modifier).semantics { if (label != null) contentDescription = label }
            .onFocusChanged { f -> if (focused && !f.isFocused && text != value) commit(text); focused = f.isFocused },
        textStyle = style, singleLine = singleLine, cursorBrush = SolidColor(Palette.Tomato),
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = if (singleLine) ImeAction.Done else ImeAction.Default),
        keyboardActions = KeyboardActions(onDone = { if (text != value) commit(text) }),
        decorationBox = { inner ->
            Box(Modifier.fillMaxWidth().clip(shape).background(Color(0xFFFBF4E6)).border(1.dp, Palette.Brass.copy(alpha = 0.6f), shape).padding(horizontal = 10.dp, vertical = 9.dp)) {
                if (text.isEmpty()) Text(hint, style = style, color = Palette.Ink.copy(alpha = 0.4f))
                inner()
            }
        },
    )
}

@Composable
private fun SmallButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, tag: String? = null, enabled: Boolean = true, strong: Boolean = false) {
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier.heightIn(min = 48.dp).clip(shape).background(if (strong) Palette.Forest else Color(0xFFFBF4E6)).border(1.5.dp, if (enabled) Palette.Brass else Palette.Brass.copy(alpha = 0.3f), shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).then(if (tag != null) Modifier.testTag(tag) else Modifier).padding(horizontal = 12.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = (if (strong) Palette.Cream else Palette.Ink).copy(alpha = if (enabled) 1f else 0.4f), fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1) }
}

@Composable
private fun CheckMark(on: Boolean) {
    Box(Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).border(2.dp, Palette.Forest, RoundedCornerShape(6.dp)).background(if (on) Palette.Forest else Color.Transparent), contentAlignment = Alignment.Center) {
        if (on) Text("✓", color = Palette.Cream, fontSize = 15.sp, fontWeight = FontWeight.Bold)
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The original (left side)
// ---------------------------------------------------------------------------------------------------------------------

/** Reads the text currently selected in the page. The value arrives as a JSON string literal. */
private fun WebView.selectedText(onText: (String) -> Unit) {
    evaluateJavascript("(function(){var s=window.getSelection();return s?s.toString():'';})()") { v ->
        onText(runCatching { (Json.parseToJsonElement(v ?: "\"\"") as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty() }.getOrDefault(""))
    }
}

@Composable
private fun ZoomableImage(bmp: Bitmap, pins: List<HelpNote>, modifier: Modifier, onLongPress: ((Float, Float) -> Unit)?) {
    var scale by remember(bmp) { mutableFloatStateOf(1f) }
    var offset by remember(bmp) { mutableStateOf(Offset.Zero) }
    Box(
        modifier.clipToBounds().background(Color(0xFF3A342B)).pointerInput(bmp) {
            detectTransformGestures { _, pan, zoom, _ ->
                scale = (scale * zoom).coerceIn(1f, 6f)
                val o = offset + pan
                offset = Offset(o.x.coerceIn(-size.width * scale, size.width * scale), o.y.coerceIn(-size.height * scale * 3f, size.height * scale))
            }
        },
        contentAlignment = Alignment.TopCenter,
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(bmp.width.toFloat() / bmp.height.coerceAtLeast(1)).graphicsLayer { scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y }
                .pointerInput(bmp, onLongPress) {
                    detectTapGestures(
                        onDoubleTap = { scale = if (scale > 1f) 1f else 2.5f; offset = Offset.Zero },
                        onLongPress = { p -> onLongPress?.invoke((p.x / size.width).coerceIn(0f, 1f), (p.y / size.height).coerceIn(0f, 1f)) },
                    )
                },
        ) {
            Image(bmp.asImageBitmap(), "The original", Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds)
            pins.forEachIndexed { i, n ->
                Box(Modifier.align(BiasAlignment((n.x ?: 0.5f) * 2f - 1f, (n.y ?: 0.5f) * 2f - 1f)).size(26.dp).clip(CircleShape).background(Color(0xFFFFD23F)).border(2.dp, Palette.Ink, CircleShape).semantics { contentDescription = "Question ${i + 1}: ${n.text}" }, contentAlignment = Alignment.Center) {
                    Text("?", fontWeight = FontWeight.ExtraBold, color = Palette.Ink, fontSize = 14.sp)
                }
            }
        }
    }
}

/**
 * Shows the original: the page, PDF or photo itself, and the text read from it as selectable lines.
 * With [onTransfer] it also offers the buttons that send the selection into the recipe; without it the pane is read-only.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OriginalPane(
    c: AppContainer, source: OriginalSource, helpNotes: List<HelpNote>, modifier: Modifier = Modifier,
    onTransfer: ((String, String) -> String)? = null, onAskAbout: ((Int, Float, Float) -> Unit)? = null, onReadPage: ((String, String?) -> Unit)? = null,
    onEditSource: ((OriginalSource) -> Unit)? = null, onCover: ((String) -> Unit)? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val lines = remember(source.text) { source.lines }
    val hasVisual = source.files.any { c.originals.exists(it) } || (source.kind == SourceKind.WEB && source.url != null)
    var tab by rememberSaveable { mutableIntStateOf(if (hasVisual && (source.kind == SourceKind.IMAGE || source.kind == SourceKind.PDF || lines.isEmpty())) 0 else 1) }
    var picked by rememberSaveable { mutableStateOf(setOf<Int>()) }
    var editFirst by rememberSaveable { mutableStateOf(source.kind == SourceKind.IMAGE) }
    var pending by remember { mutableStateOf<Pair<String, String>?>(null) }
    var more by remember { mutableStateOf(false) }
    var web by remember { mutableStateOf<WebView?>(null) }
    var page by rememberSaveable { mutableIntStateOf(0) }
    var savedCopy by rememberSaveable { mutableStateOf(source.url == null) }
    var showCleaned by rememberSaveable { mutableStateOf(true) }
    var cropPage by remember { mutableStateOf<Bitmap?>(null) }      // the photo as taken, opened for marking the card's corners
    var cropDish by remember { mutableStateOf<Bitmap?>(null) }      // the page as shown, opened for cutting out the dish photo
    var confirmReread by remember { mutableStateOf<Bitmap?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun send(target: String, text: String) {
        if (text.isBlank()) { scope.launch { snack.say(if (tab == 1) "Tap one or more lines on the left first." else "Select some text in the page first.") }; return }
        if (editFirst) pending = target to text
        else { val msg = onTransfer?.invoke(target, text).orEmpty(); picked = emptySet(); if (msg.isNotEmpty()) scope.launch { snack.say(msg) } }
    }
    fun transfer(target: String) {
        if (tab == 1) send(target, picked.sorted().mapNotNull { lines.getOrNull(it) }.joinToString("\n"))
        else if (source.kind == SourceKind.WEB) web?.selectedText { t -> send(target, t) } ?: send(target, "")
        else scope.launch { snack.say("Switch to Text, tap the lines you want, then choose where they go.") }
    }

    Column(modifier.background(Color(0xFFEDE3CF))) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Original", style = paneHead, modifier = Modifier.semantics { heading() })
            Spacer(Modifier.weight(1f))
            if (hasVisual) Chip(when (source.kind) { SourceKind.WEB -> "Page"; SourceKind.PDF -> "PDF"; else -> "Picture" }, tab == 0, { tab = 0 }, Modifier.testTag("orig-tab-visual"))
            Chip("Text", tab == 1, { tab = 1 }, Modifier.testTag("orig-tab-text"))
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (tab == 1) {
                if (lines.isEmpty()) Text("No text was read from the original. ${if (hasVisual) "Look at it under ${if (source.kind == SourceKind.WEB) "Page" else "Picture"} and type what you see on the right." else "Type the recipe on the right."}", Modifier.padding(16.dp), style = fieldText)
                else LazyColumn(Modifier.fillMaxSize().testTag("orig-lines"), state = rememberLazyListState(), contentPadding = PaddingValues(bottom = 8.dp)) {
                    itemsIndexed(lines) { i, line ->
                        val on = i in picked
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 44.dp).background(if (on) Color(0xFFFFF1C2) else Color.Transparent)
                                .toggleable(on, enabled = onTransfer != null, role = Role.Checkbox, onValueChange = { picked = if (on) picked - i else picked + i }).padding(horizontal = 10.dp, vertical = 5.dp).testTag("orig-line:$i"),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (onTransfer != null) { CheckMark(on); Spacer(Modifier.width(10.dp)) }
                            Text(line, style = fieldText)
                        }
                    }
                }
            } else when (source.kind) {
                SourceKind.WEB -> {
                    val snapshot = source.files.firstOrNull { c.originals.exists(it) }?.let { c.originals.file(it) }
                    Column(Modifier.fillMaxSize()) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (source.url != null) Chip("Live page", !savedCopy, { savedCopy = false })
                            if (snapshot != null) Chip("Saved copy", savedCopy, { savedCopy = true })
                            if (onReadPage != null) TextButton({ web?.evaluateJavascript("document.documentElement.outerHTML") { v ->
                                val html = runCatching { (Json.parseToJsonElement(v ?: "\"\"") as? JsonPrimitive)?.content.orEmpty() }.getOrDefault("")
                                if (html.length < 200) scope.launch { snack.say("The page hasn't finished loading yet.") } else onReadPage(html, web?.url ?: source.url)
                            } }, Modifier.testTag("orig-read-page")) { Text("Read recipe from this page", color = Palette.Forest) }
                        }
                        key(savedCopy) {
                            AndroidView(modifier = Modifier.fillMaxSize().testTag("orig-web"), factory = { ctx ->
                                WebView(ctx).apply {
                                    settings.allowFileAccess = false; settings.allowContentAccess = false
                                    settings.builtInZoomControls = true; settings.displayZoomControls = false
                                    settings.loadWithOverviewMode = true; settings.useWideViewPort = true
                                    webViewClient = WebViewClient()
                                    if (!savedCopy && source.url != null) { settings.javaScriptEnabled = true; settings.domStorageEnabled = true; loadUrl(source.url) }
                                    else if (snapshot != null) { settings.javaScriptEnabled = true; loadDataWithBaseURL(source.url, runCatching { snapshot.readText() }.getOrDefault(""), "text/html", "utf-8", null) }
                                    web = this
                                }
                            }, onRelease = { if (web === it) web = null; it.destroy() })
                        }
                    }
                }
                SourceKind.IMAGE, SourceKind.PDF -> {
                    val pdf = source.kind == SourceKind.PDF
                    val files = source.files.filter { c.originals.exists(it) }
                    val hasCleaned = !pdf && source.cleaned.getOrNull(page)?.let { it.isNotBlank() && c.originals.exists(it) } == true
                    // a photograph has two faces: exactly as taken, and straightened for reading. Neither replaces the other.
                    val name = if (pdf) files.firstOrNull() else (if (showCleaned && hasCleaned) source.cleaned[page] else source.files.getOrNull(page))?.takeIf { c.originals.exists(it) }
                    val pageCount by produceState(if (pdf) 0 else source.files.size, files, pdf) { if (pdf) value = files.firstOrNull()?.let { PdfPages.pageCount(c.originals.file(it)) } ?: 0 }
                    val bmp by produceState<Bitmap?>(null, name, page, pdf) {
                        value = null
                        value = if (name == null) null else if (pdf) PdfPages.renderPage(c.originals.file(name), page)
                        else withContext(Dispatchers.IO) { ImageLoader.decode(context, Uri.fromFile(c.originals.file(name)), 2400) }
                    }
                    Column(Modifier.fillMaxSize()) {
                        val shown = bmp
                        if (shown != null) ZoomableImage(shown, helpNotes.filter { !it.resolved && it.x != null && it.page == page }, Modifier.weight(1f).fillMaxWidth().testTag("orig-image"), onAskAbout?.let { ask -> { x: Float, y: Float -> ask(page, x, y) } })
                        else Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Text(if (name == null) "The original file is no longer stored. The text read from it is under Text." else "Opening the original…", Modifier.padding(16.dp), style = fieldText) }
                        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (pageCount > 1) {
                                TextButton({ page = (page - 1).coerceAtLeast(0) }, enabled = page > 0) { Text("‹ Previous") }
                                Text("${page + 1} of $pageCount", Modifier.weight(1f), style = fieldText.copy(fontSize = 14.sp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                                TextButton({ page = (page + 1).coerceAtMost(pageCount - 1) }, enabled = page < pageCount - 1) { Text("Next ›") }
                            } else Text("Pinch to zoom, double-tap to enlarge${if (onAskAbout != null) ", press and hold to leave a question" else ""}.", Modifier.weight(1f).padding(vertical = 6.dp), style = fieldText.copy(fontSize = 13.sp), color = Palette.Ink.copy(alpha = 0.75f))
                        }
                        if (!pdf) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (hasCleaned) { Chip("Straightened", showCleaned, { showCleaned = true }, Modifier.testTag("orig-cleaned")); Chip("As photographed", !showCleaned, { showCleaned = false }, Modifier.testTag("orig-as-taken")) }
                            if (onEditSource != null && !busy) {
                                TextButton({ scope.launch { val f = source.files.getOrNull(page); cropPage = if (f == null) null else withContext(Dispatchers.IO) { ImageLoader.decode(context, Uri.fromFile(c.originals.file(f)), 2400) } } }, Modifier.testTag("orig-straighten")) { Text(if (hasCleaned) "Adjust the crop" else "Straighten and crop", color = Palette.Forest) }
                                if (shown != null) TextButton({ confirmReread = shown }, Modifier.testTag("orig-reread")) { Text("Read the text again", color = Palette.Forest) }
                            }
                            if (onCover != null && shown != null && !busy) TextButton({ cropDish = shown }, Modifier.testTag("orig-dish")) { Text("Cut out the dish photo", color = Palette.Forest) }
                            if (busy) Text("Working…", style = fieldText.copy(fontSize = 13.sp))
                        }
                    }
                }
                else -> Text("No original is stored for this recipe.", Modifier.padding(16.dp), style = fieldText)
            }
        }
        if (onTransfer != null) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (tab == 1) "${picked.size} selected" else "Send the selection to:", Modifier.weight(1f), style = fieldText.copy(fontSize = 13.sp))
                if (tab == 1 && lines.isNotEmpty()) TextButton({ picked = if (picked.size == lines.size) emptySet() else lines.indices.toSet() }, Modifier.testTag("orig-select-all")) { Text(if (picked.size == lines.size) "Clear" else "Select all", color = Palette.Forest) }
                Row(Modifier.toggleable(editFirst, role = Role.Checkbox, onValueChange = { editFirst = it }).heightIn(min = 44.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    CheckMark(editFirst); Spacer(Modifier.width(6.dp)); Text("Correct first", style = fieldText.copy(fontSize = 13.sp))
                }
            }
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                SmallButton("+ Ingredients", { transfer("ingredients") }, tag = "transfer:ingredients", strong = true)
                SmallButton("+ Steps", { transfer("steps") }, tag = "transfer:steps", strong = true)
                SmallButton("Title", { transfer("title") }, tag = "transfer:title")
                SmallButton("+ Notes", { transfer("notes") }, tag = "transfer:notes")
                SmallButton("More…", { more = true }, tag = "transfer:more")
            }
        }
    }

    if (more) ModalBottomSheet({ more = false }) {
        Column(Modifier.padding(20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Send the selection to", style = MaterialTheme.typography.headlineSmall)
            listOf("servings" to "Servings", "prep" to "Preparation time", "cook" to "Cooking time", "total" to "Total time", "description" to "Description").forEach { (k, label) ->
                BigButton(label, { more = false; transfer(k) }, Modifier.fillMaxWidth().testTag("transfer:$k"), primary = false)
            }
        }
    }
    pending?.let { (target, text) ->
        var edited by remember(target, text) { mutableStateOf(text) }
        AlertDialog({ pending = null }, title = { Text("Check before adding") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Correct anything that was read wrongly. ${if (target == "ingredients" || target == "steps") "Each line becomes one ${if (target == "steps") "step" else "ingredient"}." else ""}")
                OutlinedTextField(edited, { edited = it }, Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 300.dp).testTag("transfer-edit"))
            } },
            confirmButton = { TextButton({ val msg = onTransfer?.invoke(target, edited).orEmpty(); pending = null; picked = emptySet(); if (msg.isNotEmpty()) scope.launch { snack.say(msg) } }, Modifier.testTag("transfer-confirm")) { Text("Add") } },
            dismissButton = { TextButton({ pending = null }) { Text("Cancel") } })
    }

    cropPage?.let { photo ->
        CropDialog(photo, remember(photo) { com.mundymorning.touchrecipe.data.PageImageTools.findDocument(photo) ?: com.mundymorning.touchrecipe.core.image.Region(0.05f, 0.05f, 0.95f, 0.95f).toQuad() },
            "Straighten and crop", "Drag the four corners onto the corners of the card or page. The photo as you took it is kept unchanged.", rectangle = false, offerSharpen = true,
            onFindEdges = { com.mundymorning.touchrecipe.data.PageImageTools.findDocument(photo) }, onDismiss = { cropPage = null },
            onApply = { q, sharpen ->
                cropPage = null; busy = true
                scope.launch {
                    val saved = withContext(Dispatchers.Default) { runCatching { c.originals.saveBytes(com.mundymorning.touchrecipe.data.PageImageTools.jpeg(com.mundymorning.touchrecipe.data.PageImageTools.enhance(com.mundymorning.touchrecipe.data.PageImageTools.warp(photo, q), sharpen)), "jpg") }.getOrNull() }
                    busy = false
                    if (saved == null) snack.say("That crop couldn't be made. Try moving the corners.") else {
                        val list = MutableList(source.files.size) { i -> source.cleaned.getOrNull(i).orEmpty() }
                        val old = list.getOrNull(page).orEmpty(); if (page in list.indices) list[page] = saved
                        onEditSource?.invoke(source.copy(cleaned = list)); showCleaned = true
                        if (old.isNotBlank()) c.originals.file(old).delete()   // only the previous straightened copy; never the photo itself
                        snack.say("Straightened. Use Read the text again to re-read it.")
                    }
                }
            })
    }
    cropDish?.let { shownPage ->
        CropDialog(shownPage, remember(shownPage) { (com.mundymorning.touchrecipe.data.PageImageTools.findDishPhoto(shownPage) ?: com.mundymorning.touchrecipe.core.image.Region(0.15f, 0.12f, 0.85f, 0.55f)).toQuad() },
            "Cut out the dish photo", "Drag the corners around the picture of the finished dish. It becomes the recipe's cover; the page itself is not changed.", rectangle = true, offerSharpen = false,
            onDismiss = { cropDish = null },
            onApply = { q, _ ->
                cropDish = null; busy = true
                scope.launch {
                    val bytes = withContext(Dispatchers.Default) { runCatching { com.mundymorning.touchrecipe.data.PageImageTools.jpeg(com.mundymorning.touchrecipe.data.PageImageTools.crop(shownPage, com.mundymorning.touchrecipe.core.image.Region(q.tl.x, q.tl.y, q.br.x, q.br.y)), 92) }.getOrNull() }
                    val cover = bytes?.let { c.photos.saveBytes(it) }
                    busy = false
                    if (cover == null) snack.say("That picture couldn't be cut out.") else {
                        val kept = bytes?.let { b -> c.originals.saveBytes(b, "jpg") }; val old = source.dishPhoto
                        if (kept != null) { onEditSource?.invoke(source.copy(dishPhoto = kept)); if (old != null) c.originals.file(old).delete() }
                        onCover?.invoke(cover); snack.say("Set as the recipe's cover picture.")
                    }
                }
            })
    }
    confirmReread?.let { picture ->
        ConfirmDialog("Read the text again?", "The text on the left is replaced by a fresh reading of this picture${if (source.files.size > 1) " (added below the other pages' text)" else ""}. The recipe on the right is not changed.", "Read again",
            onDismiss = { confirmReread = null }, onConfirm = {
                confirmReread = null; busy = true
                scope.launch {
                    val text = runCatching { com.mundymorning.touchrecipe.core.importer.LayoutReader.read(c.ocr.recognizeLines(picture, page)) }.getOrDefault("")
                    busy = false
                    if (text.isBlank()) snack.say("No text could be read from this picture.") else { onEditSource?.invoke(source.copy(text = if (source.files.size > 1) source.text + "\n\n" + text else text)); picked = emptySet(); tab = 1 }
                }
            })
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The recipe (right side)
// ---------------------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditorPane(c: AppContainer, vm: RescueViewModel, s: RescueState, modifier: Modifier) {
    val r = s.recipe
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    var rowMenu by remember { mutableStateOf<String?>(null) }
    var helpFor by remember { mutableStateOf<String?>(null) }
    var photoMenu by remember { mutableStateOf(false) }
    var candidateIndex by rememberSaveable { mutableIntStateOf(0) }
    val pickers = rememberPhotoPickers({ uri -> scope.launch { c.photos.saveFromUri(uri)?.let { f -> vm.update { st -> Rescue.setPhoto(st, f) } } ?: snack.say("That photo couldn't be used.") } }, { scope.launch { snack.say(it) } })
    val numbers = remember(r.directions) { var n = 0; r.directions.map { if (it.header) 0 else ++n } }

    @Composable fun selectBox(key: String) {
        if (s.selecting) Box(Modifier.size(48.dp).toggleable(key in s.selection, role = Role.Checkbox, onValueChange = { vm.update { st -> Rescue.toggle(st, key) } }).testTag("select:$key"), contentAlignment = Alignment.Center) { CheckMark(key in s.selection) }
    }
    @Composable fun flag(key: String) {
        val open = Rescue.helpFor(s, key)
        if (open.isNotEmpty()) Box(Modifier.size(40.dp).clickable(onClickLabel = "Show the question", role = Role.Button) { helpFor = key }.semantics { contentDescription = "Needs help: ${open.first().text}" }.testTag("help-flag:$key"), contentAlignment = Alignment.Center) {
            Box(Modifier.size(26.dp).clip(CircleShape).background(Color(0xFFFFD23F)).border(2.dp, Palette.Ink, CircleShape), contentAlignment = Alignment.Center) { Text("?", fontWeight = FontWeight.ExtraBold, color = Palette.Ink, fontSize = 14.sp) }
        }
    }

    LazyColumn(modifier.testTag("rescue-editor"), state = rememberLazyListState(), contentPadding = PaddingValues(start = 10.dp, end = 10.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        item(key = "head") { Text(if (s.draft.recipeId != null) "Your recipe" else "Touch Recipe", style = paneHead, modifier = Modifier.padding(top = 4.dp).semantics { heading() }) }
        if (s.draft.findings.isNotEmpty()) item(key = "findings") {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0xFFFFE9A8)).padding(10.dp).testTag("rescue-findings")) {
                Text("The import check found:", fontWeight = FontWeight.Bold, color = Palette.Ink)
                s.draft.findings.take(8).forEach { Text("• $it", style = fieldText.copy(fontSize = 14.sp, lineHeight = 19.sp)) }
                if (s.draft.findings.size > 8) Text("…and ${s.draft.findings.size - 8} more", style = fieldText.copy(fontSize = 14.sp))
                TextButton({ vm.update { st -> st.copy(draft = st.draft.copy(findings = emptyList())) } }) { Text("Hide this list", color = Palette.Forest) }
            }
        }
        item(key = "title") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                selectBox(Rescue.TITLE)
                CommitField(r.title, { v -> vm.update { st -> Rescue.setTitle(st, v) } }, Modifier.weight(1f), hint = "Recipe title", style = fieldText.copy(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 28.sp), tag = "rescue-title", label = "Recipe title")
                flag(Rescue.TITLE)
            }
        }
        item(key = "photo") {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                selectBox(Rescue.PHOTO)
                if (r.photo != null) PhotoImage(c.photos, r.photo, Modifier.size(96.dp, 72.dp).clip(RoundedCornerShape(10.dp)), r.title, description = "Recipe picture")
                SmallButton(if (r.photo == null) "Add a picture" else "Change picture", { photoMenu = true }, tag = "rescue-photo")
            }
        }
        item(key = "meta") {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                selectBox(Rescue.SERVINGS)
                Column(Modifier.weight(1f)) { Text("Servings", fontSize = 12.sp, color = Palette.Ink); CommitField(r.servings?.toString().orEmpty(), { v -> vm.update { st -> if (v.isBlank()) Rescue.clearServings(st) else Rescue.setServings(st, v) } }, singleLine = true, keyboardType = KeyboardType.Number, hint = "—", tag = "rescue-servings", label = "Servings") }
                selectBox(Rescue.TIMES)
                listOf(Triple("prep", "Prep min", r.prepMinutes), Triple("cook", "Cook min", r.cookMinutes), Triple("total", "Total min", r.totalMinutes)).forEach { (k, label, v) ->
                    Column(Modifier.weight(1f)) { Text(label, fontSize = 12.sp, color = Palette.Ink, maxLines = 1); CommitField(v?.toString().orEmpty(), { t -> vm.update { st -> Rescue.setTime(st, k, t) } }, singleLine = true, keyboardType = KeyboardType.Number, hint = "—", tag = "rescue-$k", label = label) }
                }
            }
        }
        item(key = "ing-head") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Ingredients (${r.ingredients.count { !it.header }})", Modifier.weight(1f).semantics { heading() }, style = paneHead)
                TextButton({ vm.update { st -> Rescue.edit(st) { x -> x.copy(ingredients = x.ingredients + Ingredient(text = "")) } } }, Modifier.testTag("rescue-add-ingredient")) { Text("+ Add line", color = Palette.Forest) }
            }
        }
        if (r.ingredients.isEmpty()) item(key = "ing-empty") { Text("No ingredients yet. Select them in the original and tap + Ingredients, or add a line.", style = fieldText.copy(fontSize = 14.sp), color = Palette.Ink.copy(alpha = 0.7f)) }
        itemsIndexed(r.ingredients, key = { _, i -> "i:" + i.id }) { _, ing ->
            Row(Modifier.testTag("rescue-ing:${ing.id}"), verticalAlignment = Alignment.CenterVertically) {
                selectBox(ing.id)
                CommitField(ing.text, { v -> vm.update { st -> Rescue.editIngredient(st, ing.id, v) } }, Modifier.weight(1f), hint = "Ingredient", style = if (ing.header) fieldText.copy(fontWeight = FontWeight.Bold, color = Palette.Forest) else fieldText, label = if (ing.header) "Ingredient heading" else "Ingredient")
                flag(ing.id)
                Box(Modifier.size(44.dp).clickable(onClickLabel = "Line options", role = Role.Button) { rowMenu = ing.id }.semantics { contentDescription = "Options for ${ing.text.ifBlank { "this line" }}" }.testTag("row-menu:${ing.id}"), contentAlignment = Alignment.Center) { Text("⋮", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Palette.Ink) }
            }
        }
        item(key = "dir-head") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Steps (${r.directions.count { !it.header }})", Modifier.weight(1f).semantics { heading() }, style = paneHead)
                TextButton({ vm.update { st -> Rescue.edit(st) { x -> x.copy(directions = x.directions + Direction(text = "")) } } }, Modifier.testTag("rescue-add-step")) { Text("+ Add step", color = Palette.Forest) }
            }
        }
        if (r.directions.isEmpty()) item(key = "dir-empty") { Text("No steps yet. Select them in the original and tap + Steps, or add a step.", style = fieldText.copy(fontSize = 14.sp), color = Palette.Ink.copy(alpha = 0.7f)) }
        itemsIndexed(r.directions, key = { _, d -> "d:" + d.id }) { i, d ->
            Row(Modifier.testTag("rescue-step:${d.id}"), verticalAlignment = Alignment.Top) {
                selectBox(d.id)
                if (!d.header) Box(Modifier.padding(top = 6.dp, end = 6.dp).size(28.dp).clip(CircleShape).background(Palette.Forest), contentAlignment = Alignment.Center) { Text("${numbers.getOrElse(i) { 0 }}", color = Palette.Cream, fontSize = 13.sp, lineHeight = 13.sp, fontWeight = FontWeight.Bold) }
                CommitField(d.text, { v -> vm.update { st -> Rescue.editStep(st, d.id, v) } }, Modifier.weight(1f), hint = "Describe this step", style = if (d.header) fieldText.copy(fontWeight = FontWeight.Bold, color = Palette.Forest) else fieldText, label = if (d.header) "Step heading" else "Step")
                flag(d.id)
                Box(Modifier.size(44.dp).clickable(onClickLabel = "Step options", role = Role.Button) { rowMenu = d.id }.semantics { contentDescription = "Options for this step" }.testTag("row-menu:${d.id}"), contentAlignment = Alignment.Center) { Text("⋮", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Palette.Ink) }
            }
        }
        item(key = "notes") {
            Column {
                Text("Notes", style = paneHead, modifier = Modifier.semantics { heading() })
                Row(verticalAlignment = Alignment.Top) {
                    selectBox(Rescue.NOTES)
                    CommitField(r.notes, { v -> vm.update { st -> Rescue.setNotes(st, v) } }, Modifier.weight(1f).heightIn(min = 72.dp), hint = "Notes, tips, where it came from", tag = "rescue-notes", label = "Notes")
                    flag(Rescue.NOTES)
                }
            }
        }
        if (s.draft.helpNotes.isNotEmpty()) item(key = "questions") {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0xFFFFF1C2)).padding(10.dp).testTag("rescue-questions")) {
                Text("Questions for the family (${s.draft.openQuestions} open)", fontWeight = FontWeight.Bold, color = Palette.Ink)
                s.draft.helpNotes.forEach { q ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(48.dp).toggleable(q.resolved, role = Role.Checkbox, onValueChange = { v -> vm.update { st -> Rescue.resolveHelp(st, q.id, v) } }).semantics { contentDescription = "Answered" }.testTag("question-done:${q.id}"), contentAlignment = Alignment.Center) { CheckMark(q.resolved) }
                        Text(q.text, Modifier.weight(1f), style = fieldText.copy(fontSize = 15.sp, textDecoration = if (q.resolved) androidx.compose.ui.text.style.TextDecoration.LineThrough else null))
                        TextButton({ vm.update { st -> Rescue.deleteHelp(st, q.id) } }) { Text("Remove", color = Palette.Tomato) }
                    }
                }
                Text("Tick a question once it is answered. Open questions stay with the recipe when you save it.", style = fieldText.copy(fontSize = 13.sp), color = Palette.Ink.copy(alpha = 0.75f))
            }
        }
    }

    rowMenu?.let { id ->
        val isIng = r.ingredients.any { it.id == id }
        val header = r.ingredients.firstOrNull { it.id == id }?.header ?: r.directions.firstOrNull { it.id == id }?.header ?: false
        ModalBottomSheet({ rowMenu = null }) {
            Column(Modifier.padding(20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (isIng) "Ingredient line" else "Step", style = MaterialTheme.typography.headlineSmall)
                BigButton("Needs family help…", { rowMenu = null; helpFor = id }, Modifier.fillMaxWidth().testTag("row-help"))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BigButton("Move up", { vm.update { st -> Rescue.move(st, id, -1) } }, Modifier.weight(1f), primary = false)
                    BigButton("Move down", { vm.update { st -> Rescue.move(st, id, 1) } }, Modifier.weight(1f), primary = false)
                }
                BigButton(if (header) "Make it a normal line" else "Make it a section heading", { rowMenu = null; vm.update { st -> Rescue.toggleHeader(st, id) } }, Modifier.fillMaxWidth(), primary = false)
                BigButton("Select this and others…", { rowMenu = null; vm.update { st -> Rescue.toggle(st, id) } }, Modifier.fillMaxWidth(), primary = false)
                BigButton("Remove this line", { rowMenu = null; vm.update { st -> Rescue.delete(st, id) }; scope.launch { snack.undoable("Line removed") { vm.update { st -> Rescue.undo(st) } } } }, Modifier.fillMaxWidth().testTag("row-delete"), primary = false)
            }
        }
    }
    helpFor?.let { key ->
        val existing = Rescue.helpFor(s, key).firstOrNull()
        var text by remember(key) { mutableStateOf(existing?.text.orEmpty()) }
        AlertDialog({ helpFor = null }, title = { Text("Needs family help") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Write what needs checking. It stays with this recipe until you tick it off. Nothing is guessed for you.")
                OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth().testTag("help-text"), placeholder = { Text("Ask Mom whether this says 1 cup or 1/2 cup.") })
            } },
            confirmButton = { TextButton({ vm.update { st -> if (existing != null) Rescue.editHelp(st, existing.id, text) else Rescue.addHelp(st, key, text) }; helpFor = null }, Modifier.testTag("help-save")) { Text("Keep") } },
            dismissButton = { Row { if (existing != null) TextButton({ vm.update { st -> Rescue.resolveHelp(st, existing.id) }; helpFor = null }) { Text("Answered") }; TextButton({ helpFor = null }) { Text("Cancel") } } })
    }
    if (photoMenu) ModalBottomSheet({ photoMenu = false }) {
        Column(Modifier.padding(20.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Recipe picture", style = MaterialTheme.typography.headlineSmall)
            val firstImage = s.draft.source.files.firstOrNull { s.draft.source.kind == SourceKind.IMAGE && c.originals.exists(it) }
            if (firstImage != null) BigButton("Use the original photo", { photoMenu = false; scope.launch { c.photos.saveBytes(withContext(Dispatchers.IO) { c.originals.file(firstImage).readBytes() })?.let { f -> vm.update { st -> Rescue.setPhoto(st, f) } } ?: snack.say("That picture couldn't be used.") } }, Modifier.fillMaxWidth())
            BigButton("Choose from gallery", { photoMenu = false; pickers.gallery() }, Modifier.fillMaxWidth(), primary = firstImage == null)
            BigButton("Take a photo", { photoMenu = false; pickers.camera() }, Modifier.fillMaxWidth(), primary = false)
            val others = s.draft.imageCandidates
            if (others.size > 1 || (others.size == 1 && r.photo == null)) BigButton("Try another picture from the page", { photoMenu = false; scope.launch {
                candidateIndex = (candidateIndex + 1) % others.size
                c.importer.fetchPhoto(listOf(others[candidateIndex]), s.draft.source.url)?.let { f -> vm.update { st -> Rescue.setPhoto(st, f) } } ?: snack.say("That picture couldn't be downloaded.")
            } }, Modifier.fillMaxWidth().testTag("rescue-next-picture"), primary = false)
            if (r.photo != null) BigButton("Remove picture", { photoMenu = false; vm.update { st -> Rescue.setPhoto(st, null) } }, Modifier.fillMaxWidth(), primary = false)
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RescueScreen(c: AppContainer, nav: NavController, draftId: String) {
    val vm = vmOf("rescue-$draftId") { RescueViewModel(c, draftId) }
    val st by vm.state.collectAsState()
    val missing by vm.missing.collectAsState()
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val clipboard = LocalClipboardManager.current
    val owner = LocalLifecycleOwner.current
    var menu by remember { mutableStateOf(false) }
    var freshOpen by remember { mutableStateOf(false) }
    var pasteOpen by remember { mutableStateOf(false) }
    var replaceOpen by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var confirmUpdate by remember { mutableStateOf(false) }
    var pagePlan by remember { mutableStateOf<Rescue.PastePlan?>(null) }
    var pinAt by remember { mutableStateOf<Triple<Int, Float, Float>?>(null) }
    var split by rememberSaveable { mutableFloatStateOf(0.42f) }

    // this screen alone may turn sideways: the artwork pages stay upright
    DisposableEffect(Unit) {
        val activity = context.findActivity()
        val before = activity?.requestedOrientation
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_USER
        onDispose { vm.flush(); activity?.requestedOrientation = before ?: ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
    }
    // leaving the app in any way writes the draft at once
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_STOP || e == Lifecycle.Event.ON_PAUSE) vm.flush() }
        owner.lifecycle.addObserver(obs); onDispose { owner.lifecycle.removeObserver(obs) }
    }
    fun leave() { focus.clearFocus(); vm.flush(); nav.popBackStack() }
    BackHandler { leave() }

    if (missing) { UtilityPage("Recipe Rescue", { nav.popBackStack() }) { Text("This unfinished recipe is no longer here. It may have been saved or deleted.") }; return }
    val s = st ?: return

    fun save() {
        focus.clearFocus()
        val now = vm.state.value ?: return
        val problems = Rescue.problems(now.recipe)
        if (problems.isNotEmpty()) { scope.launch { snack.say(problems.first()) }; return }
        if (now.draft.recipeId != null && !confirmUpdate) { confirmUpdate = true; return }
        confirmUpdate = false
        vm.saveRecipe { id -> nav.navigate(Routes.detail(id)) { popUpTo(Routes.HUB) }; scope.launch { snack.say(if (now.draft.recipeId != null) "Recipe updated" else "Saved to your collection") } }
    }

    Box(Modifier.fillMaxSize().background(Palette.Parchment).semantics { paneTitle = "Recipe Rescue" }) {
        BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout)).imePadding()) {
            val wide = maxWidth > maxHeight
            val totalPx = with(LocalDensity.current) { maxHeight.toPx() }.coerceAtLeast(1f)
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().background(Palette.CreamDeep.copy(alpha = 0.8f)).padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClickLabel = "Leave; your work is kept", role = Role.Button) { leave() }.semantics { contentDescription = "Back" }.testTag("rescue-back"), contentAlignment = Alignment.Center) { Text("←", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Palette.Ink) }
                    Text("Recipe Rescue", Modifier.weight(1f).semantics { heading() }, style = paneHead.copy(fontSize = 19.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    SmallButton("Undo", { focus.clearFocus(); vm.update { x -> Rescue.undo(x) } }, tag = "rescue-undo", enabled = s.canUndo)
                    SmallButton("Redo", { vm.update { x -> Rescue.redo(x) } }, tag = "rescue-redo", enabled = s.canRedo)
                    SmallButton(if (s.selecting) "Done" else "Select", { vm.update { x -> if (x.selecting) Rescue.cancelSelection(x) else Rescue.startSelecting(x) } }, tag = "rescue-select")
                    Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClickLabel = "More", role = Role.Button) { menu = true }.semantics { contentDescription = "More" }.testTag("rescue-more"), contentAlignment = Alignment.Center) { Text("⋯", fontSize = 24.sp, color = Palette.Ink) }
                }
                val original: @Composable (Modifier) -> Unit = { m ->
                    OriginalPane(c, s.draft.source, s.draft.helpNotes, m,
                        onTransfer = { target, text -> vm.transfer(target, text) },
                        onAskAbout = { p, x, y -> pinAt = Triple(p, x, y) },
                        onEditSource = { src -> vm.update { x -> x.copy(draft = x.draft.copy(source = src)) } },
                        onCover = { name -> vm.update { x -> Rescue.setPhoto(x, name) } },
                        onReadPage = { html, url ->
                            val d = WebRecipeExtractor.extract(html, url); val r = d.recipe
                            // keep what the page showed, so it can be compared offline next time
                            vm.update { x -> if (x.draft.source.text.isBlank()) x.copy(draft = x.draft.copy(source = x.draft.source.copy(text = Rescue.pageText(html).take(300_000)))) else x }
                            if (r.ingredients.isEmpty() && r.directions.isEmpty()) scope.launch { snack.say("No recipe could be read from this page. Select the text you want and send it across instead.") }
                            else pagePlan = Rescue.PastePlan(r.title, r.ingredients, r.directions, r.servings, r.prepMinutes, r.cookMinutes, r.totalMinutes, r.notes, d.unplaced)
                        })
                }
                if (wide) Row(Modifier.weight(1f).fillMaxWidth()) {
                    original(Modifier.weight(1f).fillMaxHeight())
                    Box(Modifier.fillMaxHeight().width(3.dp).background(Palette.Brass))
                    EditorPane(c, vm, s, Modifier.weight(1f).fillMaxHeight())
                } else Column(Modifier.weight(1f).fillMaxWidth()) {
                    original(Modifier.weight(split).fillMaxWidth())
                    // drag the bar to give either side more room
                    Box(Modifier.fillMaxWidth().height(22.dp).background(Palette.Brass.copy(alpha = 0.85f))
                        .draggable(rememberDraggableState { dy -> split = (split + dy / totalPx).coerceIn(0.15f, 0.8f) }, Orientation.Vertical)
                        .clickable(onClickLabel = "Change how the screen is shared", role = Role.Button) { split = when { split < 0.3f -> 0.42f; split < 0.5f -> 0.62f; else -> 0.22f } }
                        .semantics { contentDescription = "Divider. Drag or tap to resize." }.testTag("rescue-divider"), contentAlignment = Alignment.Center) { Text("• • •", color = Palette.Cream, fontSize = 12.sp) }
                    EditorPane(c, vm, s, Modifier.weight(1f - split).fillMaxWidth())
                }
                if (s.selecting) Row(Modifier.fillMaxWidth().background(Palette.CreamDeep.copy(alpha = 0.9f)).horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    SmallButton("Remove selected (${s.selection.size})", { vm.update { x -> Rescue.removeSelected(x) }; scope.launch { snack.undoable("Removed") { vm.update { x -> Rescue.undo(x) } } } }, tag = "rescue-remove-selected", enabled = s.selection.isNotEmpty(), strong = s.selection.isNotEmpty())
                    SmallButton("Replace selected…", { replaceOpen = true }, tag = "rescue-replace-selected", enabled = s.selection.any { k -> !k.startsWith("f:") })
                    SmallButton("All ingredients", { vm.update { x -> Rescue.selectAllIngredients(x) } }, tag = "rescue-all-ingredients")
                    SmallButton("All steps", { vm.update { x -> Rescue.selectAllSteps(x) } }, tag = "rescue-all-steps")
                    SmallButton("Cancel", { vm.update { x -> Rescue.cancelSelection(x) } }, tag = "rescue-cancel-selection")
                } else Row(Modifier.fillMaxWidth().background(Palette.CreamDeep.copy(alpha = 0.9f)).padding(horizontal = 8.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SmallButton("Save for later", { leave(); scope.launch { snack.say("Kept in Unfinished Recipes") } }, Modifier.weight(1f), tag = "rescue-later")
                    SmallButton(if (s.draft.recipeId != null) "Update recipe" else "Save recipe", { save() }, Modifier.weight(1f), tag = "rescue-save", strong = true)
                }
            }
        }
    }

    if (menu) ModalBottomSheet({ menu = false }) {
        Column(Modifier.padding(20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Recipe Rescue", style = MaterialTheme.typography.headlineSmall)
            BigButton("Smart Paste…", { menu = false; pasteOpen = true }, Modifier.fillMaxWidth().testTag("rescue-paste"), primary = false)
            BigButton("Add a question for the family…", { menu = false; pinAt = Triple(0, -1f, -1f) }, Modifier.fillMaxWidth(), primary = false)
            BigButton("Start fresh…", { menu = false; freshOpen = true }, Modifier.fillMaxWidth().testTag("rescue-fresh"), primary = false)
            BigButton("Delete this unfinished recipe…", { menu = false; confirmDelete = true }, Modifier.fillMaxWidth(), primary = false)
            Text("Your work is saved automatically. Turn the phone sideways to see the original and the recipe side by side.", style = MaterialTheme.typography.bodySmall)
        }
    }
    if (freshOpen) {
        val fields = listOf(Rescue.TITLE to "Title", Rescue.PHOTO to "Picture", Rescue.SERVINGS to "Servings", Rescue.TIMES to "Times", Rescue.INGREDIENTS to "Ingredients", Rescue.DIRECTIONS to "Steps", Rescue.NOTES to "Notes")
        var keep by remember { mutableStateOf(setOf<String>()) }
        AlertDialog({ freshOpen = false }, title = { Text("Start fresh?") },
            text = { Column {
                Text("This clears the recipe fields so you can rebuild them from the original. The original is not touched, and Undo brings everything back.")
                Text("Keep:", Modifier.padding(top = 8.dp), fontWeight = FontWeight.Bold)
                fields.forEach { (k, label) ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).toggleable(k in keep, role = Role.Checkbox, onValueChange = { keep = if (k in keep) keep - k else keep + k }).testTag("fresh-keep:$k"), verticalAlignment = Alignment.CenterVertically) { CheckMark(k in keep); Spacer(Modifier.width(10.dp)); Text(label) }
                }
            } },
            confirmButton = { TextButton({ freshOpen = false; vm.update { x -> Rescue.startFresh(x, keep) }; scope.launch { snack.undoable("Fields cleared") { vm.update { x -> Rescue.undo(x) } } } }, Modifier.testTag("fresh-confirm")) { Text("Clear the rest") } },
            dismissButton = { TextButton({ freshOpen = false }) { Text("Cancel") } })
    }
    if (pasteOpen) {
        var text by remember { mutableStateOf("") }
        var plan by remember { mutableStateOf<Rescue.PastePlan?>(null) }
        AlertDialog({ pasteOpen = false }, title = { Text("Smart Paste") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val p = plan
                if (p == null) {
                    Text("Paste recipe text from anywhere. You will see what would be added before anything changes.")
                    OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 260.dp).testTag("paste-text"))
                    TextButton({ text = clipboard.getText()?.text.orEmpty() }) { Text("Paste from clipboard") }
                } else if (p.isEmpty) Text("Nothing usable was found in that text.")
                else {
                    Text("This would be added:", fontWeight = FontWeight.Bold)
                    if (p.title.isNotBlank()) Text("Title: ${p.title}${if (s.recipe.title.isNotBlank()) " (not used: the recipe already has a title)" else ""}")
                    Text("${p.ingredients.count { !it.header }} ingredient lines, ${p.directions.count { !it.header }} steps", Modifier.testTag("paste-summary"))
                    p.ingredients.take(4).forEach { Text("• ${it.text}", fontSize = 14.sp) }
                    if (p.ingredients.size > 4) Text("…", fontSize = 14.sp)
                    listOfNotNull(p.servings?.let { "serves $it" }, p.prep?.let { "prep $it min" }, p.cook?.let { "cook $it min" }).takeIf { it.isNotEmpty() }?.let { Text(it.joinToString(", ")) }
                    Text("Fields that already have a value are left as they are.", fontSize = 13.sp)
                }
            } },
            confirmButton = {
                val p = plan
                if (p == null) TextButton({ plan = Rescue.planSmartPaste(text) }, Modifier.testTag("paste-preview"), enabled = text.isNotBlank()) { Text("Preview") }
                else TextButton({ if (!p.isEmpty) vm.update { x -> Rescue.applySmartPaste(x, p) }; pasteOpen = false }, Modifier.testTag("paste-apply")) { Text(if (p.isEmpty) "Close" else "Add to recipe") }
            },
            dismissButton = { TextButton({ pasteOpen = false }) { Text("Cancel") } })
    }
    pagePlan?.let { p ->
        AlertDialog({ pagePlan = null }, title = { Text("Read from the page") },
            text = { Text("Found ${p.ingredients.count { !it.header }} ingredient lines and ${p.directions.count { !it.header }} steps${if (p.title.isNotBlank()) " for “${p.title}”" else ""}. Add them to the recipe? Fields that already have a value are left as they are.") },
            confirmButton = { TextButton({ vm.update { x -> Rescue.applySmartPaste(x, p) }; pagePlan = null }) { Text("Add to recipe") } },
            dismissButton = { TextButton({ pagePlan = null }) { Text("Cancel") } })
    }
    if (replaceOpen) {
        var text by remember { mutableStateOf("") }
        AlertDialog({ replaceOpen = false }, title = { Text("Replace the selected lines") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Type or paste what should stand there instead. Each line becomes one entry, in the same place.")
                OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 260.dp).testTag("replace-text"))
                TextButton({ text = clipboard.getText()?.text.orEmpty() }) { Text("Paste from clipboard") }
            } },
            confirmButton = { TextButton({ replaceOpen = false; vm.update { x -> Rescue.replaceSelected(x, text) } }, Modifier.testTag("replace-confirm"), enabled = text.isNotBlank()) { Text("Replace") } },
            dismissButton = { TextButton({ replaceOpen = false }) { Text("Cancel") } })
    }
    pinAt?.let { (p, x, y) ->
        var text by remember { mutableStateOf("") }
        AlertDialog({ pinAt = null }, title = { Text("Question for the family") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (x >= 0f) "A marker will be left at this spot on the original." else "The question is kept with this recipe until you tick it off.")
                OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth().testTag("pin-text"), placeholder = { Text("What does this word say?") })
            } },
            confirmButton = { TextButton({ vm.update { st2 -> if (x >= 0f) Rescue.addHelp(st2, "source", text, p, x, y) else Rescue.addHelp(st2, "recipe", text) }; pinAt = null }, Modifier.testTag("pin-save"), enabled = text.isNotBlank()) { Text("Keep") } },
            dismissButton = { TextButton({ pinAt = null }) { Text("Cancel") } })
    }
    if (confirmDelete) ConfirmDialog("Delete this unfinished recipe?", "The work on it is removed, and so is the stored copy of its original unless a saved recipe uses it. This cannot be undone.", "Delete", destructive = true,
        onDismiss = { confirmDelete = false }, onConfirm = { confirmDelete = false; vm.deleteDraft(); nav.popBackStack() })
    if (confirmUpdate) ConfirmDialog("Update the saved recipe?", "“${s.recipe.title}” in your collection will be replaced by this repaired version.", "Update",
        onDismiss = { confirmUpdate = false }, onConfirm = { save() })
}

// ---------------------------------------------------------------------------------------------------------------------
// Unfinished Recipes and the stored original of a saved recipe
// ---------------------------------------------------------------------------------------------------------------------

private fun megabytes(bytes: Long) = if (bytes < 1024 * 1024) "${(bytes / 1024).coerceAtLeast(if (bytes > 0) 1 else 0)} KB" else "%.1f MB".format(bytes / 1048576.0)

@Composable
fun UnfinishedScreen(c: AppContainer, nav: NavController) {
    val tick by c.drafts.changes.collectAsState()
    val drafts = remember(tick) { c.drafts.all() }
    var deleting by remember { mutableStateOf<RescueDraft?>(null) }
    UtilityPage("Unfinished Recipes", { nav.popBackStack() }) {
        if (drafts.isEmpty()) Text("Nothing is waiting. When an import needs more work, choose Save for later and it will be kept here with its original.", Modifier.testTag("unfinished-empty"))
        drafts.forEach { d ->
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceVariant).clickable(onClickLabel = "Continue this recipe", role = Role.Button) { nav.navigate(Routes.rescue(d.id)) }.padding(14.dp).testTag("unfinished:${d.id}")) {
                Text(d.recipe.title.ifBlank { "Untitled recipe" }, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("${d.recipe.ingredients.count { !it.header }} ingredients · ${d.recipe.directions.count { !it.header }} steps" + (if (d.openQuestions > 0) " · ${d.openQuestions} question${if (d.openQuestions == 1) "" else "s"} open" else ""), style = MaterialTheme.typography.bodyMedium)
                Text(listOfNotNull(when (d.source.kind) { SourceKind.WEB -> "From a web page"; SourceKind.PDF -> "From a PDF"; SourceKind.IMAGE -> "From a photo or scan"; SourceKind.TEXT -> "From pasted text"; else -> null },
                    if (d.recipeId != null) "repair of a saved recipe" else null, "last worked on " + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(d.updatedAt))).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                Row { TextButton({ nav.navigate(Routes.rescue(d.id)) }) { Text("Continue") }; TextButton({ deleting = d }) { Text("Delete", color = MaterialTheme.colorScheme.error) } }
            }
        }
        HorizontalDivider()
        Text("Stored originals (page copies, PDFs, photos and scans) use ${megabytes(c.originals.bytesUsed())} on this phone. They are only removed when you delete them: here for unfinished recipes, or under View the original on a saved recipe.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("originals-usage"))
    }
    deleting?.let { d ->
        ConfirmDialog("Delete “${d.recipe.title.ifBlank { "Untitled recipe" }}”?", "The unfinished work is removed, and so is the stored copy of its original (${megabytes(c.originals.bytesOf(d.source.allFiles))}) unless a saved recipe uses it. This cannot be undone.", "Delete", destructive = true,
            onDismiss = { deleting = null }, onConfirm = { c.drafts.delete(d.id); c.originals.deleteUnreferenced(d.source.allFiles, c.drafts); deleting = null })
    }
}

/** The original kept with a saved recipe, read-only, with the control to remove the stored copy. */
@Composable
fun OriginalScreen(c: AppContainer, nav: NavController, recipeId: String) {
    val tick by c.originals.changes.collectAsState()
    val o = remember(recipeId, tick) { c.originals.forRecipe(recipeId) }
    var confirm by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().background(Palette.Parchment).semantics { paneTitle = "Original" }) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout))) {
            Row(Modifier.fillMaxWidth().background(Palette.CreamDeep.copy(alpha = 0.8f)).padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClickLabel = "Go back", role = Role.Button) { nav.popBackStack() }.semantics { contentDescription = "Back" }.testTag("original-back"), contentAlignment = Alignment.Center) { Text("←", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Palette.Ink) }
                Text("The original", Modifier.weight(1f), style = paneHead)
                if (o != null && o.source.files.isNotEmpty()) TextButton({ confirm = true }, Modifier.testTag("original-remove")) { Text("Remove stored copy", color = Palette.Tomato) }
            }
            if (o == null || o.source.isEmpty) Text("No original is stored for this recipe.", Modifier.padding(20.dp), style = fieldText)
            else OriginalPane(c, o.source, o.helpNotes, Modifier.weight(1f).fillMaxWidth())
        }
    }
    if (confirm && o != null) ConfirmDialog("Remove the stored original?", "The copy kept on this phone (${megabytes(c.originals.bytesOf(o.source.allFiles))}) is deleted. The recipe itself, its text and its web address are kept. This cannot be undone.", "Remove", destructive = true,
        onDismiss = { confirm = false }, onConfirm = { confirm = false; c.originals.link(recipeId, o.source.copy(files = emptyList(), cleaned = emptyList(), dishPhoto = null), o.helpNotes); c.originals.deleteUnreferenced(o.source.allFiles, c.drafts) })
}
