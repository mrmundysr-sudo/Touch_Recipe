package com.mundymorning.touchrecipe.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavController
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.model.*
import com.mundymorning.touchrecipe.core.planner.Planner
import com.mundymorning.touchrecipe.core.quantity.Quantities
import com.mundymorning.touchrecipe.ui.Routes
import com.mundymorning.touchrecipe.ui.art.ArtButton
import com.mundymorning.touchrecipe.ui.art.ArtSlot
import com.mundymorning.touchrecipe.ui.art.PageFrame
import com.mundymorning.touchrecipe.ui.components.*
import com.mundymorning.touchrecipe.ui.theme.DisplayFont
import com.mundymorning.touchrecipe.ui.theme.Palette
import com.mundymorning.touchrecipe.ui.vmOf
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.LocalDate

class DetailViewModel(private val c: AppContainer, val id: String) : ViewModel() {
    val recipe: StateFlow<Recipe?> = c.repo.recipe(id).stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val servings = MutableStateFlow<Int?>(null)
    val loaded = MutableStateFlow(false)
    init { viewModelScope.launch { c.repo.recipe(id).first().let { servings.value = it?.servings }; loaded.value = true } }

    fun step(delta: Int) { val base = recipe.value?.servings ?: servings.value ?: 4; servings.value = ((servings.value ?: base) + delta).coerceIn(1, 99) }
    fun toggleIngredient(i: Ingredient) = viewModelScope.launch { c.repo.updateIngredients(id) { l -> l.map { if (it.id == i.id) it.copy(checked = !it.checked) else it } } }
    fun saveIngredients(rows: List<EditRow>) = viewModelScope.launch {
        val old = recipe.value?.ingredients.orEmpty().associateBy { it.id }
        c.repo.updateIngredients(id) { rows.map { r -> Ingredient(r.id, r.text.trim(), r.header, old[r.id]?.checked ?: false) } }
        touch()
    }
    fun saveDirections(rows: List<EditRow>) = viewModelScope.launch {
        val r = recipe.value ?: return@launch
        val old = r.directions.associateBy { it.id }
        c.repo.saveRecipe(r.copy(directions = rows.map { x -> Direction(x.id, x.text.trim(), if (x.header) null else (old[x.id]?.takeIf { it.text == x.text.trim() }?.timerSeconds ?: Durations.timerSeconds(x.text)), x.header) }))
    }
    private suspend fun touch() { recipe.value?.let { c.repo.saveRecipe(it) } }
    fun toggleFavorite() = viewModelScope.launch { recipe.value?.let { c.repo.setFavorite(it.id, !it.favorite) } }
    fun setPhoto(name: String?) = viewModelScope.launch { recipe.value?.let { c.repo.saveRecipe(it.copy(photo = name)) } }
}

