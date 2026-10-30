package com.mundymorning.touchrecipe.ui

import android.content.pm.ActivityInfo
import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mundymorning.touchrecipe.core.model.*
import com.mundymorning.touchrecipe.ui.art.ArtManifest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** Static checks on the art manifest: every illustrated object is labelled and has a generous touch region. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class ManifestTest {
    private val manifest = ArtManifest.parse(File("src/main/assets/art/manifest.json").readText())

    @Test fun everyTargetHasLabelHintAndGenerousTouchRegion() {
        val refWidthDp = 360f; val refHeightDp = refWidthDp / manifest.aspect
        val problems = mutableListOf<String>()
        manifest.pages.values.forEach { p ->
            p.targets.forEach { t ->
                if (t.label.isBlank() || t.hint.isBlank()) problems += "${p.key}/${t.id}: missing label or hint"
                val w = t.hit.w * refWidthDp; val h = t.hit.h * refHeightDp
                if (w < 44f || h < 44f) problems += "${p.key}/${t.id}: touch region ${w.toInt()}x${h.toInt()}dp is below 44dp"
            }
            assertEquals("duplicate target ids on ${p.key}", p.targets.size, p.targets.map { it.id }.toSet().size)
        }
        assertTrue(problems.joinToString("\n"), problems.isEmpty())
    }

    @Test fun hubHasExactlyTheSevenSpecifiedObjects() {
        assertEquals(setOf("stove", "calendar", "new_recipe", "search", "grocery", "drawer", "rolodex"), manifest.page("hub").targets.map { it.id }.toSet())
        assertEquals(setOf("back", "settings", "categories", "backup", "themes", "help", "tools", "print"), manifest.page("drawer").targets.map { it.id }.toSet())
        assertTrue("the drawer itself is decorative, not a target", manifest.page("drawer").targets.none { it.id == "drawer" })
    }

    @Test fun hubObjectsDoNotOverlapEachOther() {
        val hub = manifest.page("hub").targets
        for (a in hub) for (b in hub) if (a.id < b.id) {
            val ox = minOf(a.hit.x + a.hit.w, b.hit.x + b.hit.w) - maxOf(a.hit.x, b.hit.x); val oy = minOf(a.hit.y + a.hit.h, b.hit.y + b.hit.h) - maxOf(a.hit.y, b.hit.y)
            if (ox > 0 && oy > 0) assertTrue("${a.id}/${b.id} overlap too much", ox * oy < 0.25f * minOf(a.hit.w * a.hit.h, b.hit.w * b.hit.h))
        }
    }

    @Test fun orientationIsLockedToPortraitForAnIllustratedLayout() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val info = ctx.packageManager.getActivityInfo(android.content.ComponentName(ctx, "com.mundymorning.touchrecipe.MainActivity"), 0)
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, info.screenOrientation)
    }

    @Test fun onlyInternetPermissionIsDeclaredUpFrontAndNoStorageOrCamera() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val perms = ctx.packageManager.getPackageInfo(ctx.packageName, android.content.pm.PackageManager.GET_PERMISSIONS).requestedPermissions!!.toSet()
        assertTrue(perms.containsAll(setOf("android.permission.INTERNET", "android.permission.POST_NOTIFICATIONS")))
        val forbidden = listOf("CAMERA", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "READ_MEDIA", "RECORD_AUDIO", "ACCESS_FINE_LOCATION", "READ_CONTACTS", "MANAGE_EXTERNAL_STORAGE")
        assertTrue("unexpected permissions: $perms", perms.none { p -> forbidden.any { p.contains(it) } })
    }
}

abstract class ResponsiveBase {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    protected val ctx get() = ApplicationProvider.getApplicationContext<android.content.Context>()

