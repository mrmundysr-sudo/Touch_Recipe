package com.mundymorning.touchrecipe

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * On-device smoke test of the real app (real Room database, real art decoding, real touch input).
 * Run by CI on an emulator: `./gradlew :app:connectedDebugAndroidTest`.
 */
@RunWith(AndroidJUnit4::class)
class SmokeInstrumentedTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private fun page(title: String) = rule.waitUntil(20_000) { rule.onAllNodes(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, title)).fetchSemanticsNodes().isNotEmpty() }
    private fun tap(id: String) { rule.waitUntil(10_000) { rule.onAllNodesWithTag("art:$id", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }; rule.onNodeWithTag("art:$id", useUnmergedTree = true).performClick() }

    @Test fun splashLeadsToHubAndEveryHubObjectOpensItsPage() {
        // first launch shows a welcome dialog once; dismiss it if present
        rule.waitUntil(20_000) { rule.onAllNodesWithText("Let's cook").fetchSemanticsNodes().isNotEmpty() || rule.onAllNodes(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, "Kitchen Hub")).fetchSemanticsNodes().isNotEmpty() }
        if (rule.onAllNodesWithText("Let's cook").fetchSemanticsNodes().isNotEmpty()) rule.onNodeWithText("Let's cook").performClick()
        page("Kitchen Hub")
        for ((id, title) in listOf("calendar" to "Meal Planner", "new_recipe" to "Import Recipe", "search" to "Recipe Collection", "grocery" to "Grocery List", "drawer" to "Kitchen Junk Drawer", "rolodex" to "Recipe Collection")) {
            tap(id); page(title); rule.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }; page("Kitchen Hub")
        }
    }
}
