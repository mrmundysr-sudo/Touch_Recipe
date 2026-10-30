package com.mundymorning.touchrecipe.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.clickable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.model.Recipe
import com.mundymorning.touchrecipe.ui.Routes
import com.mundymorning.touchrecipe.ui.art.ArtScreen
import com.mundymorning.touchrecipe.ui.components.BigButton
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

fun NavController.goBackOr(route: String) { if (!popBackStack()) navigate(route) }

@Composable
fun SplashScreen(c: AppContainer, onDone: () -> Unit) {
    var skip by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        // Prepare local data while the splash is visible, but never trap the user: a hard 1.6 s ceiling and tap-to-skip.
        val minShow = launch { delay(900) }
        runCatching { kotlinx.coroutines.withTimeout(1600) { c.repo.ensureSeeded(); c.photos.sweep(c.repo.db.recipes().all().mapNotNull { it.photo }.toSet()) } }
        minShow.join()
        onDone()
    }
    ArtScreen("splash", title = "Touch Recipe", onTarget = {}, modifier = Modifier.clickable(onClickLabel = "Continue") { if (!skip) { skip = true; onDone() } })
}

@Composable
fun HubScreen(c: AppContainer, nav: NavController) {
    val scope = rememberCoroutineScope()
    var showWelcome by remember { mutableStateOf(!c.prefs.welcomeSeen) }
    var chooser by remember { mutableStateOf<List<Recipe>?>(null) }
    ArtScreen("hub", title = "Kitchen Hub", onTarget = { id ->
        when (id) {
            "stove" -> scope.launch {
                val active = c.repo.activeCookSession()
                val ok = active != null && c.repo.getRecipe(active.recipeId) != null
                val all = if (ok) emptyList() else c.repo.allRecipes()
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main.immediate) { if (ok) nav.navigate(Routes.cook(active!!.recipeId)) else chooser = all }
            }
            "calendar" -> nav.navigate(Routes.PLANNER)
            "new_recipe" -> nav.navigate(Routes.IMPORT)
            "search" -> nav.navigate(Routes.collection(true))
            "grocery" -> nav.navigate(Routes.GROCERY)
            "drawer" -> nav.navigate(Routes.DRAWER)
            "rolodex" -> nav.navigate(Routes.collection())
        }
    })
    chooser?.let { list -> CookChooser(list, onDismiss = { chooser = null }, onImport = { chooser = null; nav.navigate(Routes.IMPORT) }, onPick = { chooser = null; nav.navigate(Routes.cook(it)) }) }
    if (showWelcome) AlertDialog(
        onDismissRequest = {}, title = { Text("Welcome to Touch Recipe") },
        text = { Text("Tap anything in the kitchen to explore: the Rolodex holds your recipes, the fridge card brings new ones in, and the stove starts cooking.\n\nYour recipes stay on this phone. Nothing is uploaded unless you choose to import from a web link.") },
        confirmButton = { TextButton(onClick = { c.prefs.welcomeSeen = true; showWelcome = false }) { Text("Let's cook") } },
    )
}

/** "Stove → Cook Mode or active recipe": with nothing in progress, pick what to cook. */
@Composable
fun CookChooser(recipes: List<Recipe>, onDismiss: () -> Unit, onImport: () -> Unit, onPick: (String) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text("What are we cooking?") },
        text = {
            if (recipes.isEmpty()) Text("You don't have any recipes yet. Bring one in first, then come back to the stove.")
            else LazyColumn(Modifier.heightIn(max = 360.dp)) {
                items(recipes.filter { it.directions.any { d -> !d.header } }, key = Recipe::id) { r ->
                    Text(r.title.ifBlank { "Untitled recipe" }, Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable { onPick(r.id) }.padding(vertical = 14.dp), style = MaterialTheme.typography.titleMedium)
                    HorizontalDivider()
                }
            }
        },
        confirmButton = { if (recipes.isEmpty()) TextButton(onImport) { Text("Import a recipe") } },
        dismissButton = { TextButton(onDismiss) { Text("Close") } },
    )
}

@Composable
fun DrawerScreen(c: AppContainer, nav: NavController) {
    ArtScreen("drawer", title = "Kitchen Junk Drawer", onTarget = { id ->
        when (id) {
            "back" -> nav.goBackOr(Routes.HUB)
            "settings" -> nav.navigate(Routes.SETTINGS)
            "categories" -> nav.navigate(Routes.CATEGORIES)
            "backup" -> nav.navigate(Routes.BACKUP)
            "themes" -> nav.navigate(Routes.THEMES)
            "help" -> nav.navigate(Routes.HELP)
            "tools" -> nav.navigate(Routes.TOOLS)
            "print" -> nav.navigate(Routes.PRINT)
        }
    })
}
