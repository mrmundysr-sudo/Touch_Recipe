package com.mundymorning.touchrecipe.ui.screens

import android.content.Context
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.BuildConfig
import com.mundymorning.touchrecipe.core.backup.BackupException
import com.mundymorning.touchrecipe.core.grocery.DEFAULT_AISLES
import com.mundymorning.touchrecipe.core.model.Recipe
import com.mundymorning.touchrecipe.core.planner.Planner
import com.mundymorning.touchrecipe.core.timer.CookTimer
import com.mundymorning.touchrecipe.core.units.Convert
import com.mundymorning.touchrecipe.core.units.Kind
import com.mundymorning.touchrecipe.data.*
import com.mundymorning.touchrecipe.ui.components.*
import com.mundymorning.touchrecipe.ui.theme.Palette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Plain, accessible page used by the Junk Drawer utilities (code-rendered, follows the chosen theme). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UtilityPage(title: String, onBack: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(title = { Text(title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() }) },
                navigationIcon = { IconButtonBox("Back", "←", MaterialTheme.colorScheme.onBackground, 56.dp, onBack) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background))
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 32.dp).testTag("utility:$title"), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

@Composable
private fun SwitchRow(label: String, detail: String?, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).toggleable(value, role = Role.Switch, onValueChange = onChange), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text(label, style = MaterialTheme.typography.titleMedium); if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        Switch(value, null)
    }
}

@Composable
fun SettingsScreen(c: AppContainer, nav: NavController) {
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val glow by c.prefs.glowGuide.collectAsState(); val motion by c.prefs.motion.collectAsState(); val awake by c.prefs.keepAwake.collectAsState()
    val vibrate by c.prefs.timerVibrate.collectAsState(); val sunday by c.prefs.sundayStart.collectAsState()
    var wipe by remember { mutableStateOf(false) }
    UtilityPage("Settings", { nav.goBackOr("drawer") }) {
        SwitchRow("Highlight things to tap", "A brief glow shows tappable objects the first times you open a page.", glow) { c.prefs.setGlowGuide(it) }
        OutlinedButton({ c.prefs.resetGlow(); scope.launch { snack.showSnackbar("Tips will show again the next time you open each page.") } }, Modifier.heightIn(min = 48.dp)) { Text("Replay first-time tips") }
        SwitchRow("Reduce motion", "Softens glows and removes page transitions. Android's “remove animations” setting is always respected.", motion == MotionPref.REDUCED) { c.prefs.setMotion(if (it) MotionPref.REDUCED else MotionPref.SYSTEM) }
        SwitchRow("Keep the screen on while cooking", null, awake) { c.prefs.setKeepAwake(it) }
        SwitchRow("Vibrate when a timer finishes", null, vibrate) { c.prefs.setTimerVibrate(it) }
        SwitchRow("Week starts on Sunday", "Affects the Meal Planner and Grocery List.", sunday) { c.prefs.setSundayStart(it); c.selectedWeek.value = Planner.weekStart(c.selectedWeek.value, if (it) java.time.DayOfWeek.SUNDAY else java.time.DayOfWeek.MONDAY) }
        OutlinedButton({ nav.navigate("themes") }, Modifier.heightIn(min = 48.dp)) { Text("Appearance and themes") }
        HorizontalDivider()
        Text("Privacy", style = MaterialTheme.typography.titleMedium)
        Text("Your recipes, photos, meal plans and lists are stored only on this phone. Touch Recipe has no account and no ads or analytics. The internet is used only when you import from a web link. Photos are read on the device (not uploaded). Android may back up app data to your Google account if you have device backup turned on; you can turn that off in Android settings.", style = MaterialTheme.typography.bodyMedium)
        HorizontalDivider()
        Text("Danger zone", style = MaterialTheme.typography.titleMedium)
        OutlinedButton({ wipe = true }, Modifier.heightIn(min = 48.dp)) { Text("Delete all my recipes and data") }
        HorizontalDivider()
        Text("About", style = MaterialTheme.typography.titleMedium)
        Text("Touch Recipe ${BuildConfig.VERSION_NAME} (build ${BuildConfig.VERSION_CODE}) — Mundy Morning Studios", style = MaterialTheme.typography.bodyMedium)
        Text("Open-source notices: Playfair Display and Source Sans 3 (SIL Open Font License 1.1), jsoup (MIT), AndroidX, Room and Kotlin libraries (Apache 2.0), Google ML Kit text recognition (on-device; Google ML Kit terms). Full license texts are bundled with the app.", style = MaterialTheme.typography.bodySmall)
    }
    if (wipe) ConfirmDialog("Delete everything?", "This permanently removes all recipes, photos, meal plans, grocery lists and cooking progress from this phone. This can't be undone. Make a backup first if you might want them back.", "Delete everything", destructive = true,
        onDismiss = { wipe = false }, onConfirm = { wipe = false; scope.launch { c.db.recipes().clear(); c.db.meals().clear(); c.db.grocery().clear(); c.db.cook().clear(); c.photos.all().forEach { it.delete() }; snack.showSnackbar("All data deleted.") } })
}

