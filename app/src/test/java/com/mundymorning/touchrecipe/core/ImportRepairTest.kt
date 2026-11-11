package com.mundymorning.touchrecipe.core

import com.mundymorning.touchrecipe.core.importer.*
import com.mundymorning.touchrecipe.core.model.*
import org.junit.Assert.*
import org.junit.Test

/**
 * One test per failure found in the 2026-11 import audit (docs/knowledge/reports/2026-11-11-import-audit-and-update-plan.md).
 * Every page here is written for the test; it reproduces the shape of a real failure, not a real site's content.
 */
class ImportRepairTest {
    private fun ld(body: String) = """<script type="application/ld+json">{"@context":"https://schema.org","@type":"Recipe","name":"Test Stew",$body}</script>"""
    private fun page(head: String, body: String) = "<html><head><title>Test Stew - Site</title>$head</head><body>$body</body></html>"
    private fun x(html: String) = WebRecipeExtractor.extract(html, "https://www.example.com/stew")
    private fun ImportDraft.loud() = warnings.filter { it.severity != Severity.INFO }
    private fun ImportDraft.ing() = recipe.ingredients.filter { !it.header }.map { it.text }
    private fun ImportDraft.steps() = recipe.directions.filter { !it.header }.map { it.text }
    private val fifteen = (1..15).map { "$it cups ingredient number $it" }
    private val twoSteps = """"recipeInstructions":[{"@type":"HowToStep","text":"Brown the meat well in a heavy pot over medium heat."},{"@type":"HowToStep","text":"Add everything else and simmer gently for 2 hours."}]"""
    private fun wprm(lines: List<String>) = """<div class="wprm-recipe-ingredients-container"><ul>""" + lines.joinToString("") { val p = it.split(" ", limit = 3); """<li class="wprm-recipe-ingredient"><span class="wprm-recipe-ingredient-amount">${p[0]}</span><span class="wprm-recipe-ingredient-unit">${p[1]}</span><span class="wprm-recipe-ingredient-name">${p[2]}</span></li>""" } + "</ul></div>"

    // ---- R3: the data block is trusted although it is partial ----
    @Test fun dataBlockWithEightOfFifteenIngredientsIsCompletedFromTheRecipeCard() {
        val d = x(page(ld(""""recipeIngredient":[${fifteen.take(8).joinToString(",") { "\"$it\"" }}],$twoSteps"""), wprm(fifteen)))
        assertEquals("all 15 ingredients on the page are imported, not the 8 in the data block", 15, d.ing().size)
        assertEquals("amount, unit and name are separate boxes on the page but read as one line", "1 cups ingredient number 1", d.ing().first())
        assertNotEquals(Confidence.HIGH, d.confidence)
        assertTrue(d.warnings.any { it.field == "ingredients" && it.message.contains("15") })
    }

    @Test fun shortfallAgainstAnUntrustedListIsReportedAndTheLinesAreKept() {
        // the only evidence is a bare list with no recipe markup: do not rewrite the recipe, but never stay silent
        val d = x(page(ld(""""recipeIngredient":[${fifteen.take(8).joinToString(",") { "\"$it\"" }}],$twoSteps"""), "<ul>" + fifteen.joinToString("") { "<li>$it</li>" } + "</ul>"))
        assertEquals(8, d.ing().size)
        assertTrue("a suspected omission is always reported", d.loud().any { it.field == "ingredients" && it.message.contains("15") && it.message.contains("8") })
        assertEquals("the seven lines that were not imported are kept for review", 7, d.unplaced.size)
        assertNotEquals(Confidence.HIGH, d.confidence)
    }

    @Test fun amountsMissingFromTheDataBlockAreRestoredFromThePage() {
        val names = listOf("olive oil", "butter", "popping corn", "sea salt", "smoked paprika")
        val shown = listOf("2 tbsp olive oil", "2 tbsp butter", "1/3 cup popping corn", "1 tsp sea salt", "1/2 tsp smoked paprika")
        val d = x(page(ld(""""recipeIngredient":[${names.joinToString(",") { "\"$it\"" }}],$twoSteps"""), """<div class="recipe-ingredients"><ul>${shown.joinToString("") { "<li>$it</li>" }}</ul></div>"""))
        assertEquals(shown, d.ing())
    }

