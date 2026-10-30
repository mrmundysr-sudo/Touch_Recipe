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
import com.mundymorning.touchrecipe.ui.art.ArtScreen
import com.mundymorning.touchrecipe.ui.art.NRect
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
fun CookScreen(c: AppContainer, nav: NavController, id: String) {
    val vm = vmOf("cook-$id") { CookViewModel(c, id) }
    val ui by vm.ui.collectAsState()
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

    if (missing) {
        ArtScreen("cook", "Cook Mode", onTarget = { if (it == "back") nav.goBackOr(Routes.HUB) }) {
            Column(Modifier.region("top").padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Nothing to cook yet", fontFamily = DisplayFont, fontSize = sp(44f), fontWeight = FontWeight.Bold, color = Palette.Ink, textAlign = TextAlign.Center)
                Text("This recipe has no directions. Add some in the recipe, then Cook Mode can guide you step by step.", color = Palette.Ink, textAlign = TextAlign.Center, fontSize = sp(26f))
            }
        }
        return
    }
    if (u == null) { ArtScreen("cook", "Cook Mode", onTarget = {}); return }

    val timerLabel = when {
        !u.timer.configured -> "Set timer"
        u.timer.running -> "Pause timer"
        remaining == 0L && u.timer.remainingMs == 0L -> "Restart timer"
        u.timer.remainingMs in 1 until u.timer.totalMs -> "Resume timer"
        else -> "Start timer"
    }

    ArtScreen("cook", "Cook Mode: ${u.recipe.title}", onTarget = { t ->
        when (t) {
            "back" -> nav.goBackOr(Routes.detail(id))     // progress and timer are saved continuously
            "prev" -> vm.prev()
            "next" -> if (vm.next()) finishDialog = true
            "start" -> if (u.timer.configured && !u.timer.running && remaining == 0L && u.timer.remainingMs == 0L) { vm.reset(); scheduleAlarm(vm.startPause()) } else toggleTimer()
            "clock" -> durationDialog = true
        }
    }) {
        // step chip
        Box(Modifier.region("stepchip").semantics(mergeDescendants = true) { contentDescription = "Step ${u.index + 1} of ${u.steps.size}" }, contentAlignment = Alignment.Center) {
            FitText("Step ${u.index + 1} of ${u.steps.size}", TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.Bold, fontSize = sp(26f), color = Palette.Ink), textAlign = TextAlign.Center)
        }
        // current direction
        Column(Modifier.region("top").padding(horizontal = dp(22f), vertical = dp(70f))) {
            Text(u.recipe.title.ifBlank { "Recipe" }, fontFamily = BodyFont, fontWeight = FontWeight.SemiBold, fontSize = sp(24f), color = Palette.Forest, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${u.index + 1}", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = sp(96f), color = Palette.Tomato, modifier = Modifier.testTag("step-number"))
                if (u.index in u.completed) Text("  ✓ done", color = Palette.Forest, fontWeight = FontWeight.Bold, fontSize = sp(28f), modifier = Modifier.testTag("step-done"))
            }
            Text(u.step.text, Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).testTag("step-text"), fontSize = sp(38f), lineHeight = sp(50f), color = Palette.Ink)
            Spacer(Modifier.height(dp(8f)))
            val timerText = when {
                !u.timer.configured -> "No timer for this step"
                else -> "⏱ ${CookTimer.format(remaining.takeIf { u.timer.running || u.timer.remainingMs > 0 } ?: u.timer.totalMs)}" + if (u.timerStep != u.index && u.timer.configured) "  (timer from step ${u.timerStep + 1})" else ""
            }
            Text(timerText, fontWeight = FontWeight.Bold, fontSize = sp(32f), color = Palette.Forest, modifier = Modifier.semantics { })
        }
        // progress + step list (or step image when the direction has one)
        Column(Modifier.region("bottom").padding(horizontal = dp(22f), vertical = dp(36f))) {
            val progress = u.completed.size.toFloat() / u.steps.size
            LinearProgressIndicator(progress = { progress }, Modifier.fillMaxWidth().height(10.dp).clip(CircleShape).semantics { progressBarRangeInfo = ProgressBarRangeInfo(progress, 0f..1f); contentDescription = "${u.completed.size} of ${u.steps.size} steps completed" }.testTag("cook-progress"),
                color = Palette.Tomato, trackColor = Palette.CreamDeep)
            Text("${u.completed.size} of ${u.steps.size} steps done", Modifier.padding(vertical = 4.dp), color = Palette.Ink, fontWeight = FontWeight.SemiBold, fontSize = sp(24f))
            val img = u.step.image
            if (img != null) PhotoImage(c.photos, img, Modifier.fillMaxWidth().weight(1f).clip(RoundedCornerShape(12.dp)), description = "Photo for step ${u.index + 1}")
            else LazyColumn(Modifier.weight(1f).testTag("step-list")) {
                itemsIndexed(u.steps, key = { _, d -> d.id }) { i, d ->
                    val done = i in u.completed
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClickLabel = "Go to step ${i + 1}") { vm.jump(i) }
                        .semantics(mergeDescendants = true) { stateDescription = (if (done) "Completed" else if (i == u.index) "Current" else "Not done") }, verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(28.dp).clip(CircleShape).background(if (done) Palette.Forest else Color.Transparent).border(2.dp, if (i == u.index) Palette.Tomato else Palette.Forest, CircleShape), contentAlignment = Alignment.Center) {
                            Text(if (done) "✓" else "${i + 1}", color = if (done) Palette.Cream else Palette.Ink, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.width(10.dp))
                        Text(d.text, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, color = Palette.Ink, fontWeight = if (i == u.index) FontWeight.Bold else FontWeight.Normal, fontSize = sp(24f))
                    }
                }
            }
        }
        // live countdown inside the blank clock face
        Box(Modifier.region("clockface").clip(CircleShape).background(Color(0xFFFBF3E0)).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
            val t = if (!u.timer.configured) "--:--" else CookTimer.format(if (u.timer.running || u.timer.remainingMs > 0) remaining else u.timer.totalMs)
            FitText(t, TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.Bold, fontSize = sp(30f), color = Palette.Ink), Modifier.padding(horizontal = dp(8f)).testTag("clock-face"), textAlign = TextAlign.Center)
        }
        // state-aware label over the baked "Start Timer" text
        val start = page.target("start").box
        Box(Modifier.region(NRect(start.x + start.w * 0.2f, start.y + start.h * 0.2f, start.w * 0.6f, start.h * 0.6f)).clip(RoundedCornerShape(dp(18f))).background(Color(0xFFCF4A27)).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
            FitText(timerLabel, TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.SemiBold, fontSize = sp(40f), color = Color(0xFFFFF4E0)), Modifier.padding(horizontal = dp(6f)).testTag("timer-label"), textAlign = TextAlign.Center)
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
