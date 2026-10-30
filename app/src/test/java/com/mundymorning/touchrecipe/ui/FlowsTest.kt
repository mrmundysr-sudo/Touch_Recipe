package com.mundymorning.touchrecipe.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.model.*
import com.mundymorning.touchrecipe.data.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h800dp-xxhdpi")
class FlowsTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    private val ctx get() = ApplicationProvider.getApplicationContext<android.content.Context>()
    private val fetcher = FakeFetcher()
    private val ocr = FakeOcr()
    private val clock = TestClock()
    private lateinit var c: AppContainer

    private fun recipes() = runBlocking { c.repo.recipes().first() }
    private fun cats() = runBlocking { c.repo.categories().first() }

    /** First timer start explains notifications before asking (privacy: permission at the moment of use). */
    private fun startTimer() {
        rule.tapArt("start")
        rule.waitUntil(20000) { rule.onAllNodesWithText("Timer alerts", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() || rule.textOf("timer-label") == "Pause timer" }
        if (rule.onAllNodesWithText("Timer alerts", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) rule.onNodeWithText("Not now").performClick()
        rule.waitUntil(20000) { rule.textOf("timer-label") == "Pause timer" }
    }

    private fun start(withRecipe: Boolean = true, photo: Boolean = false): AppContainer {
        c = testContainer(ctx, fetcher, ocr, clock)
        if (withRecipe) runBlocking { c.repo.saveRecipe(sampleRecipe("r1", photo = if (photo) c.photos.saveBytes(jpegBytes()) else null, categories = listOf("b_dinner"))) }
        rule.setContent { TouchRecipeRoot(c) }
        rule.assertPage("Kitchen Hub")
        return c
    }

    // ---------- navigation through every illustrated object ----------
    @Test fun hubObjectsOpenTheirPages() {
        start()
        val routes = listOf("calendar" to "Meal Planner", "new_recipe" to "Import Recipe", "search" to "Recipe Collection", "grocery" to "Grocery List", "drawer" to "Kitchen Junk Drawer", "rolodex" to "Recipe Collection")
        for ((id, page) in routes) { rule.tapArt(id); rule.assertPage(page); rule.systemBack(); rule.assertPage("Kitchen Hub") }
        rule.tapArt("stove"); rule.waitText("What are we cooking?"); rule.waitText("Spaghetti al Pomodoro"); rule.onNodeWithText("Spaghetti al Pomodoro").performClick(); rule.assertPage("Cook Mode: Spaghetti al Pomodoro")
    }

    @Test fun searchObjectOpensSearchField() { start(); rule.tapArt("search"); rule.assertPage("Recipe Collection"); rule.waitTag("search-field") }

    @Test fun drawerObjectsOpenUtilities() {
        start(); rule.tapArt("drawer"); rule.assertPage("Kitchen Junk Drawer")
        for ((id, page) in listOf("settings" to "Settings", "categories" to "Category Management", "backup" to "Backup & Export", "themes" to "Themes", "help" to "Help", "tools" to "Timer & Tools", "print" to "Print & Share")) {
            rule.tapArt(id); rule.assertPage(page); rule.systemBack(); rule.assertPage("Kitchen Junk Drawer")
        }
        rule.tapArt("back"); rule.assertPage("Kitchen Hub")
    }

    @Test fun everyPageBackControlWorks() {
        start(); rule.tapArt("new_recipe"); rule.assertPage("Import Recipe"); rule.tapArt("back"); rule.assertPage("Kitchen Hub")
        rule.tapArt("rolodex"); rule.assertPage("Recipe Collection"); rule.waitTag("recipe-card:r1"); rule.clickTag("recipe-card:r1"); rule.assertPage("Spaghetti al Pomodoro")
        rule.tapArt("back"); rule.assertPage("Recipe Collection"); rule.backChip(); rule.assertPage("Kitchen Hub")
    }

    // ---------- first-load illumination ----------
    @Test fun firstLoadIlluminatesEveryObjectOnceAndTapGlows() {
        c = testContainer(ctx, fetcher, ocr, clock)
        rule.mainClock.autoAdvance = false
        rule.setContent { TouchRecipeRoot(c) }
        val hub = listOf("stove", "calendar", "new_recipe", "search", "grocery", "drawer", "rolodex")
        val seen = HashSet<String>()
        repeat(160) {
            rule.mainClock.advanceTimeBy(50)
            hub.forEach { if (rule.highlighted(it)) seen += it }
        }
        assertEquals("every clickable object should briefly glow", hub.toSet(), seen)
        repeat(40) { rule.mainClock.advanceTimeBy(100) }
        hub.forEach { assertFalse("glow must fade ($it)", rule.highlighted(it)) }
        rule.onNodeWithTag("art:stove", useUnmergedTree = true).performClick()
        rule.mainClock.advanceTimeBy(60)
        assertTrue("tapped object glows", rule.highlighted("stove"))
    }

    @Test fun reducedMotionStillHighlightsButSoftly() {
        c = testContainer(ctx, fetcher, ocr, clock); c.prefs.setMotion(MotionPref.REDUCED)
        rule.mainClock.autoAdvance = false
        rule.setContent { TouchRecipeRoot(c) }
        var simultaneous = false
        repeat(60) { rule.mainClock.advanceTimeBy(50); if (listOf("stove", "calendar", "rolodex").all { rule.highlighted(it) }) simultaneous = true }
        assertTrue("reduced motion uses one gentle simultaneous fade, no staggered sweep", simultaneous)
    }

    @Test fun glowCanBeSwitchedOff() {
        c = testContainer(ctx, fetcher, ocr, clock); c.prefs.setGlowGuide(false)
        rule.mainClock.autoAdvance = false
        rule.setContent { TouchRecipeRoot(c) }
        repeat(100) { rule.mainClock.advanceTimeBy(50); assertFalse(rule.highlighted("stove")) }
    }

    // ---------- import: URL, paste, share, offline ----------
    @Test fun importUrlThroughReviewToSave() {
        fetcher.pages["https://example.com/carbonara"] = FetchOutcome.Page(LD_PAGE, "https://example.com/carbonara")
        start(false); rule.tapArt("new_recipe"); rule.assertPage("Import Recipe"); rule.tapArt("url")
        rule.onNodeWithTag("url-field").performTextInput("example.com/carbonara"); rule.onNodeWithTag("url-import").performClick()
        rule.waitTag("result-continue"); rule.onNodeWithText("We found a recipe", substring = true).assertExists()
        assertTrue("nothing saved before review", recipes().isEmpty())
        rule.onNodeWithTag("result-continue").performClick(); rule.assertPage("Review and save")
        rule.onNodeWithTag("title-field").assertTextContains("Imported Carbonara")
        rule.tapArt("save"); rule.assertPage("Imported Carbonara")
        val saved = recipes().single()
        assertEquals("https://example.com/carbonara", saved.sourceUrl); assertEquals(3, saved.ingredients.size); assertEquals(2, saved.directions.size); assertEquals(540, saved.directions[0].timerSeconds)
        assertNotNull("raw source preserved for later correction", saved.rawSource)
    }

    @Test fun importPastedTextCorrectAndSave() {
        start(false); rule.tapArt("new_recipe"); rule.tapArt("text")
        rule.onNodeWithTag("text-field").performTextInput("Tomato Soup\nIngredients\n2 cups stock\n3 tomatoes\nDirections\n1. Simmer everything for 20 minutes.\n2. Blend until smooth.")
        rule.onNodeWithTag("text-import").performClick(); rule.waitTag("result-continue"); rule.onNodeWithTag("result-continue").performClick()
        rule.assertPage("Review and save")
        rule.onNodeWithTag("title-field").performTextReplacement("Corrected Tomato Soup")
        rule.tapArt("save"); rule.assertPage("Corrected Tomato Soup")
        val r = recipes().single()
        assertEquals(listOf("2 cups stock", "3 tomatoes"), r.ingredients.map { it.text }); assertEquals(2, r.directions.size)
    }

    @Test fun continueWithoutImportExplains() { start(false); rule.tapArt("new_recipe"); rule.tapArt("continue"); rule.waitText("Add a recipe first", substring = true) }

    @Test fun androidShareStartsImportWithoutSaving() {
        fetcher.pages["https://example.com/carbonara"] = FetchOutcome.Page(LD_PAGE, "https://example.com/carbonara")
        start(false)
        c.pendingShare.value = c.importer.classify("Look at this! https://example.com/carbonara")
        rule.assertPage("Import Recipe"); rule.waitTag("result-continue")
        assertNull(c.pendingShare.value)
        assertTrue(recipes().isEmpty())
    }

    @Test fun noNetworkShowsRetryThenRecovers() {
        start(false); rule.tapArt("new_recipe"); rule.tapArt("url")
        rule.onNodeWithTag("url-field").performTextInput("https://offline.example.com/x"); rule.onNodeWithTag("url-import").performClick()
        rule.waitTag("import-error"); rule.onNodeWithText("You seem to be offline").assertExists(); rule.onNodeWithText("Try again").assertExists()
        rule.onNodeWithText("Paste or type the recipe instead").assertExists()
        assertTrue(recipes().isEmpty())
        fetcher.pages["https://offline.example.com/x"] = FetchOutcome.Page(LD_PAGE, "https://offline.example.com/x")
        rule.onNodeWithText("Try again").performClick(); rule.waitTag("result-continue")
    }

    @Test fun blockedSiteIsReportedHonestly() {
        fetcher.pages["https://blocked.example.com/x"] = FetchOutcome.Blocked(403, "The site declined to share this page automatically (HTTP 403).")
        start(false); rule.tapArt("new_recipe"); rule.tapArt("url")
        rule.onNodeWithTag("url-field").performTextInput("https://blocked.example.com/x"); rule.onNodeWithTag("url-import").performClick()
        rule.waitTag("import-error"); rule.onNodeWithText("This page wouldn't open for us").assertExists()
    }

    // ---------- review editing ----------
    @Test fun reviewDynamicRowsValidationAndUndo() {
        start(false)
        c.importSession.draft.value = ImportDraft(Recipe(title = "", ingredients = emptyList(), directions = emptyList()), ImportMethod.TEXT, Confidence.LOW, emptyList())
        rule.tapArt("new_recipe"); rule.tapArt("continue"); rule.assertPage("Review and save")
        rule.onNodeWithTag("ing-rows:row:0").assertExists(); rule.onNodeWithTag("dir-rows:row:0").assertExists()
        rule.onNodeWithTag("ing-rows:row:1").assertDoesNotExist()
        rule.tapArt("save"); rule.waitText("Add a title.")      // validation: clear message, nothing saved
        rule.tapArt("add_ingredient"); rule.onNodeWithTag("ing-rows:row:1").assertExists()
        rule.tapArt("add_direction"); rule.tapArt("add_direction"); rule.onNodeWithTag("dir-rows:row:2").assertExists()
        // type into the first ingredient, delete it through the accessibility action, undo
        rule.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("ing-rows:row:0"))).performTextInput("2 cups flour")
        val actions = rule.onNodeWithTag("ing-rows:row:0").fetchSemanticsNode().config[SemanticsActions.CustomActions]
        assertTrue(actions.any { it.label == "Delete" } && actions.any { it.label == "Move down" })
        rule.runOnIdle { actions.first { it.label == "Delete" }.action() }
        rule.waitText("Removed ingredient 1"); rule.onNodeWithTag("ing-rows:row:1").assertDoesNotExist()
        rule.onNodeWithText("Undo").performClick(); rule.waitForIdle(); rule.onNodeWithTag("ing-rows:row:1").assertExists()
        // reorder through the accessibility action and renumber directions
        val move = rule.onNodeWithTag("ing-rows:row:0").fetchSemanticsNode().config[SemanticsActions.CustomActions].first { it.label == "Move down" }
        rule.runOnIdle { move.action() }; rule.waitForIdle()
        assertEquals("2 cups flour", rule.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("ing-rows:row:1"))).fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
        rule.onNodeWithTag("dir-rows:row:2").assertExists()
    }

    @Test fun keyboardEnterOnLastRowAddsNextRow() {
        start(false); c.importSession.draft.value = ImportDraft(Recipe(title = "T"), ImportMethod.TEXT, Confidence.LOW, emptyList())
        rule.tapArt("new_recipe"); rule.tapArt("continue"); rule.assertPage("Review and save")
        rule.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("ing-rows:row:0"))).performTextInput("1 egg")
        rule.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("ing-rows:row:0"))).performImeAction(); rule.waitForIdle()
        rule.onNodeWithTag("ing-rows:row:1").assertExists()
    }

    @Test fun reviewSavesCorrectionsAndCategories() {
        start(false); c.importSession.draft.value = ImportDraft(sampleRecipe("n1", "Draft"), ImportMethod.HTML, Confidence.LOW, listOf(ImportWarning("directions", "Check directions.")))
        rule.tapArt("new_recipe"); rule.tapArt("continue"); rule.assertPage("Review and save")
        rule.onNodeWithTag("warn:directions").assertExists()
        rule.tapArt("add_category"); rule.waitTag("custom-category-field")
        rule.onNodeWithTag("custom-category-field").performTextInput("Grandma Favorites"); rule.onNodeWithTag("custom-category-field").performImeAction()
        rule.waitUntil(20000) { rule.onNodeWithTag("custom-category-field").fetchSemanticsNode().config[SemanticsProperties.EditableText].text.isEmpty() }   // a fresh field is ready after Enter
        rule.waitText("Grandma Favorites")
        rule.onNodeWithTag("custom-category-field").performTextInput("grandma favorites"); rule.onNodeWithTag("custom-category-field").performImeAction()
        rule.waitText("already exists", substring = true)
        rule.onNodeWithText("Done").performClick(); rule.waitForIdle()
        rule.onNodeWithText("✓ Grandma Favorites").assertExists()   // newly created custom category defaults to checked
        rule.tapArt("save"); rule.assertPage("Draft")
        val r = recipes().single { it.title == "Draft" }
        val cats = cats()
        assertTrue(r.categoryIds.any { id -> cats.first { it.id == id }.name == "Grandma Favorites" })
    }

    @Test fun customCategoryLimitIsEnforcedInTheUi() {
        start(false)
        runBlocking { repeat(50) { assertTrue(c.repo.addCustomCategory("Cat $it") is com.mundymorning.touchrecipe.core.categories.CategoryResult.Ok) } }
        c.importSession.draft.value = ImportDraft(Recipe(title = "T"), ImportMethod.TEXT, Confidence.LOW, emptyList())
        rule.tapArt("new_recipe"); rule.tapArt("continue"); rule.tapArt("add_category"); rule.waitTag("custom-category-field")
        rule.onNodeWithText("Custom categories (50 of 50)").assertExists()
        rule.onNodeWithTag("custom-category-field").performTextInput("One more"); rule.onNodeWithTag("custom-category-field").performImeAction()
        rule.waitText("limit of 50", substring = true)
    }

    // ---------- detail ----------
    @Test fun servingScalingDoesNotCorruptTextAmounts() {
        start(); rule.tapArt("rolodex"); rule.waitTag("recipe-card:r1"); rule.clickTag("recipe-card:r1"); rule.assertPage("Spaghetti al Pomodoro")
        rule.tapArt("serv_inc"); rule.waitForIdle()
        assertEquals("5", rule.textOf("servings-value"))
        rule.onNodeWithText("1 1/4 lb spaghetti").assertExists(); rule.onNodeWithText("2 1/2 tbsp olive oil").assertExists()
        rule.onNodeWithText("3 3/4 cloves garlic, minced").assertExists()
        rule.onNodeWithTag("ingredient-list").performScrollToNode(hasText("salt to taste")); rule.onNodeWithText("salt to taste").assertExists()   // text amounts stay untouched
        rule.onNodeWithTag("ingredient-list").performScrollToIndex(0)
        rule.tapArt("serv_dec"); rule.waitUntil(20000) { rule.textOf("servings-value") == "4" }; rule.tapArt("serv_dec"); rule.waitUntil(20000) { rule.textOf("servings-value") == "3" }
        rule.waitText("3/4 lb spaghetti")   // 3 servings
    }

    @Test fun heartAndIngredientChecksPersist() {
        start(); rule.tapArt("rolodex"); rule.waitTag("recipe-card:r1"); rule.clickTag("recipe-card:r1"); rule.assertPage("Spaghetti al Pomodoro")
        rule.waitTag("heart-glyph:off"); rule.tapArt("favorite"); rule.waitTag("heart-glyph:on")
        rule.clickTag("ingredient:i1")
        rule.waitUntil(20000) { rule.onAllNodesWithTag("ingredient:i1").fetchSemanticsNodes().firstOrNull()?.config?.getOrNull(SemanticsProperties.ToggleableState) == androidx.compose.ui.state.ToggleableState.On }
        rule.waitUntil(20000) { runBlocking { c.repo.getRecipe("r1") }!!.let { it.favorite && it.ingredients[0].checked } }   // persisted
    }

    @Test fun addToGroceryListFromDetail() {
        start(); rule.tapArt("rolodex"); rule.waitTag("recipe-card:r1"); rule.clickTag("recipe-card:r1"); rule.assertPage("Spaghetti al Pomodoro")
        rule.tapArt("grocery"); rule.waitText("Add to Grocery List"); rule.onNodeWithText("Add", useUnmergedTree = true).performClick()
        rule.waitText("Added or updated", substring = true)
        val items = runBlocking { c.db.grocery().all() }
        assertTrue(items.any { it.name.startsWith("Spaghetti") }); assertTrue(items.size >= 4)
    }

    // ---------- cook mode ----------
    @Test fun cookModeTimerStepsAndPersistence() {
        start(); rule.tapArt("rolodex"); rule.waitTag("recipe-card:r1"); rule.clickTag("recipe-card:r1"); rule.assertPage("Spaghetti al Pomodoro")
        rule.tapArt("cook"); rule.waitTag("step-number"); assertEquals("1", rule.textOf("step-number")); assertEquals("09:00", rule.textOf("clock-face"))
        startTimer()
        clock.now += 60_000; rule.mainClock.advanceTimeBy(600); rule.waitUntil(20000) { rule.textOf("clock-face") == "08:00" }
        rule.tapArt("start"); rule.waitUntil(20000) { rule.textOf("timer-label") == "Resume timer" }
        clock.now += 120_000; rule.mainClock.advanceTimeBy(600); assertEquals("paused time does not elapse", "08:00", rule.textOf("clock-face"))
        rule.tapArt("next"); rule.waitUntil(20000) { rule.textOf("step-number") == "2" }
        rule.onNodeWithText("(timer from step 1)", substring = true).assertExists()   // a started timer is never silently reset
        rule.onNodeWithTag("step-done").assertDoesNotExist()
        rule.tapArt("prev"); rule.waitUntil(20000) { rule.textOf("step-number") == "1" }; rule.onNodeWithTag("step-done").assertExists()   // completed state generated by code
        rule.tapArt("next"); rule.tapArt("next"); rule.waitUntil(20000) { rule.textOf("step-number") == "3" }
        // leave and come back: state kept
        rule.tapArt("back"); rule.assertPage("Spaghetti al Pomodoro"); rule.tapArt("cook"); rule.waitUntil(20000) { rule.onAllNodesWithTag("step-number").fetchSemanticsNodes().isNotEmpty() && rule.textOf("step-number") == "3" }
        val s = runBlocking { c.repo.cookSession("r1") }!!
        assertEquals(2, s.stepIndex); assertEquals(setOf(0, 1), s.completed)
    }

    @Test fun cookModeWithoutTimerAndFinish() {
        start(false); runBlocking { c.repo.saveRecipe(Recipe(id = "n", title = "No Timer", directions = listOf(Direction("a", "Stir."), Direction("b", "Serve.")))) }
        rule.tapArt("stove"); rule.waitText("No Timer"); rule.onNodeWithText("No Timer").performClick(); rule.waitTag("step-number")
        assertEquals("--:--", rule.textOf("clock-face")); assertEquals("Set timer", rule.textOf("timer-label"))
        rule.tapArt("next"); rule.waitUntil(20000) { rule.textOf("step-number") == "2" }
        rule.tapArt("next"); rule.waitText("All steps done"); rule.onNodeWithText("Finish").performClick(); rule.assertPage("Kitchen Hub")
        assertTrue(runBlocking { c.repo.cookSession("n") }!!.finished)
    }

    @Test fun timerFinishShowsTimesUp() {
        start(); runBlocking { c.repo.saveRecipe(Recipe(id = "q", title = "Quick", directions = listOf(Direction("a", "Wait 10 seconds.", timerSeconds = 10)))) }
        rule.tapArt("stove"); rule.waitText("Quick"); rule.onNodeWithText("Quick").performClick(); rule.waitTag("step-number")
        startTimer()
        clock.now += 11_000; rule.mainClock.advanceTimeBy(800); rule.waitText("Time's up!")
    }

    // ---------- planner & grocery ----------
    @Test fun plannerAssignReplaceRemoveWeekDatesAndGrocery() {
        start(); runBlocking { c.repo.saveRecipe(sampleRecipe("r2", "Lentil Stew").copy(ingredients = listOf(Ingredient("x", "2 cloves garlic"), Ingredient("y", "1 cup lentils")))) }
        rule.tapArt("calendar"); rule.assertPage("Meal Planner")
        val firstDate = rule.textOf("day-date:0")
        rule.tapArt("day0"); rule.waitTag("pick:r1"); rule.onNodeWithTag("pick:r1").performClick(); rule.waitUntil(20000) { rule.textOf("day-title:0") == "Spaghetti al Pomodoro" }
        rule.tapArt("day1"); rule.waitTag("pick:r1"); rule.onNodeWithTag("pick:r1").performClick(); rule.waitUntil(20000) { rule.textOf("day-title:1") == "Spaghetti al Pomodoro" }
        rule.tapArt("act0"); rule.waitText("Replace recipe"); rule.onNodeWithText("Replace recipe").performClick(); rule.waitTag("pick:r2"); rule.onNodeWithTag("pick:r2").performClick()
        rule.waitUntil(20000) { rule.textOf("day-title:0") == "Lentil Stew" }
        rule.tapArt("act1"); rule.waitText("Remove from this day"); rule.onNodeWithText("Remove from this day").performClick(); rule.waitUntil(20000) { rule.textOf("day-title:1") == "Nothing planned" }
        rule.waitText("Undo"); rule.onNodeWithText("Undo").performClick(); rule.waitUntil(20000) { rule.textOf("day-title:1") == "Spaghetti al Pomodoro" }
        // week selector updates every date
        rule.tapArt("week"); rule.waitTag("week-next"); rule.onNodeWithTag("week-next").performClick(); rule.waitForIdle(); rule.onNodeWithText("Done").performClick(); rule.waitForIdle()
        assertNotEquals(firstDate, rule.textOf("day-date:0")); rule.waitUntil(20000) { rule.textOf("day-title:0") == "Nothing planned" }
        rule.tapArt("calendar"); rule.waitTag("week-prev"); rule.onNodeWithTag("week-prev").performClick(); rule.onNodeWithText("Done").performClick(); rule.waitUntil(20000) { rule.textOf("day-title:0") == "Lentil Stew" }
        // groceries combine the planned meals
        rule.tapArt("grocery"); rule.assertPage("Grocery List"); rule.waitUntil(8000) { runBlocking { c.db.grocery().all() }.isNotEmpty() }
        val names = runBlocking { c.db.grocery().all() }.map { it.name }
        assertEquals(1, names.count { it.startsWith("Spaghetti") }); assertTrue(names.any { it.startsWith("Lentils") }); assertEquals(1, names.count { it.startsWith("Garlic") })
        val garlic = runBlocking { c.db.grocery().all() }.single { it.name.startsWith("Garlic") }
        assertEquals("both recipes are referenced", 2, garlic.sourcesJson.split("recipeId").size - 1)
    }

    @Test fun groceryPurchasedStateClearAndDedupe() {
        start(); runBlocking { c.repo.addGroceryItem(c.selectedWeek.value, "Milk", "1 l", "dairy"); c.repo.addGroceryItem(c.selectedWeek.value, "Bread", "", "bakery") }
        rule.tapArt("grocery"); rule.assertPage("Grocery List")
        val milk = runBlocking { c.db.grocery().all() }.first { it.name == "Milk" }
        rule.waitTag("grocery-check:${milk.id}"); rule.onNodeWithTag("grocery-check:${milk.id}", useUnmergedTree = true).performClick()
        rule.waitUntil(20000) { runBlocking { c.db.grocery().all() }.first { it.name == "Milk" }.checked }
        rule.tapArt("add"); rule.waitTag("add-name"); rule.onNodeWithTag("add-name").performTextInput("milk"); rule.onNodeWithTag("add-confirm").performClick()
        rule.waitText("already on the list", substring = true); rule.onNodeWithText("Done").performClick(); rule.waitForIdle()
        assertEquals(1, runBlocking { c.db.grocery().all() }.count { it.name.equals("milk", true) })
        rule.tapArt("clear"); rule.waitText("Clear checked items?"); rule.onNodeWithText("Clear").performClick()
        rule.waitUntil(20000) { runBlocking { c.db.grocery().all() }.none { it.name == "Milk" } }
        assertTrue(runBlocking { c.db.grocery().all() }.any { it.name == "Bread" })
        rule.waitText("Undo"); rule.onNodeWithText("Undo").performClick(); rule.waitUntil(20000) { runBlocking { c.db.grocery().all() }.any { it.name == "Milk" && it.checked } }
    }

    @Test fun groceryCollapseHidesRows() {
        start(); runBlocking { c.repo.addGroceryItem(c.selectedWeek.value, "Apples", "3", "produce") }
        rule.tapArt("grocery"); rule.assertPage("Grocery List"); rule.waitTag("aisle:produce")
        rule.tapArt("head_produce"); rule.waitText("Tap the header to expand.", substring = true)
        rule.tapArt("head_produce"); rule.waitTag("aisle:produce")
    }

    @Test fun settingsThemesAndCategoryManagement() {
        start(); rule.tapArt("drawer"); rule.tapArt("themes"); rule.assertPage("Themes")
        rule.onNodeWithTag("theme:DARK").performClick(); rule.waitForIdle(); assertEquals(ThemeMode.DARK, c.prefs.theme.value)
        rule.systemBack(); rule.tapArt("categories"); rule.assertPage("Category Management"); rule.waitText("Custom categories (0 of 50)")
        rule.onNodeWithTag("custom-category-field").performTextInput("Potluck Hits"); rule.onNodeWithTag("custom-category-field").performImeAction()
        rule.waitText("Custom categories (1 of 50)")
    }

    @Test fun converterAndToolsRender() {
        start(); rule.tapArt("drawer"); rule.tapArt("tools"); rule.assertPage("Timer & Tools")
        rule.onNodeWithText("Convert").performClick(); rule.waitTag("convert-result"); assertTrue(rule.textOf("convert-result").contains("236") || rule.textOf("convert-result").contains("237"))
        rule.onNodeWithText("Timer").performClick(); rule.waitTag("tool-timer")
    }
}