    @Test fun ingredientsWithNoAmountsAnywhereAreFlagged() {
        val d = x(page(ld(""""recipeIngredient":["flour","butter","sugar","eggs","milk","salt"],$twoSteps"""), ""))
        assertTrue(d.loud().any { it.field == "ingredients" && it.message.contains("amount") })
    }

    @Test fun emptyDataBlockIsFilledFromTheRecipeCard() {
        val card = wprm(fifteen.take(4)) + """<div class="wprm-recipe-instructions-container"><ul><li class="wprm-recipe-instruction"><div class="wprm-recipe-instruction-text">Brown the meat well in a heavy pot.</div></li><li class="wprm-recipe-instruction"><div class="wprm-recipe-instruction-text">Simmer gently for 2 hours.</div></li></ul></div>"""
        val d = x(page(ld(""""recipeIngredient":[],"recipeInstructions":[]"""), card))
        assertEquals(4, d.ing().size); assertEquals(2, d.steps().size); assertEquals(7200, d.recipe.directions.last().timerSeconds)
        assertNotEquals(Confidence.HIGH, d.confidence)
    }

    @Test fun wholeIngredientListInOneStringIsSplit() {
        val d = x(page(ld(""""recipeIngredient":["1/4 cup lemon juice\n1/2 cup olive oil\nKosher salt and pepper"],$twoSteps"""), ""))
        assertEquals(listOf("1/4 cup lemon juice", "1/2 cup olive oil", "Kosher salt and pepper"), d.ing())
    }

    @Test fun ingredientsRunTogetherWithoutBreaksAreSplitOrFlagged() {
        val d = x(page(ld(""""recipeIngredient":"3 tablespoons red pepper powder 2 tablespoons sesame oil 2 cups chopped onion 3 cloves garlic 1 cup silken tofu 2 cups water 2 tsp fish sauce",$twoSteps"""), ""))
        assertTrue("several measured ingredients in one line are split", d.ing().size >= 6)
        val glued = x(page(ld(""""recipeIngredient":"3 tablespoons red pepper powder2 tablespoons sesame oil2 cups chopped onion3 cloves garlic1 cup silken tofu2 cups water2 tsp fish sauce1 lb pork",$twoSteps"""), ""))
        assertTrue("when it cannot be split safely the reader is told", glued.ing().size > 1 || glued.loud().any { it.field == "ingredients" })
    }

    @Test fun onlyOneIngredientIsNeverAcceptedQuietly() {
        val d = x(page(ld(""""recipeIngredient":["Chicken"],$twoSteps"""), """<div class="ingredients-list"><ul><li>150ml red wine</li><li>100g tomato paste</li><li>3 sprigs of thyme</li><li>1 whole chicken</li></ul></div>"""))
        assertEquals("the list on the page replaces the keyword in the data block", 4, d.ing().size)
        val alone = x(page(ld(""""recipeIngredient":["Chicken"],$twoSteps"""), ""))
        assertTrue(alone.loud().any { it.field == "ingredients" })
    }

    @Test fun doubleEscapedTextIsDecoded() {
        val d = x(page(ld(""""recipeIngredient":["280 g L&amp;ouml;ffelbiskuit","2 eggs"],"recipeInstructions":[{"@type":"HowToStep","text":"&lt;p&gt;Heat the oil in a large saucepan.&lt;/p&gt;"},{"@type":"HowToStep","text":"Serve warm with the biscuits."}]"""), ""))
        assertEquals("280 g Löffelbiskuit", d.ing().first()); assertEquals("Heat the oil in a large saucepan.", d.steps().first())
    }

    @Test fun oneStepHoldingSeveralParagraphsBecomesSeveralSteps() {
        val d = x(page(ld(""""recipeIngredient":["2 cups flour","1 egg"],"recipeInstructions":[{"@type":"HowToStep","text":"<p>Mix the flour and the egg.</p><p>Rest the dough for 30 minutes.</p><p>Roll it out thinly.</p>"}]"""), ""))
        assertEquals(3, d.steps().size)
    }

