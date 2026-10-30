package com.mundymorning.touchrecipe.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.categories.*
import com.mundymorning.touchrecipe.core.model.Category
import com.mundymorning.touchrecipe.ui.components.*
import kotlinx.coroutines.launch

/**
 * The full category catalog + custom entry. Used by the review screen's "Add Category" (with [selected]/[onSelect] for the recipe
 * being edited) and by Category Management (selection hidden).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CategoryCatalogContent(c: AppContainer, selected: Set<String>?, onSelect: ((String, Boolean) -> Unit)?, modifier: Modifier = Modifier) {
    val cats by c.repo.categories().collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()
    val customs = cats.filter { !it.builtIn }
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var renaming by remember { mutableStateOf<Category?>(null) }
    var deleting by remember { mutableStateOf<Category?>(null) }
    var deleteCount by remember { mutableIntStateOf(0) }
    val focus = remember { FocusRequester() }

    fun commit() {
        scope.launch {
            val (res, id) = c.repo.addCustomCategoryReturningId(name)
            when (res) {
                is CategoryResult.Ok -> { onSelect?.invoke(id!!, true); name = ""; error = null; runCatching { focus.requestFocus() } }   // fresh field ready immediately
                is CategoryResult.Rejected -> error = res.reason
            }
        }
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Custom categories (${customs.size} of $MAX_CUSTOM_CATEGORIES)", style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        OutlinedTextField(
            name, { name = it; error = null }, Modifier.fillMaxWidth().focusRequester(focus).testTag("custom-category-field"),
            label = { Text("New custom category") }, singleLine = true, isError = error != null,
            supportingText = { Text(error ?: "Press Enter to add it. New categories are switched on right away.") },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Words),
            keyboardActions = KeyboardActions(onDone = { commit() }),
        )
        customs.forEach { cat ->
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(if (selected != null) cat.id in selected else cat.enabled, { v -> if (selected != null) onSelect?.invoke(cat.id, v) else scope.launch { c.repo.setCategoryEnabled(cat.id, v) } })
                Text(cat.name, Modifier.weight(1f))
                TextButton({ renaming = cat }) { Text("Edit") }
                TextButton({ scope.launch { deleteCount = c.repo.recipesUsingCategory(cat.id); deleting = cat } }) { Text("Delete") }
            }
        }
        HorizontalDivider(Modifier.padding(vertical = 4.dp))
        Text("Built-in categories", style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        Text("Switch on the categories you want to see when organising recipes. Turning one off only hides it; recipes keep their categories.", style = MaterialTheme.typography.bodySmall)
        CategoryCatalog.groups.forEach { (group, names) ->
            Text(group, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 6.dp).semantics { heading() })
            names.forEach { n ->
                val cat = cats.firstOrNull { it.id == CategoryCatalog.idFor(n) } ?: return@forEach
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(cat.name, Modifier.weight(1f))
                    if (selected != null && cat.id in selected) Text("✓ on this recipe  ", style = MaterialTheme.typography.labelMedium)
                    Switch(cat.enabled, { v ->
                        scope.launch { c.repo.setCategoryEnabled(cat.id, v) }
                        if (selected != null) onSelect?.invoke(cat.id, v)
                    }, Modifier.semantics { contentDescription = "${cat.name}, ${if (cat.enabled) "on" else "off"}" })
                }
            }
        }
    }
    renaming?.let { cat ->
        var v by remember(cat.id) { mutableStateOf(cat.name) }
        var err by remember(cat.id) { mutableStateOf<String?>(null) }
        AlertDialog({ renaming = null }, title = { Text("Rename category") },
            text = { OutlinedTextField(v, { v = it; err = null }, singleLine = true, isError = err != null, supportingText = { err?.let { Text(it) } }) },
            confirmButton = { TextButton({ scope.launch { when (val r = c.repo.renameCategory(cat.id, v)) { is CategoryResult.Ok -> renaming = null; is CategoryResult.Rejected -> err = r.reason } } }) { Text("Save") } },
            dismissButton = { TextButton({ renaming = null }) { Text("Cancel") } })
    }
    deleting?.let { cat ->
        ConfirmDialog("Delete “${cat.name}”?", if (deleteCount == 0) "No recipes use it." else "It will be removed from $deleteCount ${if (deleteCount == 1) "recipe" else "recipes"}. The recipes themselves are kept.", "Delete", destructive = true,
            onDismiss = { deleting = null }, onConfirm = { scope.launch { c.repo.deleteCustomCategory(cat.id); if (selected?.contains(cat.id) == true) onSelect?.invoke(cat.id, false); deleting = null } })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddCategorySheet(c: AppContainer, selected: Set<String>, onSelect: (String, Boolean) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxHeight(0.92f).padding(horizontal = 20.dp).imePadding()) {
            Text("Add Category", style = MaterialTheme.typography.headlineSmall)
            androidx.compose.foundation.layout.Box(Modifier.weight(1f)) {
                CategoryCatalogContent(c, selected, onSelect, Modifier.fillMaxSize().then(Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())))
            }
            BigButton("Done", onDismiss, Modifier.fillMaxWidth().padding(vertical = 12.dp))
        }
    }
}
