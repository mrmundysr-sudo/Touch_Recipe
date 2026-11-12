package com.mundymorning.touchrecipe.ui.screens

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavController
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.model.Direction
import com.mundymorning.touchrecipe.core.model.Recipe
import com.mundymorning.touchrecipe.core.timer.CookTimer
import com.mundymorning.touchrecipe.data.Repository.CookSession
import com.mundymorning.touchrecipe.data.TimerAlarm
import com.mundymorning.touchrecipe.ui.Routes
import com.mundymorning.touchrecipe.ui.art.ArtButton
import com.mundymorning.touchrecipe.ui.art.ArtSlot
import com.mundymorning.touchrecipe.ui.art.PageFrame
import com.mundymorning.touchrecipe.core.quantity.Quantities
import com.mundymorning.touchrecipe.ui.components.*
import com.mundymorning.touchrecipe.ui.theme.BodyFont
import com.mundymorning.touchrecipe.ui.theme.DisplayFont
import com.mundymorning.touchrecipe.ui.theme.Palette
import com.mundymorning.touchrecipe.ui.vmOf
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class CookUi(
    val recipe: Recipe, val steps: List<Direction>, val index: Int, val completed: Set<Int>,
    val timer: CookTimer, val timerStep: Int, val finished: Boolean,
) { val step: Direction get() = steps[index.coerceIn(0, steps.lastIndex)] }

class CookViewModel(private val c: AppContainer, val id: String) : ViewModel() {
    private val _ui = MutableStateFlow<CookUi?>(null)
    val ui: StateFlow<CookUi?> = _ui
    val missing = MutableStateFlow(false)
    private val now get() = c.clock()

    init {
        viewModelScope.launch {
            val r = c.repo.getRecipe(id)
            val steps = r?.directions?.filter { !it.header }.orEmpty()
            if (r == null || steps.isEmpty()) { missing.value = true; return@launch }
            val s = c.repo.cookSession(id)
            _ui.value = if (s != null && !s.finished) CookUi(r, steps, s.stepIndex.coerceIn(0, steps.lastIndex), s.completed.filter { it < steps.size }.toSet(), s.timer, s.timerStep, false)
            else { val t = CookTimer().withDuration(steps[0].timerSeconds); CookUi(r, steps, 0, emptySet(), t, 0, false).also { persist(it) } }
        }
    }

    private fun persist(u: CookUi) { viewModelScope.launch { c.repo.saveCookSession(CookSession(id, u.index, u.completed, u.timer, u.timerStep, u.finished)) } }
    private fun update(f: (CookUi) -> CookUi) { val u = _ui.value ?: return; val n = f(u); _ui.value = n; persist(n) }

    /** The timer belongs to the step it was started on: moving on never silently resets a timer that is running or paused mid-way. */
    private fun timerBusy(u: CookUi) = u.timer.running || (u.timer.configured && u.timer.remainingMs in 1 until u.timer.totalMs)
    private fun carry(u: CookUi, to: Int): Pair<CookTimer, Int> =
        if (timerBusy(u)) u.timer to u.timerStep else CookTimer().withDuration(u.steps[to].timerSeconds) to to

    fun next(): Boolean {
        val u = _ui.value ?: return false
        if (u.index >= u.steps.lastIndex) { update { it.copy(completed = it.completed + it.index) }; return true }
        update { x -> val to = x.index + 1; val (t, ts) = carry(x, to); x.copy(index = to, completed = x.completed + x.index, timer = t, timerStep = ts) }
        return false
    }
    fun prev() = update { x -> if (x.index == 0) x else { val to = x.index - 1; val (t, ts) = carry(x, to); x.copy(index = to, timer = t, timerStep = ts) } }
    fun jump(i: Int) = update { x -> val (t, ts) = carry(x, i); x.copy(index = i, timer = t, timerStep = ts) }
    fun startPause(): CookTimer? {
        var out: CookTimer? = null
        update { x -> val t = if (x.timer.running) x.timer.pause(now) else x.timer.start(now); out = t; x.copy(timer = t, timerStep = if (x.timer.running) x.timerStep else x.index) }
        return out
    }
    fun reset() = update { it.copy(timer = it.timer.reset(), timerStep = it.index) }
    fun setDuration(seconds: Int?) = update { it.copy(timer = CookTimer().withDuration(seconds), timerStep = it.index) }
    fun timerFinished() = update { it.copy(timer = it.timer.copy(remainingMs = 0, endAtMs = null)) }
    fun finish() { val u = _ui.value ?: return; _ui.value = u.copy(finished = true); viewModelScope.launch { c.repo.saveCookSession(CookSession(id, u.index, u.completed, CookTimer(), u.timerStep, true)) } }
}

