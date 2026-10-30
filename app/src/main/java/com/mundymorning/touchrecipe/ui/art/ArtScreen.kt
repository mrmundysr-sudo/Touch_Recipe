package com.mundymorning.touchrecipe.ui.art

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*
import com.mundymorning.touchrecipe.ui.theme.LocalGlowGuide
import com.mundymorning.touchrecipe.ui.theme.LocalReducedMotion
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.sin

val LocalArt = staticCompositionLocalOf<ArtLoader> { error("ArtLoader not provided") }

/** Decides whether a page's first-load illumination should play (persisted by the app; always once in tests). */
interface GlowController { fun shouldPlay(page: String): Boolean; fun played(page: String) }
val LocalGlowController = staticCompositionLocalOf<GlowController> {
    object : GlowController { private val seen = HashSet<String>(); override fun shouldPlay(page: String) = page !in seen; override fun played(page: String) { seen += page } }
}

private val Gold = Color(0xFFFFD27A)

/** Layout helpers for placing code-rendered content inside the artwork. 1 design px = 1 px of the 841-wide artwork. */
class ArtScope(val page: ArtPageData, val widthPx: Float, val heightPx: Float, val density: Density) {
    private val k get() = widthPx / 841f
    fun dp(designPx: Float): Dp = with(density) { (designPx * k).toDp() }
    fun sp(designPx: Float): TextUnit = (designPx * k / density.density).sp
    fun Modifier.region(r: NRect): Modifier = this
        .offset { androidx.compose.ui.unit.IntOffset((r.x * widthPx).toInt(), (r.y * heightPx).toInt()) }
        .size(with(density) { (r.w * widthPx).toDp() }, with(density) { (r.h * heightPx).toDp() })
    fun Modifier.region(name: String): Modifier = region(page.region(name))
    fun region(name: String) = page.region(name)
}

