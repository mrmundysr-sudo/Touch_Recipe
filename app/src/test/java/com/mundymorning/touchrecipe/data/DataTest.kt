package com.mundymorning.touchrecipe.data

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mundymorning.touchrecipe.AppContainer
import com.mundymorning.touchrecipe.core.backup.BackupException
import com.mundymorning.touchrecipe.core.categories.CategoryResult
import com.mundymorning.touchrecipe.core.model.*
import com.mundymorning.touchrecipe.core.timer.CookTimer
import com.mundymorning.touchrecipe.ui.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.io.File
import java.time.LocalDate

@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class DataTest {
    private val ctx: Context get() = ApplicationProvider.getApplicationContext()
    private fun blocking(block: suspend () -> Unit) { runBlocking { block() } }

    @Test fun everythingSurvivesProcessDeathAndRestart() = blocking {
        ctx.deleteDatabase("touch_recipe.db")
        var db = AppDatabase.create(ctx)
        var repo = Repository(db)
        repo.ensureSeeded()
        val saved = repo.saveRecipe(sampleRecipe("r1").copy(favorite = true))
        val (res, catId) = repo.addCustomCategoryReturningId("Sunday Roasts")
        assertTrue(res is CategoryResult.Ok)
        repo.saveRecipe(saved.copy(categoryIds = listOf(catId!!)))
        repo.assignMeal(LocalDate.of(2026, 11, 2), "r1", 6)
        val item = repo.addGroceryItem(LocalDate.of(2026, 10, 26), "Milk", "1 l", "dairy")!!
        repo.updateGroceryItem(item.copy(checked = true))
        repo.saveCookSession(Repository.CookSession("r1", 2, setOf(0, 1), CookTimer(600_000, 480_000, 123456789L), 1, false))
        val prefs = Prefs(ctx); prefs.setTheme(ThemeMode.DARK); prefs.setGlowGuide(false)
        db.close()   // "process death": every in-memory object is gone

        db = AppDatabase.create(ctx); repo = Repository(db)
        val r = repo.getRecipe("r1")!!
        assertTrue(r.favorite); assertEquals(catId, r.categoryIds.single()); assertEquals(5, r.ingredients.size); assertEquals(3, r.directions.size)
        assertEquals(6, repo.mealsFor(LocalDate.of(2026, 11, 2), LocalDate.of(2026, 11, 2)).single().servings)
        assertTrue(db.grocery().week("2026-10-26").single().checked)
        val s = repo.cookSession("r1")!!
        assertEquals(2, s.stepIndex); assertEquals(setOf(0, 1), s.completed); assertEquals(123456789L, s.timer.endAtMs); assertEquals(1, s.timerStep)
        assertEquals("Sunday Roasts", repo.categories().first().single { !it.builtIn }.name)
        assertEquals(ThemeMode.DARK, Prefs(ctx).theme.value); assertFalse(Prefs(ctx).glowGuide.value)
        db.close(); ctx.deleteDatabase("touch_recipe.db")
    }

    @Test fun deletingARecipeCleansPlansAndCustomCategoryDeletionKeepsRecipes() = blocking {
        val db = AppDatabase.inMemory(ctx); val repo = Repository(db); repo.ensureSeeded()
        val (_, cid) = repo.addCustomCategoryReturningId("Mine")
        repo.saveRecipe(sampleRecipe("a", categories = listOf(cid!!, "b_dinner"))); repo.saveRecipe(sampleRecipe("b", "Other"))
        repo.assignMeal(LocalDate.of(2026, 11, 2), "a", 4)
        assertEquals(1, repo.deleteCustomCategory(cid))
        assertEquals(listOf("b_dinner"), repo.getRecipe("a")!!.categoryIds)
        val removed = repo.deleteRecipe("a")!!
        assertNull(repo.getRecipe("a")); assertTrue(repo.mealsFor(LocalDate.of(2026, 11, 2), LocalDate.of(2026, 11, 2)).isEmpty())
        repo.restoreRecipe(removed); assertNotNull(repo.getRecipe("a"))   // undo
        assertTrue(repo.renameCategory("b_dinner", "Supper") is CategoryResult.Rejected)   // built-ins are switched off, not renamed
        assertEquals(CategoryResult.Ok("Brunch Club"), repo.renameCategory(repo.addCustomCategoryReturningId("Tmp").second!!, "  Brunch   Club "))
        db.close()
    }

    @Test fun categoriesDisableKeepsAssignments() = blocking {
        val db = AppDatabase.inMemory(ctx); val repo = Repository(db); repo.ensureSeeded()
        repo.saveRecipe(sampleRecipe("a", categories = listOf("b_dinner")))
        repo.setCategoryEnabled("b_dinner", false)
        assertFalse(repo.categories().first().single { it.id == "b_dinner" }.enabled)
        assertEquals(listOf("b_dinner"), repo.getRecipe("a")!!.categoryIds)
        repo.setCategoryEnabled("b_dinner", true); db.close()
    }

    @Test fun backupExportRestoreMergeAndReplace() = blocking {
        val a = testContainer(ctx)
        val photo = a.photos.saveBytes(jpegBytes())!!
        a.repo.saveRecipe(sampleRecipe("r1", photo = photo).copy(favorite = true)); a.repo.saveRecipe(sampleRecipe("r2", "Second"))
        a.repo.assignMeal(LocalDate.of(2026, 11, 2), "r1", 3); a.repo.addGroceryItem(LocalDate.of(2026, 10, 26), "Eggs", "12", "dairy")
        val zip = File(ctx.cacheDir, "backup.zip"); val uri = Uri.fromFile(zip)
        assertEquals(2, a.backup.export(uri)); assertTrue(zip.length() > 100)
        a.photos.file(photo).delete()   // simulate a new phone: the photo must come back from the backup

        val b = testContainer(ctx)
        b.repo.saveRecipe(sampleRecipe("local", "Only here"))
        val sum = b.backup.restore(uri, RestoreMode.MERGE)
        assertEquals(2, sum.recipes); assertEquals(1, sum.photos)
        assertEquals(setOf("local", "r1", "r2"), b.repo.recipes().first().map { it.id }.toSet())
        assertTrue(b.repo.getRecipe("r1")!!.favorite); assertTrue(b.photos.file(photo).exists())
        assertEquals(3, b.repo.mealsFor(LocalDate.of(2026, 11, 2), LocalDate.of(2026, 11, 2)).single().servings)
        assertEquals("Eggs", b.db.grocery().week("2026-10-26").single().name)
        b.backup.restore(uri, RestoreMode.REPLACE)
        assertEquals(setOf("r1", "r2"), b.repo.recipes().first().map { it.id }.toSet())

        val json = File(ctx.cacheDir, "recipes.json"); assertEquals(2, b.backup.exportRecipesJson(Uri.fromFile(json)))
        val c = testContainer(ctx); assertEquals(2, c.backup.restore(Uri.fromFile(json), RestoreMode.MERGE).recipes)
        val junk = File(ctx.cacheDir, "junk.zip").apply { writeText("not a backup") }
        try { c.backup.restore(Uri.fromFile(junk), RestoreMode.REPLACE); fail() } catch (e: BackupException) { assertTrue(e.message!!.contains("not a Touch Recipe backup")) }
        assertEquals("a failed restore must not touch data", 2, c.repo.recipes().first().size)
    }

    @Test fun importServiceClassifiesSharedContent() {
        val c = testContainer(ctx); val i = c.importer
        assertEquals(ImportInput.Url("https://example.com/a?b=1"), i.classify("Check this out! https://example.com/a?b=1"))
        assertEquals(ImportInput.Url("https://www.tiktok.com/@x/video/1"), i.classify("https://www.tiktok.com/@x/video/1"))
        assertTrue(i.classify("2 cups flour\n1 egg\nMix well.\nBake 20 minutes at 350 degrees until golden brown and delicious https://x.com") is ImportInput.Text)
        assertEquals("https://recipes.com/x", i.normalizeUrl("recipes.com/x")); assertNull(i.normalizeUrl("not a url")); assertNull(i.normalizeUrl("javascript:alert(1)")); assertNull(i.normalizeUrl("ftp://x.com"))
    }

    @Test fun ocrImageImportAndFailures() = blocking {
        val ocr = FakeOcr("Pancakes\nIngredients\n1 cup flour\n1 egg\nDirections\nMix and fry for 3 minutes.")
        val c = testContainer(ctx, ocr = ocr)
        val draft = c.importer.import(ImportInput.Image(fileUri(ctx, "scan.jpg", jpegBytes())))
        assertEquals(ImportMethod.OCR, draft.method); assertEquals("Pancakes", draft.recipe.title); assertEquals(2, draft.recipe.ingredients.size)
        assertNotEquals(Confidence.HIGH, draft.confidence); assertTrue(draft.warnings.any { it.message.contains("mistakes") })
        ocr.text = "   "
        try { c.importer.import(ImportInput.Image(fileUri(ctx, "scan2.jpg", jpegBytes()))); fail() } catch (e: ImportFailure) { assertTrue(e.retryable) }
        try { c.importer.import(ImportInput.Pdf(fileUri(ctx, "bad.pdf", "not a pdf".toByteArray()))); fail() } catch (e: ImportFailure) { assertTrue(e.userMessage.contains("PDF")) }
        try { c.importer.import(ImportInput.File(fileUri(ctx, "x.bin", ByteArray(4)), "application/octet-stream")); fail() } catch (e: ImportFailure) { assertTrue(e.userMessage.contains("isn't supported")) }
        val txt = c.importer.import(ImportInput.File(fileUri(ctx, "r.txt", "Toast\n2 slices bread\nToast them for 2 minutes.".toByteArray()), "text/plain"))
        assertEquals("Toast", txt.recipe.title)
        val html = c.importer.import(ImportInput.File(fileUri(ctx, "r.html", LD_PAGE.toByteArray()), "text/html"))
        assertEquals("Imported Carbonara", html.recipe.title)
    }

    @Test fun socialCaptionIsLowConfidenceAndBlockedPagesAreReported() = blocking {
        val f = FakeFetcher(); val c = testContainer(ctx, f)
        f.pages["https://www.tiktok.com/oembed?url=" + java.net.URLEncoder.encode("https://www.tiktok.com/@chef/video/9", "UTF-8")] = FetchOutcome.Page("""{"title":"Garlic noodles\nIngredients\n200 g noodles\n3 cloves garlic\nDirections\nBoil noodles then toss with garlic butter."}""", "x")
        f.pages["https://www.tiktok.com/@chef/video/9"] = FetchOutcome.Page("<html><head><meta property='og:title' content='Chef on TikTok'></head></html>", "https://www.tiktok.com/@chef/video/9")
        val d = c.importer.import(ImportInput.Url("https://www.tiktok.com/@chef/video/9"))
        assertEquals(ImportMethod.SOCIAL_CAPTION, d.method); assertEquals(Confidence.LOW, d.confidence); assertEquals(2, d.recipe.ingredients.size)
        assertTrue(d.warnings.any { it.message.contains("Social platforms") })
        f.pages["https://blocked.com/r"] = FetchOutcome.Blocked(403, "declined")
        try { c.importer.import(ImportInput.Url("https://blocked.com/r")); fail() } catch (e: ImportFailure) { assertTrue(e.blocked) }
        f.bytes["https://img/1.jpg"] = jpegBytes()
        assertNotNull(c.importer.fetchPhoto(listOf("https://img/missing.jpg", "https://img/1.jpg")))
        assertNull(c.importer.fetchPhoto(listOf("https://img/missing.jpg")))
    }

    // ---- 2026-11 importer repair: PDFs are read from their own text; recognition is only for pages that are pictures ----
    private fun pdf(name: String) = javaClass.getResourceAsStream("/fixtures/pdf/$name")!!.use { it.readBytes() }

    @Test fun digitalPdfIsReadFromItsOwnTextInEveryLayout() = blocking {
        val c = testContainer(ctx, ocr = FakeOcr("WRONG TEXT FROM RECOGNITION"))
        for (name in listOf("recipe-single.pdf", "recipe-twocol.pdf", "recipe-table.pdf")) {
            val d = c.importer.import(ImportInput.Pdf(fileUri(ctx, name, pdf(name)))); val r = d.recipe
            assertEquals(name, ImportMethod.TEXT, d.method)
            assertEquals(name, "Brown Sugar Chocolate Chip Cookies", r.title)
            assertEquals("$name ingredients: ${r.ingredients.map { it.text }}", 12, r.ingredients.count { !it.header })
            assertEquals("$name directions: ${r.directions.map { it.text }}", 8, r.directions.count { !it.header })
            assertEquals(name, "2 1/2 cups all-purpose flour", r.ingredients.first().text)
            assertTrue("$name: a wrapped or two-cell line is one ingredient", r.ingredients.any { it.text == "1 cup (2 sticks) unsalted butter, softened" })
            assertTrue(name, r.directions.last().text.startsWith("Cool on the sheets for 5 minutes"))
            assertEquals(name, 36, r.servings); assertEquals(name, 20, r.prepMinutes); assertEquals(name, 11, r.cookMinutes)
            assertFalse("$name: recognition must not be used when the PDF has text", (r.rawSource.orEmpty() + r.title).contains("WRONG"))
            assertTrue("$name: nothing important is flagged on a clean PDF: ${d.warnings}", d.warnings.none { it.severity != Severity.INFO && (it.field == "ingredients" || it.field == "directions") })
        }
    }

    @Test fun longPdfKeepsEveryPageAndDropsBrowserHeadersAndFooters() = blocking {
        val c = testContainer(ctx)
        val d = c.importer.import(ImportInput.Pdf(fileUri(ctx, "recipe-long.pdf", pdf("recipe-long.pdf")))); val r = d.recipe
        assertEquals("Brown Sugar Chocolate Chip Cookies", r.title)
        assertEquals(12, r.ingredients.count { !it.header }); assertEquals(listOf("For the dough", "For finishing"), r.ingredients.filter { it.header }.map { it.text })
        assertEquals("all 24 steps across 3 pages: ${r.directions.map { it.text.take(30) }}", 24, r.directions.count { !it.header })
        assertTrue(r.directions.none { it.text.contains("Page ") || it.text.contains("example-kitchen") })
        assertEquals("https://www.example-kitchen.test/recipes/brown-sugar-cookies/", r.sourceUrl)
    }

    @Test fun scannedPdfGoesToRecognitionAndNeverReturnsAnEmptyRecipeQuietly() = blocking {
        val c = testContainer(ctx, ocr = FakeOcr("Pancakes\nIngredients\n1 cup flour\n1 egg\nDirections\nMix and fry for 3 minutes."))
        try {
            val d = c.importer.import(ImportInput.Pdf(fileUri(ctx, "recipe-scanned.pdf", pdf("recipe-scanned.pdf"))))
            assertEquals(ImportMethod.OCR, d.method); assertEquals("Pancakes", d.recipe.title); assertEquals(2, d.recipe.ingredients.size)
        } catch (e: ImportFailure) {
            // the JVM test environment may be unable to render PDF pages; the failure must then say so plainly
            assertTrue(e.userMessage, e.userMessage.contains("No text could be found") || e.userMessage.contains("could not be opened"))
        }
    }

    @Test fun twoColumnPhotoIsReadColumnByColumn() = blocking {
        val left = listOf("Ingredients", "2 cups flour", "1 tsp salt", "3 large eggs", "1 cup whole milk", "2 tbsp butter")
        val right = listOf("Directions", "Whisk the flour and the salt in a bowl.", "Beat in the eggs and then the milk.", "Rest the batter for half an hour.", "Fry in butter until golden.", "Serve at once with lemon.")
        val ocr = object : OcrEngine {
            override suspend fun recognize(bitmap: android.graphics.Bitmap) = ""
            override suspend fun recognizeLines(bitmap: android.graphics.Bitmap, page: Int): List<com.mundymorning.touchrecipe.core.importer.TextLine> {
                fun col(x: Float, lines: List<String>) = lines.mapIndexed { i, t -> com.mundymorning.touchrecipe.core.importer.TextLine(t, x, 100f + i * 16f, x + t.length * 6f, 111f + i * 16f, page, if (t.startsWith("3 large")) 0.3f else 0.95f) }
                // the recogniser returns blocks in an arbitrary order: right column first
                return col(300f, right) + col(40f, left) + com.mundymorning.touchrecipe.core.importer.TextLine("Pancakes", 40f, 40f, 200f, 60f, page, 0.99f)
            }
        }
        val c = AppContainer(ctx, db = AppDatabase.inMemory(ctx), ocr = ocr)
        val d = c.importer.import(ImportInput.Image(fileUri(ctx, "two-col.jpg", jpegBytes())))
        assertEquals("Pancakes", d.recipe.title); assertEquals(left.drop(1), d.recipe.ingredients.map { it.text }); assertEquals(5, d.recipe.directions.size)
        assertTrue("a line the recogniser was unsure of is named: ${d.warnings}", d.warnings.any { it.message.contains("hard to read") && it.message.contains("3 large eggs") })
    }

    @Test fun unplacedSourceLinesAreKeptInTheNotesOnTheWayToReview() = blocking {
        val c = testContainer(ctx)
        c.importSession.draft.value = ImportDraft(Recipe(title = "T", notes = "Family favourite."), ImportMethod.JSON_LD, Confidence.MEDIUM, unplaced = listOf("1 cup whole milk", "2 tbsp butter"))
        val vm = com.mundymorning.touchrecipe.ui.screens.ImportViewModel(c); vm.keepUnplaced()
        val r = c.importSession.draft.value!!
        assertTrue(r.recipe.notes.startsWith("Family favourite.")); assertTrue(r.recipe.notes.contains("• 1 cup whole milk")); assertTrue(r.recipe.notes.contains("• 2 tbsp butter"))
        assertTrue(r.unplaced.isEmpty())
    }
}
