package com.mundymorning.touchrecipe.core

import com.mundymorning.touchrecipe.core.importer.WebRecipeExtractor
import com.mundymorning.touchrecipe.core.model.Severity
import kotlinx.serialization.json.*
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File
import java.text.Normalizer

/**
 * Measures the web importer on real saved recipe pages: the test corpus of the open-source recipe-scrapers project
 * (MIT), about 1,100 pages from about 650 sites, each with a maintained expected result.
 *
 * The pages are third-party content and are not stored in this repository. CI clones the corpus at a pinned commit and
 * sets TR_CORPUS_DIR to its `tests/test_data` folder; without it the test is skipped. The floors below are a little
 * under the measured results (see docs/TESTING.md) so that any real regression fails the build. They are a
 * measurement on saved pages, not a promise about live sites.
 */
class RealPageBenchmarkTest {
    private fun norm(s: String?) = Normalizer.normalize((s ?: "").lowercase().replace("&amp;", "&").replace(Regex("\\bteaspoons?\\b"), "tsp").replace(Regex("\\btablespoons?\\b"), "tbsp"), Normalizer.Form.NFKD)
        .replace(Regex("[^a-z0-9 ]+"), " ").replace(Regex("\\s+"), " ").trim()
    private fun toks(s: String?) = norm(s).split(' ').filter { it.isNotEmpty() && !it.all(Char::isDigit) }
    private fun squash(s: String?) = norm(s?.replace("(s)", "s")?.replace("(es)", "es")).replace(" ", "")
    private fun sim(a: String?, b: String?): Double {
        val qa = squash(a); val qb = squash(b)
        if (qa.isNotEmpty() && (qa == qb || qa.trimEnd('s') == qb.trimEnd('s'))) return 1.0
        if (qa.length >= 6 && qb.length >= 6 && (qa.contains(qb) || qb.contains(qa)) && minOf(qa.length, qb.length) >= 0.7 * maxOf(qa.length, qb.length)) return 0.9
        val x = toks(a).toSet(); val y = toks(b).toSet()
        if (x.isEmpty() || y.isEmpty()) return if (norm(a) == norm(b)) 1.0 else 0.0
        return x.count { it in y }.toDouble() / maxOf(x.size, y.size)
    }
    private class Match(val recall: Double, val precision: Double, val ordered: Boolean)
    private fun match(exp: List<String>, got: List<String>): Match {
        val used = HashSet<Int>(); val idx = ArrayList<Int>()
        for (e in exp) { var best = -1; var bs = 0.0; got.forEachIndexed { j, g -> if (j !in used) { val s = sim(e, g); if (s > bs) { bs = s; best = j } } }; if (bs >= 0.6) { used += best; idx += best } }
        return Match(if (exp.isEmpty()) 1.0 else idx.size.toDouble() / exp.size, if (got.isEmpty()) 1.0 else used.size.toDouble() / got.size, idx.zipWithNext().all { it.first < it.second })
    }

    @Test fun realPagesStayAboveTheMeasuredFloors() {
        val dir = (System.getenv("TR_CORPUS_DIR") ?: System.getProperty("tr.corpus.dir")).orEmpty()
        Assume.assumeTrue("set TR_CORPUS_DIR to recipe-scrapers/tests/test_data to run the real-page benchmark", dir.isNotEmpty() && File(dir).isDirectory)
        var n = 0; var complete = 0; var major = 0; var silentMajor = 0; var incomplete = 0; var silent = 0; var orderOk = 0; var lowPrecision = 0; var crashed = 0
        for (host in File(dir).listFiles()!!.filter { it.isDirectory }.sortedBy { it.name }) for (f in host.listFiles()!!.filter { it.name.endsWith(".testhtml") }.sortedBy { it.name }) {
            val exp = runCatching { Json.parseToJsonElement(File(host, f.name.removeSuffix(".testhtml") + ".json").readText()).jsonObject }.getOrNull() ?: continue
            val expIng = (exp["ingredients"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: continue
            val expSteps = (exp["instructions_list"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: (exp["instructions"] as? JsonPrimitive)?.content?.split("\n")?.filter { it.isNotBlank() } ?: emptyList()
            if (expIng.isEmpty() || expSteps.isEmpty()) continue
            n++
            val d = try { WebRecipeExtractor.extract(f.readText(), (exp["canonical_url"] as? JsonPrimitive)?.content ?: "https://${host.name}/") } catch (e: Throwable) { crashed++; major++; incomplete++; continue }
            val ing = d.recipe.ingredients.filter { !it.header }.map { it.text }; val steps = d.recipe.directions.filter { !it.header }.map { it.text }
            val mi = match(expIng, ing); val et = toks(expSteps.joinToString(" ")); val got = toks(steps.joinToString(" ")).toSet()
            val cover = if (et.isEmpty()) 1.0 else et.count { it in got }.toDouble() / et.size
            val warned = d.warnings.any { it.severity != Severity.INFO }
            val ok = mi.recall >= 0.999 && cover >= 0.95; val bad = mi.recall < 0.7 || cover < 0.7
            if (ok) complete++ else { incomplete++; if (!warned) silent++ }
            if (bad) { major++; if (!warned) silentMajor++ }
            if (mi.ordered) orderOk++
            if (ing.isNotEmpty() && mi.precision < 0.8) lowPrecision++
        }
        fun pct(k: Int) = 100.0 * k / n
        println("REAL-PAGE BENCHMARK pages=$n complete=${"%.1f".format(pct(complete))}% majorLoss=${"%.1f".format(pct(major))}% silentMajorLoss=${"%.1f".format(pct(silentMajor))}% " +
            "incomplete=$incomplete silentIncomplete=$silent ingredientOrderOk=${"%.1f".format(pct(orderOk))}% extraLines=${"%.1f".format(pct(lowPrecision))}% crashed=$crashed")
        assertTrue("corpus looks incomplete: $n pages", n >= 900)
        assertTrue("no page may crash the importer ($crashed did)", crashed == 0)
        assertTrue("complete imports fell to ${pct(complete)}%", pct(complete) >= 89.5)
        assertTrue("major losses rose to ${pct(major)}%", pct(major) <= 6.2)
        assertTrue("major losses with no warning rose to ${pct(silentMajor)}%", pct(silentMajor) <= 1.2)
        assertTrue("ingredient order kept on only ${pct(orderOk)}%", pct(orderOk) >= 98.5)
        assertTrue("pages with extra or unmatched ingredient lines rose to ${pct(lowPrecision)}%", pct(lowPrecision) <= 5.0)
    }
}
