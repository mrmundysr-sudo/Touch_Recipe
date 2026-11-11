package com.mundymorning.touchrecipe.data

import android.content.Context
import android.content.SharedPreferences
import com.mundymorning.touchrecipe.core.timer.NamedTimer
import com.mundymorning.touchrecipe.core.timer.NamedTimers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ThemeMode { SYSTEM, LIGHT, DARK, GARDEN, HARVEST, BERRY }
enum class MotionPref { SYSTEM, REDUCED }
/** App-wide text size multiplier (on top of Android's own font size setting). */
enum class TextSize(val scale: Float, val label: String) { NORMAL(1.0f, "Normal"), LARGE(1.2f, "Large"), XLARGE(1.4f, "Extra large") }

/** Small, privacy-conscious preference store (local only, included in backups, no identifiers). */
class Prefs(private val sp: SharedPreferences) {
    constructor(context: Context) : this(context.getSharedPreferences("touch_recipe_prefs", Context.MODE_PRIVATE))

    private val _theme = MutableStateFlow(runCatching { ThemeMode.valueOf(sp.getString("theme", "SYSTEM")!!) }.getOrDefault(ThemeMode.SYSTEM))
    val theme: StateFlow<ThemeMode> = _theme.asStateFlow()
    fun setTheme(m: ThemeMode) { sp.edit().putString("theme", m.name).apply(); _theme.value = m }

    private val _textSize = MutableStateFlow(runCatching { TextSize.valueOf(sp.getString("text_size", "LARGE")!!) }.getOrDefault(TextSize.LARGE))
    val textSize: StateFlow<TextSize> = _textSize.asStateFlow()
    fun setTextSize(t: TextSize) { sp.edit().putString("text_size", t.name).apply(); _textSize.value = t }

    private val _glow = MutableStateFlow(sp.getBoolean("glow", true))
    val glowGuide: StateFlow<Boolean> = _glow.asStateFlow()
    fun setGlowGuide(v: Boolean) { sp.edit().putBoolean("glow", v).apply(); _glow.value = v }

    private val _motion = MutableStateFlow(runCatching { MotionPref.valueOf(sp.getString("motion", "SYSTEM")!!) }.getOrDefault(MotionPref.SYSTEM))
    val motion: StateFlow<MotionPref> = _motion.asStateFlow()
    fun setMotion(m: MotionPref) { sp.edit().putString("motion", m.name).apply(); _motion.value = m }

    private val _keepAwake = MutableStateFlow(sp.getBoolean("keep_awake", true))
    val keepAwake: StateFlow<Boolean> = _keepAwake.asStateFlow()
    fun setKeepAwake(v: Boolean) { sp.edit().putBoolean("keep_awake", v).apply(); _keepAwake.value = v }

    private val _sundayStart = MutableStateFlow(sp.getBoolean("sunday_start", false))
    val sundayStart: StateFlow<Boolean> = _sundayStart.asStateFlow()
    fun setSundayStart(v: Boolean) { sp.edit().putBoolean("sunday_start", v).apply(); _sundayStart.value = v }

    private val _vibrate = MutableStateFlow(sp.getBoolean("vibrate", true))
    val timerVibrate: StateFlow<Boolean> = _vibrate.asStateFlow()
    fun setTimerVibrate(v: Boolean) { sp.edit().putBoolean("vibrate", v).apply(); _vibrate.value = v }

    /** The Timer & Tools stopwatches: persisted so they keep running (by wall-clock end time) when the app is closed. */
    private val _timers = MutableStateFlow(NamedTimers.decode(sp.getString("kitchen_timers", null)))
    val timers: StateFlow<List<NamedTimer>> = _timers.asStateFlow()
    fun saveTimers(list: List<NamedTimer>) { sp.edit().putString("kitchen_timers", NamedTimers.encode(list)).apply(); _timers.value = list }

    var welcomeSeen: Boolean get() = sp.getBoolean("welcome_seen", false); set(v) { sp.edit().putBoolean("welcome_seen", v).apply() }
    var notifAsked: Boolean get() = sp.getBoolean("notif_asked", false); set(v) { sp.edit().putBoolean("notif_asked", v).apply() }
    var sortOrder: String get() = sp.getString("sort", "RECENT")!!; set(v) { sp.edit().putString("sort", v).apply() }

    /** How many times a page's first-load illumination has played. */
    fun glowPlays(page: String): Int = sp.getInt("glow_$page", 0)
    fun markGlowPlayed(page: String) { sp.edit().putInt("glow_$page", glowPlays(page) + 1).apply() }
    fun resetGlow() { val e = sp.edit(); sp.all.keys.filter { it.startsWith("glow_") }.forEach { e.remove(it) }; e.apply(); welcomeSeen = false }

    fun exportable(): Map<String, String> = mapOf(
        "theme" to _theme.value.name, "text_size" to _textSize.value.name, "glow" to _glow.value.toString(), "motion" to _motion.value.name,
        "keep_awake" to _keepAwake.value.toString(), "sunday_start" to _sundayStart.value.toString(), "vibrate" to _vibrate.value.toString(),
    )

    fun restore(map: Map<String, String>) {
        map["theme"]?.let { runCatching { setTheme(ThemeMode.valueOf(it)) } }
        map["text_size"]?.let { runCatching { setTextSize(TextSize.valueOf(it)) } }
        map["glow"]?.let { setGlowGuide(it.toBoolean()) }
        map["motion"]?.let { runCatching { setMotion(MotionPref.valueOf(it)) } }
        map["keep_awake"]?.let { setKeepAwake(it.toBoolean()) }
        map["sunday_start"]?.let { setSundayStart(it.toBoolean()) }
        map["vibrate"]?.let { setTimerVibrate(it.toBoolean()) }
    }
}