    protected fun tour(tag: String) {
        val c = testContainer(ctx)
        val photo = c.photos.saveBytes(jpegBytes())
        runBlocking {
            c.repo.saveRecipe(sampleRecipe("r1", photo = photo, categories = listOf("b_dinner")))
            c.repo.saveRecipe(sampleRecipe("r2", "An extremely long recipe title that goes on and on and on to make sure nothing overflows its card or its page", null).copy(favorite = true, description = "Notes ".repeat(60)))
        }
        c.importSession.draft.value = ImportDraft(sampleRecipe("n1", "Draft"), ImportMethod.HTML, Confidence.LOW, listOf(ImportWarning("directions", "Check.")))
        rule.setContent { TouchRecipeRoot(c) }
        rule.assertPage("Kitchen Hub"); rule.shot("${tag}_hub"); inBounds()
        rule.tapArt("rolodex"); rule.assertPage("Recipe Collection"); rule.waitTag("recipe-card:r1"); rule.shot("${tag}_collection"); inBounds()
        rule.clickTag("recipe-card:r2"); rule.assertPage("An extremely long recipe title that goes on and on and on to make sure nothing overflows its card or its page"); rule.shot("${tag}_detail_long"); inBounds()
        rule.tapArt("back"); rule.clickTag("recipe-card:r1"); rule.assertPage("Spaghetti al Pomodoro"); rule.shot("${tag}_detail"); inBounds()
        rule.tapArt("cook"); rule.waitTag("step-number"); rule.shot("${tag}_cook"); inBounds()
        rule.tapArt("back"); rule.tapArt("back"); rule.backChip(); rule.assertPage("Kitchen Hub")
        rule.tapArt("new_recipe"); rule.assertPage("Import Recipe"); rule.shot("${tag}_import"); inBounds()
        rule.tapArt("continue"); rule.assertPage("Review and save"); rule.shot("${tag}_review"); inBounds()
        rule.tapArt("back"); rule.onNodeWithText("Discard").performClick(); rule.tapArt("back"); rule.tapArt("calendar"); rule.assertPage("Meal Planner"); rule.shot("${tag}_planner"); inBounds()
        rule.backChip(); rule.tapArt("grocery"); rule.assertPage("Grocery List"); rule.shot("${tag}_grocery"); inBounds()
        rule.tapArt("back"); rule.tapArt("drawer"); rule.assertPage("Kitchen Junk Drawer"); rule.shot("${tag}_drawer"); inBounds()
    }

    /** No illustrated control may be pushed off-screen. */
    private fun inBounds() {
        val root = rule.onAllNodes(isRoot()).onFirst().fetchSemanticsNode().boundsInRoot
        rule.onAllNodes(SemanticsMatcher("art target") { true }, useUnmergedTree = true).fetchSemanticsNodes().filter { n -> n.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.TestTag)?.startsWith("art:") == true }.forEach { n ->
            val b = n.boundsInRoot
            assertTrue("${n.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.TestTag)} escapes the screen: $b vs $root", b.left >= root.left - 1 && b.top >= root.top - 1 && b.right <= root.right + 1 && b.bottom <= root.bottom + 1)
        }
    }
}

@RunWith(AndroidJUnit4::class) @GraphicsMode(GraphicsMode.Mode.NATIVE) @Config(sdk = [34], qualifiers = "w320dp-h568dp-mdpi")
class SmallScreenTest : ResponsiveBase() { @Test fun tour() = tour("small") }

@RunWith(AndroidJUnit4::class) @GraphicsMode(GraphicsMode.Mode.NATIVE) @Config(sdk = [34], qualifiers = "w800dp-h1280dp-xhdpi")
class TabletTest : ResponsiveBase() { @Test fun tour() = tour("tablet") }

@RunWith(AndroidJUnit4::class) @GraphicsMode(GraphicsMode.Mode.NATIVE) @Config(sdk = [34], qualifiers = "w360dp-h800dp-night-xxhdpi")
class DarkModeTest : ResponsiveBase() { @Test fun tour() = tour("dark") }

@RunWith(AndroidJUnit4::class) @GraphicsMode(GraphicsMode.Mode.NATIVE) @Config(sdk = [34], qualifiers = "w360dp-h800dp-xxhdpi", fontScale = 2.0f)
class LargeFontTest : ResponsiveBase() { @Test fun tour() = tour("font200") }
