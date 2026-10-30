package com.mundymorning.touchrecipe.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavController
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.model.*
import com.mundymorning.touchrecipe.data.ImportFailure
import com.mundymorning.touchrecipe.data.ImportInput
import com.mundymorning.touchrecipe.ui.Routes
import com.mundymorning.touchrecipe.ui.art.ArtScreen
import com.mundymorning.touchrecipe.ui.components.*
import com.mundymorning.touchrecipe.ui.vmOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

sealed interface ImportUi {
    data object Idle : ImportUi
    data class Working(val message: String) : ImportUi
    data class Done(val draft: ImportDraft) : ImportUi
    data class Failed(val message: String, val retryable: Boolean, val offline: Boolean, val blocked: Boolean) : ImportUi
}

class ImportViewModel(private val c: AppContainer) : ViewModel() {
    val ui = MutableStateFlow<ImportUi>(c.importSession.draft.value?.let { ImportUi.Done(it) } ?: ImportUi.Idle)
    private var last: ImportInput? = null
    private var job: Job? = null

    fun start(input: ImportInput) {
        last = input; job?.cancel()
        c.importSession.clear()
        ui.value = ImportUi.Working("Starting…")
        job = viewModelScope.launch {
            try {
                var draft = c.importer.import(input) { m -> ui.value = ImportUi.Working(m) }
                if (draft.recipe.title.isBlank() && draft.recipe.ingredients.isEmpty() && draft.recipe.directions.isEmpty() && draft.warnings.any { it.severity == Severity.ERROR }) {
                    ui.value = ImportUi.Failed(draft.warnings.first { it.severity == Severity.ERROR }.message, retryable = input is ImportInput.Url, offline = false, blocked = input is ImportInput.Url)
                    return@launch
                }
                if (draft.imageCandidates.isNotEmpty()) {
                    ui.value = ImportUi.Working("Fetching the photo…")
                    c.importSession.photoFile = c.importer.fetchPhoto(draft.imageCandidates)
                    if (c.importSession.photoFile == null) draft = draft.copy(warnings = draft.warnings + ImportWarning("photo", "The page's photo could not be downloaded. You can add your own.", Severity.INFO))
                }
                c.importSession.draft.value = draft
                ui.value = ImportUi.Done(draft)
            } catch (e: CancellationException) { throw e
            } catch (e: ImportFailure) { ui.value = ImportUi.Failed(e.userMessage, e.retryable, e.offline, e.blocked)
            } catch (e: Exception) { ui.value = ImportUi.Failed("Something went wrong while importing. Nothing was saved.", true, false, false) }
        }
    }
    fun retry() { last?.let(::start) }
    fun cancel() { job?.cancel(); ui.value = ImportUi.Idle }
    fun dismiss() { if (ui.value !is ImportUi.Done) ui.value = ImportUi.Idle }
    fun discard() { c.importSession.clear(); ui.value = ImportUi.Idle }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportScreen(c: AppContainer, nav: NavController) {
    val vm = vmOf { ImportViewModel(c) }
    val ui by vm.ui.collectAsState()
    val share by c.pendingShare.collectAsState()
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    var urlSheet by remember { mutableStateOf(false) }
    var textSheet by remember { mutableStateOf(false) }
    var scanSheet by remember { mutableStateOf(false) }
    var shareHelp by remember { mutableStateOf(false) }
    var resultOpen by remember { mutableStateOf(ui !is ImportUi.Idle) }

    LaunchedEffect(share) { share?.let { vm.start(it); resultOpen = true; c.pendingShare.value = null } }
    LaunchedEffect(ui) { if (ui !is ImportUi.Idle) resultOpen = true }

    val pickers = rememberPhotoPickers({ vm.start(ImportInput.Image(it)) }, { scope.launch { snack.showSnackbar(it) } })
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.start(c.context.contentResolver.getType(uri).let { t -> if (t == "application/pdf") ImportInput.Pdf(uri) else if (t?.startsWith("image/") == true) ImportInput.Image(uri) else ImportInput.File(uri, t) })
    }

    ArtScreen("import", "Import Recipe", onTarget = { id ->
        when (id) {
            "back" -> nav.goBackOr(Routes.HUB)
            "url" -> urlSheet = true
            "text" -> textSheet = true
            "scan" -> scanSheet = true
            "file" -> filePicker.launch(arrayOf("application/pdf", "image/*", "text/plain", "text/html"))
            "share" -> shareHelp = true
            "continue" -> if (c.importSession.draft.value != null) nav.navigate(Routes.review()) else scope.launch { snack.showSnackbar("Add a recipe first: paste a link, type or paste text, scan, or choose a file.") }
        }
    })

