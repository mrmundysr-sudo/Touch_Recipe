package com.mundymorning.touchrecipe.ui.components

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import androidx.core.content.FileProvider
import com.mundymorning.touchrecipe.core.model.newId
import java.io.File

/** Gallery picker (no storage permission needed) and camera capture via the system camera app (no CAMERA permission needed). */
class PhotoPickers(val gallery: () -> Unit, val camera: () -> Unit)

@Composable
fun rememberPhotoPickers(onPicked: (Uri) -> Unit, onError: (String) -> Unit = {}): PhotoPickers {
    val context = LocalContext.current
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { it?.let(onPicked) }
    var pending by remember { mutableStateOf<Uri?>(null) }
    val take = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) pending?.let(onPicked) }
    return remember {
        PhotoPickers(
            gallery = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            camera = {
                try {
                    val dir = File(context.cacheDir, "captures").apply { mkdirs() }
                    val f = File(dir, "capture-${newId().take(8)}.jpg")
                    val uri = FileProvider.getUriForFile(context, context.packageName + ".files", f)
                    pending = uri; take.launch(uri)
                } catch (e: Exception) { onError("The camera couldn't be opened. You can choose a photo from your gallery instead.") }
            },
        )
    }
}

fun shareText(context: Context, title: String, text: String) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TEXT, text)
    context.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

fun openLink(context: Context, url: String): Boolean = try {
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
} catch (e: Exception) { false }

/** Full-height editor for ingredient/direction lists: add, edit, delete with undo, reorder, auto-renumber. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RowsEditorSheet(
    title: String, initial: List<EditRow>, hint: String, numbered: Boolean, allowHeaders: Boolean,
    note: String? = null, onSave: (List<EditRow>) -> Unit, onDismiss: () -> Unit,
) {
    var rows by remember { mutableStateOf(initial.ifEmpty { listOf(EditRow(newId(), "")) }) }
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var showErrors by remember { mutableStateOf(false) }
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f).padding(horizontal = 16.dp)) {
            Text(title, style = MaterialTheme.typography.headlineSmall)
            if (note != null) Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            Box(Modifier.weight(1f)) {
                EditableRows(
                    rows, { rows = it }, onDelete = { row, index ->
                        val before = rows
                        rows = rows.filter { it.id != row.id }
                        scope.launch { snack.undoable("Removed line ${index + 1}") { rows = before } }
                    },
                    Modifier.fillMaxSize(), numbered = numbered, hint = hint, showErrors = showErrors,
                    textStyle = androidx.compose.ui.text.TextStyle(fontSize = 16.sp, color = com.mundymorning.touchrecipe.ui.theme.Palette.Ink),
                    newRow = { EditRow(newId(), "") }, tag = "editor-rows",
                )
                SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton({ rows = rows + EditRow(newId(), "") }, Modifier.weight(1f).heightIn(min = 48.dp)) { Text(if (numbered) "Add step" else "Add line") }
                if (allowHeaders) OutlinedButton({ rows = rows + EditRow(newId(), "", header = true) }, Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Add section") }
            }
            Row(Modifier.fillMaxWidth().padding(bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onDismiss, Modifier.weight(1f).heightIn(min = 52.dp)) { Text("Cancel") }
                Button({
                    val cleaned = rows.filter { it.text.isNotBlank() }
                    if (cleaned.size != rows.size && !showErrors) { showErrors = true; scope.launch { snack.showSnackbar("Empty lines are marked. Save again to remove them.") } }
                    else onSave(cleaned)
                }, Modifier.weight(1f).heightIn(min = 52.dp)) { Text("Save") }
            }
        }
    }
}
