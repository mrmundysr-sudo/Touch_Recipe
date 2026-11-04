package com.mundymorning.touchrecipe.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.model.*
import com.mundymorning.touchrecipe.data.*
import kotlinx.coroutines.runBlocking
import java.io.ByteArrayOutputStream
import java.io.File

class FakeFetcher : PageFetcher {
    val pages = HashMap<String, FetchOutcome>()
    var calls = 0
    override suspend fun fetchPage(url: String): FetchOutcome { calls++; return pages[url] ?: FetchOutcome.Failure("No internet connection, or the address could not be found.", offline = true) }
    val bytes = HashMap<String, ByteArray>()
    override suspend fun fetchBytes(url: String, maxBytes: Int): ByteArray? = bytes[url]
}

class FakeOcr(var text: String = "") : OcrEngine { override suspend fun recognize(bitmap: Bitmap): String = text }

class TestClock(var now: Long = 1_700_000_000_000L) : () -> Long { override fun invoke() = now }

fun testContainer(context: Context, fetcher: FakeFetcher = FakeFetcher(), ocr: FakeOcr = FakeOcr(), clock: TestClock = TestClock(), db: AppDatabase = AppDatabase.inMemory(context)): AppContainer {
    context.getSharedPreferences("touch_recipe_prefs", Context.MODE_PRIVATE).edit().clear().commit()
    val c = AppContainer(context, db = db, fetcher = fetcher, ocr = ocr, prefs = Prefs(context), clock = clock)
    c.prefs.welcomeSeen = true
    runBlocking { c.repo.ensureSeeded() }
    return c
}

fun jpegBytes(color: Int = Color.rgb(200, 120, 60)): ByteArray {
    val bmp = Bitmap.createBitmap(120, 90, Bitmap.Config.ARGB_8888); bmp.eraseColor(color)
    return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 90, it) }.toByteArray()
}

fun sampleRecipe(id: String = "r1", title: String = "Spaghetti al Pomodoro", photo: String? = null, categories: List<String> = emptyList()) = Recipe(
    id = id, title = title, description = "A weeknight classic with sweet tomatoes and basil.", photo = photo, sourceName = "example.com", sourceUrl = "https://example.com/pasta",
    prepMinutes = 10, cookMinutes = 20, totalMinutes = 30, servings = 4, categoryIds = categories, cuisine = "Italian",
    ingredients = listOf(Ingredient("i1", "1 lb spaghetti"), Ingredient("i2", "2 tbsp olive oil"), Ingredient("i3", "3 cloves garlic, minced"), Ingredient("i4", "1 can (14 oz) crushed tomatoes"), Ingredient("i5", "salt to taste")),
    directions = listOf(
        Direction("d1", "Bring a large pot of salted water to a boil and cook the spaghetti for 9 minutes.", timerSeconds = 540),
        Direction("d2", "Warm the oil with the garlic, add tomatoes and simmer for 15 minutes.", timerSeconds = 900),
        Direction("d3", "Toss the pasta with the sauce and serve."),
    ),
)

fun ComposeContentTestRule.assertPage(title: String) {
    try {
        waitUntil(25000) { org.robolectric.shadows.ShadowLooper.idleMainLooper(); onAllNodes(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, title)).fetchSemanticsNodes().isNotEmpty() }
    } catch (e: Throwable) {
        println("ASSERT PAGE '$title' FAILED. Panes: " + onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.PaneTitle), useUnmergedTree = true).fetchSemanticsNodes().map { it.config[SemanticsProperties.PaneTitle] })
        println(onRoot(useUnmergedTree = true).printToString(maxDepth = 12).take(6000))
        throw e
    }
}

fun ComposeContentTestRule.tapArt(id: String) { waitTag("art:$id"); onNodeWithTag("art:$id", useUnmergedTree = true).performClick(); waitForIdle() }

/** Saves a PNG of the current screen under build/screens so layouts can be reviewed. */
fun AndroidComposeTestRule<*, ComponentActivity>.shot(name: String) {
    val dir = File("build/screens").apply { mkdirs() }
    mainClock.advanceTimeBy(2500)
    org.robolectric.shadows.ShadowLooper.idleMainLooper()
    val view = activity.window.decorView
    val bmp = Bitmap.createBitmap(view.width.coerceAtLeast(1), view.height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    view.draw(android.graphics.Canvas(bmp))
    File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
}

fun fileUri(context: Context, name: String, bytes: ByteArray): Uri {
    val f = File(context.cacheDir, name).apply { writeBytes(bytes) }
    return Uri.fromFile(f)
}

fun ComposeContentTestRule.backChip() { onNodeWithTag("back-chip").performClick(); waitForIdle() }

fun AndroidComposeTestRule<*, ComponentActivity>.systemBack() {
    runOnUiThread { activity.onBackPressedDispatcher.onBackPressed() }
    waitForIdle()
}
fun ComposeContentTestRule.waitTag(tag: String, ms: Long = 25000) = waitUntil(ms) { org.robolectric.shadows.ShadowLooper.idleMainLooper(); onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
fun ComposeContentTestRule.waitText(text: String, ms: Long = 25000, substring: Boolean = false) {
    try { waitUntil(ms) { org.robolectric.shadows.ShadowLooper.idleMainLooper(); onAllNodesWithText(text, substring = substring, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() } }
    catch (e: Throwable) { println("WAIT TEXT '$text' FAILED. Trees:\n" + onAllNodes(isRoot(), useUnmergedTree = true).fetchSemanticsNodes().size + " roots"); onAllNodes(isRoot(), useUnmergedTree = true).let { r -> (0 until r.fetchSemanticsNodes().size).forEach { i -> println("ROOT $i: " + r[i].printToString(maxDepth = 12).take(2500)) } }; throw e }
}
fun ComposeContentTestRule.textOf(tag: String): String = onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString("") { it.text }.orEmpty()
fun ComposeContentTestRule.highlighted(id: String): Boolean = onAllNodesWithTag("art:$id", useUnmergedTree = true).fetchSemanticsNodes().firstOrNull()?.config?.getOrNull(SemanticsProperties.StateDescription) == "Highlighted"

const val LD_PAGE = """<html><head><title>Pasta | Site</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Recipe","name":"Imported Carbonara",
"image":"https://example.com/a.jpg","author":{"@type":"Person","name":"Jo Cook"},"prepTime":"PT10M","cookTime":"PT15M","recipeYield":"2 servings","recipeCategory":"Dinner",
"recipeIngredient":["200 g spaghetti","2 eggs","50 g pecorino"],"recipeInstructions":[{"@type":"HowToStep","text":"Boil the pasta for 9 minutes."},{"@type":"HowToStep","text":"Mix eggs and cheese, toss with pasta."}]}</script></head><body></body></html>"""

/** Clicks a node that must be present in the *merged* semantics tree (waits out page-transition overlap). */
fun ComposeContentTestRule.clickTag(tag: String, ms: Long = 25000) {
    waitUntil(ms) { org.robolectric.shadows.ShadowLooper.idleMainLooper(); onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    onNodeWithTag(tag).performClick(); waitForIdle()
}
