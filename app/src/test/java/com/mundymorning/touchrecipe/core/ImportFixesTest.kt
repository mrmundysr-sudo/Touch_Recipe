package com.mundymorning.touchrecipe.core

import com.mundymorning.touchrecipe.core.importer.TextRecipeParser
import com.mundymorning.touchrecipe.core.importer.WebRecipeExtractor
import com.mundymorning.touchrecipe.core.model.Confidence
import com.mundymorning.touchrecipe.core.model.ImportMethod
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test

/**
 * Regression tests for the import problems found with Paula Deen's "Southern Fried Chicken" (real page data and real PDF text in test resources):
 * a JSON-LD block ending in "};" was discarded; pages without a data block lost times/servings; browser PDF footers became directions;
 * wrapped lines starting with a bracket became separate steps; the byline / difficulty polluted the description; damaged PDF text layers.
 */
class ImportFixesTest {
    private fun fx(n: String) = javaClass.classLoader!!.getResourceAsStream("fixtures/$n")!!.readBytes().toString(Charsets.UTF_8)
    private val pageUrl = "https://www.pauladeen.com/recipe/southern-fried-chicken-recipe/"

    @Test fun realPageWithTrailingSemicolonIsReadCompletely() {
        val d = WebRecipeExtractor.extract(fx("paula-deen-page-jsonld-with-semicolon.html"), pageUrl); val r = d.recipe
        assertEquals(ImportMethod.JSON_LD, d.method); assertEquals(Confidence.HIGH, d.confidence)
        assertEquals("Southern Fried Chicken", r.title); assertEquals(10, r.servings)
        assertEquals(10, r.prepMinutes); assertEquals(10, r.cookMinutes); assertEquals(20, r.totalMinutes)
        assertEquals("Paula Deen", r.sourceName); assertEquals(5, r.ingredients.size); assertEquals(2, r.directions.size)
        assertEquals("Paula Deen's House Seasoning", r.ingredients[0].text); assertEquals("3 eggs", r.ingredients[4].text)
        assertTrue(r.directions[1].text.contains("(about 1 cup)"))
        assertTrue(d.imageCandidates.any { it.endsWith("southern_fried_chicken_1.jpg") })
        assertTrue("blank JSON-LD description falls back to the page description", r.description.contains("classic Southern Fried Chicken"))
    }

    @Test fun jsonLdReaderToleratesSemicolonsAssignmentsBomCommasAndSeveralObjects() {
        val one = """{"@type":"Recipe","name":"X","recipeIngredient":["1 egg"],"recipeInstructions":"Cook."}"""
        listOf("$one;", "var data = $one;", "\uFEFF$one", "//<![CDATA[\n$one\n//]]>", one.replace("\"Cook.\"}", "\"Cook.\",}"), "{\"@type\":\"WebPage\"}\n$one;").forEach { raw ->
            assertTrue(raw.take(30), WebRecipeExtractor.parseLenientAll(raw).any { (it as? JsonObject)?.get("@type")?.jsonPrimitive?.content == "Recipe" })
        }
        val d = WebRecipeExtractor.extract("""<script type="application/ld+json">{"@type":"WebPage"}$one;</script>""", null)
        assertEquals("X", d.recipe.title); assertEquals(ImportMethod.JSON_LD, d.method)
        assertTrue(WebRecipeExtractor.parseLenientAll("not json at all").isEmpty())
    }

    @Test fun pageWithoutDataBlockGetsServingsAndTimesFromVisibleLabels() {
        val html = """<html><head><title>Soup</title></head><body><h1>Soup</h1><div class="meta"><span>Servings: 6</span><span>Prep time: 15 minutes</span><span>Cook time: 1 hour</span></div>
            <h2>Ingredients</h2><ul><li>1 onion</li><li>2 cups stock</li></ul><h2>Instructions</h2><ol><li>Chop onion.</li><li>Simmer 20 minutes.</li></ol></body></html>"""
        val d = WebRecipeExtractor.extract(html, "https://blog.example/soup"); val r = d.recipe
        assertEquals(ImportMethod.HTML, d.method); assertEquals(6, r.servings); assertEquals(15, r.prepMinutes); assertEquals(60, r.cookMinutes); assertEquals(2, r.ingredients.size)
    }

