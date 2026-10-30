package com.mundymorning.touchrecipe.ui.components

import androidx.compose.foundation.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.isSpecified
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.mundymorning.touchrecipe.ui.theme.Palette
import kotlinx.coroutines.launch

/** Snackbar access for undo actions anywhere in the UI. */
val LocalSnack = staticCompositionLocalOf<SnackbarHostState> { SnackbarHostState() }

/** Shows a message now: an older message never blocks a newer, more relevant one. */
suspend fun SnackbarHostState.say(message: String) { currentSnackbarData?.dismiss(); showSnackbar(message) }

suspend fun SnackbarHostState.undoable(message: String, onUndo: suspend () -> Unit) {
    currentSnackbarData?.dismiss()
    val r = showSnackbar(message, actionLabel = "Undo", withDismissAction = true, duration = SnackbarDuration.Long)
    if (r == SnackbarResult.ActionPerformed) onUndo()
}

/** Text that shrinks (down to [minScale]) to stay inside a fixed artwork region instead of clipping. */
@Composable
fun FitText(
    text: String, style: TextStyle, modifier: Modifier = Modifier, maxLines: Int = 1, minScale: Float = 0.55f,
    color: Color = style.color, textAlign: androidx.compose.ui.text.style.TextAlign? = null,
) {
    var scale by remember(text, style.fontSize) { mutableFloatStateOf(1f) }
    Text(
        text, modifier = modifier, color = color, maxLines = maxLines, overflow = TextOverflow.Ellipsis, textAlign = textAlign,
        style = style.copy(fontSize = style.fontSize * scale, lineHeight = if (style.lineHeight.isSpecified) style.lineHeight * scale else style.lineHeight),
        onTextLayout = { if (it.hasVisualOverflow && scale > minScale) scale = (scale * 0.9f).coerceAtLeast(minScale) },
    )
}

@Composable
fun ConfirmDialog(title: String, text: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit, destructive: Boolean = false) {
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text(title) }, text = { Text(text) },
        confirmButton = { TextButton(onClick = { onConfirm() }, colors = if (destructive) ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error) else ButtonDefaults.textButtonColors()) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Large, text-labelled action with a generous touch target. */
@Composable
fun BigButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, primary: Boolean = true) {
    val colors = if (primary) ButtonDefaults.buttonColors(containerColor = Palette.Tomato, contentColor = Color.White)
    else ButtonDefaults.outlinedButtonColors()
    if (primary) Button(onClick, modifier.heightIn(min = 52.dp), enabled = enabled, colors = colors, shape = RoundedCornerShape(14.dp)) { Text(label) }
    else OutlinedButton(onClick, modifier.heightIn(min = 52.dp), enabled = enabled, shape = RoundedCornerShape(14.dp)) { Text(label) }
}

/** A row in an [EditableRows] list. */
data class EditRow(val id: String, val text: String, val header: Boolean = false)

/**
 * Dynamic editable rows with drag handles, move up/down and delete for assistive tech, automatic renumbering,
 * validation (empty rows are flagged), Enter-to-add-next-row and per-row undo through [onDelete].
 */