@Composable
fun CategoriesScreen(c: AppContainer, nav: NavController) {
    UtilityPage("Category Management", { nav.goBackOr("drawer") }) {
        Text("Pick which categories appear when you organise recipes, and add up to 50 of your own.", style = MaterialTheme.typography.bodyMedium)
        CategoryCatalogContent(c, null, null)
    }
}

@Composable
fun ThemesScreen(c: AppContainer, nav: NavController) {
    val theme by c.prefs.theme.collectAsState()
    UtilityPage("Themes", { nav.goBackOr("drawer") }) {
        Text("The illustrated pages keep their warm look in every theme. Themes change menus, sheets and utility pages.", style = MaterialTheme.typography.bodyMedium)
        listOf(ThemeMode.SYSTEM to ("Match my phone" to "Follows Android's light or dark setting."), ThemeMode.LIGHT to ("Kitchen Light" to "Warm cream and forest green."), ThemeMode.DARK to ("Forest Night" to "Deep green with cream text, easier on the eyes in a dim kitchen.")).forEach { (m, t) ->
            val sel = theme == m
            Row(Modifier.fillMaxWidth().heightIn(min = 72.dp).clip(RoundedCornerShape(14.dp)).border(if (sel) 3.dp else 1.dp, if (sel) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, RoundedCornerShape(14.dp))
                .selectable(sel, role = Role.RadioButton, onClick = { c.prefs.setTheme(m) }).padding(14.dp).testTag("theme:${m.name}"), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.padding(end = 12.dp)) {
                    listOf(if (m == ThemeMode.DARK) Color(0xFF17211B) else Palette.Cream, Palette.Forest, Palette.Tomato, Palette.Brass).forEach { Box(Modifier.size(22.dp).clip(RoundedCornerShape(5.dp)).background(it).border(1.dp, Color.Gray.copy(alpha = 0.4f), RoundedCornerShape(5.dp))) }
                }
                Column(Modifier.weight(1f)) { Text(t.first, style = MaterialTheme.typography.titleMedium); Text(t.second, style = MaterialTheme.typography.bodySmall) }
                Text(if (sel) "✓ Selected" else "", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
fun HelpScreen(c: AppContainer, nav: NavController) {
    val snack = LocalSnack.current; val scope = rememberCoroutineScope()
    UtilityPage("Help", { nav.goBackOr("drawer") }) {
        listOf(
            "Bring a recipe in" to "Tap the “New Recipe” card on the fridge. Paste a web link, paste or type text, scan a printed recipe with the camera, or choose a PDF or photo. You can also use Share in your browser and pick “Import to Touch Recipe”. Every import is shown for review before it is saved.",
            "Fix what the import got wrong" to "On the review page, tap any field to edit it. Yellow ! marks show where the import was unsure. Add, remove and reorder ingredients and directions; tap “Ingredients” or “Directions” for a bigger editor. Removed a row by mistake? Tap Undo.",
            "Cook step by step" to "Open a recipe and tap Cook Mode, or tap the stove. Your place and timer are remembered if you leave.",
            "Plan the week" to "Tap the cat calendar. Tap a day to choose a recipe, then tap the grocery basket to build one combined shopping list.",
            "Shop" to "On the Grocery List tick items as you buy them. Tick state is kept. “Clear Checked” removes what you bought (with undo).",
            "Back up your recipes" to "Open the notebook in the junk drawer. Export a backup file, then keep it somewhere safe. Restore it on any phone with Touch Recipe.",
            "Sites that won't import" to "Some sites block automatic reading or hide recipes behind a login. Open the page in your browser, copy the recipe text, and use Paste or Type Recipe.",
        ).forEach { (h, t) -> Column { Text(h, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() }); Text(t, style = MaterialTheme.typography.bodyMedium) } }
        OutlinedButton({ c.prefs.resetGlow(); scope.launch { snack.showSnackbar("Tips will show again.") } }, Modifier.heightIn(min = 48.dp)) { Text("Replay the glowing tips") }
    }
}

@Composable
fun BackupScreen(c: AppContainer, nav: NavController) {
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var restoreUri by remember { mutableStateOf<android.net.Uri?>(null) }
    var confirmReplace by remember { mutableStateOf(false) }
    val stamp = remember { SimpleDateFormat("yyyyMMdd", Locale.US).format(Date()) }
    val exportZip = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri -> uri?.let { scope.launch { busy = true; message = try { "Backup saved: ${c.backup.export(it)} recipes and their photos." } catch (e: Exception) { "The backup couldn't be saved. ${(e as? BackupException)?.message ?: "Please try another location."}" }; busy = false } } }
    val exportJson = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri -> uri?.let { scope.launch { busy = true; message = try { "Exported ${c.backup.exportRecipesJson(it)} recipes (no photos)." } catch (e: Exception) { "The export couldn't be saved." }; busy = false } } }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> restoreUri = uri }
    suspend fun doRestore(mode: RestoreMode) {
        val u = restoreUri ?: return
        busy = true
        message = try { val s = c.backup.restore(u, mode); "Restored ${s.recipes} recipes, ${s.meals} planned meals and ${s.groceries} grocery items." } catch (e: BackupException) { e.message } catch (e: Exception) { "That backup couldn't be read. Nothing was changed." }
        busy = false; restoreUri = null
    }
    UtilityPage("Backup & Export", { nav.goBackOr("drawer") }) {
        Text("Your recipes live only on this phone. A backup file lets you move to a new phone or recover from loss. Files are saved where you choose and are never uploaded by Touch Recipe.", style = MaterialTheme.typography.bodyMedium)
        BigButton("Back up everything", { exportZip.launch("touch-recipe-backup-$stamp.zip") }, Modifier.fillMaxWidth().testTag("backup-export"), enabled = !busy)
        BigButton("Export recipes as JSON", { exportJson.launch("touch-recipe-recipes-$stamp.json") }, Modifier.fillMaxWidth(), primary = false, enabled = !busy)
        BigButton("Restore from a backup", { pick.launch(arrayOf("application/zip", "application/json", "application/octet-stream", "*/*")) }, Modifier.fillMaxWidth().testTag("backup-restore"), primary = false, enabled = !busy)
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        message?.let { Text(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("backup-message"), style = MaterialTheme.typography.titleSmall) }
        HorizontalDivider()
        Text("Backup format", style = MaterialTheme.typography.titleSmall)
        Text("A backup is a ZIP file holding data.json (recipes, categories, meal plan, grocery lists, preferences) and a photos folder. The format is documented in the project's docs/BACKUP_FORMAT.md, so your data is never locked in.", style = MaterialTheme.typography.bodySmall)
    }
    if (restoreUri != null && !confirmReplace) AlertDialog({ restoreUri = null }, title = { Text("Restore this backup?") },
        text = { Text("Merge adds the backup's recipes to what you have now (newer versions win). Replace swaps your current recipes, plans and lists for the backup's.") },
        confirmButton = { TextButton({ scope.launch { doRestore(RestoreMode.MERGE) } }) { Text("Merge") } },
        dismissButton = { Row { TextButton({ confirmReplace = true }) { Text("Replace…") }; TextButton({ restoreUri = null }) { Text("Cancel") } } })
    if (confirmReplace) ConfirmDialog("Replace everything?", "Your current recipes, meal plans and grocery lists will be replaced by the backup. Consider making a backup of what you have first.", "Replace", destructive = true,
        onDismiss = { confirmReplace = false; restoreUri = null }, onConfirm = { confirmReplace = false; scope.launch { doRestore(RestoreMode.REPLACE) } })
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ToolsScreen(c: AppContainer, nav: NavController) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    UtilityPage("Timer & Tools", { nav.goBackOr("drawer") }) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("Timer", "Convert", "Measures").forEachIndexed { i, t -> Chip(t, tab == i, { tab = i }, Modifier.weight(1f)) } }
        when (tab) { 0 -> KitchenTimer(c); 1 -> Converter(); else -> Measures() }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun KitchenTimer(c: AppContainer) {
    var total by rememberSaveable { mutableLongStateOf(0L) }
    var left by rememberSaveable { mutableLongStateOf(0L) }
    var endAt by rememberSaveable { mutableLongStateOf(-1L) }
    val timer = CookTimer(total, left, endAt.takeIf { it >= 0 })
    fun set(t: CookTimer) { total = t.totalMs; left = t.remainingMs; endAt = t.endAtMs ?: -1L }
    var now by remember { mutableLongStateOf(c.clock()) }
    var mins by rememberSaveable { mutableStateOf("") }
    val ctx = LocalContext.current
    LaunchedEffect(timer.running) { while (timer.running) { now = c.clock(); delay(250) }; now = c.clock() }
    LaunchedEffect(now, endAt) { if (timer.running && timer.remaining(now) == 0L) { set(timer.copy(remainingMs = 0, endAtMs = null)); TimerAlarm.cancel(ctx, "kitchen-timer") } }
    val shown = if (timer.configured) timer.remaining(now) else 0L
    Text(CookTimer.format(shown), Modifier.fillMaxWidth().testTag("tool-timer"), fontSize = 64.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onBackground)
    if (timer.configured && !timer.running && timer.remainingMs == 0L) Text("Time's up!", Modifier.fillMaxWidth(), textAlign = TextAlign.Center, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.secondary)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(1, 5, 10, 15, 20, 30, 45, 60).forEach { m -> OutlinedButton({ set(CookTimer().withDuration(m * 60)) }, Modifier.heightIn(min = 48.dp)) { Text("$m min") } } }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(mins, { mins = it.filter(Char::isDigit).take(3) }, Modifier.weight(1f), label = { Text("Custom minutes") }, singleLine = true, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number))
        OutlinedButton({ mins.toIntOrNull()?.let { set(CookTimer().withDuration(it * 60)) } }, Modifier.heightIn(min = 56.dp)) { Text("Set") }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BigButton(if (timer.running) "Pause" else "Start", {
            if (timer.running) { set(timer.pause(c.clock())); TimerAlarm.cancel(ctx, "kitchen-timer") }
            else { val t = timer.start(c.clock()); set(t); t.endAtMs?.let { TimerAlarm.ensureChannel(ctx); TimerAlarm.schedule(ctx, "kitchen-timer", "Kitchen timer", it) } }
        }, Modifier.weight(1f), enabled = timer.configured)
        BigButton("Reset", { set(timer.reset()); TimerAlarm.cancel(ctx, "kitchen-timer") }, Modifier.weight(1f), primary = false, enabled = timer.configured)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Converter() {
    var kind by rememberSaveable { mutableStateOf(Kind.VOLUME) }
    var amount by rememberSaveable { mutableStateOf("1") }
    var from by rememberSaveable { mutableStateOf("cup") }
    var to by rememberSaveable { mutableStateOf("ml") }
    val units = Convert.units(kind)
    if (from !in units) from = units[0]; if (to !in units) to = units.getOrElse(1) { units[0] }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Kind.values().forEach { k -> Chip(k.label, kind == k, { kind = k }, Modifier.weight(1f)) } }
    OutlinedTextField(amount, { amount = it.filter { ch -> ch.isDigit() || ch == '.' || ch == '-' }.take(8) }, Modifier.fillMaxWidth().testTag("convert-amount"), label = { Text("Amount") }, singleLine = true, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal))
    Text("From", style = MaterialTheme.typography.titleSmall); FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { units.forEach { Chip(it, from == it, { from = it }) } }
    Text("To", style = MaterialTheme.typography.titleSmall); FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { units.forEach { Chip(it, to == it, { to = it }) } }
    val v = amount.toDoubleOrNull()
    Text(if (v == null) "Enter a number to convert." else "$amount $from = ${Convert.format(kind, Convert.convert(kind, v, from, to), to)}", Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("convert-result"), style = MaterialTheme.typography.headlineSmall)
}

