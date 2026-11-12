package com.mundymorning.touchrecipe.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.focus.focusRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.grocery.*
import com.mundymorning.touchrecipe.core.model.GroceryItem
import com.mundymorning.touchrecipe.core.planner.Planner
import com.mundymorning.touchrecipe.ui.Routes
import com.mundymorning.touchrecipe.ui.art.ArtButton
import com.mundymorning.touchrecipe.ui.art.ArtSlot
import com.mundymorning.touchrecipe.ui.art.PageFrame
import com.mundymorning.touchrecipe.ui.components.*
import com.mundymorning.touchrecipe.ui.theme.BodyFont
import com.mundymorning.touchrecipe.ui.theme.DisplayFont
import com.mundymorning.touchrecipe.ui.theme.Palette
import kotlinx.coroutines.launch

val AISLE_NAMES = mapOf(AISLE_PRODUCE to "Produce", AISLE_MEAT to "Meat & Seafood", AISLE_DAIRY to "Dairy & Eggs", AISLE_PANTRY to "Pantry", AISLE_BAKERY to "Bakery")
fun aisleName(key: String) = AISLE_NAMES[key] ?: key

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun GroceryScreen(c: AppContainer, nav: NavController) {
    val week by c.selectedWeek.collectAsState()
    val items by remember(week) { c.repo.groceryItems(week) }.collectAsState(initial = emptyList())
    val customAisles by remember { c.repo.customAisles() }.collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val collapsed = remember { mutableStateListOf<String>() }
    val sundayStart by c.prefs.sundayStart.collectAsState()
    var weekSheet by remember { mutableStateOf(false) }
    var addSheet by remember { mutableStateOf(false) }
    var basketSheet by remember { mutableStateOf(false) }
    var rowSheet by remember { mutableStateOf<GroceryItem?>(null) }
    var confirmClear by remember { mutableStateOf(false) }
    val allAisles = DEFAULT_AISLES + customAisles
    val checkedCount = items.count { it.checked }

    PageFrame("Grocery List",
        topBar = {
            Column(Modifier.fillMaxWidth().background(Palette.CreamDeep.copy(alpha = 0.7f)).padding(horizontal = 8.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ArtButton("back", "←", round = true, description = "Back", onClick = { nav.goBackOr(Routes.HUB) })
                    Text("Grocery List", Modifier.weight(1f).padding(start = 12.dp).semantics { heading() }, style = TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = Palette.Forest))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    ArtButton("week", "Week", Modifier.weight(1f), description = "Week range, ${Planner.rangeLabel(week)}", hint = "Chooses the week", onClick = { weekSheet = true }) {
                        Text(Planner.rangeLabel(week) + "  ▾", style = TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Palette.Ink), maxLines = 1, modifier = Modifier.testTag("grocery-week"))
                    }
                    ArtButton("basket", "From meal plan", hint = "Adds the ingredients of this week's planned meals",
                        onClick = { scope.launch { val n = c.repo.generateGroceries(week); basketSheet = true; snack.showSnackbar(if (n == 0) "No meals are planned this week, so nothing was added." else "Refreshed from $n planned ${if (n == 1) "meal" else "meals"}.") } })
                }
            }
        },
        bottomBar = {
            Row(Modifier.fillMaxWidth().background(Palette.CreamDeep.copy(alpha = 0.7f)).padding(horizontal = 10.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ArtButton("add", "Add Item", Modifier.weight(1f), primary = true, onClick = { addSheet = true })
                ArtButton("clear", "Clear checked", Modifier.weight(1f), onClick = { if (checkedCount == 0) scope.launch { snack.showSnackbar("Nothing is checked off yet.") } else confirmClear = true })
            }
        },
    ) {
        // one list as long as it needs to be: category headings in bold with their items beneath
        GroceryList(c, week, items, allAisles, collapsed, onOpen = { rowSheet = it }, modifier = Modifier.fillMaxSize())
    }

    if (weekSheet) WeekSheet(week, sundayStart, { weekSheet = false }, { c.selectedWeek.value = it })
    rowSheet?.let { item -> ItemSheet(item, allAisles, items, onDismiss = { rowSheet = null }, onSave = { scope.launch { c.repo.updateGroceryItem(it.copy(edited = true)) }; rowSheet = null },
        onDelete = { scope.launch { c.repo.deleteGroceryItem(item.id); snack.undoable("Removed ${item.name}") { c.repo.restoreGroceryItems(listOf(item)) } }; rowSheet = null },
        onMove = { dir -> scope.launch { val l = items.filter { it.aisle == item.aisle }.map { it.id }.toMutableList(); val i = l.indexOf(item.id); val j = i + dir; if (j in l.indices) { l.add(j, l.removeAt(i)); c.repo.reorderGrocery(week, item.aisle, l) } } })
    }
    if (addSheet) AddItemSheet(c, week, allAisles, customAisles, items, onDismiss = { addSheet = false })
    if (basketSheet) BasketSheet(c, week, onDismiss = { basketSheet = false }, onOpenPlanner = { basketSheet = false; nav.navigate(Routes.PLANNER) })
    if (confirmClear) ConfirmDialog("Clear checked items?", "$checkedCount purchased ${if (checkedCount == 1) "item" else "items"} will be removed from this week's list. You can undo right after.", "Clear", destructive = true,
        onDismiss = { confirmClear = false }, onConfirm = { confirmClear = false; scope.launch { val removed = c.repo.clearChecked(week); snack.undoable("Cleared ${removed.size} items") { c.repo.restoreGroceryItems(removed) } } })
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GroceryList(c: AppContainer, week: java.time.LocalDate, all: List<GroceryItem>, aisles: List<String>, collapsed: MutableList<String>, onOpen: (GroceryItem) -> Unit, modifier: Modifier) {
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val text = TextStyle(fontFamily = BodyFont, fontSize = 17.sp, color = Palette.Ink)
    // known categories first (in their usual order), then any other category that has items; empty categories are not shown
    val groups = (aisles + all.map { it.aisle }).distinct().map { k -> k to all.filter { it.aisle == k } }.filter { it.second.isNotEmpty() }
    // the list position survives leaving the app and coming back
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    LazyColumn(modifier.testTag("grocery-list"), state = listState, contentPadding = PaddingValues(bottom = 20.dp)) {
        item(key = "art-top") { ArtSlot("grocery_list_top") }
        if (groups.isEmpty()) item(key = "empty") {
            Text("Nothing on your list yet. Tap Add Item below, add ingredients from a recipe, or plan meals and tap the basket.", Modifier.padding(horizontal = 10.dp, vertical = 16.dp).testTag("grocery-empty"), style = text.copy(fontSize = 18.sp), color = Palette.Ink.copy(alpha = 0.75f))
        }
        groups.forEach { (aisle, list) ->
            val open = aisle !in collapsed
            item(key = "head:$aisle") {
                Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp))
                        .clickable(onClickLabel = if (open) "Collapse ${aisleName(aisle)}" else "Expand ${aisleName(aisle)}", role = Role.Button) { if (open) collapsed.add(aisle) else collapsed.remove(aisle) }
                        .semantics { contentDescription = "${aisleName(aisle)}: ${list.size} ${if (list.size == 1) "item" else "items"}, ${list.count { it.checked }} bought. ${if (open) "Expanded" else "Collapsed"}" }
                        .testTag("aisle-head:$aisle").padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(aisleName(aisle), Modifier.weight(1f), style = TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 25.sp, color = Palette.Forest))
                        Text("${list.count { it.checked }}/${list.size}", style = text.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold), color = Palette.Ink.copy(alpha = 0.7f))
                        Text(if (open) "  ▾" else "  ▸", style = text.copy(fontSize = 18.sp), color = Palette.Forest)
                    }
                    Box(Modifier.fillMaxWidth().padding(horizontal = 10.dp).height(1.5.dp).background(Palette.Forest.copy(alpha = 0.45f)))
                }
            }
            if (!open) {
                item(key = "summary:$aisle") {
                    Text("${list.size} items · ${list.count { it.checked }} bought. Tap the heading to expand.", Modifier.padding(horizontal = 10.dp, vertical = 10.dp).testTag("aisle-summary:$aisle"), style = text.copy(fontSize = 15.sp), color = Palette.Ink.copy(alpha = 0.8f))
                }
            } else {
                items(list, key = { it.id }) { item ->
                    var name by remember(item.id, item.name) { mutableStateOf(item.name) }
                    var qty by remember(item.id, item.quantityText) { mutableStateOf(item.quantityText) }
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("grocery-row:${item.id}")
                            .combinedClickable(onLongClickLabel = "Row options", onLongClick = { onOpen(item) }, onClick = {})
                            .semantics { customActions = listOf(CustomAccessibilityAction("Edit, move or delete") { onOpen(item); true }, CustomAccessibilityAction("Delete") { scope.launch { c.repo.deleteGroceryItem(item.id); snack.undoable("Removed ${item.name}") { c.repo.restoreGroceryItems(listOf(item)) } }; true }) },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(48.dp).toggleable(item.checked, role = Role.Checkbox, onValueChange = { v -> scope.launch { c.repo.updateGroceryItem(item.copy(checked = v)) } }).semantics { contentDescription = "${item.name} purchased" }.testTag("grocery-check:${item.id}"), contentAlignment = Alignment.Center) {
                            Box(Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).border(2.dp, Palette.Forest, RoundedCornerShape(6.dp)).background(if (item.checked) Palette.Forest else Color.Transparent), contentAlignment = Alignment.Center) { if (item.checked) Text("✓", color = Palette.Cream, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
                        }
                        BasicTextField(name, { name = it }, Modifier.weight(1f).padding(end = 6.dp).onFocusLost { if (name.isNotBlank() && name != item.name) scope.launch { c.repo.updateGroceryItem(item.copy(name = name.trim(), edited = true)) } else name = item.name }.semantics { contentDescription = "Item name" },
                            textStyle = text.copy(textDecoration = if (item.checked) TextDecoration.LineThrough else null), singleLine = true, cursorBrush = SolidColor(Palette.Tomato),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Next))
                        Box(Modifier.width(78.dp).clip(RoundedCornerShape(6.dp)).background(Palette.CreamDeep.copy(alpha = 0.55f)).padding(horizontal = 6.dp, vertical = 7.dp)) {
                            BasicTextField(qty, { qty = it }, Modifier.fillMaxWidth().onFocusLost { if (qty != item.quantityText) scope.launch { c.repo.updateGroceryItem(item.copy(quantityText = qty.trim(), edited = true)) } }.semantics { contentDescription = "Quantity and unit" },
                                textStyle = text.copy(fontSize = 15.sp), singleLine = true, cursorBrush = SolidColor(Palette.Tomato), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                decorationBox = { inner -> if (qty.isEmpty()) Text("qty", style = text.copy(fontSize = 15.sp), color = Palette.Ink.copy(alpha = 0.4f)); inner() })
                        }
                        Box(Modifier.size(width = 40.dp, height = 48.dp).clickable(onClickLabel = "Row options for ${item.name}", role = Role.Button) { onOpen(item) }.semantics { contentDescription = "Row options for ${item.name}" }, contentAlignment = Alignment.Center) { Text("⋮", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Palette.Ink) }
                    }
                }
            }
        }
    }
}

