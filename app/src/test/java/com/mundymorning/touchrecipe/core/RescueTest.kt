package com.mundymorning.touchrecipe.core

import com.mundymorning.touchrecipe.core.model.*
import com.mundymorning.touchrecipe.core.rescue.Rescue
import com.mundymorning.touchrecipe.core.rescue.RescueDraft
import com.mundymorning.touchrecipe.core.rescue.RescueState
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

/** Recipe Rescue editing rules (specification section 5): transfer, selective removal, replacement, undo, Start Fresh, questions, drafts. */
class RescueTest {
    private val imported = Recipe(title = "Grandma's Bisquits", photo = "p.jpg", servings = 8, cookMinutes = 15,
        ingredients = listOf(Ingredient("i1", "2 cups flour"), Ingredient("i2", "1 tbsp WRONG"), Ingredient("i3", "1/2 cup milk")),
        directions = listOf(Direction("d1", "Mix."), Direction("d2", "GARBLED STEP"), Direction("d3", "Bake for 15 minutes.", timerSeconds = 900)), notes = "From the tin box.")
    private fun state(r: Recipe = imported) = RescueState(RescueDraft(recipe = r))

    @Test fun selectedLinesAreRemovedAndEverythingElseIsKept() {
        var s = Rescue.toggle(state(), "i2"); s = Rescue.toggle(s, "d2")
        s = Rescue.removeSelected(s)
        assertEquals(listOf("i1", "i3"), s.recipe.ingredients.map { it.id }); assertEquals(listOf("d1", "d3"), s.recipe.directions.map { it.id })
        assertEquals("the photo, time and servings that imported correctly are untouched", listOf("p.jpg", 15, 8), listOf(s.recipe.photo, s.recipe.cookMinutes, s.recipe.servings))
        assertFalse(s.selecting); assertTrue(s.selection.isEmpty())
        s = Rescue.undo(s); assertEquals(imported, s.recipe)
        s = Rescue.redo(s); assertEquals(2, s.recipe.ingredients.size)
    }

    @Test fun keepPhotoAndTimeButRemoveAllIngredientsAndSteps() {
        var s = Rescue.selectAllIngredients(state()); s = Rescue.selectAllSteps(s)
        assertEquals(6, s.selection.size)
        s = Rescue.removeSelected(s)
        assertTrue(s.recipe.ingredients.isEmpty() && s.recipe.directions.isEmpty())
        assertEquals("p.jpg", s.recipe.photo); assertEquals(15, s.recipe.cookMinutes); assertEquals("Grandma's Bisquits", s.recipe.title)
        assertEquals("one undo restores the lot", imported, Rescue.undo(s).recipe)
    }

    @Test fun fieldsCanBeSelectedAndRemovedToo() {
        var s = Rescue.toggle(state(), Rescue.TITLE); s = Rescue.toggle(s, Rescue.NOTES); s = Rescue.toggle(s, Rescue.TIMES)
        s = Rescue.removeSelected(s)
        assertEquals("", s.recipe.title); assertEquals("", s.recipe.notes); assertNull(s.recipe.cookMinutes); assertEquals(3, s.recipe.ingredients.size)
    }

    @Test fun cancelSelectionChangesNothing() {
        val s = Rescue.cancelSelection(Rescue.toggle(state(), "i1"))
        assertEquals(imported, s.recipe); assertFalse(s.canUndo); assertFalse(s.selecting)
    }

    @Test fun replaceSelectedPutsTheNewLinesWhereTheOldOnesWere() {
        var s = Rescue.toggle(state(), "i2")
        s = Rescue.replaceSelected(s, "• 1 tbsp baking powder\n• 1 tsp salt")
        assertEquals(listOf("2 cups flour", "1 tbsp baking powder", "1 tsp salt", "1/2 cup milk"), s.recipe.ingredients.map { it.text })
        assertEquals("the lines that were not selected keep their ids", listOf("i1", "i3"), s.recipe.ingredients.filter { it.id.startsWith("i") && it.id.length == 2 }.map { it.id })
        s = Rescue.toggle(s, "d2"); s = Rescue.replaceSelected(s, "2. Cut in the butter until\ncrumbly.\n3. Stir in the milk.")
        assertEquals(listOf("Mix.", "Cut in the butter until crumbly.", "Stir in the milk.", "Bake for 15 minutes."), s.recipe.directions.map { it.text })
    }

