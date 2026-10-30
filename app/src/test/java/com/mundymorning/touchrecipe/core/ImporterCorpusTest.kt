package com.mundymorning.touchrecipe.core

import com.mundymorning.touchrecipe.core.grocery.GroceryEngine
import com.mundymorning.touchrecipe.core.importer.*
import com.mundymorning.touchrecipe.core.model.*
import org.junit.Assert.*
import org.junit.Assume
import org.junit.Test

/** Representative page shapes seen across recipe sites (hand-written fixtures, not copies of any site). */
class ImporterCorpusTest {
    @Test fun wordpressPluginHtmlWithoutStructuredData() {
        val html = """<html><head><title>Banana Bread - Some Blog</title><meta property="og:image" content="https://cdn.x.com/b.jpg"></head><body><h1>Banana Bread</h1>
          <ul class="wprm-recipe-ingredients"><li class="wprm-recipe-ingredient">3 ripe bananas</li><li class="wprm-recipe-ingredient">1/3 cup melted butter</li><li class="wprm-recipe-ingredient">3/4 cup sugar</li></ul>
          <ul class="wprm-recipe-instructions"><li><div class="wprm-recipe-instruction-text">Mash the bananas.</div></li><li><div class="wprm-recipe-instruction-text">Bake for 60 minutes.</div></li></ul></body></html>"""
        val d = WebRecipeExtractor.extract(html, "https://blog.example.com/banana-bread")
        assertEquals("Banana Bread", d.recipe.title); assertEquals(3, d.recipe.ingredients.size); assertEquals(2, d.recipe.directions.size)
        assertEquals(3600, d.recipe.directions[1].timerSeconds); assertEquals(Confidence.LOW, d.confidence)
        assertEquals(listOf("https://cdn.x.com/b.jpg"), d.imageCandidates)
    }

    @Test fun yoastGraphWithWebPageAndRecipeAndNumericYield() {
        val html = """<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Org"},{"@type":"WebPage","name":"Page"},
          {"@type":"Recipe","name":"Gazpacho","recipeYield":6,"image":[{"@type":"ImageObject","url":"https://i.x/g1.jpg"},"https://i.x/g2.jpg"],"recipeCuisine":["Spanish"],
           "recipeIngredient":["1 kg tomatoes","1 cucumber","50 ml olive oil"],"recipeInstructions":"<p>Blend everything.</p><p>Chill 2 hours.</p>"}]}</script>"""
        val d = WebRecipeExtractor.extract(html, "https://x.es/gazpacho")
        assertEquals(6, d.recipe.servings); assertEquals("Spanish", d.recipe.cuisine); assertEquals(2, d.imageCandidates.size)
        assertEquals(listOf("Blend everything.", "Chill 2 hours."), d.recipe.directions.map { it.text }); assertEquals(7200, d.recipe.directions[1].timerSeconds)
    }

    @Test fun recipeSectionsAndEntitiesAndNotes() {
        val html = """<script type="application/ld+json">{"@type":"Recipe","name":"Pie &amp; Mash","description":"Rich &frac12; cup gravy","recipeNotes":"Swap butter for oil.",
          "recipeIngredient":["500 g potatoes","2 tbsp butter"],"recipeInstructions":[{"@type":"HowToSection","name":"Mash","itemListElement":[{"@type":"HowToStep","text":"Boil potatoes."}]},
          {"@type":"HowToSection","name":"Pie","itemListElement":[{"@type":"HowToStep","text":"Bake the pie 35 min."}]}]}</script>"""
        val d = WebRecipeExtractor.extract(html, null)
        assertEquals("Pie & Mash", d.recipe.title); assertTrue(d.recipe.description.contains("½")); assertEquals("Swap butter for oil.", d.recipe.notes)
        assertEquals(listOf(true, false, true, false), d.recipe.directions.map { it.header }); assertEquals(2100, d.recipe.directions[3].timerSeconds)
    }

