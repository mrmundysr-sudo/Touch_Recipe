package com.mundymorning.touchrecipe.core

import com.mundymorning.touchrecipe.core.image.*
import com.mundymorning.touchrecipe.core.importer.ImageCandidates
import com.mundymorning.touchrecipe.core.importer.WebRecipeExtractor
import org.jsoup.Jsoup
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.abs

/** Recipe photographs (specification sections 4 to 6): the right picture from a web page, a card's corners, the dish photo on a page. */
class RecipeImagesTest {
    // ---- synthetic pictures: enough to state the rules exactly; real photographs are a device test ----
    private fun canvas(w: Int, h: Int, color: Int) = IntArray(w * h) { color }
    private fun rgb(r: Int, g: Int, b: Int) = (255 shl 24) or (r shl 16) or (g shl 8) or b
    private fun IntArray.rect(w: Int, x0: Int, y0: Int, x1: Int, y1: Int, color: (Int, Int) -> Int) { for (y in y0 until y1) for (x in x0 until x1) this[y * w + x] = color(x, y) }
    /** Fills a four-sided shape given by its corners (convex), by testing each pixel against the four edges. */
    private fun IntArray.quad(w: Int, h: Int, pts: List<Pair<Int, Int>>, color: Int) {
        for (y in 0 until h) for (x in 0 until w) {
            var inside = true
            for (i in 0 until 4) { val (ax, ay) = pts[i]; val (bx, by) = pts[(i + 1) % 4]; if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) { inside = false; break } }
            if (inside) this[y * w + x] = color
        }
    }
    private fun IntArray.textLines(w: Int, x0: Int, x1: Int, y0: Int, y1: Int) { var y = y0; while (y < y1) { for (x in x0 until x1) if ((x / 7) % 5 != 4) { this[y * w + x] = rgb(40, 40, 40); this[(y + 1) * w + x] = rgb(40, 40, 40) }; y += 9 } }
    private val paper = rgb(236, 230, 214)

    @Test fun cardOnADarkTableIsFoundEvenWhenPhotographedAtAnAngle() {
        val w = 300; val h = 220; val img = canvas(w, h, rgb(52, 38, 30))
        val corners = listOf(60 to 30, 250 to 48, 236 to 190, 44 to 168)
        img.quad(w, h, corners, paper)
        val q = DocumentFinder.find(Pixels(w, h, img))
        assertNotNull("a clear card must be found", q); q!!
        corners.zip(q.points).forEach { (c, p) -> assertTrue("corner $c found near ${p.x * w},${p.y * h}", abs(p.x * w - c.first) <= 5 && abs(p.y * h - c.second) <= 5) }
        assertTrue(q.confidence > 0.85f)
    }

    @Test fun noCropIsOfferedWhenThePageFillsThePictureOrNothingStandsOut() {
        val w = 300; val h = 220
        val full = canvas(w, h, paper).also { it.textLines(w, 20, 280, 30, 200) }
        assertNull("the page already fills the frame", DocumentFinder.find(Pixels(w, h, full)))
        assertNull("a flat picture gives nothing to go on", DocumentFinder.find(Pixels(w, h, canvas(w, h, rgb(120, 120, 120)))))
        // a light blob that is not four-sided (an L shape) is not presented as a card
        val blob = canvas(w, h, rgb(40, 40, 40)).also { it.rect(w, 40, 30, 260, 90) { _, _ -> paper }; it.rect(w, 40, 90, 110, 200) { _, _ -> paper } }
        assertNull(DocumentFinder.find(Pixels(w, h, blob)))
    }

    @Test fun dishPhotoOnACookbookPageIsCutOutWithoutTheText() {
        val w = 240; val h = 320; val img = canvas(w, h, paper)
        img.textLines(w, 16, 224, 14, 40)                       // title lines
        img.rect(w, 30, 54, 210, 164) { x, y -> rgb(150 + (x % 60), 70 + (y % 50), 30 + ((x + y) % 40)) }   // the photograph
        img.textLines(w, 16, 224, 180, 306)                     // ingredients and method
        val r = PhotoRegionFinder.find(Pixels(w, h, img))
        assertNotNull(r); r!!
        assertTrue("left ${r.left * w}", abs(r.left * w - 30) <= 7); assertTrue("top ${r.top * h}", abs(r.top * h - 54) <= 7)
        assertTrue("right ${r.right * w}", abs(r.right * w - 210) <= 7); assertTrue("bottom ${r.bottom * h}", abs(r.bottom * h - 164) <= 7)
        assertTrue("a clean single photograph is a confident find", r.confidence > 0.7f)
    }

    @Test fun blackAndWhitePhotoOnYellowedPaperIsStillFoundAndTextAloneIsNot() {
        val w = 240; val h = 320; val old = rgb(226, 205, 150)   // yellowed card: the paper itself is "coloured"
        val img = canvas(w, h, old).also { it.textLines(w, 16, 224, 14, 150); it.rect(w, 60, 170, 190, 290) { x, y -> val v = 60 + ((x * 3 + y * 2) % 90); rgb(v, v, v) } }
        val r = PhotoRegionFinder.find(Pixels(w, h, img))
        assertNotNull(r); assertTrue(abs(r!!.top * h - 170) <= 7 && abs(r.bottom * h - 290) <= 7)
        val onlyText = canvas(w, h, old).also { it.textLines(w, 16, 224, 14, 300) }
        assertNull("a handwritten card with no picture gets no invented cover", PhotoRegionFinder.find(Pixels(w, h, onlyText)))
    }

    @Test fun aPlainPhotographIsNotMistakenForAPageAndTwoPicturesLowerTheConfidence() {
        val w = 240; val h = 320
        val photo = IntArray(w * h) { i -> val x = i % w; val y = i / w; rgb(90 + (x * 7 + y * 3) % 150, 40 + (x * 5 + y * 11) % 170, 20 + (x * 13 + y * 5) % 120) }
        assertNull(PhotoRegionFinder.find(Pixels(w, h, photo)))
        val two = canvas(w, h, paper).also { it.rect(w, 20, 20, 220, 130) { x, _ -> rgb(180, 60 + x % 40, 30) }; it.textLines(w, 16, 224, 140, 180); it.rect(w, 30, 196, 200, 300) { _, y -> rgb(40, 120 + y % 40, 60) } }
        val r = PhotoRegionFinder.find(Pixels(w, h, two))
        assertTrue("two pictures: either none, or one offered as uncertain", r == null || r.confidence < 0.6f)
    }

    @Test fun levelsBrightenADullScanAndLeaveAGoodOneAlone() {
        val w = 100; val h = 100
        val dull = IntArray(w * h) { i -> if ((i / w) % 10 == 0) rgb(70, 70, 70) else rgb(170, 165, 150) }
        val (scale, offset) = Levels.auto(Pixels(w, h, dull))
        assertTrue(scale > 1.5f); assertTrue("ink goes towards black", 70 * scale + offset < 30); assertTrue("paper goes towards white", 165 * scale + offset > 230)
        assertEquals(1f to 0f, Levels.auto(Pixels(w, h, canvas(w, h, rgb(128, 128, 128)))))
    }

    // ---- web pages ----
    private fun rank(html: String, structured: List<String> = emptyList()) = ImageCandidates.rank(Jsoup.parse(html, "https://www.example.com/r/stew"), structured, "https://www.example.com/r/stew")

    @Test fun recipeDataImageComesFirstThenThePageImageThenRecipePictures() {
        val html = """<html><head><meta property="og:image" content="/img/og-stew.jpg"></head><body><article>
            <img src="/img/logo.png" width="300" height="80"><img src="/img/step1.jpg" width="800" height="600"><img data-lazy-src="/img/step2.jpg" src="data:image/gif;base64,AAAA" width="800" height="600"></article></body></html>"""
        assertEquals(listOf("https://cdn.example.com/stew-main.jpg", "https://www.example.com/img/og-stew.jpg", "https://www.example.com/img/step1.jpg", "https://www.example.com/img/step2.jpg"), rank(html, listOf("https://cdn.example.com/stew-main.jpg")))
    }

    @Test fun logosAvatarsAdvertsIconsAndPixelsAreNeverChosen() {
        val html = """<html><body><main>
            <img src="https://ads.example.net/banner-728.jpg" width="728" height="90"><img src="/wp-content/uploads/site-logo.png"><img src="https://secure.gravatar.com/avatar/abc.jpg" width="96" height="96">
            <img src="/pixel.gif" width="1" height="1"><img src="/img/pinterest-share.png"><div class="comments"><img src="/img/reader-photo.jpg" width="600" height="400"></div>
            <div class="related-posts"><img src="/img/other-recipe.jpg" width="600" height="400"></div><img src="/img/icon.svg">
            <img srcset="/img/stew-400.jpg 400w, /img/stew-1200.jpg 1200w" src="/img/stew-400.jpg" width="1200" height="800"></main></body></html>"""
        assertEquals("only the dish, in its largest size", listOf("https://www.example.com/img/stew-1200.jpg"), rank(html))
    }

    @Test fun pageWithoutRecipeDataStillGetsItsPhotoAndAPageWithNoneSaysSo() {
        val page = """<html><head><title>Stew</title></head><body><h1>Stew</h1><img src="/img/stew.jpg" width="900" height="600"><h2>Ingredients</h2><ul><li>2 lb beef</li><li>1 onion</li></ul><h2>Method</h2><ol><li>Brown the beef well in a heavy pot.</li><li>Add the onion and simmer for 2 hours.</li></ol></body></html>"""
        val d = WebRecipeExtractor.extract(page, "https://www.example.com/r/stew")
        assertEquals(listOf("https://www.example.com/img/stew.jpg"), d.imageCandidates)
        val none = WebRecipeExtractor.extract(page.replace("""<img src="/img/stew.jpg" width="900" height="600">""", ""), "https://www.example.com/r/stew")
        assertTrue(none.imageCandidates.isEmpty()); assertTrue(none.warnings.any { it.field == "photo" })
    }
}
