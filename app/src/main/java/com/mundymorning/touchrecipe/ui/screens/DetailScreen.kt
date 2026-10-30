package com.mundymorning.touchrecipe.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
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
import com.mundymorning.touchrecipe.ui.art.ArtScreen
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
    val cats by c.repo.categories().collectAsState(initial = emptyList())
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
        ArtScreen("detail", "Recipe", onTarget = { if (it == "back") nav.goBackOr(Routes.collection()) }) {
            if (loaded) Box(Modifier.region("title"), contentAlignment = Alignment.Center) { Text("This recipe is no longer in your collection.", color = Palette.Ink, textAlign = TextAlign.Center) }
        }
        return
    }
    val factor = Quantities.factor(r.servings, servings)

    ArtScreen("detail", r.title.ifBlank { "Recipe" }, onTarget = { t ->
        when (t) {
            "back" -> nav.goBackOr(Routes.collection())
            "favorite" -> vm.toggleFavorite()
            "cook" -> if (r.directions.none { !it.header }) scope.launch { snack.showSnackbar("Add directions first, then Cook Mode can guide you.") } else nav.navigate(Routes.cook(r.id))
            "grocery" -> if (r.ingredients.none { !it.header }) scope.launch { snack.showSnackbar("This recipe has no ingredients yet.") } else groceryPicker = true
            "photo" -> photoMenu = true
            "ingredients_head" -> ingEditor = true
            "directions_head" -> dirEditor = true
            "serv_dec" -> vm.step(-1)
            "serv_inc" -> vm.step(1)
        }
    }) {
        // photo window under the back/heart controls
        val photoBox = page.target("photo").box
        Box(Modifier.region(photoBox).clip(RoundedCornerShape(dp(18f))), contentAlignment = Alignment.Center) {
            PhotoImage(c.photos, r.photo, Modifier.fillMaxSize(), r.title, maxEdge = 1200, description = if (r.photo != null) "Photo of ${r.title}" else null)
            if (r.photo == null) Text("Tap to add a photo", color = Palette.Cream, fontWeight = FontWeight.SemiBold, fontSize = sp(24f), modifier = Modifier.padding(top = dp(110f)))
        }
        // favorite heart with persistent outline / filled state, drawn over the art heart
        Box(Modifier.region(page.target("favorite").box).clip(CircleShape).background(Color(0xFFFBF4E6)).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
            Text(if (r.favorite) "♥" else "♡", color = Palette.Tomato, fontSize = sp(50f), modifier = Modifier.testTag("heart-glyph:${if (r.favorite) "on" else "off"}"))
        }
        // more options
        Box(Modifier.region(com.mundymorning.touchrecipe.ui.art.NRect(0.44f, 0.012f, 0.14f, 0.045f)).clip(CircleShape).background(Color(0xFFFBF4E6).copy(alpha = 0.92f))
            .clickable(onClickLabel = "More options", role = Role.Button) { menu = true }.semantics { contentDescription = "More options" }.testTag("detail-more"), contentAlignment = Alignment.Center) { Text("⋯", fontSize = sp(40f), color = Palette.Ink) }

        // title, categories, description, source
        Column(Modifier.region("title").verticalScroll(rememberScrollState())) {
            FitText(r.title.ifBlank { "Untitled recipe" }, TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = sp(46f), color = Palette.Ink, lineHeight = sp(52f)), maxLines = 3, minScale = 0.5f)
            val names = r.categoryIds.mapNotNull { id -> cats.firstOrNull { it.id == id }?.name }
            if (names.isNotEmpty()) Text(names.joinToString(" · "), color = Palette.Forest, fontSize = sp(21f), fontWeight = FontWeight.SemiBold)
            if (r.description.isNotBlank()) Text(r.description, color = Palette.Ink, fontSize = sp(21f), lineHeight = sp(27f), maxLines = 5, overflow = TextOverflow.Ellipsis)
            val src = r.sourceName ?: r.sourceUrl
            if (src != null) Text("Source: $src", color = Palette.Forest, fontSize = sp(20f), textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline,
                modifier = Modifier.heightIn(min = 32.dp).clickable(enabled = r.sourceUrl != null, onClickLabel = "Open the original page") { r.sourceUrl?.let { u -> if (!openLink(context, u)) scope.launch { snack.showSnackbar("No app could open that link.") } } })
            if (r.notes.isNotBlank()) Text("Notes: ${r.notes}", color = Palette.Ink, fontSize = sp(20f), lineHeight = sp(26f))
        }
        // times and servings (code-rendered values on the artwork's blank lines)
        val vals = listOf(minutesLabel(r.prepMinutes), minutesLabel(r.cookMinutes), minutesLabel(r.effectiveTotal), servings?.toString() ?: r.servings?.toString())
        val names = listOf("Prep time", "Cook time", "Total time", "Servings")
        vals.forEachIndexed { i, v ->
            Box(Modifier.region("meta$i").semantics(mergeDescendants = true) { contentDescription = "${names[i]}: ${v ?: "not set"}" }, contentAlignment = Alignment.CenterStart) {
                FitText(v ?: "—", TextStyle(fontFamily = com.mundymorning.touchrecipe.ui.theme.BodyFont, fontWeight = FontWeight.SemiBold, fontSize = sp(24f), color = Palette.Ink), minScale = 0.6f)
            }
        }
        Box(Modifier.region("servings_value").semantics { contentDescription = "Servings: ${servings ?: "not set"}"; liveRegion = LiveRegionMode.Polite }, contentAlignment = Alignment.Center) {
            Text((servings ?: r.servings)?.toString() ?: "—", fontSize = sp(34f), fontWeight = FontWeight.Bold, color = Palette.Ink, modifier = Modifier.testTag("servings-value"))
        }
        // ingredients (rows generated from the recipe; amounts scaled safely)
        Box(Modifier.region("ingredients")) {
            if (r.ingredients.isEmpty()) Text("No ingredients yet. Tap “Ingredients” to add some.", color = Palette.Ink.copy(alpha = 0.7f), fontSize = sp(22f))
            LazyColumn(Modifier.fillMaxSize().testTag("ingredient-list")) {
                itemsIndexed(r.ingredients, key = { _, i -> i.id }) { _, ing ->
                    val shown = if (ing.header) ing.text else Quantities.scale(ing.text, factor)
                    if (ing.header) Text(shown, fontWeight = FontWeight.Bold, color = Palette.Forest, fontSize = sp(24f), modifier = Modifier.padding(top = 6.dp).semantics { heading() })
                    else Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(ing.checked, role = Role.Checkbox, onValueChange = { vm.toggleIngredient(ing) }).padding(vertical = 2.dp).testTag("ingredient:${ing.id}"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(26.dp).clip(RoundedCornerShape(6.dp)).border(2.dp, Palette.Forest, RoundedCornerShape(6.dp)).background(if (ing.checked) Palette.Forest else Color.Transparent), contentAlignment = Alignment.Center) {
                            if (ing.checked) Text("✓", color = Palette.Cream, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.width(10.dp))
                        Text(shown, color = Palette.Ink, fontSize = sp(25f), lineHeight = sp(30f), textDecoration = if (ing.checked) androidx.compose.ui.text.style.TextDecoration.LineThrough else null)
                    }
                }
            }
        }
        // directions with automatic numbering
        Box(Modifier.region("directions")) {
            if (r.directions.isEmpty()) Text("No directions yet. Tap “Directions” to add some.", color = Palette.Ink.copy(alpha = 0.7f), fontSize = sp(22f))
            LazyColumn(Modifier.fillMaxSize().testTag("direction-list")) {
                var n = 0
                itemsIndexed(r.directions, key = { _, d -> d.id }) { _, d ->
                    if (d.header) Text(d.text, fontWeight = FontWeight.Bold, color = Palette.Forest, fontSize = sp(24f), modifier = Modifier.padding(top = 6.dp).semantics { heading() })
                    else {
                        n++
                        Row(Modifier.padding(vertical = 3.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.Top) {
                            Box(Modifier.size(dp(36f)).clip(CircleShape).background(Palette.Forest), contentAlignment = Alignment.Center) { Text("$n", color = Palette.Cream, fontSize = sp(22f), fontWeight = FontWeight.Bold) }
                            Spacer(Modifier.width(10.dp))
                            Text(d.text, color = Palette.Ink, fontSize = sp(24f), lineHeight = sp(30f), modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
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
        Column(Modifier.padding(20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
                    result = if (n == 0) "Everything is already on the list." else "Added or updated $n items."
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