    private fun checkPdfText(name: String) {
        val d = TextRecipeParser.parse(fx(name), ImportMethod.OCR); val r = d.recipe
        assertEquals(r.directions.joinToString(" | ") { it.text }, 2, r.directions.size)
        assertEquals("Heat the oil to 350 °F in a deep pot. Do not fill the pot more than 1/2 full with oil.", r.directions[0].text)
        assertTrue(r.directions[1].text.startsWith("In a medium size bowl"))
        assertTrue("wrapped line starting with ( joins the previous line", r.directions[1].text.contains("bright orange (about 1 cup). Season"))
        assertTrue("page-break sentence rejoined", r.directions[1].text.contains("Approximate cooking time is 13 to 14 minutes"))
        listOf("http", "Page 1", "Page 2", "Learn more", "3 04 AM").forEach { junk -> assertTrue(junk, r.directions.none { it.text.contains(junk) }) }
        assertTrue(r.directions.none { it.text.trim() == ":" })
        assertEquals(5, r.ingredients.size); assertEquals(10, r.servings); assertEquals(10, r.prepMinutes); assertEquals(10, r.cookMinutes)
        assertEquals("the printed address becomes the source link (fragment removed)", pageUrl, r.sourceUrl); assertEquals("pauladeen.com", r.sourceName)
        assertTrue(r.description, !r.description.contains("By Paula Deen") && !Regex("Di.{0,3}cult").containsMatchIn(r.description))
        assertTrue(r.description.startsWith("Paula\u2019s southern fried chicken recipe"))
        assertEquals("By Paula Deen\nDifficulty: Medium", r.notes)
        assertEquals(780, r.directions[1].timerSeconds)
    }
    @Test fun pdfReadingOrderTextIsCleaned() = checkPdfText("paula-deen-pdf-reading-order.txt")
    @Test fun pdfLayoutTextIsCleaned() = checkPdfText("paula-deen-pdf-layout.txt")

    @Test fun cleanPageTextRemovesFurnitureAndReportsTheAddress() {
        val c = TextRecipeParser.cleanPageText("Pancakes\n\nhttps://x.com/p/#ingredients\n11/6/26, 3 04 AM\nPage 1 of 2\n:\nLearn more\n2 eggs\nMix well https://x.com/p/#a 1/2/2026, 10:30 PM")
        assertEquals("https://x.com/p/", c.sourceUrl); assertEquals("Pancakes\n\n2 eggs\nMix well", c.text)
    }

    @Test fun wrappedLineContinuationRules() {
        val merged = TextRecipeParser.parse("Stew\nIngredients\n2 carrots\nDirections\nPeel the carrots and chop them\n(about 2 cups)\nand add to the pot.\nSimmer for 20 minutes.").recipe.directions.map { it.text }
        assertEquals(listOf("Peel the carrots and chop them (about 2 cups) and add to the pot.", "Simmer for 20 minutes."), merged)
        val numbered = TextRecipeParser.parse("Stew\nIngredients\n2 carrots\nDirections\n1. Preheat oven\n2. Mix dry ingredients\n3. Bake").recipe.directions.map { it.text }
        assertEquals("numbered steps stay separate even without punctuation", listOf("Preheat oven", "Mix dry ingredients", "Bake"), numbered)
        assertEquals(3, TextRecipeParser.parse("Stew\nIngredients\n2 carrots\nDirections\nPreheat oven to 350\nMix dry ingredients\nBake 20 min").recipe.directions.size)
    }

    @Test fun garbledTextLayersAreDetectedButOrdinaryTextIsNot() {
        assertTrue(TextRecipeParser.looksGarbled("Southern \"ied Chicken\nBy Paula Deen")); assertTrue(TextRecipeParser.looksGarbled("Di!iculty: Medium")); assertTrue(TextRecipeParser.looksGarbled("bad \uFFFD char"))
        assertFalse(TextRecipeParser.looksGarbled("Southern Fried Chicken\nDifficulty: Medium\nAdd \"extra\" hot sauce! Then serve.\n2 cups flour"))
    }
}
