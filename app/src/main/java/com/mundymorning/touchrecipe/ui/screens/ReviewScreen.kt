package com.mundymorning.touchrecipe.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavController
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.importer.Durations
import com.mundymorning.touchrecipe.core.model.*
import com.mundymorning.touchrecipe.ui.Routes
import com.mundymorning.touchrecipe.ui.art.ArtScreen
import com.mundymorning.touchrecipe.ui.art.NRect
import com.mundymorning.touchrecipe.ui.components.*
import com.mundymorning.touchrecipe.ui.theme.BodyFont
import com.mundymorning.touchrecipe.ui.theme.DisplayFont
import com.mundymorning.touchrecipe.ui.theme.Palette
import com.mundymorning.touchrecipe.ui.vmOf
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.net.URI

data class ReviewState(
    val title: String = "", val description: String = "", val notes: String = "", val cuisine: String = "",
    val sourceText: String = "", val sourceUrl: String? = null,
    val photo: String? = null, val ingredients: List<EditRow> = emptyList(), val directions: List<EditRow> = emptyList(),
    val prep: String = "", val cook: String = "", val total: String = "", val servings: String = "",
    val categories: Set<String> = emptySet(), val rawSource: String? = null,
    val warnings: List<ImportWarning> = emptyList(), val confidence: Confidence? = null, val candidates: List<String> = emptyList(), val candidateIndex: Int = 0,
    val showErrors: Boolean = false, val editingId: String? = null, val favorite: Boolean = false, val dirty: Boolean = false,
    val timers: Map<String, Int?> = emptyMap(), val createdAt: Long = 0,
)

class ReviewViewModel(private val c: AppContainer, private val editId: String?) : ViewModel() {
    val state = MutableStateFlow(ReviewState())
    val ready = MutableStateFlow(false)
    val saved = MutableStateFlow<String?>(null)

    init {
        viewModelScope.launch {
            val s = if (editId != null) c.repo.getRecipe(editId)?.let { fromRecipe(it, emptyList(), null, emptyList()) }
            else c.importSession.draft.value?.let { d -> fromRecipe(d.recipe, d.warnings, d.confidence, d.imageCandidates).copy(photo = c.importSession.photoFile, dirty = true) }
            state.value = (s ?: ReviewState(editingId = null, dirty = false)).let { st ->
                st.copy(ingredients = st.ingredients.ifEmpty { listOf(EditRow(newId(), "")) }, directions = st.directions.ifEmpty { listOf(EditRow(newId(), "")) })
            }
            ready.value = true
        }
    }

    private fun fromRecipe(r: Recipe, w: List<ImportWarning>, conf: Confidence?, cands: List<String>) = ReviewState(
        title = r.title, description = r.description, notes = r.notes, cuisine = r.cuisine.orEmpty(),
        sourceText = r.sourceUrl ?: r.sourceName.orEmpty(), sourceUrl = r.sourceUrl, photo = r.photo,
        ingredients = r.ingredients.map { EditRow(it.id, it.text, it.header) }, directions = r.directions.map { EditRow(it.id, it.text, it.header) },
        prep = r.prepMinutes?.toString().orEmpty(), cook = r.cookMinutes?.toString().orEmpty(), total = r.totalMinutes?.toString().orEmpty(), servings = r.servings?.toString().orEmpty(),
        categories = r.categoryIds.toSet(), rawSource = r.rawSource, warnings = w, confidence = conf, candidates = cands, editingId = if (editId != null) r.id else null,
        favorite = r.favorite, timers = r.directions.associate { it.id to it.timerSeconds }, createdAt = r.createdAt,
    ).also { _ ->
        if (editId != null) originalPhoto = r.photo
    }
    private var originalPhoto: String? = null

    fun edit(f: (ReviewState) -> ReviewState) { state.value = f(state.value).copy(dirty = true) }

    fun problems(s: ReviewState = state.value): List<String> = buildList {
        if (s.title.isBlank()) add("Add a title.")
        if (s.ingredients.none { it.text.isNotBlank() && !it.header } && s.directions.none { it.text.isNotBlank() && !it.header }) add("Add at least one ingredient or direction.")
        if (s.prep.isNotBlank() && s.prep.toIntOrNull() == null) add("Prep time must be a number of minutes.")
        if (s.cook.isNotBlank() && s.cook.toIntOrNull() == null) add("Cook time must be a number of minutes.")
        if (s.total.isNotBlank() && s.total.toIntOrNull() == null) add("Total time must be a number of minutes.")
        if (s.servings.isNotBlank() && s.servings.toIntOrNull() == null) add("Servings must be a number.")
    }