    @Test fun stepTitlesInTheDataBlockAreReplacedByTheFullDirectionsOnThePage() {
        val body = """<div class="recipe-instructions"><ol><li>Bring a large pot of salted water to the boil and cook the rice noodles until just tender, about 4 minutes, then drain and rinse.</li><li>Pat the turkey dry, season it well and cook it in a hot pan with the lemongrass paste until browned and cooked through.</li><li>Toss the noodles with the turkey, the radishes and the dressing and serve straight away with lime wedges.</li></ol></div>"""
        val d = x(page(ld(""""recipeIngredient":["10 ounces ground turkey","5 ounces rice noodles"],"recipeInstructions":[{"@type":"HowToStep","text":"Cook the rice noodles"},{"@type":"HowToStep","text":"Prep and cook your protein"},{"@type":"HowToStep","text":"Serve"}]"""), body))
        assertEquals(3, d.steps().size); assertTrue(d.steps().first().contains("salted water"))
    }

    @Test fun directionsLongerOnThePageThanInTheDataBlockAreUsedOrReported() {
        val long = listOf("Brown the meat well in a heavy pot over medium heat.", "Add everything else and simmer gently for 2 hours.", "Skim the fat from the surface and stir in the vinegar and the chopped herbs.", "Rest the stew off the heat for 15 minutes before serving with bread.")
        val d = x(page(ld(""""recipeIngredient":["2 lb beef","1 onion"],$twoSteps"""), """<div class="directions"><ol>${long.joinToString("") { "<li>$it</li>" }}</ol></div>"""))
        assertTrue("the two extra steps are imported or at least reported", d.steps().size == 4 || d.loud().any { it.field == "directions" })
    }