@Composable
fun ArtScreen(
    pageKey: String,
    title: String,
    modifier: Modifier = Modifier,
    enabled: (String) -> Boolean = { true },
    glowing: Set<String> = emptySet(),
    describe: (ArtTarget) -> String? = { null },
    onTarget: (String) -> Unit,
    content: @Composable ArtScope.() -> Unit = {},
) {
    val art = LocalArt.current
    val page = remember(pageKey) { art.manifest.page(pageKey) }
    val reduced = LocalReducedMotion.current
    val guide = LocalGlowGuide.current
    val controller = LocalGlowController.current
    val scope = rememberCoroutineScope()
    val onTargetState by rememberUpdatedState(onTarget)
    val enabledState by rememberUpdatedState(enabled)

    val glowTargets = remember(page) { page.targets.filter { it.glow } }
    val total = 520f + 120f * glowTargets.size
    val intro = remember(pageKey) { Animatable(0f) }
    var introPlaying by remember(pageKey) { mutableStateOf(false) }
    LaunchedEffect(pageKey, guide) {
        if (guide && glowTargets.isNotEmpty() && controller.shouldPlay(pageKey)) {
            introPlaying = true
            intro.snapTo(0f)
            intro.animateTo(1f, tween(if (reduced) 700 else total.toInt(), easing = LinearEasing))
            introPlaying = false
            controller.played(pageKey)
        }
    }
    val tap = remember(pageKey) { Animatable(0f) }
    var tapped by remember(pageKey) { mutableStateOf<String?>(null) }

    fun trigger(id: String) {
        if (!enabledState(id)) return
        scope.launch {
            tapped = id
            launch { tap.snapTo(1f); tap.animateTo(0f, tween(if (reduced) 250 else 520, easing = LinearEasing)) }
            delay(if (reduced) 0L else 130L)
            onTargetState(id)
        }
    }

    fun intensity(t: ArtTarget, index: Int): Float {
        var a = 0f
        if (introPlaying) {
            a = if (reduced) sin(PI * intro.value).toFloat() * 0.55f
            else { val local = ((intro.value * total - 120f * index) / 520f).coerceIn(0f, 1f); sin(PI * local).toFloat() }
        }
        if (tapped == t.id) a = maxOf(a, tap.value)
        if (t.id in glowing) a = maxOf(a, 0.7f)
        return a.coerceIn(0f, 1f)
    }

    Box(modifier.fillMaxSize().background(Color(page.bg.toInt())).semantics { paneTitle = title }) {
        BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout))) {
            val density = LocalDensity.current
            val availW = maxWidth; val availH = maxHeight
            val aspect = art.manifest.aspect
            val artW = minOf(availW, availH * aspect)
            val artH = artW / aspect
            val widthPx = with(density) { artW.toPx() }; val heightPx = with(density) { artH.toPx() }
            val scroll = rememberScrollState()
            Box(Modifier.fillMaxSize().imePadding()) {
                Column(Modifier.fillMaxSize().verticalScroll(scroll), horizontalAlignment = Alignment.CenterHorizontally) {
                    Spacer(Modifier.height(((availH - artH) / 2).coerceAtLeast(0.dp)))
                    Box(Modifier.size(artW, artH).clipToBounds()) {
                        val scopeObj = remember(page, widthPx, heightPx, density) { ArtScope(page, widthPx, heightPx, density) }
                        val clean = remember(page) { art.image(page.clean) }
                        if (clean != null) Image(clean, null, Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds)
                        // illumination
                        Canvas(Modifier.fillMaxSize()) {
                            page.targets.forEachIndexed { i, t ->
                                if (!t.glow) return@forEachIndexed
                                val gi = glowTargets.indexOf(t)
                                val a = intensity(t, gi)
                                if (a <= 0.01f) return@forEachIndexed
                                val img = t.layer?.let { art.image(it) }
                                val bx = t.box.x * size.width; val by = t.box.y * size.height; val bw = t.box.w * size.width; val bh = t.box.h * size.height
                                if (img != null) {
                                    val grow = if (reduced) 0f else 0.05f * a
                                    drawImage(img, dstOffset = androidx.compose.ui.unit.IntOffset((bx - bw * grow).toInt(), (by - bh * grow).toInt()),
                                        dstSize = IntSize((bw * (1 + 2 * grow)).toInt(), (bh * (1 + 2 * grow)).toInt()), alpha = a * 0.5f,
                                        colorFilter = ColorFilter.tint(Gold, BlendMode.SrcAtop), blendMode = BlendMode.Plus)
                                    drawImage(img, dstOffset = androidx.compose.ui.unit.IntOffset(bx.toInt(), by.toInt()), dstSize = IntSize(bw.toInt(), bh.toInt()),
                                        alpha = a * 0.45f, colorFilter = ColorFilter.tint(Gold, BlendMode.SrcAtop), blendMode = BlendMode.Plus)
                                } else {
                                    val r = CornerRadius(14f * size.width / 841f)
                                    drawRoundRect(Gold.copy(alpha = a * 0.28f), Offset(bx, by), Size(bw, bh), r)
                                    drawRoundRect(Gold.copy(alpha = a * 0.9f), Offset(bx, by), Size(bw, bh), r, style = Stroke(3f * size.width / 841f))
                                }
                            }
                        }
                        // one tap layer: resolves whole physical objects (cutout alpha first, generous region second)
                        Box(Modifier.fillMaxSize().pointerInput(page) {
                            detectTapGestures { off ->
                                art.resolve(page, off.x / size.width, off.y / size.height)?.let { trigger(it.id) }
                            }
                        })
                        // accessibility + keyboard nodes (no pointer handling; the layer above resolves touches)
                        page.targets.forEach { t ->
                            var focused by remember { mutableStateOf(false) }
                            val live = intensity(t, 0) > 0.05f
                            Box(
                                Modifier
                                    .offset { androidx.compose.ui.unit.IntOffset((t.hit.x * widthPx).toInt(), (t.hit.y * heightPx).toInt()) }
                                    .size(with(density) { (t.hit.w * widthPx).toDp() }, with(density) { (t.hit.h * heightPx).toDp() })
                                    .testTag("art:${t.id}")
                                    .semantics(mergeDescendants = true) {
                                        contentDescription = describe(t) ?: t.label
                                        role = Role.Button
                                        if (live) stateDescription = "Highlighted"
                                        if (!enabledState(t.id)) disabled()
                                        onClick(label = t.hint) { trigger(t.id); true }
                                    }
                                    .onFocusChanged { focused = it.isFocused }
                                    .onKeyEvent { e ->
                                        if (e.type == KeyEventType.KeyUp && (e.key == Key.Enter || e.key == Key.NumPadEnter || e.key == Key.Spacebar || e.key == Key.DirectionCenter)) { trigger(t.id); true } else false
                                    }
                                    .focusable()
                                    .then(if (focused) Modifier.border(3.dp, Color(0xFFFFFFFF), RoundedCornerShape(10.dp)).border(5.dp, Color(0xFF1F4D3A).copy(alpha = 0.0f), RoundedCornerShape(10.dp)) else Modifier)
                            )
                        }
                        scopeObj.content()
                    }
                }
            }
        }
    }
}
