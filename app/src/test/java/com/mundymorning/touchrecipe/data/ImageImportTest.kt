package com.mundymorning.touchrecipe.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import androidx.compose.ui.geometry.Offset
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mundymorning.touchrecipe.core.image.Pt
import com.mundymorning.touchrecipe.core.image.Quad
import com.mundymorning.touchrecipe.core.model.Severity
import com.mundymorning.touchrecipe.core.model.SourceKind
import com.mundymorning.touchrecipe.ui.FakeOcr
import com.mundymorning.touchrecipe.ui.fileUri
import com.mundymorning.touchrecipe.ui.screens.moveCorner
import com.mundymorning.touchrecipe.ui.testContainer
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream
import kotlin.math.abs

/**
 * Photographed recipes through the real Android imaging code (specification sections 5 and 6): the card is straightened and
 * cropped, the dish photo is cut out as the cover, and the photo as taken is kept byte for byte. The pictures are drawn for
 * the test; real cards, lighting and handwriting are a device test.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class ImageImportTest {
    private val ctx: Context get() = ApplicationProvider.getApplicationContext()
    private val paper = Color.rgb(236, 230, 214); private val table = Color.rgb(52, 38, 30)
    private val recipeText = "Card Cookies\nIngredients\n1 cup flour\n1 egg\nDirections\nMix and bake for 10 minutes."
    private fun jpeg(b: Bitmap) = ByteArrayOutputStream().also { b.compress(Bitmap.CompressFormat.JPEG, 95, it) }.toByteArray()
    private fun lum(c: Int) = (Color.red(c) * 299 + Color.green(c) * 587 + Color.blue(c) * 114) / 1000
    private fun Canvas.textLines(x0: Float, x1: Float, y0: Float, y1: Float) { val p = Paint().apply { color = Color.rgb(40, 40, 40) }; var y = y0; while (y < y1) { drawRect(x0, y, x1, y + 5f, p); y += 26f } }

    /** A light card lying askew on a dark table. */
    private fun cardOnTable(): Bitmap = Bitmap.createBitmap(900, 700, Bitmap.Config.ARGB_8888).also { b ->
        val c = Canvas(b); c.drawColor(table)
        c.drawPath(Path().apply { moveTo(150f, 90f); lineTo(760f, 140f); lineTo(720f, 600f); lineTo(110f, 540f); close() }, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = paper })
    }

    /** A cookbook page that fills the frame: text, a colour photograph of the dish, more text. */
    private fun pageWithDish(): Bitmap = Bitmap.createBitmap(800, 1000, Bitmap.Config.ARGB_8888).also { b ->
        val c = Canvas(b); c.drawColor(paper)
        c.textLines(60f, 740f, 40f, 120f)
        for (x in 100 until 700 step 20) c.drawRect(x.toFloat(), 150f, x + 20f, 480f, Paint().apply { color = Color.rgb(150 + x % 90, 70 + (x / 7) % 60, 30) })
        c.textLines(60f, 740f, 520f, 960f)
    }

    @Test fun photographedCardIsStraightenedAndTheOriginalIsKeptUntouched() = runBlocking {
        val c = testContainer(ctx, ocr = FakeOcr(recipeText)); val bytes = jpeg(cardOnTable())
        val d = c.importer.import(ImportInput.Image(fileUri(ctx, "card.jpg", bytes)))
        assertEquals(SourceKind.IMAGE, d.source.kind); assertEquals("Card Cookies", d.recipe.title)
        assertEquals("the photo as taken, byte for byte", bytes.size.toLong(), c.originals.file(d.source.files.single()).length())
        val cleanedName = d.source.cleaned.single(); assertTrue("a separate straightened page is stored", cleanedName.isNotBlank() && c.originals.exists(cleanedName) && cleanedName != d.source.files.single())
        val cleaned = BitmapFactory.decodeFile(c.originals.file(cleanedName).path)
        assertTrue("about the card's own size, not the whole photo: ${cleaned.width}x${cleaned.height}", abs(cleaned.width - 612) < 40 && abs(cleaned.height - 462) < 40)
        // every corner of the result is card, no table left in the picture
        listOf(8 to 8, cleaned.width - 9 to 8, 8 to cleaned.height - 9, cleaned.width - 9 to cleaned.height - 9, cleaned.width / 2 to cleaned.height / 2).forEach { (x, y) -> assertTrue("pixel $x,$y is paper", lum(cleaned.getPixel(x, y)) > 170) }
        assertTrue(d.warnings.any { it.field == "photo" && it.message.contains("straightened") && it.severity == Severity.INFO })
        assertNull("a card with no picture on it gets no invented cover", d.suggestedPhoto); assertNull(d.source.dishPhoto)
    }

    @Test fun dishPhotoOnAPageBecomesTheCoverAndAllThreePicturesAreSeparate() = runBlocking {
        val c = testContainer(ctx, ocr = FakeOcr(recipeText)); val bytes = jpeg(pageWithDish())
        val d = c.importer.import(ImportInput.Image(fileUri(ctx, "page.jpg", bytes)))
        assertEquals(bytes.size.toLong(), c.originals.file(d.source.files.single()).length())
        assertTrue("the page fills the frame, so nothing is cropped away", d.source.cleaned.isEmpty())
        val cover = d.suggestedPhoto; assertNotNull("the dish photograph is offered as the cover", cover)
        val pic = BitmapFactory.decodeFile(c.photos.file(cover!!).path)
        assertTrue("only the photograph, without the text around it: ${pic.width}x${pic.height}", abs(pic.width - 600) < 50 && abs(pic.height - 330) < 50)
        val mid = pic.getPixel(pic.width / 2, pic.height / 2); assertTrue("it is the coloured picture", Color.red(mid) - Color.blue(mid) > 60)
        val kept = d.source.dishPhoto; assertTrue("and it is also kept with the originals as its own file", kept != null && c.originals.exists(kept) && kept != d.source.files.single())
        assertTrue(d.warnings.any { it.field == "photo" && it.message.contains("cover") })
        assertEquals("page, dish photo: independent files", 2, d.source.allFiles.distinct().size)
    }

    @Test fun manualCornersStraightenAnyFourSidedArea() {
        val photo = cardOnTable()
        val out = PageImageTools.warp(photo, Quad(Pt(150f / 900, 90f / 700), Pt(760f / 900, 140f / 700), Pt(720f / 900, 600f / 700), Pt(110f / 900, 540f / 700)))
        assertTrue(abs(out.width - 612) < 12 && abs(out.height - 462) < 12)
        assertTrue(lum(out.getPixel(4, 4)) > 200 && lum(out.getPixel(out.width - 5, out.height - 5)) > 200)
        assertEquals("the photo passed in is not changed", table, photo.getPixel(5, 5))
        val found = PageImageTools.findDocument(photo); assertNotNull(found)
        assertTrue(abs(found!!.tl.x * 900 - 150) < 12 && abs(found.br.y * 700 - 600) < 12)
        val bright = PageImageTools.enhance(Bitmap.createBitmap(200, 200, Bitmap.Config.ARGB_8888).also { b -> Canvas(b).apply { drawColor(Color.rgb(170, 165, 150)); drawRect(0f, 90f, 200f, 110f, Paint().apply { color = Color.rgb(70, 70, 70) }) } }, sharpen = true)
        assertTrue("dull paper becomes white, ink stays dark", lum(bright.getPixel(100, 30)) > 225 && lum(bright.getPixel(100, 100)) < 60)
        assertEquals(90, PageImageTools.rotate(Bitmap.createBitmap(90, 40, Bitmap.Config.ARGB_8888), 90).height)
    }

    @Test fun cropCornersMoveFreelyOrAsARectangle() {
        val full = listOf(Offset(0f, 0f), Offset(1f, 0f), Offset(1f, 1f), Offset(0f, 1f))
        val free = moveCorner(full, 0, 0.2f, 0.1f, rectangle = false)
        assertEquals(Offset(0.2f, 0.1f), free[0]); assertEquals(full.drop(1), free.drop(1))
        val rect = moveCorner(full, 0, 0.2f, 0.1f, rectangle = true)
        assertEquals(listOf(Offset(0.2f, 0.1f), Offset(1f, 0.1f), Offset(1f, 1f), Offset(0.2f, 1f)), rect)
        assertEquals(listOf(Offset(0f, 0f), Offset(0.7f, 0f), Offset(0.7f, 0.6f), Offset(0f, 0.6f)), moveCorner(full, 2, -0.3f, -0.4f, rectangle = true))
        assertEquals("a corner cannot leave the picture", Offset(0f, 0f), moveCorner(full, 0, -5f, -5f, rectangle = false)[0])
    }
}