@Composable
private fun Measures() {
    Text("Kitchen equivalents", style = MaterialTheme.typography.titleMedium); Convert.equivalents.forEach { Text("• $it", style = MaterialTheme.typography.bodyLarge) }
    Spacer(Modifier.height(8.dp)); Text("Oven temperatures", style = MaterialTheme.typography.titleMedium); Convert.ovenTemps.forEach { Text("• $it", style = MaterialTheme.typography.bodyLarge) }
    Text("Flour and sugar weights are approximate; weighing is more accurate than measuring by volume.", style = MaterialTheme.typography.bodySmall)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PrintShareScreen(c: AppContainer, nav: NavController) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val recipes by c.repo.recipes().collectAsState(initial = emptyList())
    val week by c.selectedWeek.collectAsState()
    var chosen by remember { mutableStateOf<String?>(null) }
    suspend fun planText(): String { val meals = c.repo.mealsFor(week, week.plusDays(6)).associateBy { it.date }
        return buildString { appendLine("Meal plan: ${Planner.rangeLabel(week)}"); Planner.days(week).forEach { d -> val m = meals[d.toString()]; val r = m?.let { x -> recipes.firstOrNull { it.id == x.recipeId } }; appendLine("${Planner.dayLabel(d)} ${Planner.dateLabel(d)}: ${r?.title ?: "—"}${m?.servings?.let { " ($it servings)" } ?: ""}") } } }
    suspend fun groceryText(): String { val items = c.db.grocery().week(week.toString()).map { it.toModel() }
        return buildString { appendLine("Grocery list: ${Planner.rangeLabel(week)}"); (DEFAULT_AISLES + items.map { it.aisle }.distinct().filter { it !in DEFAULT_AISLES }).forEach { a -> val l = items.filter { it.aisle == a }; if (l.isNotEmpty()) { appendLine(); appendLine(aisleName(a)); l.forEach { appendLine((if (it.checked) "[x] " else "[ ] ") + it.name + if (it.quantityText.isNotEmpty()) " — ${it.quantityText}" else "") } } } } }
    fun print(title: String, text: String) = printText(context, title, text)
    UtilityPage("Print & Share", { nav.goBackOr("drawer") }) {
        Text("Share as text with any app, or print through Android's print service (or save as PDF).", style = MaterialTheme.typography.bodyMedium)
        Text("Meal plan and grocery list", style = MaterialTheme.typography.titleMedium); Text(Planner.rangeLabel(week))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BigButton("Share meal plan", { scope.launch { shareText(context, "Meal plan", planText()) } }, Modifier.weight(1f), primary = false)
            BigButton("Print meal plan", { scope.launch { print("Meal plan", planText()) } }, Modifier.weight(1f), primary = false)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BigButton("Share grocery list", { scope.launch { shareText(context, "Grocery list", groceryText()) } }, Modifier.weight(1f), primary = false)
            BigButton("Print grocery list", { scope.launch { print("Grocery list", groceryText()) } }, Modifier.weight(1f), primary = false)
        }
        HorizontalDivider()
        Text("A recipe", style = MaterialTheme.typography.titleMedium)
        if (recipes.isEmpty()) Text("Save a recipe first, then you can share or print it here.")
        recipes.sortedBy { it.title.lowercase() }.forEach { r ->
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(r.title.ifBlank { "Untitled recipe" }, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                TextButton({ shareText(context, r.title, RecipeText.format(r, null)) }) { Text("Share") }
                TextButton({ print(r.title, RecipeText.format(r, null)) }) { Text("Print") }
            }
        }
    }
}

/** Prints plain recipe/plan text through Android's print framework (also offers "Save as PDF"). */
fun printText(context: Context, title: String, text: String) {
    val html = "<html><head><meta charset='utf-8'><style>body{font-family:serif;font-size:14pt;line-height:1.4;margin:24px}h1{font-size:22pt}pre{font-family:serif;white-space:pre-wrap}</style></head><body><h1>" +
        android.text.Html.escapeHtml(title) + "</h1><pre>" + android.text.Html.escapeHtml(text) + "</pre></body></html>"
    val web = WebView(context)
    web.webViewClient = object : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String?) {
            val pm = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
            pm.print(title, view.createPrintDocumentAdapter(title), PrintAttributes.Builder().build())
        }
    }
    web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
}