@Composable
fun CookScreen(c: AppContainer, nav: NavController, id: String, servings: Int? = null) {
    val vm = vmOf("cook-$id") { CookViewModel(c, id) }
    val ui by vm.ui.collectAsState()
    val liveRecipe by remember { c.repo.recipe(id) }.collectAsState(initial = null)   // live, so ticking an ingredient here and on the recipe stay in step
    val missing by vm.missing.collectAsState()
    val context = LocalContext.current
    val view = LocalView.current
    val keepAwake by c.prefs.keepAwake.collectAsState()
    val vibrate by c.prefs.timerVibrate.collectAsState()
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var durationDialog by remember { mutableStateOf(false) }
    var finishDialog by remember { mutableStateOf(false) }
    var notifExplain by remember { mutableStateOf(false) }
    var timeUp by remember { mutableStateOf(false) }

    DisposableEffect(keepAwake) { view.keepScreenOn = keepAwake; onDispose { view.keepScreenOn = false } }

    // live countdown
    var now by remember { mutableLongStateOf(c.clock()) }
    val running = ui?.timer?.running == true
    LaunchedEffect(running) { while (running) { now = c.clock(); kotlinx.coroutines.delay(250) }; now = c.clock() }
    val u = ui
    val remaining = u?.timer?.remaining(now) ?: 0L
    LaunchedEffect(u?.timer?.endAtMs, remaining == 0L) {
        if (u != null && u.timer.running && remaining == 0L) {
            vm.timerFinished(); TimerAlarm.cancel(context, id); timeUp = true
            if (vibrate) buzz(context)
        }
    }

    fun scheduleAlarm(t: CookTimer?) {
        val title = u?.recipe?.title ?: return
        if (t?.endAtMs != null) { TimerAlarm.ensureChannel(context); TimerAlarm.schedule(context, id, "$title — step ${(u.timerStep) + 1} timer is done", t.endAtMs) } else TimerAlarm.cancel(context, id)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { _ -> scheduleAlarm(vm.startPause()) }

    fun toggleTimer() {
        val cur = vm.ui.value ?: return
        if (!cur.timer.configured) { durationDialog = true; return }
        if (cur.timer.running) { scheduleAlarm(vm.startPause()); return }
        // explain notifications at the moment they matter (first timer start), then ask
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && !c.prefs.notifAsked) { notifExplain = true; return }
        scheduleAlarm(vm.startPause())
    }

    fun pressTimer() {
        val cur = vm.ui.value ?: return
        if (cur.timer.configured && !cur.timer.running && cur.timer.remaining(c.clock()) == 0L && cur.timer.remainingMs == 0L) { vm.reset(); scheduleAlarm(vm.startPause()) } else toggleTimer()
    }

    if (missing) {
        PageFrame("Cook Mode", topBar = { Row(Modifier.fillMaxWidth().padding(8.dp)) { ArtButton("back", "←", round = true, description = "Back", onClick = { nav.goBackOr(Routes.HUB) }) } }) {
            Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Nothing to cook yet", fontFamily = DisplayFont, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Palette.Ink, textAlign = TextAlign.Center)
                Text("This recipe has no directions. Add some in the recipe, then Cook Mode can guide you step by step.", color = Palette.Ink, textAlign = TextAlign.Center, fontSize = 17.sp)
            }
        }
        return
    }
    if (u == null) { PageFrame("Cook Mode", topBar = {}) {}; return }

    val timerLabel = when {
        !u.timer.configured -> "Set timer"
        u.timer.running -> "Pause timer"
        remaining == 0L && u.timer.remainingMs == 0L -> "Restart timer"
        u.timer.remainingMs in 1 until u.timer.totalMs -> "Resume timer"
        else -> "Start timer"
    }
    // the recipe's ingredients, amounts scaled to the servings chosen on the recipe page
    val ingredients = liveRecipe?.ingredients ?: u.recipe.ingredients
    val factor = Quantities.factor(u.recipe.servings, servings)
    val listState = rememberLazyListState()
    // rows ahead of the first step: top decoration, Ingredients heading, the ingredient rows (or one "none" row), Directions heading
    val firstStepRow = 2 + maxOf(ingredients.size, 1) + 1
    var shownIndex by remember { mutableIntStateOf(-1) }
    LaunchedEffect(u.index) {
        // moving to another step brings it into view; opening the page never moves it, so the reading position is kept
        if (shownIndex != -1 && shownIndex != u.index) runCatching { listState.animateScrollToItem(firstStepRow + u.index) }
        shownIndex = u.index
    }

    PageFrame("Cook Mode: ${u.recipe.title}",
        topBar = {
            Column(Modifier.fillMaxWidth().background(Palette.CreamDeep.copy(alpha = 0.7f)).padding(horizontal = 8.dp, vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ArtButton("back", "←", round = true, description = "Back", hint = "Returns to the recipe; progress is kept", onClick = { nav.goBackOr(Routes.detail(id)) })   // progress and timer are saved continuously
                    Column(Modifier.weight(1f).padding(start = 10.dp)) {
                        Text(u.recipe.title.ifBlank { "Recipe" }, fontFamily = BodyFont, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = Palette.Forest, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Step ", fontFamily = BodyFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Palette.Ink)
                            Text("${u.index + 1}", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = Palette.Tomato, modifier = Modifier.testTag("step-number"))
                            Text(" of ${u.steps.size}", fontFamily = BodyFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Palette.Ink)
                            if (u.index in u.completed) Text("  \u2713 done", color = Palette.Forest, fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.testTag("step-done"))
                        }
                    }
                }
                val progress = u.completed.size.toFloat() / u.steps.size
                LinearProgressIndicator(progress = { progress }, Modifier.fillMaxWidth().padding(top = 4.dp).height(8.dp).clip(CircleShape).semantics { progressBarRangeInfo = ProgressBarRangeInfo(progress, 0f..1f); contentDescription = "${u.completed.size} of ${u.steps.size} steps completed" }.testTag("cook-progress"),
                    color = Palette.Tomato, trackColor = Palette.CreamDeep)
                // the timer stays in reach however far the page is scrolled
                if (u.timer.configured) {
                    val shown = CookTimer.format(remaining.takeIf { u.timer.running || u.timer.remainingMs > 0 } ?: u.timer.totalMs)
                    Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFFCF4A27)).clickable(onClickLabel = timerLabel, role = Role.Button) { pressTimer() }
                            .padding(horizontal = 14.dp, vertical = 6.dp).testTag("timer-button"), contentAlignment = Alignment.Center) {
                            Text(timerLabel, fontFamily = DisplayFont, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Color(0xFFFFF4E0), modifier = Modifier.testTag("timer-label"))
                        }
                        Text(shown, Modifier.padding(start = 12.dp).semantics { contentDescription = "Time left $shown" }.testTag("clock-face"), fontFamily = BodyFont, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = Palette.Ink)
                        TextButton({ durationDialog = true }, Modifier.testTag("timer-change")) { Text("Change", color = Palette.Forest, fontSize = 15.sp) }
                    }
                    if (u.timerStep != u.index) Text("(timer from step ${u.timerStep + 1})", color = Palette.Forest, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                } else TextButton({ durationDialog = true }, Modifier.testTag("timer-add")) { Text("\u23F1 Add a timer", color = Palette.Forest, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) }
            }
        },
        bottomBar = {
            Row(Modifier.fillMaxWidth().background(Palette.CreamDeep.copy(alpha = 0.7f)).padding(horizontal = 10.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ArtButton("prev", "Previous step", Modifier.weight(1f), hint = "Returns to the prior direction", onClick = { vm.prev() })
                ArtButton("next", if (u.index >= u.steps.lastIndex) "Finish" else "Next step", Modifier.weight(1f), primary = true, hint = "Completes this step and moves on", onClick = { if (vm.next()) finishDialog = true })
            }
        },
    ) {
        // ingredients first, then every step, in one page that scrolls freely: nobody is forced to advance one step at a time
        LazyColumn(Modifier.fillMaxSize().testTag("cook-scroll"), state = listState, contentPadding = PaddingValues(bottom = 20.dp)) {
            item(key = "art-top") { ArtSlot("cook_mode_top") }
            item(key = "ing-head") { Text("Ingredients", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = Palette.Forest, modifier = Modifier.padding(top = 4.dp).semantics { heading() }.testTag("cook-ingredients")) }
            if (ingredients.isEmpty()) item(key = "ing-empty") { Text("This recipe has no ingredients listed.", color = Palette.Ink.copy(alpha = 0.7f), fontSize = 17.sp, modifier = Modifier.padding(top = 8.dp)) }
            itemsIndexed(ingredients, key = { _, i -> "ing:" + i.id }) { _, ing ->
                if (ing.header) Text(ing.text, fontWeight = FontWeight.Bold, color = Palette.Forest, fontSize = 18.sp, modifier = Modifier.padding(top = 8.dp).semantics { heading() })
                else Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(ing.checked, role = Role.Checkbox, onValueChange = { v -> scope.launch { c.repo.updateIngredients(id) { l -> l.map { if (it.id == ing.id) it.copy(checked = v) else it } } } }).padding(vertical = 4.dp).testTag("cook-ing:${ing.id}"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(26.dp).clip(RoundedCornerShape(6.dp)).border(2.dp, Palette.Forest, RoundedCornerShape(6.dp)).background(if (ing.checked) Palette.Forest else Color.Transparent), contentAlignment = Alignment.Center) {
                        if (ing.checked) Text("\u2713", color = Palette.Cream, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(12.dp))
                    Text(Quantities.scale(ing.text, factor), color = Palette.Ink, fontSize = 18.sp, lineHeight = 25.sp, textDecoration = if (ing.checked) androidx.compose.ui.text.style.TextDecoration.LineThrough else null)
                }
            }
            item(key = "steps-head") { Text("Directions", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = Palette.Forest, modifier = Modifier.padding(top = 14.dp).semantics { heading() }) }
            itemsIndexed(u.steps, key = { _, d -> "step:" + d.id }) { i, d ->
                val current = i == u.index; val done = i in u.completed
                val shape = RoundedCornerShape(14.dp)
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 5.dp).clip(shape).background(if (current) Color(0xFFFFF4E0) else Color.Transparent)
                        .then(if (current) Modifier.border(2.5.dp, Palette.Tomato, shape) else Modifier)
                        .clickable(onClickLabel = "Make step ${i + 1} the current step", role = Role.Button) { vm.jump(i) }
                        .semantics { if (current) stateDescription = "Current step"; if (done) contentDescription = "Step ${i + 1}, done" }
                        .testTag("cook-step:$i").padding(10.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Box(Modifier.size(34.dp).clip(CircleShape).background(if (current) Palette.Tomato else if (done) Palette.Forest else Palette.Brass), contentAlignment = Alignment.Center) {
                        Text(if (done && !current) "\u2713" else "${i + 1}", color = Palette.Cream, fontSize = 16.sp, lineHeight = 16.sp, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        if (current) Text("Current step", color = Palette.Tomato, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Text(d.text, color = Palette.Ink, fontSize = if (current) 22.sp else 18.sp, lineHeight = if (current) 30.sp else 25.sp, modifier = if (current) Modifier.testTag("step-text") else Modifier)
                        val img = d.image
                        if (img != null) PhotoImage(c.photos, img, Modifier.fillMaxWidth().height(140.dp).padding(top = 6.dp).clip(RoundedCornerShape(12.dp)), description = "Photo for step ${i + 1}")
                    }
                }
            }
            item(key = "art-bottom") { ArtSlot("cook_mode_bottom", 34.dp) }
        }
    }

    if (durationDialog) TimerDurationDialog(u.timer.totalMs / 1000, onSet = { vm.setDuration(it); TimerAlarm.cancel(context, id); durationDialog = false }, onReset = { vm.reset(); TimerAlarm.cancel(context, id); durationDialog = false }, onDismiss = { durationDialog = false })
    if (timeUp) AlertDialog(onDismissRequest = { timeUp = false }, title = { Text("Time's up!") }, text = { Text("The timer for step ${u.timerStep + 1} has finished.") },
        confirmButton = { TextButton({ timeUp = false; vm.reset() }) { Text("Reset timer") } }, dismissButton = { TextButton({ timeUp = false }) { Text("OK") } })
    if (notifExplain) AlertDialog(onDismissRequest = { notifExplain = false }, title = { Text("Timer alerts") },
        text = { Text("Touch Recipe can notify you when a timer finishes, even if the screen is off or you switch apps. Android will ask for permission to show notifications. You can also keep going without it; the timer still works while this screen is open.") },
        confirmButton = { TextButton({ notifExplain = false; c.prefs.notifAsked = true; permission.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Continue") } },
        dismissButton = { TextButton({ notifExplain = false; c.prefs.notifAsked = true; scheduleAlarm(vm.startPause()) }) { Text("Not now") } })
    if (finishDialog) AlertDialog(onDismissRequest = { finishDialog = false }, title = { Text("All steps done") }, text = { Text("Nice cooking! Finish this session, or stay and review the steps.") },
        confirmButton = { TextButton({ finishDialog = false; vm.finish(); TimerAlarm.cancel(context, id); nav.goBackOr(Routes.detail(id)) }) { Text("Finish") } },
        dismissButton = { TextButton({ finishDialog = false }) { Text("Keep reviewing") } })
}

@Suppress("DEPRECATION")
private fun buzz(context: Context) {
    runCatching {
        val v = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 400, 200, 400, 200, 600), -1)) else v.vibrate(longArrayOf(0, 400, 200, 400), -1)
    }
}