@Composable
fun EditableRows(
    rows: List<EditRow>, onRows: (List<EditRow>) -> Unit, onDelete: (EditRow, Int) -> Unit, modifier: Modifier = Modifier,
    numbered: Boolean = false, hint: String, showErrors: Boolean = false, compact: Boolean = false,
    textStyle: TextStyle = TextStyle(fontSize = 16.sp, color = Palette.Ink), rowBackground: Color = Color(0xFFFBF4E6),
    newRow: () -> EditRow, tag: String = "rows", allowHeaders: Boolean = false, onEmptyRowClear: Boolean = false,
) {
    val state = rememberLazyListState()
    var dragId by remember { mutableStateOf<String?>(null) }
    var dragDelta by remember { mutableFloatStateOf(0f) }
    val focusers = remember { HashMap<String, FocusRequester>() }
    var focusNext by remember { mutableStateOf<String?>(null) }
    val current by rememberUpdatedState(rows)
    val scope = rememberCoroutineScope()

    LaunchedEffect(focusNext, rows.size) {
        val id = focusNext ?: return@LaunchedEffect
        runCatching { focusers[id]?.requestFocus() }
        focusNext = null
        rows.indexOfFirst { it.id == id }.takeIf { it >= 0 }?.let { state.animateScrollToItem(it) }
    }

    fun move(from: Int, to: Int) {
        if (from == to || to !in current.indices) return
        onRows(current.toMutableList().also { val x = it.removeAt(from); it.add(to, x) })
    }

    var number = 0
    val numbers = rows.map { if (it.header) 0 else ++number }

    LazyColumn(modifier.testTag(tag), state = state, verticalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 6.dp)) {
        itemsIndexed(rows, key = { _, r -> r.id }) { index, row ->
            val fr = focusers.getOrPut(row.id) { FocusRequester() }
            val dragging = dragId == row.id
            val invalid = showErrors && row.text.isBlank()
            Row(
                Modifier.fillMaxWidth().heightIn(min = if (compact) 44.dp else 52.dp)
                    .zIndex(if (dragging) 1f else 0f)
                    .graphicsLayer { translationY = if (dragging) dragDelta else 0f; shadowElevation = if (dragging) 12f else 0f }
                    .clip(RoundedCornerShape(10.dp)).background(rowBackground)
                    .border(if (invalid) 2.dp else 1.dp, if (invalid) MaterialTheme.colorScheme.error else Palette.Brass.copy(alpha = 0.35f), RoundedCornerShape(10.dp))
                    .testTag("$tag:row:$index")
                    .semantics {
                        customActions = buildList {
                            if (index > 0) add(CustomAccessibilityAction("Move up") { move(index, index - 1); true })
                            if (index < current.lastIndex) add(CustomAccessibilityAction("Move down") { move(index, index + 1); true })
                            add(CustomAccessibilityAction("Delete") { onDelete(row, index); true })
                        }
                    },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // drag handle
                Box(
                    Modifier.size(44.dp).semantics { contentDescription = "Reorder handle. Use the actions menu to move up or down."; role = Role.Button }
                        .pointerInput(row.id) {
                            detectDragGestures(
                                onDragStart = { dragId = row.id; dragDelta = 0f },
                                onDragEnd = { dragId = null; dragDelta = 0f }, onDragCancel = { dragId = null; dragDelta = 0f },
                                onDrag = { change, amount ->
                                    change.consume(); dragDelta += amount.y
                                    val info = state.layoutInfo.visibleItemsInfo.firstOrNull { it.key == row.id } ?: return@detectDragGestures
                                    val center = info.offset + info.size / 2f + dragDelta
                                    val target = state.layoutInfo.visibleItemsInfo.firstOrNull { it.key != row.id && center >= it.offset && center <= it.offset + it.size }
                                    if (target != null) {
                                        val from = current.indexOfFirst { it.id == row.id }
                                        move(from, target.index)
                                        dragDelta -= (target.offset - info.offset)
                                    }
                                },
                            )
                        },
                    contentAlignment = Alignment.Center,
                ) { Text("⠿", fontSize = 22.sp, color = Palette.Wood) }
                if (numbered && !row.header) {
                    Box(Modifier.size(26.dp).clip(CircleShape).background(Palette.Forest), contentAlignment = Alignment.Center) {
                        Text("${numbers[index]}", color = Palette.Cream, fontSize = 13.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                    }
                    Spacer(Modifier.width(8.dp))
                }
                BasicTextField(
                    value = row.text, onValueChange = { v -> onRows(current.map { if (it.id == row.id) it.copy(text = v) else it }) },
                    modifier = Modifier.weight(1f).padding(vertical = 8.dp).focusRequester(fr)
                        .semantics { contentDescription = (if (numbered) "Step ${numbers[index]}" else "Item ${index + 1}") + (if (row.header) ", section title" else "") },
                    textStyle = textStyle.copy(fontWeight = if (row.header) androidx.compose.ui.text.font.FontWeight.Bold else textStyle.fontWeight),
                    cursorBrush = SolidColor(Palette.Tomato),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = {
                        if (index == current.lastIndex) { val n = newRow(); onRows(current + n); focusNext = n.id }
                        else focusNext = current[index + 1].id
                    }),
                    decorationBox = { inner ->
                        Box { if (row.text.isEmpty()) Text(if (invalid) "$hint (can't be empty)" else hint, style = textStyle, color = if (invalid) MaterialTheme.colorScheme.error else Palette.Ink.copy(alpha = 0.5f)); inner() }
                    },
                )
                IconButtonBox("Delete ${if (numbered) "step ${numbers[index]}" else "item ${index + 1}"}", "−", Palette.Tomato) { onDelete(row, index) }
            }
        }
    }
}

/** 48dp touch target with a code-drawn glyph and an accessibility label. */
@Composable
fun IconButtonBox(label: String, glyph: String, tint: Color, size: Dp = 48.dp, onClick: () -> Unit) {
    Box(
        Modifier.size(size).clip(CircleShape).clickable(onClickLabel = label, role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Text(glyph, color = tint, fontSize = 24.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold) }
}

@Composable
fun Chip(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    // selection is conveyed by a check mark and weight, never by colour alone
    // fixed palette: chips sit on the always-light illustrated paper as well as on themed sheets, so they must not follow dark mode
    FilterChip(
        selected, onClick, label = { Text(if (selected) "✓ $label" else label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        modifier = modifier.heightIn(min = 40.dp).semantics { this.selected = selected },
        colors = FilterChipDefaults.filterChipColors(
            containerColor = Color(0xFFFBF4E6), labelColor = Palette.Ink, selectedContainerColor = Palette.Forest, selectedLabelColor = Palette.Cream,
        ),
        border = FilterChipDefaults.filterChipBorder(enabled = true, selected = selected, borderColor = Palette.Brass, selectedBorderColor = Palette.Forest),
    )
}

/** Back control for pages whose artwork has no back arrow (Collection, Planner). Code-rendered so it stays accessible. */
@Composable
fun BackChip(onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.size(48.dp).clip(CircleShape).background(Color(0xFFFBF4E6).copy(alpha = 0.95f)).border(1.5.dp, Palette.Brass, CircleShape)
            .clickable(onClickLabel = "Go back", role = Role.Button, onClick = onClick).semantics { contentDescription = "Back" }.testTag("back-chip"),
        contentAlignment = Alignment.Center,
    ) { Text("←", fontSize = 24.sp, color = Palette.Ink, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold) }
}