private fun Modifier.onFocusLost(block: () -> Unit): Modifier = composed {
    var had by remember { mutableStateOf(false) }
    onFocusChanged { if (it.isFocused) had = true else if (had) { had = false; block() } }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun ItemSheet(item: GroceryItem, aisles: List<String>, all: List<GroceryItem>, onDismiss: () -> Unit, onSave: (GroceryItem) -> Unit, onDelete: () -> Unit, onMove: (Int) -> Unit) {
    var name by remember { mutableStateOf(item.name) }
    var qty by remember { mutableStateOf(item.quantityText) }
    var aisle by remember { mutableStateOf(item.aisle) }
    ModalBottomSheet(onDismiss) {
        Column(Modifier.padding(20.dp).padding(bottom = 20.dp).imePadding().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Edit item", style = MaterialTheme.typography.headlineSmall)
            OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth().testTag("item-name"), label = { Text("Item") }, singleLine = true, isError = name.isBlank())
            OutlinedTextField(qty, { qty = it }, Modifier.fillMaxWidth().testTag("item-qty"), label = { Text("Quantity and unit") }, singleLine = true)
            Text("Category", style = MaterialTheme.typography.titleSmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { aisles.forEach { Chip(aisleName(it), aisle == it, { aisle = it }) } }
            if (item.sources.isNotEmpty()) Text("From: " + item.sources.joinToString { it.title }, style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton({ onMove(-1) }, Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Move up") }
                OutlinedButton({ onMove(1) }, Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Move down") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BigButton("Delete", onDelete, Modifier.weight(1f), primary = false)
                BigButton("Save", { if (name.isNotBlank()) onSave(item.copy(name = name.trim(), quantityText = qty.trim(), aisle = aisle)) }, Modifier.weight(1f), enabled = name.isNotBlank())
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun AddItemSheet(c: AppContainer, week: java.time.LocalDate, aisles: List<String>, custom: List<String>, items: List<GroceryItem>, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf("") }
    var aisle by remember { mutableStateOf(AISLE_PRODUCE) }
    var autoAisle by remember { mutableStateOf(true) }
    var newAisle by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    fun add() {
        if (name.isBlank()) { message = "Type what you need first."; return }
        val n = name; val q = qty; val a = if (autoAisle) GroceryEngine.aisleFor(GroceryEngine.normalizeKey(n)) else aisle
        scope.launch {
            val before = items.size
            val r = c.repo.addGroceryItem(week, n, q, a)
            message = if (r == null) "Type what you need first." else if (items.any { it.id == r.id }) "“${r.name}” is already on the list." else "Added “${r.name}” to ${aisleName(a)}."
            name = ""; qty = ""; runCatching { focus.requestFocus() }
        }
    }
    ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxHeight(0.92f).padding(horizontal = 20.dp).imePadding().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Add item", style = MaterialTheme.typography.headlineSmall)
            OutlinedTextField(name, { name = it; message = null }, Modifier.fillMaxWidth().focusRequester(focus).testTag("add-name"), label = { Text("Item") }, singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Next))
            OutlinedTextField(qty, { qty = it }, Modifier.fillMaxWidth().testTag("add-qty"), label = { Text("Quantity and unit (optional)") }, singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { add() }))
            Text("Category", style = MaterialTheme.typography.titleSmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("Pick for me", autoAisle, { autoAisle = true })
                aisles.forEach { Chip(aisleName(it), !autoAisle && aisle == it, { aisle = it; autoAisle = false }) }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(newAisle, { newAisle = it }, Modifier.weight(1f).testTag("new-aisle"), label = { Text("New category") }, singleLine = true)
                OutlinedButton({ scope.launch { val ok = c.repo.addAisle(newAisle); if (ok) { aisle = newAisle.trim(); autoAisle = false; newAisle = ""; message = "Category added." } else message = "That category name isn't available." } }, Modifier.heightIn(min = 48.dp)) { Text("Add") }
            }
            message?.let { Text(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = MaterialTheme.colorScheme.primary) }
            BigButton("Add to list", { add() }, Modifier.fillMaxWidth().testTag("add-confirm"))
            if (custom.isNotEmpty() || items.any { it.aisle in custom }) {
                HorizontalDivider(Modifier.padding(vertical = 6.dp))
                Text("Your own categories", style = MaterialTheme.typography.titleMedium)
                custom.forEach { a ->
                    Text(a, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 6.dp))
                    items.filter { it.aisle == a }.forEach { it2 ->
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(it2.checked, { v -> scope.launch { c.repo.updateGroceryItem(it2.copy(checked = v)) } })
                            Text(it2.name + if (it2.quantityText.isNotEmpty()) " — ${it2.quantityText}" else "", Modifier.weight(1f))
                            TextButton({ scope.launch { c.repo.deleteGroceryItem(it2.id) } }) { Text("Delete") }
                        }
                    }
                    TextButton({ scope.launch { c.repo.deleteAisle(a, week) } }) { Text("Remove category “$a” (items move to Pantry)") }
                }
            }
            BigButton("Done", onDismiss, Modifier.fillMaxWidth().padding(bottom = 16.dp), primary = false)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BasketSheet(c: AppContainer, week: java.time.LocalDate, onDismiss: () -> Unit, onOpenPlanner: () -> Unit) {
    val meals by remember(week) { c.repo.meals(week, week.plusDays(6)) }.collectAsState(initial = emptyList())
    val recipes by remember { c.repo.recipes() }.collectAsState(initial = emptyList())
    ModalBottomSheet(onDismiss) {
        Column(Modifier.padding(20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Meals feeding this list", style = MaterialTheme.typography.headlineSmall)
            Text(Planner.rangeLabel(week), style = MaterialTheme.typography.bodyMedium)
            if (meals.isEmpty()) Text("No meals are planned for this week. Plan meals and the ingredients will be combined here, with duplicates merged.")
            meals.sortedBy { it.date }.forEach { m ->
                val r = recipes.firstOrNull { it.id == m.recipeId } ?: return@forEach
                val d = java.time.LocalDate.parse(m.date)
                Text("${Planner.dayLabel(d)}: ${r.title}" + (m.servings?.let { " ($it servings)" } ?: ""), Modifier.heightIn(min = 40.dp), style = MaterialTheme.typography.titleSmall)
            }
            BigButton("Open Meal Planner", onOpenPlanner, Modifier.fillMaxWidth().padding(top = 8.dp), primary = false)
            BigButton("Done", onDismiss, Modifier.fillMaxWidth())
        }
    }
}
