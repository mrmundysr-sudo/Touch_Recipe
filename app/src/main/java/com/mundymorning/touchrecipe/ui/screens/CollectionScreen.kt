package com.mundymorning.touchrecipe.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.navigation.NavController
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.model.Category
import com.mundymorning.touchrecipe.core.model.Recipe
import com.mundymorning.touchrecipe.core.search.RecipeSearch
import com.mundymorning.touchrecipe.core.search.Sort
import com.mundymorning.touchrecipe.ui.Routes
import com.mundymorning.touchrecipe.ui.art.ArtScreen
import com.mundymorning.touchrecipe.ui.components.*
import com.mundymorning.touchrecipe.ui.theme.DisplayFont
import com.mundymorning.touchrecipe.ui.theme.Palette
import com.mundymorning.touchrecipe.ui.vmOf
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class CollectionViewModel(private val c: AppContainer) : ViewModel() {
    val query = MutableStateFlow("")
    val category = MutableStateFlow<String?>(null)
    val favoritesOnly = MutableStateFlow(false)
    val sort = MutableStateFlow(runCatching { Sort.valueOf(c.prefs.sortOrder) }.getOrDefault(Sort.RECENT))
    val all = c.repo.recipes()
    val categories = c.repo.categories()
    fun setSort(s: Sort) { sort.value = s; c.prefs.sortOrder = s.name }
    val visible = combine(all, categories, query, category, favoritesOnly, sort) { arr -> arr }.let { _ ->
        combine(combine(all, categories) { a, b -> a to b }, combine(query, category, favoritesOnly, sort) { q, cat, f, s -> listOf(q, cat, f, s) }) { (r, cats), f ->
            @Suppress("UNCHECKED_CAST") RecipeSearch.filter(r, cats, f[0] as String, f[1] as String?, f[2] as Boolean, f[3] as Sort)
        }
    }
}

fun minutesLabel(m: Int?): String? = m?.let { if (it >= 60) "${it / 60} hr" + (if (it % 60 != 0) " ${it % 60} min" else "") else "$it min" }

fun metaLine(r: Recipe): String = listOfNotNull(
    r.prepMinutes?.let { "Prep ${minutesLabel(it)}" }, r.cookMinutes?.let { "Cook ${minutesLabel(it)}" },
    r.effectiveTotal?.let { "Total ${minutesLabel(it)}" }, r.servings?.let { "Serves $it" },
).joinToString(" · ")

@Composable
fun CollectionScreen(c: AppContainer, nav: NavController, openSearch: Boolean) {
    val vm = vmOf { CollectionViewModel(c) }
    val scope = rememberCoroutineScope()
    val all by vm.all.collectAsState(initial = emptyList())
    val cats by vm.categories.collectAsState(initial = emptyList())
    val visible by vm.visible.collectAsState(initial = emptyList())
    val query by vm.query.collectAsState()
    val category by vm.category.collectAsState()
    val favOnly by vm.favoritesOnly.collectAsState()
    val sort by vm.sort.collectAsState()
    var searchOpen by rememberSaveable { mutableStateOf(openSearch) }
    var filters by remember { mutableStateOf(false) }
    val snack = LocalSnack.current

    // category tabs: the two most-used enabled categories
    val usage = remember(all) { all.flatMap { it.categoryIds }.groupingBy { it }.eachCount() }
    val tabCats = remember(cats, usage) { cats.filter { it.enabled }.sortedByDescending { usage[it.id] ?: 0 }.take(2) }

    ArtScreen("collection", "Recipe Collection", onTarget = { id ->
        when (id) {
            "search" -> searchOpen = !searchOpen
            "new_recipe" -> nav.navigate(Routes.IMPORT)
            "tab0" -> { vm.category.value = null; vm.favoritesOnly.value = false }
            "tab1" -> { vm.favoritesOnly.value = !vm.favoritesOnly.value }
            "tab2" -> tabCats.getOrNull(0)?.let { vm.category.value = if (category == it.id) null else it.id } ?: run { filters = true }
            "tab3" -> tabCats.getOrNull(1)?.let { vm.category.value = if (category == it.id) null else it.id } ?: run { filters = true }
            "tab4" -> filters = true
        }
    }) {
        BackChip({ nav.goBackOr(Routes.HUB) }, Modifier.offset(widthDp - 60.dp, dp(14f)))
        // tab labels (code-rendered on the blank tabs)
        val tabs = listOf(
            "tab0" to Triple("All", category == null && !favOnly, true), "tab1" to Triple("Favorites", favOnly, true),
            "tab2" to Triple(tabCats.getOrNull(0)?.name ?: "Dinner", tabCats.getOrNull(0)?.id == category && category != null, true),
            "tab3" to Triple(tabCats.getOrNull(1)?.name ?: "Desserts", tabCats.getOrNull(1)?.id == category && category != null, true),
            "tab4" to Triple("⋯", false, true),
        )
        tabs.forEach { (id, v) ->
            val t = page.target(id)
            Box(Modifier.region(t.box).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    FitText(v.first, androidx.compose.ui.text.TextStyle(fontFamily = DisplayFont, fontSize = sp(if (id == "tab4") 30f else 21f), fontWeight = if (v.second) FontWeight.Bold else FontWeight.Medium, color = Palette.Ink), Modifier.padding(horizontal = dp(6f)), textAlign = TextAlign.Center)
                    if (v.second) Box(Modifier.padding(top = dp(3f)).height(dp(4f)).width(dp(34f)).background(Palette.Tomato))
                }
            }
        }
        Column(
            Modifier.region("list").clip(RoundedCornerShape(dp(18f))).background(Color(0xFFF4E9D3)).padding(horizontal = dp(14f), vertical = dp(10f)),
        ) {
            val focus = remember { FocusRequester() }
            if (searchOpen) {
                OutlinedTextField(
                    value = query, onValueChange = { vm.query.value = it }, singleLine = true,
                    modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag("search-field"),
                    placeholder = { Text("Search title, ingredient, category, source…") },
                    trailingIcon = { if (query.isNotEmpty()) TextButton({ vm.query.value = "" }) { Text("Clear") } },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = {}),
                    textStyle = androidx.compose.ui.text.TextStyle(color = Palette.Ink, fontSize = 16.sp),
                )
                LaunchedEffect(searchOpen) { runCatching { focus.requestFocus() } }
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    buildString {
                        append("${visible.size} ${if (visible.size == 1) "recipe" else "recipes"}")
                        if (favOnly) append(" · favorites")
                        category?.let { id -> cats.firstOrNull { it.id == id }?.let { append(" · ${it.name}") } }
                    }, Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite }, color = Palette.Ink, style = MaterialTheme.typography.labelLarge)
                TextButton({ filters = true }) { Text("Sort & filter", color = Palette.Forest) }
            }
            when {
                all.isEmpty() -> EmptyState("Your Rolodex is empty", "Bring in your first recipe from a web page, a photo, a PDF or by typing it in.", "Import a recipe") { nav.navigate(Routes.IMPORT) }
                visible.isEmpty() -> EmptyState("No recipes match", "Try a different word, or clear the filters.", "Clear filters") { vm.query.value = ""; vm.category.value = null; vm.favoritesOnly.value = false }
                else -> LazyColumn(Modifier.fillMaxSize().testTag("recipe-list"), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 12.dp)) {
                    items(visible, key = Recipe::id) { r ->
                        RecipeCard(c, r, cats, onOpen = { nav.navigate(Routes.detail(r.id)) }, onFavorite = { scope.launch { c.repo.setFavorite(r.id, !r.favorite) } })
                    }
                }
            }
        }
    }
    if (filters) FilterSheet(cats.filter { it.enabled }, category, favOnly, sort, onDismiss = { filters = false },
        onCategory = { vm.category.value = it }, onFavorites = { vm.favoritesOnly.value = it }, onSort = vm::setSort)
}

