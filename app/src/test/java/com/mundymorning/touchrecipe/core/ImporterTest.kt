package com.mundymorning.touchrecipe.core

import com.mundymorning.touchrecipe.core.importer.*
import com.mundymorning.touchrecipe.core.model.*
import org.junit.Assert.*
import org.junit.Test

class ImporterTest {
    private val ldPage = """
        <html><head><title>Best Pasta | Site</title>
        <meta property="og:image" content="/img/og.jpg">
        <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Site"},
         {"@type":["Recipe"],"name":"Best Pasta","description":"A <b>simple</b> dinner &amp; more.",
          "image":["https://x.com/a.jpg",{"@type":"ImageObject","url":"https://x.com/b.jpg"}],
          "author":{"@type":"Person","name":"Jo Cook"},
          "prepTime":"PT15M","cookTime":"PT1H5M","totalTime":"PT1H20M","recipeYield":["4","4 servings"],
          "recipeCategory":["Dinner"],"recipeCuisine":"Italian",
          "recipeIngredient":["1 lb spaghetti","2 tbsp olive oil","2 tbsp olive oil","salt to taste"],
          "recipeInstructions":[{"@type":"HowToSection","name":"Sauce","itemListElement":[{"@type":"HowToStep","text":"Simmer for 10-15 minutes."}]},
                                {"@type":"HowToStep","text":"Boil pasta 9 minutes."}]}]}
        </script></head><body></body></html>"""

    @Test fun jsonLdGraph() {
        val d = WebRecipeExtractor.extract(ldPage, "https://www.example.com/pasta")
        assertEquals(ImportMethod.JSON_LD, d.method)
        assertEquals(Confidence.HIGH, d.confidence)
        val r = d.recipe
        assertEquals("Best Pasta", r.title)
        assertEquals("A simple dinner & more.", r.description)
        assertEquals(15, r.prepMinutes); assertEquals(65, r.cookMinutes); assertEquals(80, r.totalMinutes)
        assertEquals(4, r.servings)
        assertEquals("Jo Cook", r.sourceName)
        assertEquals("Italian", r.cuisine)
        assertEquals(3, r.ingredients.size) // consecutive duplicate removed
        assertEquals(3, r.directions.size)
        assertTrue(r.directions[0].header)
        assertEquals(600, r.directions[1].timerSeconds)
        assertEquals(540, r.directions[2].timerSeconds)
        assertTrue(d.imageCandidates.containsAll(listOf("https://x.com/a.jpg", "https://x.com/b.jpg", "https://www.example.com/img/og.jpg")))
        assertEquals("https://www.example.com/pasta", r.sourceUrl)
        assertNotNull(r.rawSource)
    }

    @Test fun jsonLdMalformedTrailingCommaAndStringInstructions() {
        val html = """<script type="application/ld+json">{"@type":"Recipe","name":"X","recipeIngredient":["1 egg",],
          "recipeInstructions":"Crack egg.\nFry it for 2 minutes."}</script>"""
        val d = WebRecipeExtractor.extract(html, "https://a.org/x")
        assertEquals(1, d.recipe.ingredients.size)
        assertEquals(listOf("Crack egg.", "Fry it for 2 minutes."), d.recipe.directions.map { it.text })
    }

    @Test fun missingFieldsWarnButKeepContent() {
        val html = """<script type="application/ld+json">{"@type":"Recipe","name":"Tea","recipeIngredient":["1 bag tea"]}</script>"""
        val d = WebRecipeExtractor.extract(html, null)
        assertTrue(d.hasWarning("directions"))
        assertNotEquals(Confidence.HIGH, d.confidence)
        assertEquals("Tea", d.recipe.title)
    }

    @Test fun htmlHeuristicFallback() {
        val html = """<html><head><title>Soup - Blog</title></head><body><h1>Soup</h1>
          <h2>Ingredients</h2><ul><li>1 onion</li><li>2 cups stock</li></ul>
          <h2>Instructions</h2><ol><li>Chop onion.</li><li>Simmer 20 minutes.</li></ol></body></html>"""
        val d = WebRecipeExtractor.extract(html, "https://blog.com/soup")
        assertEquals(ImportMethod.HTML, d.method)
        assertEquals(2, d.recipe.ingredients.size)
        assertEquals(2, d.recipe.directions.size)
        assertEquals(Confidence.LOW, d.confidence) // never claims certainty for a guess
        assertTrue(d.warnings.any { it.message.contains("guessed") })
    }