    @Test fun transferKeepsAmountsOrderAndSeveralLinesAtOnce() {
        var s = state(Recipe())
        s = Rescue.addIngredients(s, "2 1/2 cups all-purpose flour\n☐ ½ teaspoon salt\n\n- 1 cup (2 sticks) butter, softened\nFor the glaze:")
        assertEquals(listOf("2 1/2 cups all-purpose flour", "½ teaspoon salt", "1 cup (2 sticks) butter, softened", "For the glaze"), s.recipe.ingredients.map { it.text })
        assertEquals(listOf(false, false, false, true), s.recipe.ingredients.map { it.header })
        s = Rescue.addSteps(s, "1. Heat the oven to 375 degrees.\n2. Bake for 12 minutes, until\ngolden at the edges.\n\nCool on a rack.")
        assertEquals(listOf("Heat the oven to 375 degrees.", "Bake for 12 minutes, until golden at the edges.", "Cool on a rack."), s.recipe.directions.map { it.text })
        assertEquals(720, s.recipe.directions[1].timerSeconds)
        s = Rescue.setTitle(s, "\n  Brown Sugar Cookies \nby Aunt May"); assertEquals("Brown Sugar Cookies", s.recipe.title)
        s = Rescue.setServings(s, "Makes 36 cookies"); assertEquals(36, s.recipe.servings)
        s = Rescue.setTime(s, "prep", "Prep time: 20 minutes"); s = Rescue.setTime(s, "cook", "1 hr 10 min"); assertEquals(20, s.recipe.prepMinutes); assertEquals(70, s.recipe.cookMinutes)
        s = Rescue.addNotes(s, "Dough keeps 3 days."); s = Rescue.addNotes(s, "Freezes well."); assertEquals("Dough keeps 3 days.\nFreezes well.", s.recipe.notes)
        val steps = s.draft.undo.size; repeat(steps) { s = Rescue.undo(s) }; assertEquals("every transfer is one undo step", Recipe(id = s.recipe.id), s.recipe)
    }

    @Test fun textWithNoNumberNeverChangesServingsOrTimes() {
        val s = state()
        assertSame(s, Rescue.setServings(s, "serves a crowd")); assertSame(s, Rescue.setTime(s, "cook", "until done")); assertSame(s, Rescue.addIngredients(s, "  \n "))
    }

    @Test fun startFreshClearsFieldsKeepsWhatWasChosenAndCanBeUndone() {
        val src = OriginalSource(SourceKind.IMAGE, files = listOf("card.jpg"), text = "2 cups flour")
        var s = RescueState(RescueDraft(recipe = imported, source = src))
        s = Rescue.startFresh(s, keep = setOf(Rescue.PHOTO, Rescue.TIMES))
        assertEquals("", s.recipe.title); assertTrue(s.recipe.ingredients.isEmpty()); assertTrue(s.recipe.directions.isEmpty()); assertEquals("", s.recipe.notes); assertNull(s.recipe.servings)
        assertEquals("p.jpg", s.recipe.photo); assertEquals(15, s.recipe.cookMinutes)
        assertEquals("the original is never touched", src, s.draft.source)
        assertEquals(imported, Rescue.undo(s).recipe)
    }

    @Test fun smartPasteProposesAndOnlyFillsWhatIsEmpty() {
        val plan = Rescue.planSmartPaste("Pancakes\nServes 4\nIngredients\n1 cup flour\n1 egg\nDirections\nMix and fry for 3 minutes.")
        assertEquals("Pancakes", plan.title); assertEquals(2, plan.ingredients.size); assertEquals(1, plan.directions.size); assertEquals(4, plan.servings)
        val before = state()
        assertEquals("planning changes nothing", imported, before.recipe)
        val s = Rescue.applySmartPaste(before, plan)
        assertEquals("an existing title is not overwritten", "Grandma's Bisquits", s.recipe.title); assertEquals(8, s.recipe.servings)
        assertEquals(5, s.recipe.ingredients.size); assertEquals(4, s.recipe.directions.size)
        assertEquals(imported, Rescue.undo(s).recipe)
        assertTrue(Rescue.planSmartPaste("   ").isEmpty)
    }