@Composable
private fun EmptyState(title: String, text: String, action: String, onAction: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(20.dp).testTag("empty-state"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(title, fontFamily = DisplayFont, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Palette.Forest, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(text, color = Palette.Ink, textAlign = TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        BigButton(action, onAction)
    }
}

@Composable
fun RecipeCard(c: AppContainer, r: Recipe, cats: List<Category>, onOpen: () -> Unit, onFavorite: () -> Unit) {
    val names = r.categoryIds.mapNotNull { id -> cats.firstOrNull { it.id == id }?.name }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 112.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFFFBF4E6)).border(1.dp, Palette.Brass.copy(alpha = 0.4f), RoundedCornerShape(14.dp))
            .clickable(onClickLabel = "Open recipe", onClick = onOpen).testTag("recipe-card:${r.id}")
            .semantics(mergeDescendants = true) { contentDescription = "${r.title.ifBlank { "Untitled recipe" }}. ${metaLine(r)}. ${if (names.isNotEmpty()) names.joinToString() else ""}${if (r.favorite) ". Favorite" else ""}" },
    ) {
        PhotoImage(c.photos, r.photo, Modifier.width(112.dp).heightIn(min = 112.dp).fillMaxHeight(), r.title)
        Column(Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 8.dp)) {
            Text(r.title.ifBlank { "Untitled recipe" }, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Palette.Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (names.isNotEmpty()) Text(names.joinToString(" · "), color = Palette.Forest, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val meta = metaLine(r)
            if (meta.isNotEmpty()) Text(meta, color = Palette.Ink.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        Box(
            Modifier.size(52.dp).clickable(onClickLabel = if (r.favorite) "Remove from favorites" else "Add to favorites", role = Role.Button, onClick = onFavorite)
                .semantics { contentDescription = if (r.favorite) "Favorite, on" else "Favorite, off"; toggleableState = if (r.favorite) androidx.compose.ui.state.ToggleableState.On else androidx.compose.ui.state.ToggleableState.Off }
                .testTag("favorite:${r.id}"),
            contentAlignment = Alignment.Center,
        ) { Text(if (r.favorite) "♥" else "♡", color = Palette.Tomato, fontSize = 28.sp) }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun FilterSheet(cats: List<Category>, category: String?, favOnly: Boolean, sort: Sort, onDismiss: () -> Unit, onCategory: (String?) -> Unit, onFavorites: (Boolean) -> Unit, onSort: (Sort) -> Unit) {
    ModalBottomSheet(onDismiss) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 28.dp).verticalScroll(rememberScrollState())) {
            Text("Sort and filter", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(12.dp))
            Text("Sort by", style = MaterialTheme.typography.titleSmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Sort.values().forEach { Chip(it.label, sort == it, { onSort(it) }) } }
            Spacer(Modifier.height(12.dp))
            Chip("Favorites only", favOnly, { onFavorites(!favOnly) })
            Spacer(Modifier.height(12.dp))
            Text("Category", style = MaterialTheme.typography.titleSmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("All", category == null, { onCategory(null) })
                cats.forEach { Chip(it.name, category == it.id, { onCategory(if (category == it.id) null else it.id) }) }
            }
            Spacer(Modifier.height(16.dp))
            BigButton("Done", onDismiss, Modifier.fillMaxWidth())
        }
    }
}
