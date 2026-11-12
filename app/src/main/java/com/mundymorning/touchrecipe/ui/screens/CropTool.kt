package com.mundymorning.touchrecipe.ui.screens

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.mundymorning.touchrecipe.core.image.Pt
import com.mundymorning.touchrecipe.core.image.Quad
import kotlin.math.roundToInt

/** Moves corner [i] of a four-cornered outline. In [rectangle] mode the two neighbouring corners follow, so the outline stays upright. */
fun moveCorner(pts: List<Offset>, i: Int, dx: Float, dy: Float, rectangle: Boolean): List<Offset> {
    val out = pts.toMutableList()
    val p = Offset((pts[i].x + dx).coerceIn(0f, 1f), (pts[i].y + dy).coerceIn(0f, 1f))
    out[i] = p
    if (rectangle) {
        // corners run clockwise from the top-left: each shares its x with one neighbour and its y with the other
        val sameX = intArrayOf(3, 2, 1, 0)[i]; val sameY = intArrayOf(1, 0, 3, 2)[i]
        out[sameX] = Offset(p.x, out[sameX].y); out[sameY] = Offset(out[sameY].x, p.y)
    }
    return out
}

/**
 * The manual crop: the picture with four corner handles. Used to mark a card's corners for straightening (free corners) and
 * to cut the dish photo out of a page (an upright rectangle). The picture shown is never changed; [onApply] receives the outline.
 */
@Composable
fun CropDialog(
    bmp: Bitmap, initial: Quad, title: String, hint: String, rectangle: Boolean, offerSharpen: Boolean,
    onFindEdges: (() -> Quad?)? = null, onApply: (Quad, Boolean) -> Unit, onDismiss: () -> Unit,
) {
    var pts by remember(bmp) { mutableStateOf(initial.points.map { Offset(it.x, it.y) }) }
    var sharpen by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    Dialog(onDismiss, DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize().semantics { paneTitle = title }.testTag("crop-tool"), color = Color(0xFF2A2118)) {
            Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars).padding(12.dp)) {
                Text(title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                Text(note ?: hint, color = Color(0xFFE9D8B7), fontSize = 14.sp)
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().padding(24.dp)) {
                    val k = minOf(constraints.maxWidth.toFloat() / bmp.width, constraints.maxHeight.toFloat() / bmp.height)
                    val wPx = (bmp.width * k).coerceAtLeast(1f); val hPx = (bmp.height * k).coerceAtLeast(1f)
                    val density = LocalDensity.current
                    val half = with(density) { 24.dp.roundToPx() }
                    Box(Modifier.align(Alignment.Center).size(with(density) { wPx.toDp() }, with(density) { hPx.toDp() })) {
                        Image(remember(bmp) { bmp.asImageBitmap() }, "The picture being cropped", Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds)
                        Canvas(Modifier.fillMaxSize()) {
                            for (i in 0 until 4) {
                                val a = pts[i]; val b = pts[(i + 1) % 4]
                                drawLine(Color(0xFFFFD23F), Offset(a.x * size.width, a.y * size.height), Offset(b.x * size.width, b.y * size.height), strokeWidth = 3.dp.toPx())
                            }
                        }
                        for (i in 0 until 4) {
                            Box(
                                Modifier.offset { IntOffset((pts[i].x * wPx).roundToInt() - half, (pts[i].y * hPx).roundToInt() - half) }.size(48.dp)
                                    .pointerInput(i, rectangle, wPx, hPx) { detectDragGestures { change, drag -> change.consume(); pts = moveCorner(pts, i, drag.x / wPx, drag.y / hPx, rectangle) } }
                                    .semantics { contentDescription = listOf("Top left", "Top right", "Bottom right", "Bottom left")[i] + " corner" }.testTag("crop-corner:$i"),
                                contentAlignment = Alignment.Center,
                            ) { Box(Modifier.size(24.dp).clip(CircleShape).background(Color(0xFFFFD23F)).border(2.dp, Color.Black, CircleShape)) }
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton({ pts = Quad.FULL.points.map { Offset(it.x, it.y) }; note = null }, Modifier.testTag("crop-whole")) { Text("Whole picture", color = Color.White) }
                    if (onFindEdges != null) TextButton({
                        val q = onFindEdges()
                        if (q != null) { pts = q.points.map { Offset(it.x, it.y) }; note = "Edges found. Drag a corner if one is off." } else note = "No clear edges were found. Drag the corners to the card yourself."
                    }, Modifier.testTag("crop-find")) { Text("Find edges", color = Color.White) }
                    if (offerSharpen) Row(Modifier.toggleable(sharpen, role = Role.Checkbox, onValueChange = { sharpen = it }).heightIn(min = 48.dp).padding(horizontal = 8.dp).testTag("crop-sharpen"), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(22.dp).border(2.dp, Color.White).background(if (sharpen) Color(0xFFFFD23F) else Color.Transparent)); Spacer(Modifier.width(6.dp)); Text("Sharpen", color = Color.White)
                    }
                    Spacer(Modifier.weight(1f))
                    TextButton(onDismiss, Modifier.testTag("crop-cancel")) { Text("Cancel", color = Color.White) }
                    TextButton({ onApply(Quad(Pt(pts[0].x, pts[0].y), Pt(pts[1].x, pts[1].y), Pt(pts[2].x, pts[2].y), Pt(pts[3].x, pts[3].y)), sharpen) }, Modifier.testTag("crop-apply")) { Text("Use this", color = Color(0xFFFFD23F), fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}