    fun buildRecipe(): Recipe {
        val s = state.value
        val src = s.sourceText.trim()
        val isUrl = src.startsWith("http://", true) || src.startsWith("https://", true)
        val url = if (isUrl) src else s.sourceUrl?.takeIf { it.isNotBlank() && src.isNotBlank() && !isUrl && it.contains(src, true).not() }?.let { s.sourceUrl }
        val name = if (isUrl) runCatching { URI(src).host?.removePrefix("www.") }.getOrNull() else src.ifBlank { null }
        return Recipe(
            id = s.editingId ?: newId(), title = s.title.trim(), description = s.description.trim(), notes = s.notes.trim(), photo = s.photo,
            sourceUrl = url ?: if (isUrl) src else s.sourceUrl, sourceName = name, cuisine = s.cuisine.trim().ifEmpty { null },
            prepMinutes = s.prep.toIntOrNull(), cookMinutes = s.cook.toIntOrNull(), totalMinutes = s.total.toIntOrNull(), servings = s.servings.toIntOrNull(),
            ingredients = s.ingredients.filter { it.text.isNotBlank() }.map { Ingredient(it.id, it.text.trim(), it.header) },
            directions = s.directions.filter { it.text.isNotBlank() }.map { Direction(it.id, it.text.trim(), if (it.header) null else (s.timers[it.id] ?: Durations.timerSeconds(it.text)), it.header) },
            categoryIds = s.categories.toList(), favorite = s.favorite, rawSource = s.rawSource, createdAt = s.createdAt,
        )
    }

    suspend fun duplicateOf(r: Recipe): Recipe? = if (r.id != state.value.editingId && state.value.editingId == null)
        c.repo.recipes().first().firstOrNull { (r.sourceUrl != null && it.sourceUrl == r.sourceUrl) || it.title.equals(r.title, true) } else null

    fun save(r: Recipe) = viewModelScope.launch {
        val s = c.repo.saveRecipe(r)
        if (originalPhoto != null && originalPhoto != s.photo) c.photos.delete(originalPhoto)
        c.importSession.clear(); saved.value = s.id
    }

    suspend fun nextCandidate(): Boolean {
        val s = state.value
        if (s.candidates.size < 2) return false
        val next = (s.candidateIndex + 1) % s.candidates.size
        val file = c.importer.fetchPhoto(listOf(s.candidates[next])) ?: return false
        edit { it.copy(photo = file, candidateIndex = next) }; return true
    }
    fun photo() = c.photos
}

