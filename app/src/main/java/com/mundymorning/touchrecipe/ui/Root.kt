package com.mundymorning.touchrecipe.ui

import android.app.Activity
import android.content.Context
import android.provider.Settings
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.ui.unit.dp
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.data.MotionPref
import com.mundymorning.touchrecipe.ui.art.GlowController
import com.mundymorning.touchrecipe.ui.art.LocalArt
import com.mundymorning.touchrecipe.ui.art.LocalGlowController
import com.mundymorning.touchrecipe.ui.components.LocalSnack
import com.mundymorning.touchrecipe.ui.screens.*
import com.mundymorning.touchrecipe.ui.theme.TouchRecipeTheme

object Routes {
    const val SPLASH = "splash"; const val HUB = "hub"
    const val COLLECTION = "collection?search={search}"; fun collection(search: Boolean = false) = "collection?search=$search"
    const val DETAIL = "detail/{id}"; fun detail(id: String) = "detail/$id"
    const val COOK = "cook/{id}"; fun cook(id: String) = "cook/$id"
    const val IMPORT = "import"
    const val REVIEW = "review?edit={edit}"; fun review(editId: String? = null) = "review?edit=${editId ?: ""}"
    const val PLANNER = "planner"; const val GROCERY = "grocery"; const val DRAWER = "drawer"
    const val SETTINGS = "settings"; const val CATEGORIES = "categories"; const val BACKUP = "backup"; const val THEMES = "themes"
    const val HELP = "help"; const val TOOLS = "tools"; const val PRINT = "print"
}

@Composable
inline fun <reified VM : ViewModel> vmOf(key: String? = null, crossinline create: () -> VM): VM =
    viewModel(key = key, factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = create() as T
    })

private class PrefsGlow(val c: AppContainer) : GlowController {
    private val plays = 2   // teaches on the first two visits of each page, then stays out of the way; replay from Settings or Help
    private val shown = HashSet<String>()
    override fun shouldPlay(page: String) = page !in shown && c.prefs.glowPlays(page) < plays
    override fun played(page: String) { shown += page; c.prefs.markGlowPlayed(page) }
}

fun systemReducedMotion(context: Context): Boolean =
    runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)

@Composable
fun TouchRecipeRoot(c: AppContainer, activity: Activity? = null) {
    val context = LocalContext.current
    val theme by c.prefs.theme.collectAsState()
    val motion by c.prefs.motion.collectAsState()
    val glow by c.prefs.glowGuide.collectAsState()
    val reduced = motion == MotionPref.REDUCED || systemReducedMotion(context)
    val snack = remember { SnackbarHostState() }
    val nav = rememberNavController()
    val share by c.pendingShare.collectAsState()

    LaunchedEffect(share) {
        if (share != null && nav.currentDestination?.route != Routes.IMPORT) {
            nav.navigate(Routes.IMPORT) { launchSingleTop = true }
        }
    }

    TouchRecipeTheme(theme, reduced, glow) {
        CompositionLocalProvider(LocalArt provides c.art, LocalGlowController provides remember { PrefsGlow(c) }, LocalSnack provides snack) {
            Box(Modifier.fillMaxSize()) {
                val enter: androidx.compose.animation.AnimatedContentTransitionScope<*>.() -> EnterTransition = { if (reduced) EnterTransition.None else fadeIn(tween(220)) }
                val exit: androidx.compose.animation.AnimatedContentTransitionScope<*>.() -> ExitTransition = { if (reduced) ExitTransition.None else fadeOut(tween(160)) }
                NavHost(nav, Routes.SPLASH, Modifier.fillMaxSize(), enterTransition = enter, exitTransition = exit, popEnterTransition = enter, popExitTransition = exit) {
                    composable(Routes.SPLASH) { SplashScreen(c) { nav.navigate(Routes.HUB) { popUpTo(Routes.SPLASH) { inclusive = true } } } }
                    composable(Routes.HUB) { HubScreen(c, nav) }
                    composable(Routes.COLLECTION, listOf(navArgument("search") { type = NavType.BoolType; defaultValue = false })) { CollectionScreen(c, nav, it.arguments?.getBoolean("search") ?: false) }
                    composable(Routes.DETAIL, listOf(navArgument("id") { type = NavType.StringType })) { DetailScreen(c, nav, it.arguments!!.getString("id")!!) }
                    composable(Routes.COOK, listOf(navArgument("id") { type = NavType.StringType })) { CookScreen(c, nav, it.arguments!!.getString("id")!!) }
                    composable(Routes.IMPORT) { ImportScreen(c, nav) }
                    composable(Routes.REVIEW, listOf(navArgument("edit") { type = NavType.StringType; defaultValue = "" })) { ReviewScreen(c, nav, it.arguments?.getString("edit").orEmpty().ifEmpty { null }) }
                    composable(Routes.PLANNER) { PlannerScreen(c, nav) }
                    composable(Routes.GROCERY) { GroceryScreen(c, nav) }
                    composable(Routes.DRAWER) { DrawerScreen(c, nav) }
                    composable(Routes.SETTINGS) { SettingsScreen(c, nav) }
                    composable(Routes.CATEGORIES) { CategoriesScreen(c, nav) }
                    composable(Routes.BACKUP) { BackupScreen(c, nav) }
                    composable(Routes.THEMES) { ThemesScreen(c, nav) }
                    composable(Routes.HELP) { HelpScreen(c, nav) }
                    composable(Routes.TOOLS) { ToolsScreen(c, nav) }
                    composable(Routes.PRINT) { PrintShareScreen(c, nav) }
                }
                // Top, over the pages' decorative title space: a bottom snackbar would cover (and swallow taps on) Save, Next, Add Item.
                SnackbarHost(snack, Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 68.dp))
            }
        }
    }
}