    @Test fun editMoveHeaderAndDeleteASingleLine() {
        var s = Rescue.editIngredient(state(), "i2", " 1 tbsp baking powder "); assertEquals("1 tbsp baking powder", s.recipe.ingredients[1].text)
        s = Rescue.move(s, "i3", -1); assertEquals(listOf("i1", "i3", "i2"), s.recipe.ingredients.map { it.id })
        s = Rescue.move(s, "i1", -1); assertEquals("moving past the end does nothing", listOf("i1", "i3", "i2"), s.recipe.ingredients.map { it.id })
        s = Rescue.editStep(s, "d1", "Rest the dough for 30 minutes."); assertEquals(1800, s.recipe.directions[0].timerSeconds)
        s = Rescue.toggleHeader(s, "d2"); assertTrue(s.recipe.directions[1].header)
        s = Rescue.delete(s, "d2"); assertEquals(2, s.recipe.directions.size)
    }

    @Test fun questionsStayUntilResolvedAndAreNotUndoneByRecipeUndo() {
        var s = Rescue.addHelp(state(), "i3", "Ask Mom whether this says 1 cup or 1/2 cup.")
        s = Rescue.addHelp(s, "source", "What is this smudged word?", page = 0, x = 0.4f, y = 0.72f)
        assertEquals(2, s.draft.openQuestions); assertEquals(1, Rescue.helpFor(s, "i3").size)
        s = Rescue.editIngredient(s, "i3", "1 cup milk"); s = Rescue.undo(s)
        assertEquals("undoing a recipe edit keeps the questions", 2, s.draft.openQuestions)
        val first = s.draft.helpNotes.first().id
        s = Rescue.resolveHelp(s, first); assertEquals(1, s.draft.openQuestions); assertTrue(Rescue.helpFor(s, "i3").isEmpty())
        assertEquals("a resolved question is kept, not deleted", 2, s.draft.helpNotes.size)
        assertSame(s, Rescue.addHelp(s, "i1", "   "))
    }

    @Test fun draftSurvivesBeingWrittenAndReadBack() {
        var s = RescueState(RescueDraft(recipe = imported, source = OriginalSource(SourceKind.PDF, "https://x.test/r", listOf("a.pdf"), "text", 5), findings = listOf("Possibly missing: 1 egg"), createdAt = 1, updatedAt = 2))
        s = Rescue.removeSelected(Rescue.toggle(s, "i2")); s = Rescue.addHelp(s, "d2", "Is this 350 or 450 degrees?")
        val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
        val back = json.decodeFromString<RescueDraft>(json.encodeToString(s.draft))
        assertEquals(s.draft, back)
        assertEquals("undo still works after reopening", imported, Rescue.undo(RescueState(back)).recipe)
    }

    @Test fun savingNeedsATitleAndSomeContentAndDropsBlankLines() {
        assertEquals(2, Rescue.problems(Recipe()).size); assertTrue(Rescue.problems(imported).isEmpty())
        assertEquals(1, Rescue.problems(Recipe(title = "T")).size); assertTrue(Rescue.problems(Recipe(title = "T", directions = listOf(Direction(text = "Stir.")))).isEmpty())
        val c = Rescue.cleaned(imported.copy(title = "  T ", ingredients = imported.ingredients + Ingredient(text = "  ")))
        assertEquals("T", c.title); assertEquals(3, c.ingredients.size)
    }

    @Test fun historyIsBounded() {
        var s = state(); repeat(100) { i -> s = Rescue.setNotes(s, "note $i") }
        assertEquals(40, s.draft.undo.size)
    }

    @Test fun pageTextGivesOneLinePerBlockWithoutMenus() {
        val t = Rescue.pageText("<html><body><nav><li>Home</li></nav><h1>Stew</h1><ul><li><span>2</span><span>cups</span> stock</li><li>1 onion</li></ul><p>Brown the meat.</p><script>x()</script></body></html>")
        assertEquals(listOf("Stew", "2 cups stock", "1 onion", "Brown the meat."), t.lines())
    }
}
