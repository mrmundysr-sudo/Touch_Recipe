package com.mundymorning.touchrecipe.ui

import androidx.compose.ui.test.*
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mundymorning.touchrecipe.AppContainer
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h800dp-xxhdpi")
class ScreensSmokeTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun everyPageRendersAndShoots() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val c = testContainer(ctx)
        val photo = c.photos.saveBytes(jpegBytes())
        runBlocking {
            c.repo.saveRecipe(sampleRecipe("r1", photo = photo, categories = listOf("b_dinner")))
            c.repo.saveRecipe(sampleRecipe("r2", "A very long recipe title that keeps going and going so the card layout has to cope with it gracefully", null, listOf("b_desserts")).copy(favorite = true))
        }
        rule.setContent { TouchRecipeRoot(c) }
        rule.assertPage("Kitchen Hub"); rule.shot("01_hub")
        rule.tapArt("rolodex"); rule.assertPage("Recipe Collection"); rule.waitUntil(5000) { rule.onAllNodesWithTag("recipe-card:r1").fetchSemanticsNodes().isNotEmpty() }; rule.shot("02_collection")
        rule.clickTag("recipe-card:r1"); rule.assertPage("Spaghetti al Pomodoro"); rule.shot("03_detail")
        rule.tapArt("cook"); rule.assertPage("Cook Mode: Spaghetti al Pomodoro"); rule.waitUntil(5000) { rule.onAllNodesWithTag("step-number").fetchSemanticsNodes().isNotEmpty() }; rule.shot("04_cook")
        rule.tapArt("back"); rule.assertPage("Spaghetti al Pomodoro"); rule.tapArt("back"); rule.assertPage("Recipe Collection"); rule.tapArt("new_recipe"); rule.assertPage("Import Recipe"); rule.shot("05_import")
        c.importSession.draft.value = com.mundymorning.touchrecipe.core.model.ImportDraft(sampleRecipe("n1", "Imported Soup").copy(servings = null), com.mundymorning.touchrecipe.core.model.ImportMethod.HTML, com.mundymorning.touchrecipe.core.model.Confidence.LOW,
            listOf(com.mundymorning.touchrecipe.core.model.ImportWarning("servings", "Servings were not given.", com.mundymorning.touchrecipe.core.model.Severity.INFO), com.mundymorning.touchrecipe.core.model.ImportWarning("directions", "Some directions look incomplete.")))
        rule.tapArt("continue"); rule.assertPage("Review and save"); rule.shot("06_review")
        rule.tapArt("back"); rule.waitUntil(5000) { rule.onAllNodesWithText("Discard").fetchSemanticsNodes().isNotEmpty() }; rule.onNodeWithText("Discard").performClick(); rule.assertPage("Import Recipe")
        rule.tapArt("back"); rule.assertPage("Recipe Collection"); rule.backChip(); rule.assertPage("Kitchen Hub")
        rule.tapArt("calendar"); rule.assertPage("Meal Planner"); rule.shot("07_planner")
        rule.tapArt("grocery"); rule.assertPage("Grocery List"); rule.shot("08_grocery")
        rule.tapArt("back"); rule.assertPage("Meal Planner"); rule.backChip(); rule.assertPage("Kitchen Hub")
        rule.tapArt("drawer"); rule.assertPage("Kitchen Junk Drawer"); rule.shot("09_drawer")
    }
}