    if (urlSheet) UrlSheet(clipboardText = { clipboard.getText()?.text.orEmpty() }, onDismiss = { urlSheet = false }, onImport = { urlSheet = false; vm.start(ImportInput.Url(it)) }, normalize = c.importer::normalizeUrl)
    if (textSheet) TextSheet(clipboardText = { clipboard.getText()?.text.orEmpty() }, onDismiss = { textSheet = false }, onImport = { textSheet = false; vm.start(c.importer.classify(it).let { i -> if (i is ImportInput.Url) ImportInput.Text(it) else i }) })
    if (scanSheet) ModalBottomSheet({ scanSheet = false }) {
        Column(Modifier.padding(20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Scan a recipe", style = MaterialTheme.typography.headlineSmall)
            Text("Take a clear, well-lit photo of a cookbook page or recipe card. Touch Recipe opens your camera app, then reads the text on this device. The photo isn't uploaded anywhere. Handwriting and busy layouts may need corrections.")
            BigButton("Take a photo", { scanSheet = false; pickers.camera() }, Modifier.fillMaxWidth())
            BigButton("Choose a photo", { scanSheet = false; pickers.gallery() }, Modifier.fillMaxWidth(), primary = false)
            TextButton({ scanSheet = false; textSheet = true }, Modifier.fillMaxWidth()) { Text("Type or paste instead") }
        }
    }
    if (shareHelp) ModalBottomSheet({ shareHelp = false }) {
        Column(Modifier.padding(20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Share to Touch Recipe", style = MaterialTheme.typography.headlineSmall)
            Text("From your browser or any app: tap Share, then choose “Import to Touch Recipe”. The link or text arrives here, ready for you to review before anything is saved.")
            Text("Photos and PDFs you share from your gallery or Files app work the same way.")
            BigButton("Got it", { shareHelp = false }, Modifier.fillMaxWidth())
        }
    }
    if (resultOpen && ui !is ImportUi.Idle) ResultSheet(ui, onCancel = { vm.cancel(); resultOpen = false }, onRetry = vm::retry,
        onClose = { resultOpen = false; vm.dismiss() }, onPasteInstead = { resultOpen = false; vm.dismiss(); textSheet = true },
        onContinue = { resultOpen = false; nav.navigate(Routes.review()) }, onDiscard = { resultOpen = false; vm.discard() })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun UrlSheet(clipboardText: () -> String, onDismiss: () -> Unit, onImport: (String) -> Unit, normalize: (String) -> String?) {
    var url by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismiss) {
        Column(Modifier.padding(20.dp).padding(bottom = 20.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Paste Recipe URL", style = MaterialTheme.typography.headlineSmall)
            Text("Touch Recipe will fetch this one page from the internet and look for the recipe. Nothing else is sent.", style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(url, { url = it; error = null }, Modifier.fillMaxWidth().testTag("url-field"), label = { Text("Recipe web address") }, singleLine = true, isError = error != null,
                supportingText = { error?.let { Text(it) } },
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = androidx.compose.ui.text.input.ImeAction.Go),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(onGo = { normalize(url)?.let(onImport) ?: run { error = "That doesn't look like a web address." } }))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BigButton("Paste from clipboard", { url = clipboardText().trim(); error = null }, Modifier.weight(1f), primary = false)
                BigButton("Import", { normalize(url)?.let(onImport) ?: run { error = "That doesn't look like a web address." } }, Modifier.weight(1f).testTag("url-import"))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TextSheet(clipboardText: () -> String, onDismiss: () -> Unit, onImport: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(20.dp).padding(bottom = 20.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Paste or type a recipe", style = MaterialTheme.typography.headlineSmall)
            Text("Paste a recipe from anywhere, or type one in. Headings such as Ingredients and Directions help; you can fix everything on the next screen.", style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth().heightIn(min = 180.dp, max = 320.dp).testTag("text-field"), label = { Text("Recipe text") })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BigButton("Paste from clipboard", { text = clipboardText() }, Modifier.weight(1f), primary = false)
                BigButton("Continue", { onImport(text) }, Modifier.weight(1f).testTag("text-import"), enabled = text.isNotBlank())
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ResultSheet(ui: ImportUi, onCancel: () -> Unit, onRetry: () -> Unit, onClose: () -> Unit, onPasteInstead: () -> Unit, onContinue: () -> Unit, onDiscard: () -> Unit) {
    ModalBottomSheet(onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(20.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()).semantics { liveRegion = LiveRegionMode.Polite }.testTag("import-result"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            when (ui) {
                is ImportUi.Working -> {
                    Text("Importing…", style = MaterialTheme.typography.headlineSmall)
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text(ui.message, Modifier.testTag("import-status"))
                    BigButton("Cancel", onCancel, Modifier.fillMaxWidth(), primary = false)
                }
                is ImportUi.Failed -> {
                    Text(if (ui.offline) "You seem to be offline" else if (ui.blocked) "This page wouldn't open for us" else "We couldn't import that", style = MaterialTheme.typography.headlineSmall)
                    Text(ui.message, Modifier.testTag("import-error"))
                    Text("Nothing was saved. Your other recipes are untouched.", style = MaterialTheme.typography.bodySmall)
                    if (ui.retryable) BigButton("Try again", onRetry, Modifier.fillMaxWidth())
                    BigButton("Paste or type the recipe instead", onPasteInstead, Modifier.fillMaxWidth(), primary = !ui.retryable)
                    TextButton(onClose, Modifier.fillMaxWidth()) { Text("Close") }
                }
                is ImportUi.Done -> {
                    val d = ui.draft; val r = d.recipe
                    Text(if (d.confidence == Confidence.HIGH) "We found a recipe" else "We found some of a recipe", style = MaterialTheme.typography.headlineSmall)
                    Text(r.title.ifBlank { "Untitled recipe" }, style = MaterialTheme.typography.titleLarge)
                    Text("${r.ingredients.count { !it.header }} ingredients · ${r.directions.count { !it.header }} directions" + (r.servings?.let { " · serves $it" } ?: ""))
                    Text(when (d.confidence) {
                        Confidence.HIGH -> "This came from the page's own recipe data, but extraction is never perfect. Please give it a quick check."
                        Confidence.MEDIUM -> "Some parts were interpreted automatically. Please check the details before saving."
                        Confidence.LOW -> "This was guessed from text or layout, so mistakes are likely. Please check carefully; everything can be edited."
                    }, style = MaterialTheme.typography.bodyMedium)
                    d.warnings.filter { it.severity != Severity.INFO }.forEach { Text("⚠ ${it.message}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                    BigButton("Continue to Review", onContinue, Modifier.fillMaxWidth().testTag("result-continue"))
                    TextButton(onDiscard, Modifier.fillMaxWidth()) { Text("Discard this import") }
                }
                ImportUi.Idle -> {}
            }
        }
    }
}