    @Test fun oneShortDirectionForManyIngredientsIsFlagged() {
        val d = x(page(ld(""""recipeIngredient":["2 cups flour","1 egg","1 cup milk","2 tbsp sugar","1 tsp salt"],"recipeInstructions":"Make the best pancakes with this recipe""""), ""))
        assertTrue(d.loud().any { it.field == "directions" })
    }

    // ---- R4: microdata present but not read ----
    @Test fun microdataPropertiesOutsideTheRecipeElementAreRead() {
        val body = """<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Test Stew</h1></div>
            <ul><li itemprop="recipeIngredient">2 lb beef</li><li itemprop="recipeIngredient">1 onion, chopped</li><li itemprop="recipeIngredient">3 cups stock</li></ul>
            <div itemprop="recipeInstructions"><p>Brown the meat well in a heavy pot.</p><p>Add the stock and simmer for 2 hours.</p></div>"""
        val d = x(page("", body))
        assertEquals(3, d.ing().size); assertEquals(2, d.steps().size); assertEquals("Test Stew", d.recipe.title)
    }

    // ---- R2 / R5: pages with no structured data ----
    @Test fun plainBlogPostWithFriendlyHeadingsIsRead() {
        val body = """<div class="content has-sidebar"><h1>Test Stew</h1><p>My grandmother made this every winter.</p>
            <h2>&#128722; What You&rsquo;ll Need</h2><ul><li>2 lbs beef brisket, cut into chunks</li><li>1 large yellow onion, diced</li><li>4 cloves garlic, minced</li><li>Salt and pepper to taste</li></ul>
            <p><strong>Here&rsquo;s how to make it:</strong></p><ol><li>Brown the beef in a heavy pot over medium-high heat until well coloured.</li><li>Add the onion and garlic and cook until soft, then cover with water and simmer for 2 hours.</li></ol>
            <h2>Comments</h2><p>Looks great, I will try this at the weekend with my family!</p></div>"""
        val d = x(page("", body))
        assertEquals(4, d.ing().size); assertEquals(2, d.steps().size)
        assertEquals("a wrapper class such as has-sidebar must not hide the page", "2 lbs beef brisket, cut into chunks", d.ing().first())
        assertEquals(Confidence.LOW, d.confidence); assertTrue("a guess from layout is always labelled", d.loud().isNotEmpty())
    }

    @Test fun recipeInSeveralPartsKeepsEveryPart() {
        val body = """<h1>Test Stew</h1><h2>Produce</h2><ul><li>1 small red onion</li><li>2 celery stalks</li><li>1/2 cup dill leaves</li></ul>
            <h2>Pantry</h2><ul><li>2 cans oil-packed tuna</li><li>1/3 cup mayonnaise</li><li>4 teaspoons Dijon mustard</li></ul>
            <h2>Method</h2><ol><li>Finely chop the onion and the celery and put them in a bowl.</li><li>Fold in the tuna, the mayonnaise and the mustard and season well.</li></ol>"""
        val d = x(page("", body))
        assertEquals(6, d.ing().size); assertEquals(listOf("Produce", "Pantry"), d.recipe.ingredients.filter { it.header }.map { it.text })
    }

    @Test fun directionsWithNoHeadingAreFoundAfterTheIngredients() {
        val body = """<h1>Test Stew</h1><h3>Recipe: Orange Carrots</h3><ul><li>3 large carrots</li><li>1/4 tsp. salt</li><li>1 Tbs. soy sauce</li></ul>
            <p>Cut the carrots into thick rounds and put them in a small pan.</p><p>Add orange juice to cover and the salt, bring to a boil and cook for 10 minutes.</p>"""
        val d = x(page("", body))
        assertEquals(3, d.ing().size); assertEquals(2, d.steps().size)
    }

    @Test fun pageFurnitureIsNeverImportedAsDirections() {
        val body = """<h1>Test Stew</h1><h2>Ingredients</h2><ul><li>1 rack baby back ribs</li><li>1 cup apple cider vinegar</li></ul>
            <footer><p>© 2026 Example Kitchen. All rights reserved. Privacy Policy and Terms of Service apply.</p><p>Use this popup to embed a mailing list sign up form for your readers.</p></footer>"""
        val d = x(page("", body))
        assertTrue(d.steps().none { it.contains("rights reserved") }); assertTrue(d.loud().any { it.field == "directions" })
    }

    // ---- completeness of text, PDF and OCR imports ----
    @Test fun missingNumberedStepIsReported() {
        val d = TextRecipeParser.parse("Soup\nIngredients\n2 carrots\n1 onion\nDirections\n1. Chop the carrots and the onion.\n2. Fry them gently in butter.\n4. Blend until smooth and season.")
        assertTrue(d.loud().any { it.field == "directions" && it.message.contains("3") })
    }

    @Test fun lastDirectionCutOffMidSentenceIsReported() {
        val d = TextRecipeParser.parse("Soup\nIngredients\n2 carrots\n1 onion\nDirections\nChop the carrots and the onion.\nFry them gently in butter and then add the")
        assertTrue(d.loud().any { it.field == "directions" && it.message.contains("mid-sentence") })
    }

    @Test fun headingsWithCountsAndScaleButtonsAreRecognised() {
        val d = TextRecipeParser.parse("Taquitos\nIngredients 1x 2x 3x\n2 Tablespoons olive oil\n1 cup diced onion\nInstructions\nStep 1\nHeat the oil in a large pan over medium heat.\nStep 2\nAdd the onion and cook until translucent.")
        assertEquals(2, d.recipe.ingredients.size); assertEquals("'Step 1' labels a step, it is not the Directions heading", 2, d.recipe.directions.count { it.text.length > 20 })
        assertEquals(2, TextRecipeParser.parse("Cake\nIngredients (2)\n1 cup flour\n2 eggs\nMethod\nMix everything together and bake for 30 minutes.").recipe.ingredients.size)
    }

    @Test fun wrappedIngredientLineIsJoinedAndTickBoxesAreRemoved() {
        val d = TextRecipeParser.parse("Cookies\nIngredients\n▢ 1 cup (2 sticks) unsalted butter,\nsoftened\n▢ 3/4 cup sugar\nDirections\n① Beat the butter with the sugar until pale and fluffy.")
        assertEquals(listOf("1 cup (2 sticks) unsalted butter, softened", "3/4 cup sugar"), d.recipe.ingredients.map { it.text })
        assertEquals("Beat the butter with the sugar until pale and fluffy.", d.recipe.directions.single().text)
    }

    @Test fun severalLabelledValuesOnOneLineAreAllRead() {
        val r = TextRecipeParser.parse("Cookies\nServings: 36 Prep time: 20 minutes Cook time: 11 minutes\nIngredients\n1 cup flour\n2 eggs\nDirections\nMix and bake until golden at the edges.").recipe
        assertEquals(36, r.servings); assertEquals(20, r.prepMinutes); assertEquals(11, r.cookMinutes)
    }

    @Test fun printedWebPageUsesTheRecipeBlockNotTheSiteMenu() {
        val text = listOf("11/6/26, 3:04 PM Whole Wheat Buns - Example Kitchen", "Home", "Recipes", "Ingredients", "Sauces, Wines & Oils", "Spices & Seasonings", "Noodles & Wrappers", "About Us", "Contact",
            "Whole Wheat Buns", "INGREDIENTS", "1 3/4 cups warm milk", "1 teaspoon active dry yeast", "2 1/2 cups all-purpose flour", "INSTRUCTIONS",
            "1 Heat the milk until warm to the touch, then stir in the yeast.", "2 Mix in the flour until the dough is smooth and soft.", "Nutrition", "Calories: 120kcal", "Leave a comment", "Great recipe!",
            "https://www.example-kitchen.test/buns/ 1/3").joinToString("\n")
        val d = TextRecipeParser.parse(text); val r = d.recipe
        assertEquals("Whole Wheat Buns", r.title); assertEquals(3, r.ingredients.size); assertEquals(2, r.directions.size)
        assertEquals("https://www.example-kitchen.test/buns/", r.sourceUrl)
        assertTrue("everything that was read is still kept with the recipe", r.rawSource!!.contains("Spices & Seasonings"))
    }

    // ---- R6 / R7: reading order of PDF and OCR text ----
    private fun col(x: Float, lines: List<String>, top: Float = 100f) = lines.mapIndexed { i, t -> TextLine(t, x, top + i * 16f, x + t.length * 6f, top + i * 16f + 11f) }

    @Test fun twoColumnsAreReadOneAfterTheOtherNotInterleaved() {
        val left = listOf("Ingredients", "2 cups flour", "1 tsp salt", "3 large eggs", "1 cup whole milk", "2 tbsp butter")
        val right = listOf("Directions", "Whisk the flour and the salt in a bowl.", "Beat in the eggs and then the milk.", "Rest the batter for half an hour.", "Fry in butter until golden.", "Serve at once with lemon.")
        val text = LayoutReader.read(listOf(TextLine("Pancakes", 40f, 40f, 200f, 60f)) + col(40f, left) + col(300f, right))
        val lines = text.lines().filter { it.isNotBlank() }
        assertEquals(listOf("Pancakes") + left + right, lines)
        val d = TextRecipeParser.parse(text)
        assertEquals(5, d.recipe.ingredients.size); assertEquals(5, d.recipe.directions.size)
    }

    @Test fun amountAndNameInSeparateTableCellsStayOnOneLine() {
        val qty = listOf("2 cups", "1 tsp", "3 large", "1 cup", "2 tbsp", "1 pinch"); val name = listOf("flour", "salt", "eggs", "whole milk", "butter", "nutmeg")
        val text = LayoutReader.read(col(40f, qty) + col(160f, name))
        assertEquals(qty.zip(name).map { "${it.first} ${it.second}" }, text.lines().filter { it.isNotBlank() })
    }

    @Test fun runningHeadersAndFootersAreDroppedAndTheSourceAddressIsKept() {
        fun pageOf(n: Int, body: List<String>) = (listOf(TextLine("11/6/26, 3:04 PM Pancakes - Example Kitchen", 40f, 10f, 400f, 20f, n)) + body.mapIndexed { i, t -> TextLine(t, 40f, 60f + i * 16f, 400f, 71f + i * 16f, n) } +
            TextLine("https://www.example-kitchen.test/pancakes/ Page ${n + 1} of 2", 40f, 760f, 400f, 770f, n))
        val text = LayoutReader.read(pageOf(0, listOf("Pancakes", "Ingredients", "2 cups flour", "3 eggs", "Directions", "Whisk the flour with the eggs and then fry spoonfuls of the batter in a hot pan until")) + pageOf(1, listOf("golden on both sides, about 2 minutes each.")))
        assertFalse(text.contains("3:04 PM")); assertFalse(text.contains("Page 1 of 2"))
        val d = TextRecipeParser.parse(text)
        assertEquals("Pancakes", d.recipe.title); assertEquals("https://www.example-kitchen.test/pancakes/", d.recipe.sourceUrl)
        assertEquals("a step that continues on the next page is one step", 1, d.recipe.directions.size)
        assertTrue(d.recipe.directions.single().text.endsWith("about 2 minutes each."))
    }
}
