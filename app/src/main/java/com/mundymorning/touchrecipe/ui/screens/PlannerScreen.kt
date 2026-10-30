package com.mundymorning.touchrecipe.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.model.MealEntry
import com.mundymorning.touchrecipe.core.model.Recipe
import com.mundymorning.touchrecipe.core.planner.Planner
import com.mundymorning.touchrecipe.core.search.RecipeSearch
import com.mundymorning.touchrecipe.core.search.Sort
import com.mundymorning.touchrecipe.ui.Routes
import com.mundymorning.touchrecipe.ui.art.ArtScreen
import com.mundymorning.touchrecipe.ui.components.*
import com.mundymorning.touchrecipe.ui.theme.BodyFont
import com.mundymorning.touchrecipe.ui.theme.DisplayFont
import com.mundymorning.touchrecipe.ui.theme.Palette
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.launch
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneOffset

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlannerScreen(c: AppContainer, nav: NavController) {
    val week by c.selectedWeek.collectAsState()
    val days = remember(week) { Planner.days(week) }
    val meals by remember(week) { c.repo.meals(week, week.plusDays(6)) }.collectAsState(initial = emptyList())
    val recipes by remember { c.repo.recipes() }.collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val sundayStart by c.prefs.sundayStart.collectAsState()
    var weekSheet by remember { mutableStateOf(false) }
    var daySheet by remember { mutableStateOf<Int?>(null) }
    var picker by remember { mutableStateOf<Int?>(null) }
    val byDate = meals.associateBy { it.date }
    fun recipeFor(i: Int): Recipe? = byDate[days[i].toString()]?.let { m -> recipes.firstOrNull { it.id == m.recipeId } }

    ArtScreen("planner", "Meal Planner", describe = { t ->
        val i = t.id.removePrefix("day").toIntOrNull()?.takeIf { t.id.startsWith("day") }
        val a = t.id.removePrefix("act").toIntOrNull()?.takeIf { t.id.startsWith("act") }
        when {
            i != null -> { val r = recipeFor(i); val e = byDate[days[i].toString()]; "${Planner.dayLabel(days[i])}, ${Planner.dateLabel(days[i])}: " + (if (r != null) "${r.title}, ${minutesLabel(r.cookMinutes) ?: "no cook time"}, ${e?.servings ?: r.servings ?: "?"} servings. Opens the recipe" else "no meal planned. Opens the recipe chooser") }
            a != null -> "${Planner.dayLabel(days[a])} options: ${if (recipeFor(a) != null) "replace or remove the meal" else "assign a recipe"}"
            t.id == "week" -> "Week selector, ${Planner.rangeLabel(week)}"
            else -> null
        }
    }, onTarget = { id ->
        when {
            id == "week" || id == "calendar" -> weekSheet = true
            id == "grocery" -> scope.launch { c.repo.generateGroceries(week); kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main.immediate) { nav.navigate(Routes.GROCERY) } }
            id.startsWith("day") -> { val i = id.removePrefix("day").toInt(); val r = recipeFor(i); if (r != null) nav.navigate(Routes.detail(r.id)) else if (recipes.isEmpty()) daySheet = i else picker = i }
            id.startsWith("act") -> daySheet = id.removePrefix("act").toInt()
        }
    }) {
        BackChip({ nav.goBackOr(Routes.HUB) }, Modifier.offset(widthDp - 60.dp, dp(14f)))
        val weekBox = page.target("week").box
        Box(Modifier.region(weekBox).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
            FitText(Planner.rangeLabel(week), TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.Bold, fontSize = sp(24f), color = Palette.Ink), textAlign = TextAlign.Center, modifier = Modifier.testTag("week-label"))
        }
        page.days.forEachIndexed { i, d ->
            val date = days[i]
            val r = recipeFor(i)
            val entry = byDate[date.toString()]
            Box(Modifier.region(d.label).clearAndSetSemantics { }, contentAlignment = Alignment.Center) { FitText(Planner.dayLabel(date), TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.Bold, fontSize = sp(22f), color = Palette.Forest), textAlign = TextAlign.Center, modifier = Modifier.testTag("day-label:$i")) }
            Box(Modifier.region(d.date).clearAndSetSemantics { }, contentAlignment = Alignment.Center) { FitText(Planner.dateLabel(date), TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.SemiBold, fontSize = sp(21f), color = Palette.Ink), textAlign = TextAlign.Center, modifier = Modifier.testTag("day-date:$i")) }
            Box(Modifier.region(d.photo).clip(RoundedCornerShape(dp(12f))).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
                if (r != null) PhotoImage(c.photos, r.photo, Modifier.fillMaxSize(), r.title, maxEdge = 400)
                else Text("＋", fontSize = sp(52f), color = Palette.Brass.copy(alpha = 0.8f))
            }
            Box(Modifier.region(d.title).padding(horizontal = dp(10f)).clearAndSetSemantics { }, contentAlignment = Alignment.CenterStart) {
                FitText(r?.title ?: "Nothing planned", TextStyle(fontFamily = DisplayFont, fontWeight = if (r != null) FontWeight.Bold else FontWeight.Normal, fontSize = sp(28f), color = if (r != null) Palette.Ink else Palette.Ink.copy(alpha = 0.55f)), minScale = 0.5f, modifier = Modifier.testTag("day-title:$i"))
            }
            Box(Modifier.region(d.cook).clearAndSetSemantics { }, contentAlignment = Alignment.Center) { FitText(minutesLabel(r?.cookMinutes ?: r?.effectiveTotal) ?: "—", TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.SemiBold, fontSize = sp(21f), color = Palette.Ink), textAlign = TextAlign.Center) }
            Box(Modifier.region(d.servings).clearAndSetSemantics { }, contentAlignment = Alignment.Center) { FitText((entry?.servings ?: r?.servings)?.toString() ?: "—", TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.SemiBold, fontSize = sp(21f), color = Palette.Ink), textAlign = TextAlign.Center) }
            Box(Modifier.region(d.action).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
                Box(Modifier.size(dp(58f)).clip(CircleShape).background(Color(0xFFFBF4E6).copy(alpha = 0.92f)).border(1.5.dp, Palette.Brass, CircleShape), contentAlignment = Alignment.Center) { Text(if (r != null) "⋯" else "＋", fontSize = sp(34f), color = Palette.Ink, fontWeight = FontWeight.Bold) }
            }
        }
    }

    if (weekSheet) WeekSheet(week, sundayStart, onDismiss = { weekSheet = false }, onPick = { c.selectedWeek.value = it })
    daySheet?.let { i ->
        val r = recipeFor(i); val e = byDate[days[i].toString()]
        ModalBottomSheet({ daySheet = null }) {
            Column(Modifier.padding(20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${Planner.dayLabel(days[i])}, ${Planner.dateLabel(days[i])}", style = MaterialTheme.typography.headlineSmall)
                if (recipes.isEmpty()) {
                    Text("You haven't saved any recipes yet. Import one first, then plan it here.")
                    BigButton("Import a recipe", { daySheet = null; nav.navigate(Routes.IMPORT) }, Modifier.fillMaxWidth())
                } else if (r == null) {
                    BigButton("Assign a recipe", { daySheet = null; picker = i }, Modifier.fillMaxWidth())
                    Text("Leave the day empty if you don't want to plan a meal.", style = MaterialTheme.typography.bodySmall)
                } else {
                    Text(r.title, style = MaterialTheme.typography.titleMedium)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Servings", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                        val cur = e?.servings ?: r.servings ?: 4
                        OutlinedButton({ scope.launch { c.repo.assignMeal(days[i], r.id, (cur - 1).coerceAtLeast(1)) } }, Modifier.size(48.dp), contentPadding = PaddingValues(0.dp)) { Text("−", fontSize = 22.sp) }
                        Text("$cur", Modifier.widthIn(min = 48.dp), textAlign = TextAlign.Center, style = MaterialTheme.typography.titleLarge)
                        OutlinedButton({ scope.launch { c.repo.assignMeal(days[i], r.id, (cur + 1).coerceAtMost(99)) } }, Modifier.size(48.dp), contentPadding = PaddingValues(0.dp)) { Text("+", fontSize = 22.sp) }
                    }
                    BigButton("Open recipe", { daySheet = null; nav.navigate(Routes.detail(r.id)) }, Modifier.fillMaxWidth())
                    BigButton("Replace recipe", { daySheet = null; picker = i }, Modifier.fillMaxWidth(), primary = false)
                    BigButton("Remove from this day", { daySheet = null; scope.launch { val prev = e; c.repo.removeMeal(days[i]); if (prev != null) snack.undoable("Removed ${r.title} from ${Planner.dayLabel(days[i])}") { c.repo.assignMeal(days[i], prev.recipeId, prev.servings) } } }, Modifier.fillMaxWidth(), primary = false)
                }
            }
        }
    }
    picker?.let { i ->
        RecipePickerSheet(recipes, "Choose a recipe for ${Planner.dayLabel(days[i])}", onDismiss = { picker = null }, onPick = { r -> picker = null; scope.launch { c.repo.assignMeal(days[i], r.id, r.servings) } }, onImport = { picker = null; nav.navigate(Routes.IMPORT) })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecipePickerSheet(recipes: List<Recipe>, title: String, onDismiss: () -> Unit, onPick: (Recipe) -> Unit, onImport: () -> Unit) {
    var q by remember { mutableStateOf("") }
    val list = remember(recipes, q) { RecipeSearch.filter(recipes, emptyList(), q, null, false, Sort.TITLE) }
    ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxHeight(0.9f).padding(horizontal = 20.dp).imePadding()) {
            Text(title, style = MaterialTheme.typography.headlineSmall)
            if (recipes.isEmpty()) { Spacer(Modifier.height(12.dp)); Text("No recipes yet."); BigButton("Import a recipe", onImport, Modifier.fillMaxWidth().padding(top = 12.dp)); return@Column }
            OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("picker-search"), singleLine = true, placeholder = { Text("Search your recipes") })
            LazyColumn(Modifier.weight(1f).testTag("picker-list")) {
                items(list, key = { it.id }) { r ->
                    Column(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(onClickLabel = "Choose ${r.title}") { onPick(r) }.padding(vertical = 10.dp).testTag("pick:${r.id}")) {
                        Text(r.title.ifBlank { "Untitled recipe" }, style = MaterialTheme.typography.titleMedium)
                        val m = metaLine(r); if (m.isNotEmpty()) Text(m, style = MaterialTheme.typography.bodySmall)
                    }
                    HorizontalDivider()
                }
                if (list.isEmpty()) item { Text("No recipes match “$q”.", Modifier.padding(16.dp)) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WeekSheet(week: LocalDate, sunday: Boolean, onDismiss: () -> Unit, onPick: (LocalDate) -> Unit) {
    val first = if (sunday) DayOfWeek.SUNDAY else DayOfWeek.MONDAY
    var datePicker by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismiss) {
        Column(Modifier.padding(20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Choose a week", style = MaterialTheme.typography.headlineSmall)
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton({ onPick(week.minusWeeks(1)) }, Modifier.heightIn(min = 48.dp).testTag("week-prev")) { Text("‹ Previous") }
                Text(Planner.rangeLabel(week), Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite }, textAlign = TextAlign.Center, style = MaterialTheme.typography.titleMedium)
                OutlinedButton({ onPick(week.plusWeeks(1)) }, Modifier.heightIn(min = 48.dp).testTag("week-next")) { Text("Next ›") }
            }
            BigButton("This week", { onPick(Planner.weekStart(LocalDate.now(), first)); onDismiss() }, Modifier.fillMaxWidth(), primary = false)
            BigButton("Pick a date…", { datePicker = true }, Modifier.fillMaxWidth(), primary = false)
            BigButton("Done", onDismiss, Modifier.fillMaxWidth())
        }
    }
    if (datePicker) {
        val st = rememberDatePickerState(initialSelectedDateMillis = week.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog({ datePicker = false }, confirmButton = { TextButton({
            st.selectedDateMillis?.let { ms -> onPick(Planner.weekStart(java.time.Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate(), first)) }; datePicker = false
        }) { Text("Select") } }, dismissButton = { TextButton({ datePicker = false }) { Text("Cancel") } }) { DatePicker(st) }
    }
}