private typealias Durations = com.mundymorning.touchrecipe.core.importer.Durations

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DetailScreen(c: AppContainer, nav: NavController, id: String) {
    val vm = vmOf("detail-$id") { DetailViewModel(c, id) }
    val recipe by vm.recipe.collectAsState()
    val servings by vm.servings.collectAsState()
    val loaded by vm.loaded.collectAsState()
    val cats by remember { c.repo.categories() }.collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snack = LocalSnack.current
    var ingEditor by remember { mutableStateOf(false) }
    var dirEditor by remember { mutableStateOf(false) }
    var groceryPicker by remember { mutableStateOf(false) }
    var photoMenu by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var planPicker by remember { mutableStateOf(false) }
    val pickers = rememberPhotoPickers({ uri -> scope.launch { c.photos.saveFromUri(uri)?.let { vm.setPhoto(it) } ?: snack.showSnackbar("That photo couldn't be used.") } }, { scope.launch { snack.showSnackbar(it) } })

    val r = recipe
    if (r == null) {
        // not found (deleted) or still loading
        PageFrame("Recipe", topBar = { Row(Modifier.fillMaxWidth().padding(8.dp)) { ArtButton("back", "←", round = true, description = "Back", onClick = { nav.goBackOr(Routes.collection()) }) } }) {
            if (loaded) Text("This recipe is no longer in your collection.", Modifier.align(Alignment.Center).padding(24.dp), color = Palette.Ink, textAlign = TextAlign.Center)
        }
        return
    }
    val factor = Quantities.factor(r.servings, servings)
    val listState = rememberLazyListState()
    val originalsTick by c.originals.changes.collectAsState()
    val original = remember(r.id, originalsTick) { c.originals.forRecipe(r.id) }
    val openQuestions = original?.helpNotes.orEmpty().filter { !it.resolved }
    fun openRescue() {
        // one unfinished repair per recipe: reopen it rather than start a second copy
        val existing = c.drafts.all().firstOrNull { it.recipeId == r.id }
        val draft = existing ?: com.mundymorning.touchrecipe.core.rescue.RescueDraft(recipe = r, recipeId = r.id, helpNotes = original?.helpNotes.orEmpty(),
            source = original?.source?.takeIf { !it.isEmpty } ?: OriginalSource(if (r.rawSource.isNullOrBlank()) SourceKind.NONE else SourceKind.TEXT, r.sourceUrl, emptyList(), r.rawSource.orEmpty(), c.clock()),
            createdAt = c.clock(), updatedAt = c.clock()).also { c.drafts.save(it) }
        nav.navigate(Routes.rescue(draft.id))
    }
    val bodyStyle = TextStyle(fontFamily = com.mundymorning.touchrecipe.ui.theme.BodyFont, fontSize = 18.sp, lineHeight = 25.sp, color = Palette.Ink)
    val headStyle = TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = Palette.Forest)
    val numbers = remember(r.directions) { var n = 0; r.directions.map { if (it.header) 0 else ++n } }

    PageFrame(r.title.ifBlank { "Recipe" },
        topBar = {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                ArtButton("back", "←", round = true, description = "Back", hint = "Returns to the Recipe Collection", onClick = { nav.goBackOr(Routes.collection()) })
                Spacer(Modifier.weight(1f))
                Box(Modifier.size(48.dp).clip(CircleShape).background(Color(0xFFFBF4E6)).border(1.5.dp, Palette.Brass, CircleShape)
                    .clickable(onClickLabel = "More options", role = Role.Button) { menu = true }.semantics { contentDescription = "More options" }.testTag("detail-more"), contentAlignment = Alignment.Center) { Text("⋯", fontSize = 24.sp, color = Palette.Ink) }
                Spacer(Modifier.width(8.dp))
                ArtButton("favorite", "Favorite", round = true, hint = "Toggles favorite", onClick = { vm.toggleFavorite() }) {
                    Text(if (r.favorite) "♥" else "♡", color = Palette.Tomato, fontSize = 26.sp, modifier = Modifier.testTag("heart-glyph:${if (r.favorite) "on" else "off"}"))
                }
            }
        },
        bottomBar = {
            Column(Modifier.fillMaxWidth().background(Palette.CreamDeep.copy(alpha = 0.7f)).padding(horizontal = 10.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Servings", Modifier.weight(1f), style = bodyStyle.copy(fontWeight = FontWeight.SemiBold))
                    ArtButton("serv_dec", "−", round = true, description = "Fewer servings", hint = "Decreases servings and scales ingredients", onClick = { vm.step(-1) })
                    Box(Modifier.width(64.dp).semantics { contentDescription = "Servings: ${servings ?: "not set"}"; liveRegion = LiveRegionMode.Polite }, contentAlignment = Alignment.Center) {
                        Text((servings ?: r.servings)?.toString() ?: "—", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Palette.Ink, textAlign = TextAlign.Center, modifier = Modifier.testTag("servings-value"))
                    }
                    ArtButton("serv_inc", "+", round = true, description = "More servings", hint = "Increases servings and scales ingredients", onClick = { vm.step(1) })
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ArtButton("cook", "Cook Mode", Modifier.weight(1f), primary = true, hint = "Step by step cooking",
                        onClick = { if (r.directions.none { !it.header }) scope.launch { snack.showSnackbar("Add directions first, then Cook Mode can guide you.") } else nav.navigate(Routes.cook(r.id, servings)) })
                    ArtButton("grocery", "Add to Grocery List", Modifier.weight(1f), hint = "Adds ingredients to the grocery list",
                        onClick = { if (r.ingredients.none { !it.header }) scope.launch { snack.showSnackbar("This recipe has no ingredients yet.") } else groceryPicker = true })
                }
            }
        },
    ) {
        // one continuous page: it is exactly as long as this recipe needs
        LazyColumn(Modifier.fillMaxSize().testTag("ingredient-list"), state = listState, contentPadding = PaddingValues(bottom = 20.dp)) {
            item(key = "art-top") { ArtSlot("recipe_detail_top") }
            item(key = "photo") {
                if (r.photo != null) Box(Modifier.fillMaxWidth().heightIn(max = 220.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(16.dp))
                    .clickable(onClickLabel = "Shows, replaces or removes the photo", role = Role.Button) { photoMenu = true }.testTag("detail-photo")) {
                    PhotoImage(c.photos, r.photo, Modifier.fillMaxSize(), r.title, maxEdge = 1200, description = "Photo of ${r.title}")
                } else Box(Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(14.dp)).background(Palette.CreamDeep.copy(alpha = 0.6f))
                    .clickable(onClickLabel = "Adds a photo", role = Role.Button) { photoMenu = true }.testTag("detail-photo"), contentAlignment = Alignment.Center) {
                    Text("Tap to add a photo", color = Palette.Forest, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                }
            }
            item(key = "title") {
                Column(Modifier.fillMaxWidth().padding(top = 10.dp)) {
                    // the whole title is always shown; a long one simply takes more lines
                    Text(r.title.ifBlank { "Untitled recipe" }, style = TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 28.sp, lineHeight = 34.sp, color = Palette.Ink), modifier = Modifier.semantics { heading() })
                    val names = r.categoryIds.mapNotNull { id -> cats.firstOrNull { it.id == id }?.name }
                    if (names.isNotEmpty()) Text(names.joinToString(" · "), color = Palette.Forest, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    if (r.description.isNotBlank()) Text(r.description, style = bodyStyle, modifier = Modifier.padding(top = 4.dp))
                    val src = r.sourceName ?: r.sourceUrl
                    if (src != null) Text("Source: $src", color = Palette.Forest, fontSize = 16.sp, textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline,
                        modifier = Modifier.heightIn(min = 40.dp).clickable(enabled = r.sourceUrl != null, onClickLabel = "Open the original page") { r.sourceUrl?.let { u -> if (!openLink(context, u)) scope.launch { snack.showSnackbar("No app could open that link.") } } }.padding(top = 8.dp))
                }
            }
            item(key = "meta") {
                val vals = listOf("Prep" to minutesLabel(r.prepMinutes), "Cook" to minutesLabel(r.cookMinutes), "Total" to minutesLabel(r.effectiveTotal))
                FlowRow(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    vals.forEach { (name, v) ->
                        Box(Modifier.clip(RoundedCornerShape(10.dp)).background(Palette.CreamDeep.copy(alpha = 0.6f)).padding(horizontal = 10.dp, vertical = 6.dp).semantics(mergeDescendants = true) { contentDescription = "$name time: ${v ?: "not set"}" }) {
                            Text("$name  ${v ?: "—"}", style = bodyStyle.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold))
                        }
                    }
                }
            }
            if (openQuestions.isNotEmpty()) item(key = "questions") {
                Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFFFE9A8)).padding(12.dp).testTag("detail-questions")) {
                    Text("Still to check (${openQuestions.size})", fontWeight = FontWeight.Bold, color = Palette.Ink, fontSize = 17.sp)
                    openQuestions.forEach { q ->
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(false, role = Role.Checkbox, onValueChange = { c.originals.updateHelp(r.id) { l -> l.map { if (it.id == q.id) it.copy(resolved = true) else it } } }), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).border(2.dp, Palette.Ink, RoundedCornerShape(6.dp)))
                            Spacer(Modifier.width(10.dp)); Text(q.text, style = bodyStyle.copy(fontSize = 16.sp))
                        }
                    }
                    Text("Tick a question when it has been answered.", fontSize = 13.sp, color = Palette.Ink.copy(alpha = 0.75f))
                }
            }
            item(key = "ing-head") {
                Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Ingredients", Modifier.weight(1f).semantics { heading() }, style = headStyle)
                    TextButton({ ingEditor = true }, Modifier.testTag("edit-ingredients")) { Text("Edit", color = Palette.Forest, fontSize = 16.sp) }
                }
            }
            if (r.ingredients.isEmpty()) item(key = "ing-empty") { Text("No ingredients yet. Tap Edit to add some.", color = Palette.Ink.copy(alpha = 0.7f), style = bodyStyle) }
            itemsIndexed(r.ingredients, key = { _, i -> "ing:" + i.id }) { _, ing ->
                val shown = if (ing.header) ing.text else Quantities.scale(ing.text, factor)
                if (ing.header) Text(shown, fontWeight = FontWeight.Bold, color = Palette.Forest, fontSize = 18.sp, modifier = Modifier.padding(top = 8.dp, bottom = 2.dp).semantics { heading() })
                else Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(ing.checked, role = Role.Checkbox, onValueChange = { vm.toggleIngredient(ing) }).padding(vertical = 4.dp).testTag("ingredient:${ing.id}"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(26.dp).clip(RoundedCornerShape(6.dp)).border(2.dp, Palette.Forest, RoundedCornerShape(6.dp)).background(if (ing.checked) Palette.Forest else Color.Transparent), contentAlignment = Alignment.Center) {
                        if (ing.checked) Text("✓", color = Palette.Cream, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(12.dp))
                    Text(shown, style = bodyStyle, textDecoration = if (ing.checked) androidx.compose.ui.text.style.TextDecoration.LineThrough else null)
                }
            }
            item(key = "dir-head") {
                Row(Modifier.fillMaxWidth().padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Directions", Modifier.weight(1f).semantics { heading() }, style = headStyle)
                    TextButton({ dirEditor = true }, Modifier.testTag("edit-directions")) { Text("Edit", color = Palette.Forest, fontSize = 16.sp) }
                }
            }
            if (r.directions.isEmpty()) item(key = "dir-empty") { Text("No directions yet. Tap Edit to add some.", color = Palette.Ink.copy(alpha = 0.7f), style = bodyStyle) }
            itemsIndexed(r.directions, key = { _, d -> "dir:" + d.id }) { i, d ->
                if (d.header) Text(d.text, fontWeight = FontWeight.Bold, color = Palette.Forest, fontSize = 18.sp, modifier = Modifier.padding(top = 8.dp, bottom = 2.dp).semantics { heading() })
                else Row(Modifier.fillMaxWidth().padding(vertical = 6.dp).semantics(mergeDescendants = true) {}.testTag("direction:${d.id}"), verticalAlignment = Alignment.Top) {
                    Box(Modifier.size(32.dp).clip(CircleShape).background(Palette.Forest), contentAlignment = Alignment.Center) { Text("${numbers.getOrElse(i) { 0 }}", color = Palette.Cream, fontSize = 15.sp, lineHeight = 15.sp, fontWeight = FontWeight.Bold) }
                    Spacer(Modifier.width(12.dp))
                    Text(d.text, style = bodyStyle, modifier = Modifier.weight(1f))
                }
            }
            if (r.notes.isNotBlank()) item(key = "notes") {
                Column(Modifier.fillMaxWidth().padding(top = 14.dp)) {
                    Text("Notes", Modifier.semantics { heading() }, style = headStyle)
                    Text(r.notes, style = bodyStyle, modifier = Modifier.testTag("detail-notes"))
                }
            }
            if (original != null && !original.source.isEmpty) item(key = "original") {
                Column(Modifier.fillMaxWidth().padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Original", Modifier.semantics { heading() }, style = headStyle)
                    Text(when (original.source.kind) { SourceKind.IMAGE -> "The original photo or scan is kept with this recipe."; SourceKind.PDF -> "The original PDF is kept with this recipe."; SourceKind.WEB -> "A copy of the original page is kept with this recipe."; else -> "The original text is kept with this recipe." }, style = bodyStyle.copy(fontSize = 16.sp))
                    BigButton("View the original", { nav.navigate(Routes.original(r.id)) }, Modifier.fillMaxWidth().testTag("view-original"), primary = false)
                }
            }
            // the closing decoration belongs to the real end of the recipe, however long the page is
            item(key = "art-bottom") { ArtSlot("recipe_detail_bottom", 34.dp) }
        }
    }

    // ---- sheets & dialogs ----
    if (ingEditor) RowsEditorSheet("Ingredients", r.ingredients.map { EditRow(it.id, it.text, it.header) }, "e.g. 1 1/2 cups flour", false, true,
        note = if (factor != 1.0) "You are editing the original amounts (for ${r.servings} servings)." else null,
        onSave = { vm.saveIngredients(it); ingEditor = false }, onDismiss = { ingEditor = false })
    if (dirEditor) RowsEditorSheet("Directions", r.directions.map { EditRow(it.id, it.text, it.header) }, "Describe this step", true, true,
        onSave = { vm.saveDirections(it); dirEditor = false }, onDismiss = { dirEditor = false })
    if (photoMenu) ModalBottomSheet({ photoMenu = false }) {
        Column(Modifier.padding(20.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Recipe photo", style = MaterialTheme.typography.headlineSmall)
            BigButton("Choose from gallery", { photoMenu = false; pickers.gallery() }, Modifier.fillMaxWidth())
            BigButton("Take a photo", { photoMenu = false; pickers.camera() }, Modifier.fillMaxWidth(), primary = false)
            if (r.photo != null) BigButton("Remove photo", { photoMenu = false; vm.setPhoto(null) }, Modifier.fillMaxWidth(), primary = false)
        }
    }
    if (menu) ModalBottomSheet({ menu = false }) {
        Column(Modifier.padding(20.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(r.title.ifBlank { "Recipe" }, style = MaterialTheme.typography.headlineSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            BigButton("Edit details", { menu = false; nav.navigate(Routes.review(r.id)) }, Modifier.fillMaxWidth(), primary = false)
            BigButton("Repair with Recipe Rescue", { menu = false; openRescue() }, Modifier.fillMaxWidth().testTag("detail-rescue"), primary = false)
            BigButton("Add to meal plan", { menu = false; planPicker = true }, Modifier.fillMaxWidth(), primary = false)
            BigButton("Share as text", { menu = false; shareText(context, r.title, RecipeText.format(r, servings)) }, Modifier.fillMaxWidth(), primary = false)
            BigButton("Delete recipe", { menu = false; confirmDelete = true }, Modifier.fillMaxWidth(), primary = false)
        }
    }
    if (confirmDelete) ConfirmDialog("Delete this recipe?", "“${r.title}” will be removed from your collection and meal plan. You can undo right after.", "Delete", destructive = true, onDismiss = { confirmDelete = false }, onConfirm = {
        confirmDelete = false
        scope.launch {
            val removed = c.repo.deleteRecipe(r.id)
            nav.goBackOr(Routes.collection())
            if (removed != null) snack.undoable("Deleted “${removed.title}”") { c.repo.restoreRecipe(removed) }
        }
    })
    if (groceryPicker) GroceryAddSheet(r, servings, c, onDismiss = { groceryPicker = false }, onOpenList = { groceryPicker = false; nav.navigate(Routes.GROCERY) })
    if (planPicker) DayPickerSheet("Add “${r.title}” to which day?", onDismiss = { planPicker = false }, onPick = { date ->
        planPicker = false
        scope.launch { c.repo.assignMeal(date, r.id, servings ?: r.servings); snack.showSnackbar("Planned for ${Planner.dayLabel(date)}, ${Planner.dateLabel(date)}.") }
    })
}

object RecipeText {
    fun format(r: Recipe, servings: Int?): String {
        val f = Quantities.factor(r.servings, servings)
        return buildString {
            appendLine(r.title); if (r.description.isNotBlank()) appendLine(r.description)
            val meta = metaLine(r); if (meta.isNotEmpty()) appendLine(meta)
            appendLine(); appendLine("Ingredients")
            r.ingredients.forEach { appendLine(if (it.header) "\n${it.text}:" else "• " + Quantities.scale(it.text, f)) }
            appendLine(); appendLine("Directions")
            var n = 0; r.directions.forEach { if (it.header) appendLine("\n${it.text}:") else appendLine("${++n}. ${it.text}") }
            if (r.notes.isNotBlank()) { appendLine(); appendLine("Notes: ${r.notes}") }
            r.sourceUrl?.let { appendLine(); appendLine("Source: $it") }
        }.trim()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroceryAddSheet(r: Recipe, servings: Int?, c: AppContainer, onDismiss: () -> Unit, onOpenList: () -> Unit) {
    val scope = rememberCoroutineScope()
    val sunday by c.prefs.sundayStart.collectAsState()
    var week by remember { mutableStateOf(Planner.weekStart(LocalDate.now(), if (sunday) java.time.DayOfWeek.SUNDAY else java.time.DayOfWeek.MONDAY)) }
    val checked = r.ingredients.filter { it.checked && !it.header }
    var onlyChecked by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismiss) {
        Column(Modifier.padding(20.dp).navigationBarsPadding().padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Add to Grocery List", style = MaterialTheme.typography.headlineSmall)
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton({ week = week.minusWeeks(1) }) { Text("‹ Earlier") }
                Text(Planner.rangeLabel(week), Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.titleMedium)
                TextButton({ week = week.plusWeeks(1) }) { Text("Later ›") }
            }
            Chip("All ${r.ingredients.count { !it.header }} ingredients", !onlyChecked, { onlyChecked = false }, Modifier.fillMaxWidth())
            Chip("Only the ${checked.size} I ticked", onlyChecked, { if (checked.isNotEmpty()) onlyChecked = true }, Modifier.fillMaxWidth())
            if (checked.isEmpty()) Text("Tick ingredients in the recipe first to add just those.", style = MaterialTheme.typography.bodySmall)
            val msg = result
            if (msg != null) Text(msg, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, style = MaterialTheme.typography.titleSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BigButton("Add", { scope.launch {
                    val n = c.repo.addIngredientsToGroceries(week, r, servings ?: r.servings, if (onlyChecked) checked else null)
                    c.selectedWeek.value = week   // so "Open list" (and the Grocery page) show the week these were added to
                    result = if (n == 0) "Everything is already on the list for ${Planner.rangeLabel(week)}." else "Added or updated $n ${if (n == 1) "item" else "items"} on the list for ${Planner.rangeLabel(week)}. Tap Open list to see them."
                } }, Modifier.weight(1f))
                BigButton("Open list", onOpenList, Modifier.weight(1f), primary = false)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DayPickerSheet(title: String, onDismiss: () -> Unit, onPick: (LocalDate) -> Unit) {
    val today = LocalDate.now()
    ModalBottomSheet(onDismiss) {
        Column(Modifier.padding(20.dp).padding(bottom = 20.dp)) {
            Text(title, style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            (0..13).forEach { i ->
                val d = today.plusDays(i.toLong())
                Text("${if (i == 0) "Today" else Planner.dayLabel(d)}, ${Planner.dateLabel(d)}", Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable { onPick(d) }.padding(vertical = 14.dp), style = MaterialTheme.typography.titleMedium)
                HorizontalDivider()
            }
        }
    }
}
