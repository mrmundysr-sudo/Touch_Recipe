package com.mundymorning.touchrecipe.ui.art

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mundymorning.touchrecipe.ui.theme.Palette

/**
 * A page whose content decides its own length: a pinned top bar, a pinned bottom bar and, between them, whatever
 * scrolling content the screen provides. Unlike [ArtScreen] nothing is placed by artwork coordinates, so a recipe with
 * 5 ingredients makes a short page and one with 40 makes a long one.
 *
 * The visuals are deliberate placeholders. Final artwork arrives as separate pieces: a top piece, a strip that repeats
 * down the sides, a bottom piece shown only at the real end of the content, and one cutout per pinned button. Each
 * [ArtButton] and [ArtSlot] below names the piece that will replace it (see docs/ART_WIRING.md).
 */
@Composable
fun PageFrame(
    title: String, modifier: Modifier = Modifier,
    topBar: @Composable () -> Unit, bottomBar: (@Composable () -> Unit)? = null, content: @Composable BoxScope.() -> Unit,
) {
    Box(modifier.fillMaxSize().background(Palette.Parchment).semantics { paneTitle = title }) {
        BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout)).imePadding()) {
            val w = minOf(maxWidth, 640.dp)   // a comfortable reading column on tablets
            Column(Modifier.width(w).fillMaxHeight().align(Alignment.TopCenter)) {
                topBar()
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    // placeholder for the repeating herb border down both edges; the centre stays open for content
                    Box(Modifier.align(Alignment.CenterStart).fillMaxHeight().width(8.dp).background(Palette.Forest.copy(alpha = 0.16f)).clearAndSetSemantics { })
                    Box(Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(8.dp).background(Palette.Forest.copy(alpha = 0.16f)).clearAndSetSemantics { })
                    Box(Modifier.fillMaxSize().padding(horizontal = 16.dp), content = content)
                }
                if (bottomBar != null) bottomBar()
            }
        }
    }
}

/**
 * A pinned control drawn by code for now. It keeps the id of the artwork target it stands in for (`art:<id>`), so the
 * cutout that replaces it later, and every test that presses it, address the same control.
 */
@Composable
fun ArtButton(
    id: String, label: String, modifier: Modifier = Modifier, primary: Boolean = false, round: Boolean = false, enabled: Boolean = true,
    description: String? = null, hint: String? = null, onClick: () -> Unit, content: (@Composable () -> Unit)? = null,
) {
    val shape = if (round) CircleShape else RoundedCornerShape(14.dp)
    val fill = if (primary) Palette.Forest else Color(0xFFFBF4E6)
    Box(
        modifier.then(if (round) Modifier.size(48.dp) else Modifier.heightIn(min = 48.dp)).clip(shape).background(if (enabled) fill else fill.copy(alpha = 0.5f)).border(1.5.dp, Palette.Brass, shape)
            .clickable(enabled = enabled, onClickLabel = hint ?: label, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description ?: label }.testTag("art:$id")
            .padding(horizontal = if (round) 0.dp else 12.dp, vertical = if (round) 0.dp else 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (content != null) content()
        else Text(label, color = if (primary) Palette.Cream else Palette.Ink, fontWeight = FontWeight.SemiBold, fontSize = if (round) 22.sp else 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}

/** Marks where a decorative artwork piece will sit. Purely visual; hidden from screen readers. */
@Composable
fun ArtSlot(name: String, height: Dp = 26.dp, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(vertical = 6.dp).height(height).clip(RoundedCornerShape(10.dp)).background(Palette.Forest.copy(alpha = 0.10f)).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
        Text("artwork: $name", color = Palette.Forest.copy(alpha = 0.55f), fontSize = 11.sp, maxLines = 1)
    }
}