    @Test fun microdata() {
        val html = """<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Toast</h1>
          <span itemprop="recipeIngredient">2 slices bread</span><span itemprop="recipeIngredient">1 tbsp butter</span>
          <div itemprop="recipeInstructions"><ol><li>Toast it.</li><li>Butter it.</li></ol></div>
          <meta itemprop="prepTime" content="PT5M"></div>"""
        val d = WebRecipeExtractor.extract(html, null)
        assertEquals(ImportMethod.MICRODATA, d.method)
        assertEquals("Toast", d.recipe.title); assertEquals(2, d.recipe.ingredients.size); assertEquals(2, d.recipe.directions.size)
        assertEquals(5, d.recipe.prepMinutes)
    }

    @Test fun blockedPageGivesErrorNotEmptySuccess() {
        val d = WebRecipeExtractor.extract("<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>", "https://x.com")
        assertTrue(d.warnings.any { it.severity == Severity.ERROR })
    }

    @Test fun durations() {
        assertEquals(90, Durations.toMinutes("PT1H30M"))
        assertEquals(20, Durations.toMinutes("P0DT0H20M"))
        assertEquals(75, Durations.toMinutes("1 hr 15 min"))
        assertEquals(45, Durations.toMinutes("45 minutes"))
        assertNull(Durations.toMinutes("soon"))
        assertNull(Durations.toMinutes(null))
        assertEquals(1500, Durations.timerSeconds("Bake 25 to 30 minutes until golden"))
        assertNull(Durations.timerSeconds("Stir well."))
    }

    @Test fun pastedTextWithHeaders() {
        val text = """
            Grandma's Pancakes
            Prep time: 10 minutes
            Cook Time: 15 min
            Serves 4
            Ingredients
            • 1 1/2 cups flour
            • 2 eggs
            - 1 cup milk
            Directions
            1. Mix everything well in a large bowl until smooth.
            2. Cook on a hot griddle for 3 minutes per side.
            Notes
            Works with oat milk.
        """.trimIndent()
        val d = TextRecipeParser.parse(text)
        val r = d.recipe
        assertEquals("Grandma's Pancakes", r.title)
        assertEquals(10, r.prepMinutes); assertEquals(15, r.cookMinutes); assertEquals(4, r.servings)
        assertEquals(listOf("1 1/2 cups flour", "2 eggs", "1 cup milk"), r.ingredients.map { it.text })
        assertEquals(2, r.directions.size)
        assertEquals(180, r.directions[1].timerSeconds)
        assertEquals("Works with oat milk.", r.notes)
        assertEquals(text, r.rawSource)
        assertNotEquals(Confidence.HIGH, d.confidence)
    }

    @Test fun pastedTextWithoutHeaders() {
        val d = TextRecipeParser.parse("Quick Salad\n2 cups lettuce\n1 tbsp olive oil\n1 lemon\nToss everything together in a bowl and serve right away with bread.")
        assertEquals("Quick Salad", d.recipe.title)
        assertEquals(3, d.recipe.ingredients.size)
        assertEquals(1, d.recipe.directions.size)
        assertEquals(Confidence.LOW, d.confidence)
    }

    @Test fun ocrWrappedLinesAreJoined() {
        val d = TextRecipeParser.parse("Stew\nIngredients\n2 carrots\nMethod\nChop the carrots and add them to the\npot with water and simmer.", ImportMethod.OCR)
        assertEquals(1, d.recipe.directions.size)
        assertTrue(d.recipe.directions[0].text.contains("to the pot"))
        assertEquals(Confidence.LOW, d.confidence)
    }

    @Test fun emptyTextIsAnError() {
        val d = TextRecipeParser.parse("   \n  ")
        assertTrue(d.warnings.any { it.severity == Severity.ERROR })
    }
}