@Composable
private fun TimerDurationDialog(currentSeconds: Long, onSet: (Int?) -> Unit, onReset: () -> Unit, onDismiss: () -> Unit) {
    var minutes by remember { mutableStateOf((currentSeconds / 60).takeIf { it > 0 }?.toString() ?: "") }
    var seconds by remember { mutableStateOf((currentSeconds % 60).takeIf { it > 0 }?.toString() ?: "") }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Step timer") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Set how long this step should be timed. Leave both empty for no timer.")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(minutes, { minutes = it.filter(Char::isDigit).take(3) }, Modifier.weight(1f).testTag("timer-minutes"), label = { Text("Minutes") }, singleLine = true, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number))
                OutlinedTextField(seconds, { seconds = it.filter(Char::isDigit).take(2) }, Modifier.weight(1f).testTag("timer-seconds"), label = { Text("Seconds") }, singleLine = true, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number))
            }
            if (currentSeconds > 0) TextButton(onReset) { Text("Reset to ${CookTimer.format(currentSeconds * 1000)}") }
        }
    }, confirmButton = { TextButton({ val total = (minutes.toIntOrNull() ?: 0) * 60 + (seconds.toIntOrNull() ?: 0); onSet(total.takeIf { it > 0 }) }) { Text("Set") } },
        dismissButton = { TextButton(onDismiss) { Text("Cancel") } })
}