    @Test fun multipleRecipesPicksMostCompleteAndSaysSo() {
        val html = """<script type="application/ld+json">[{"@type":"Recipe","name":"Small","recipeIngredient":["1 egg"],"recipeInstructions":"Cook."},
          {"@type":"Recipe","name":"Big","recipeIngredient":["1 egg","2 cups flour","1 cup milk"],"recipeInstructions":"Mix. Bake."}]</script>"""
        val d = WebRecipeExtractor.extract(html, "https://x.com/roundup")
        assertEquals("Big", d.recipe.title); assertTrue(d.warnings.any { it.message.contains("2 recipes") })
    }

    @Test fun jsonLdMissingDirectionsIsFilledFromHtmlAndFlagged() {
        val html = """<html><script type="application/ld+json">{"@type":"Recipe","name":"Half","recipeIngredient":["1 apple","1 pear"]}</script><body>
          <h2>Instructions</h2><ol><li>Slice the fruit.</li><li>Serve cold.</li></ol></body></html>"""
        val d = WebRecipeExtractor.extract(html, null)
        assertEquals(2, d.recipe.directions.size); assertNotEquals(Confidence.HIGH, d.confidence); assertTrue(d.warnings.any { it.message.contains("guessed") })
    }

    @Test fun internationalUnitsAndMalformedQuantitiesNeverCrash() {
        listOf("250 ml Milch", "1 ½ Tassen Mehl", "2–3 EL Öl", "1/0 cup broken", "½-¾ tsp salt", "", "   ", "a handful of kale", "3 (400 g) tins tomatoes", "1,5 dl cream", "1 1/2 cups", "99999999999 cups").forEach { line ->
            val p = GroceryEngine.parse(line); assertNotNull(p)
            val scaled = com.mundymorning.touchrecipe.core.quantity.Quantities.scale(line, 2.0); assertNotNull(scaled)
        }
        assertEquals("500 ml Milch", com.mundymorning.touchrecipe.core.quantity.Quantities.scale("250 ml Milch", 2.0))
        assertEquals("a handful of kale", com.mundymorning.touchrecipe.core.quantity.Quantities.scale("a handful of kale", 2.0))
        assertEquals("1/0 cup broken", com.mundymorning.touchrecipe.core.quantity.Quantities.scale("1/0 cup broken", 2.0))
    }

    @Test fun duplicateIngredientsAcrossSectionsAreMergedInGroceries() {
        val r = Recipe(ingredients = listOf(Ingredient(text = "1 cup sugar"), Ingredient(text = "For the glaze", header = true), Ingredient(text = "1/2 cup sugar"), Ingredient(text = "Sugar, to taste")))
        val items = GroceryEngine.generate(listOf(com.mundymorning.touchrecipe.core.grocery.PlannedMeal(r, null)))
        assertTrue("measured sugar is merged across sections: ${items.map { it.name + "=" + it.quantityText }}", items.any { it.quantityText == "1 1/2 cups" })
        assertEquals("the unmeasured 'to taste' line stays separate rather than corrupting the total", 2, items.size)
    }

    /** Opt-in: `gradlew testDebugUnitTest -Dtr.live.urls=https://site/a,https://site/b` on a machine with internet access. */
    @Test fun optionalLiveSitesAreNeverRunByDefault() {
        val urls = System.getProperty("tr.live.urls").orEmpty().split(",").filter { it.startsWith("http") }
        Assume.assumeTrue("live import checks are opt-in", urls.isNotEmpty())
        urls.forEach { u ->
            val html = java.net.URL(u).openStream().use { it.readBytes().toString(Charsets.UTF_8) }
            val d = WebRecipeExtractor.extract(html, u)
            println("LIVE $u -> ${d.method} ${d.confidence} title='${d.recipe.title}' ing=${d.recipe.ingredients.size} dir=${d.recipe.directions.size}")
        }
    }
}