@Composable
private fun WarnBadge(label: String, messages: List<String>, modifier: Modifier = Modifier) {
    if (messages.isEmpty()) return
    var open by remember { mutableStateOf(false) }
    Box(modifier.size(48.dp).clip(androidx.compose.foundation.shape.CircleShape).clickable(onClickLabel = "Show what to check", role = Role.Button) { open = true }
        .semantics { contentDescription = "Needs a look: $label" }.testTag("warn:$label"), contentAlignment = Alignment.Center) {
        Box(Modifier.size(28.dp).clip(androidx.compose.foundation.shape.CircleShape).background(Color(0xFFFFE08A)).border(2.dp, Color(0xFF8A5A00), androidx.compose.foundation.shape.CircleShape), contentAlignment = Alignment.Center) { Text("!", fontWeight = FontWeight.ExtraBold, color = Color(0xFF5A3A00)) }
    }
    if (open) AlertDialog({ open = false }, title = { Text("Check: $label") }, text = { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { messages.forEach { Text("• $it") } } }, confirmButton = { TextButton({ open = false }) { Text("OK") } })
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ReviewScreen(c: AppContainer, nav: NavController, editId: String?) {
    val vm = vmOf("review-${editId ?: "new"}") { ReviewViewModel(c, editId) }
    val s by vm.state.collectAsState()
    val ready by vm.ready.collectAsState()
    val saved by vm.saved.collectAsState()
    val cats by remember { c.repo.categories() }.collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    var confirmLeave by remember { mutableStateOf(false) }
    var detailsOpen by remember { mutableStateOf(false) }
    var catsOpen by remember { mutableStateOf(false) }
    var photoMenu by remember { mutableStateOf(false) }
    var ingEditor by remember { mutableStateOf(false) }
    var dirEditor by remember { mutableStateOf(false) }
    var duplicate by remember { mutableStateOf<Recipe?>(null) }
    val pickers = rememberPhotoPickers({ uri -> scope.launch { c.photos.saveFromUri(uri)?.let { f -> vm.edit { it.copy(photo = f) } } ?: snack.showSnackbar("That photo couldn't be used.") } }, { scope.launch { snack.showSnackbar(it) } })

    LaunchedEffect(saved) {
        val id = saved ?: return@LaunchedEffect
        nav.navigate(Routes.detail(id)) { popUpTo(Routes.HUB) }   // never make the user wait for the toast
        launch { snack.say("Saved to your collection") }
    }
    LaunchedEffect(ready) { if (ready && s.confidence != null && s.confidence != Confidence.HIGH) snack.showSnackbar("Some parts were guessed. Look for the yellow ! marks.") }
    fun leave() { if (s.dirty && saved == null) confirmLeave = true else nav.popBackStack() }
    BackHandler { leave() }

    fun warn(vararg fields: String) = s.warnings.filter { it.field in fields && it.severity != Severity.INFO || (it.field in fields && it.severity == Severity.INFO && it.field in listOf("photo", "servings", "times", "source")) }.map { it.message }

    fun trySave() {
        val problems = vm.problems()
        if (problems.isNotEmpty()) { vm.edit { it.copy(showErrors = true) }; scope.launch { snack.say(problems.first()) }; return }
        val r = vm.buildRecipe()
        scope.launch { val dup = vm.duplicateOf(r); if (dup != null) duplicate = dup else vm.save(r) }
    }

    ArtScreen("review", if (editId != null) "Edit recipe" else "Review and save", onTarget = { id ->
        when (id) {
            "back" -> leave()
            "photo" -> photoMenu = true
            "add_ingredient" -> vm.edit { it.copy(ingredients = it.ingredients + EditRow(newId(), "")) }
            "add_direction" -> vm.edit { it.copy(directions = it.directions + EditRow(newId(), "")) }
            "ingredients_head" -> ingEditor = true
            "directions_head" -> dirEditor = true
            "add_category" -> catsOpen = true
            "details" -> detailsOpen = true
            "save" -> trySave()
        }
    }) {
        // photo over the placeholder
        if (s.photo != null) PhotoImage(c.photos, s.photo, Modifier.region(page.target("photo").box).clip(RoundedCornerShape(dp(14f))), s.title, description = "Recipe photo. Tap to change.")
        // title and source fields
        val fieldStyle = TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = sp(32f), color = Palette.Ink)
        Box(Modifier.region("title").padding(start = dp(14f), end = dp(48f)), contentAlignment = Alignment.CenterStart) {
            val invalid = s.showErrors && s.title.isBlank()
            BasicTextField(s.title, { v -> vm.edit { it.copy(title = v) } }, Modifier.fillMaxWidth().testTag("title-field").semantics { contentDescription = "Recipe title" },
                textStyle = fieldStyle, maxLines = 2, cursorBrush = SolidColor(Palette.Tomato),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
                decorationBox = { inner -> if (s.title.isEmpty()) Text(if (invalid) "Title needed" else "Recipe title", style = fieldStyle, color = if (invalid) MaterialTheme.colorScheme.error else Palette.Ink.copy(alpha = 0.45f)); inner() })
        }
        if (s.showErrors && s.title.isBlank()) Box(Modifier.region("title").border(3.dp, MaterialTheme.colorScheme.error, RoundedCornerShape(dp(14f))).clearAndSetSemantics { })
        WarnBadge("title", warn("title"), Modifier.region(NRect(0.80f, 0.205f, 0.12f, 0.05f)))
        Box(Modifier.region("source").padding(start = dp(10f), end = dp(10f)), contentAlignment = Alignment.CenterStart) {
            val st = TextStyle(fontFamily = BodyFont, fontSize = sp(25f), color = Palette.Ink)
            BasicTextField(s.sourceText, { v -> vm.edit { it.copy(sourceText = v) } }, Modifier.fillMaxWidth().testTag("source-field").semantics { contentDescription = "Source" },
                textStyle = st, singleLine = true, cursorBrush = SolidColor(Palette.Tomato), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                decorationBox = { inner -> if (s.sourceText.isEmpty()) Text("Source (website or cookbook)", style = st, color = Palette.Ink.copy(alpha = 0.45f)); inner() })
        }
        WarnBadge("photo", warn("photo"), Modifier.region(NRect(0.30f, 0.20f, 0.07f, 0.05f)).offset(y = dp(-40f)))

        // ingredient rows (dynamic, start with one)
        WarnBadge("ingredients", warn("ingredients"), Modifier.region(NRect(0.52f, 0.352f, 0.12f, 0.04f)))
        EditableRows(
            s.ingredients, { r -> vm.edit { it.copy(ingredients = r) } }, onDelete = { row, i ->
                val before = s.ingredients
                if (before.size == 1) vm.edit { it.copy(ingredients = listOf(EditRow(newId(), ""))) } else vm.edit { it.copy(ingredients = before.filter { x -> x.id != row.id }) }
                scope.launch { snack.undoable("Removed ingredient ${i + 1}") { vm.edit { it.copy(ingredients = before) } } }
            },
            Modifier.region("ingredients"), hint = "Ingredient, e.g. 2 cups flour", showErrors = false, compact = true, tag = "ing-rows",
            textStyle = TextStyle(fontFamily = BodyFont, fontSize = 16.sp, color = Palette.Ink), newRow = { EditRow(newId(), "") },
        )
        WarnBadge("directions", warn("directions"), Modifier.region(NRect(0.52f, 0.552f, 0.12f, 0.04f)))
        EditableRows(
            s.directions, { r -> vm.edit { it.copy(directions = r) } }, onDelete = { row, i ->
                val before = s.directions
                if (before.size == 1) vm.edit { it.copy(directions = listOf(EditRow(newId(), ""))) } else vm.edit { it.copy(directions = before.filter { x -> x.id != row.id }) }
                scope.launch { snack.undoable("Removed step ${i + 1}") { vm.edit { it.copy(directions = before) } } }
            },
            Modifier.region("directions"), numbered = true, hint = "Describe this step", compact = true, tag = "dir-rows",
            textStyle = TextStyle(fontFamily = BodyFont, fontSize = 16.sp, color = Palette.Ink), newRow = { EditRow(newId(), "") },
        )
        // categories: the enabled ones, tap to attach
        FlowRow(Modifier.region(NRect(0.505f, 0.811f, 0.45f, 0.1f)).clipToBounds().verticalScroll(rememberScrollState()).testTag("review-categories"), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(0.dp)) {
            cats.filter { it.enabled || it.id in s.categories }.forEach { cat ->
                Chip(cat.name, cat.id in s.categories, { vm.edit { it.copy(categories = if (cat.id in it.categories) it.categories - cat.id else it.categories + cat.id) } })
            }
        }
    }

    // ---- sheets ----
    if (ingEditor) RowsEditorSheet("Ingredients", s.ingredients, "e.g. 1 1/2 cups flour", false, true, onSave = { r -> vm.edit { it.copy(ingredients = r) }; ingEditor = false }, onDismiss = { ingEditor = false })
    if (dirEditor) RowsEditorSheet("Directions", s.directions, "Describe this step", true, true, onSave = { r -> vm.edit { it.copy(directions = r) }; dirEditor = false }, onDismiss = { dirEditor = false })
    if (catsOpen) AddCategorySheet(c, s.categories, onSelect = { id, on -> vm.edit { it.copy(categories = if (on) it.categories + id else it.categories - id) } }, onDismiss = { catsOpen = false })
    if (detailsOpen) DetailsSheet(s, onChange = { f -> vm.edit(f) }, onDismiss = { detailsOpen = false }, onEditIngredients = { detailsOpen = false; ingEditor = true }, onEditDirections = { detailsOpen = false; dirEditor = true })
    if (photoMenu) ModalBottomSheet({ photoMenu = false }) {
        Column(Modifier.padding(20.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Recipe photo", style = MaterialTheme.typography.headlineSmall)
            BigButton("Choose from gallery", { photoMenu = false; pickers.gallery() }, Modifier.fillMaxWidth())
            BigButton("Take a photo", { photoMenu = false; pickers.camera() }, Modifier.fillMaxWidth(), primary = false)
            if (s.candidates.size > 1) BigButton("Try another image from the page", { scope.launch { if (!vm.nextCandidate()) snack.showSnackbar("That image couldn't be downloaded.") }; photoMenu = false }, Modifier.fillMaxWidth(), primary = false)
            if (s.photo != null) BigButton("Remove photo", { photoMenu = false; vm.edit { it.copy(photo = null) } }, Modifier.fillMaxWidth(), primary = false)
        }
    }
    if (confirmLeave) ConfirmDialog("Leave without saving?", "Your changes to this recipe haven't been saved.", "Discard", destructive = true, onDismiss = { confirmLeave = false },
        onConfirm = { confirmLeave = false; if (editId == null) c.importSession.clear(); nav.popBackStack() })
    duplicate?.let { d ->
        AlertDialog({ duplicate = null }, title = { Text("You may already have this") }, text = { Text("“${d.title}” is already in your collection. Save this as a separate recipe, or keep the one you have?") },
            confirmButton = { TextButton({ duplicate = null; vm.save(vm.buildRecipe()) }) { Text("Save as new") } },
            dismissButton = { TextButton({ duplicate = null; nav.navigate(Routes.detail(d.id)) }) { Text("Open existing") } })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DetailsSheet(s: ReviewState, onChange: ((ReviewState) -> ReviewState) -> Unit, onDismiss: () -> Unit, onEditIngredients: () -> Unit, onEditDirections: () -> Unit) {
    ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxHeight(0.92f).padding(horizontal = 20.dp).imePadding().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Edit details", style = MaterialTheme.typography.headlineSmall)
            @Composable fun num(label: String, v: String, tag: String, set: (String) -> Unit, mod: Modifier) = OutlinedTextField(v, { set(it.filter(Char::isDigit).take(4)) }, mod.testTag(tag), label = { Text(label) }, singleLine = true,
                isError = false, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                num("Servings", s.servings, "servings-field", { v -> onChange { it.copy(servings = v) } }, Modifier.weight(1f))
                num("Prep (min)", s.prep, "prep-field", { v -> onChange { it.copy(prep = v) } }, Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                num("Cook (min)", s.cook, "cook-field", { v -> onChange { it.copy(cook = v) } }, Modifier.weight(1f))
                num("Total (min)", s.total, "total-field", { v -> onChange { it.copy(total = v) } }, Modifier.weight(1f))
            }
            OutlinedTextField(s.cuisine, { v -> onChange { it.copy(cuisine = v) } }, Modifier.fillMaxWidth(), label = { Text("Cuisine") }, singleLine = true)
            OutlinedTextField(s.sourceUrl.orEmpty(), { v -> onChange { it.copy(sourceUrl = v.ifBlank { null }) } }, Modifier.fillMaxWidth(), label = { Text("Original link") }, singleLine = true)
            OutlinedTextField(s.description, { v -> onChange { it.copy(description = v) } }, Modifier.fillMaxWidth().heightIn(min = 90.dp), label = { Text("Description") })
            OutlinedTextField(s.notes, { v -> onChange { it.copy(notes = v) } }, Modifier.fillMaxWidth().heightIn(min = 90.dp).testTag("notes-field"), label = { Text("Notes and substitutions") })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onEditIngredients, Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Edit all ingredients") }
                OutlinedButton(onEditDirections, Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Edit all directions") }
            }
            if (s.rawSource != null) Text("The original imported text is kept with this recipe so you can fix mistakes later.", style = MaterialTheme.typography.bodySmall)
            val infos = s.warnings.filter { it.severity == Severity.INFO }
            if (infos.isNotEmpty()) { Text("Import notes", style = MaterialTheme.typography.titleSmall); infos.forEach { Text("• ${it.message}", style = MaterialTheme.typography.bodySmall) } }
            BigButton("Done", onDismiss, Modifier.fillMaxWidth().padding(bottom = 16.dp))
        }
    }
}
