package com.mundymorning.touchrecipe.core

import com.mundymorning.touchrecipe.core.backup.*
import com.mundymorning.touchrecipe.core.categories.*
import com.mundymorning.touchrecipe.core.grocery.*
import com.mundymorning.touchrecipe.core.model.*
import com.mundymorning.touchrecipe.core.planner.Planner
import com.mundymorning.touchrecipe.core.timer.CookTimer
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class EnginesTest {
    private fun recipe(id: String, servings: Int?, vararg lines: String) =
        Recipe(id = id, title = "R$id", servings = servings, ingredients = lines.map { Ingredient(text = it) })

    @Test fun groceryMergesSameUnitAndDifferentUnitSpelling() {
        val items = GroceryEngine.generate(listOf(
            PlannedMeal(recipe("1", 4, "1 cup flour", "2 cloves garlic, minced", "1 large onion, diced"), 4),
            PlannedMeal(recipe("2", 2, "8 tbsp flour", "3 cloves garlic", "2 onions"), 4),
        ))
        val flour = items.single { it.name.startsWith("Flour") }
        assertEquals("2 cups", flour.quantityText)      // 1 cup + (8 tbsp scaled x2 = 16 tbsp = 1 cup)
        val garlic = items.single { it.name.startsWith("Garlic") }
        assertEquals(2, garlic.sources.size)
        val onion = items.single { it.name.startsWith("Onion") }
        assertEquals("5", onion.quantityText)
        assertEquals(setOf("1", "2"), onion.sources.map { it.recipeId }.toSet())
    }

    @Test fun groceryScalesToPlannedServings() {
        val items = GroceryEngine.generate(listOf(PlannedMeal(recipe("1", 2, "1 cup rice", "salt to taste"), 6)))
        assertEquals("3 cups", items.single { it.name == "Rice" }.quantityText)
        assertEquals("", items.single { it.name.startsWith("Salt") }.quantityText)
    }

    @Test fun groceryKeepsDifferentFamiliesSeparate() {
        val items = GroceryEngine.generate(listOf(PlannedMeal(recipe("1", null, "1 cup milk", "200 ml milk", "1 lb beef", "500 g beef"), null)))
        assertEquals(4, items.size)
    }

    @Test fun aislesAndHeadersIgnored() {
        assertEquals(AISLE_MEAT, GroceryEngine.aisleFor(GroceryEngine.normalizeKey("boneless chicken breasts")))
        assertEquals(AISLE_DAIRY, GroceryEngine.aisleFor("eggs"))
        assertEquals(AISLE_PRODUCE, GroceryEngine.aisleFor("tomatoes"))
        assertEquals(AISLE_BAKERY, GroceryEngine.aisleFor("baguette"))
        assertEquals(AISLE_PANTRY, GroceryEngine.aisleFor("tomato paste"))
        val r = Recipe(ingredients = listOf(Ingredient(text = "Sauce", header = true), Ingredient(text = "1 onion")))
        assertEquals(1, GroceryEngine.generate(listOf(PlannedMeal(r, null))).size)
    }

    @Test fun mergePreservesPurchasedAndEdited() {
        val gen = GroceryEngine.generate(listOf(PlannedMeal(recipe("1", null, "2 onions", "1 lb beef"), null)))
        val first = GroceryMerge.merge("2026-01-05", emptyList(), gen)
        val marked = first.map { if (it.name == "Onions") it.copy(checked = true) else if (it.name == "Beef") it.copy(edited = true, quantityText = "3 lb") else it }
        val custom = marked + GroceryItem(weekStart = "2026-01-05", name = "Paper towels", aisle = AISLE_PANTRY)
        val regen = GroceryEngine.generate(listOf(PlannedMeal(recipe("1", null, "4 onions", "1 lb beef"), null)))
        val merged = GroceryMerge.merge("2026-01-05", custom, regen)
        assertTrue(merged.single { it.name == "Onions" }.checked)
        assertEquals("3 lb", merged.single { it.name == "Beef" }.quantityText)
        assertTrue(merged.any { it.name == "Paper towels" })
        assertEquals(3, merged.size)
        // removing the meal drops unchecked/unedited, keeps purchased + edited
        val none = GroceryMerge.merge("2026-01-05", merged, emptyList())
        assertEquals(setOf("Onions", "Beef", "Paper towels"), none.map { it.name }.toSet())
    }

    @Test fun categoryRules() {
        val seed = CategoryCatalog.seed()
        assertEquals(CategoryCatalog.starter.size, seed.count { it.enabled })
        assertTrue(CategoryRules.validateNew("  ", seed) is CategoryResult.Rejected)
        assertTrue(CategoryRules.validateNew("dinner", seed) is CategoryResult.Rejected)
        assertEquals(CategoryResult.Ok("Grandma's  Pies".replace("  ", " ")), CategoryRules.validateNew("  Grandma's   Pies ", seed))
        var cats = seed
        repeat(MAX_CUSTOM_CATEGORIES) { i ->
            val r = CategoryRules.validateNew("Custom $i", cats)
            assertTrue(r is CategoryResult.Ok)
            cats = cats + Category("c_$i", (r as CategoryResult.Ok).name, "Custom", false, true, 1000 + i)
        }
        val over = CategoryRules.validateNew("One too many", cats)
        assertTrue(over is CategoryResult.Rejected && over.reason.contains("50"))
        assertTrue(CategoryRules.validateNew("custom 3", cats) is CategoryResult.Rejected)
        assertTrue(CategoryRules.validateRename("c_1", "Custom 2", cats) is CategoryResult.Rejected)
        assertTrue(CategoryRules.validateRename("c_1", "Custom 1", cats) is CategoryResult.Ok)
    }

    @Test fun timerSurvivesPauseAndRestart() {
        var t = CookTimer().withDuration(60)
        assertTrue(t.configured && !t.running)
        t = t.start(1_000)
        assertEquals(30_000, t.remaining(31_000))
        t = t.pause(31_000)
        assertEquals(30_000, t.remaining(500_000)) // paused time does not elapse
        t = t.start(500_000)
        assertEquals(10_000, t.remaining(520_000))
        assertTrue(t.finished(560_001))
        assertEquals(0, t.remaining(900_000))
        t = t.reset()
        assertEquals(60_000, t.remaining(0)); assertFalse(t.running)
        assertEquals("01:05", CookTimer.format(65_000)); assertEquals("1:01:05", CookTimer.format(3_665_000))
        assertFalse(CookTimer().withDuration(null).configured)
        assertFalse(CookTimer().start(0).running) // no timer: start is a no-op
    }

    @Test fun planner() {
        val ws = Planner.weekStart(LocalDate.of(2026, 10, 30))
        assertEquals(LocalDate.of(2026, 10, 26), ws)
        assertEquals(7, Planner.days(ws).size)
        assertEquals(LocalDate.of(2026, 11, 1), Planner.days(ws).last())
        assertEquals(LocalDate.of(2026, 10, 25), Planner.weekStart(LocalDate.of(2026, 10, 30), java.time.DayOfWeek.SUNDAY))
    }

    @Test fun backupRoundTripAndValidation() {
        val file = BackupFile(exportedAt = 5, recipes = listOf(Recipe(id = "a", title = "T", ingredients = listOf(Ingredient(text = "1 egg")), directions = listOf(Direction(text = "Go", timerSeconds = 30)))),
            categories = CategoryCatalog.seed().take(2), mealPlan = listOf(MealEntry("2026-10-30", "a", 4)),
            groceryItems = listOf(GroceryItem(weekStart = "2026-10-26", name = "Egg", aisle = AISLE_DAIRY)), preferences = mapOf("theme" to "dark"))
        val back = BackupCodec.decode(BackupCodec.encode(file))
        assertEquals(file, back)
        assertThrows(BackupException::class.java) { BackupCodec.decode("not json") }
        assertThrows(BackupException::class.java) { BackupCodec.decode("""{"format":"other","version":1,"exportedAt":1}""") }
        assertThrows(BackupException::class.java) { BackupCodec.decode("""{"format":"touch-recipe-backup","version":99,"exportedAt":1}""") }
    }
}
