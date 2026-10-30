package com.mundymorning.touchrecipe.data

import com.mundymorning.touchrecipe.core.categories.*
import com.mundymorning.touchrecipe.core.grocery.*
import com.mundymorning.touchrecipe.core.model.*
import com.mundymorning.touchrecipe.core.timer.CookTimer
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import java.time.LocalDate

class Repository(val db: AppDatabase, private val clock: () -> Long = System::currentTimeMillis) {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- recipes ----
    fun recipes(): Flow<List<Recipe>> = db.recipes().observeAll().map { l -> l.map { it.toModel() } }
    fun recipe(id: String): Flow<Recipe?> = db.recipes().observe(id).map { it?.toModel() }
    suspend fun getRecipe(id: String): Recipe? = db.recipes().get(id)?.toModel()
    suspend fun recipeCount() = db.recipes().count()

    suspend fun saveRecipe(r: Recipe): Recipe {
        val now = clock()
        val existing = db.recipes().get(r.id)
        val saved = r.copy(createdAt = existing?.createdAt ?: r.createdAt.takeIf { it > 0 } ?: now, updatedAt = now)
        db.recipes().upsert(saved.toEntity())
        return saved
    }

    suspend fun deleteRecipe(id: String): Recipe? {
        val r = getRecipe(id)
        db.recipes().delete(id); db.meals().deleteForRecipe(id); db.cook().delete(id)
        return r
    }

    /** Restores a recipe removed by [deleteRecipe] (undo). Meal-plan entries are not restored. */
    suspend fun restoreRecipe(r: Recipe) { db.recipes().upsert(r.toEntity()) }

    suspend fun setFavorite(id: String, fav: Boolean) = db.recipes().setFavorite(id, fav)

    suspend fun updateIngredients(id: String, f: (List<Ingredient>) -> List<Ingredient>) {
        val r = getRecipe(id) ?: return
        db.recipes().upsert(r.copy(ingredients = f(r.ingredients)).toEntity())   // keeps updatedAt: checking boxes isn't an edit
    }

    // ---- categories ----
    fun categories(): Flow<List<Category>> = db.categories().observeAll().map { l -> l.map { it.toModel() } }
    suspend fun ensureSeeded() { if (db.categories().count() == 0) db.categories().upsertAll(CategoryCatalog.seed().map { it.toEntity() }) }

    suspend fun addCustomCategory(name: String): CategoryResult {
        val all = db.categories().all().map { it.toModel() }
        val v = CategoryRules.validateNew(name, all)
        if (v is CategoryResult.Ok) {
            val order = (all.maxOfOrNull { it.sortOrder } ?: 0) + 1
            db.categories().upsert(CategoryEntity("c_" + newId().take(8), v.name, "Custom", false, true, order))
        }
        return v
    }

    /** Creates the category and returns its id (for attaching to the recipe being edited). */
    suspend fun addCustomCategoryReturningId(name: String): Pair<CategoryResult, String?> {
        val all = db.categories().all().map { it.toModel() }
        val v = CategoryRules.validateNew(name, all)
        if (v !is CategoryResult.Ok) return v to null
        val id = "c_" + newId().take(8)
        val order = (all.maxOfOrNull { it.sortOrder } ?: 0) + 1
        db.categories().upsert(CategoryEntity(id, v.name, "Custom", false, true, order))
        return v to id
    }

    suspend fun setCategoryEnabled(id: String, enabled: Boolean) {
        val c = db.categories().all().firstOrNull { it.id == id } ?: return
        db.categories().upsert(c.copy(enabled = enabled))
    }

    suspend fun renameCategory(id: String, name: String): CategoryResult {
        val all = db.categories().all()
        val c = all.firstOrNull { it.id == id } ?: return CategoryResult.Rejected("Category not found.")
        if (c.builtIn) return CategoryResult.Rejected("Built-in categories can't be renamed. Turn them off instead.")
        val v = CategoryRules.validateRename(id, name, all.map { it.toModel() })
        if (v is CategoryResult.Ok) db.categories().upsert(c.copy(name = v.name))
        return v
    }

    /** Deleting a custom category removes it from every recipe that used it (recipes themselves are kept). */
    suspend fun deleteCustomCategory(id: String): Int {
        val c = db.categories().all().firstOrNull { it.id == id } ?: return 0
        if (c.builtIn) return 0
        var affected = 0
        db.recipes().all().forEach { e ->
            val m = e.toModel()
            if (id in m.categoryIds) { affected++; db.recipes().upsert(m.copy(categoryIds = m.categoryIds - id).toEntity()) }
        }
        db.categories().delete(id)
        return affected
    }

    suspend fun recipesUsingCategory(id: String): Int = db.recipes().all().count { id in it.toModel().categoryIds }

    // ---- meal plan ----
    fun meals(from: LocalDate, to: LocalDate): Flow<List<MealEntry>> = db.meals().observeRange(from.toString(), to.toString()).map { l -> l.map { it.toModel() } }
    suspend fun mealsFor(from: LocalDate, to: LocalDate) = db.meals().range(from.toString(), to.toString()).map { it.toModel() }
    suspend fun assignMeal(date: LocalDate, recipeId: String, servings: Int?) = db.meals().upsert(MealEntry(date.toString(), recipeId, servings).toEntity())
    suspend fun removeMeal(date: LocalDate) = db.meals().delete(date.toString())

    // ---- grocery ----
    fun groceryItems(week: LocalDate): Flow<List<GroceryItem>> = db.grocery().observeWeek(week.toString()).map { l -> l.map { it.toModel() } }
    fun customAisles(): Flow<List<String>> = db.grocery().observeAisles().map { l -> l.map { it.name } }
    suspend fun addAisle(name: String): Boolean {
        val n = CategoryRules.clean(name)
        val builtin = listOf("Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry", "Bakery")
        if (n.isEmpty() || n.length > 30 || builtin.any { it.equals(n, true) } || db.grocery().aisles().any { it.name.equals(n, true) }) return false
        db.grocery().upsertAisle(AisleEntity(n, db.grocery().aisles().size)); return true
    }
    suspend fun deleteAisle(name: String, week: LocalDate) {
        db.grocery().week(week.toString()).filter { it.aisle == name }.forEach { db.grocery().upsert(it.copy(aisle = AISLE_PANTRY)) }
        db.grocery().deleteAisle(name)
    }

    suspend fun addGroceryItem(week: LocalDate, name: String, qty: String, aisle: String): GroceryItem? {
        val n = name.trim(); if (n.isEmpty()) return null
        val existing = db.grocery().week(week.toString()).map { it.toModel() }
        val key = GroceryEngine.normalizeKey(n)
        // avoid duplicates: same ingredient already listed -> don't add a second line
        existing.firstOrNull { key.isNotEmpty() && GroceryEngine.normalizeKey(it.name) == key && it.aisle == aisle }?.let { return it }
        val item = GroceryItem(weekStart = week.toString(), name = n, quantityText = qty.trim(), aisle = aisle, sortIndex = (existing.maxOfOrNull { it.sortIndex } ?: -1) + 1, edited = true)
        db.grocery().upsert(item.toEntity()); return item
    }
    suspend fun updateGroceryItem(item: GroceryItem) = db.grocery().upsert(item.toEntity())
    suspend fun deleteGroceryItem(id: String) = db.grocery().delete(id)
    suspend fun clearChecked(week: LocalDate): List<GroceryItem> {
        val removed = db.grocery().week(week.toString()).filter { it.checked }.map { it.toModel() }
        db.grocery().clearChecked(week.toString()); return removed
    }
    suspend fun restoreGroceryItems(items: List<GroceryItem>) = db.grocery().upsertAll(items.map { it.toEntity() })

    /** Reorders items within an aisle by rewriting sortIndex for the whole week's list. */
    suspend fun reorderGrocery(week: LocalDate, aisle: String, orderedIds: List<String>) {
        val all = db.grocery().week(week.toString()).map { it.toModel() }
        val others = all.filter { it.aisle != aisle }
        val mine = orderedIds.mapNotNull { id -> all.firstOrNull { it.id == id } }
        (mine + others).forEachIndexed { i, it -> db.grocery().upsert(it.copy(sortIndex = i).toEntity()) }
    }

    /** Builds the week's list from planned meals; returns number of contributing meals. */
    suspend fun generateGroceries(week: LocalDate): Int {
        val meals = mealsFor(week, week.plusDays(6))
        val planned = meals.mapNotNull { m -> getRecipe(m.recipeId)?.let { PlannedMeal(it, m.servings) } }
        val existing = db.grocery().week(week.toString()).map { it.toModel() }
        val merged = GroceryMerge.merge(week.toString(), existing, GroceryEngine.generate(planned))
        db.grocery().clearWeek(week.toString())
        db.grocery().upsertAll(merged.map { it.toEntity() })
        return planned.size
    }

    suspend fun addIngredientsToGroceries(week: LocalDate, recipe: Recipe, servings: Int?, lines: List<Ingredient>? = null): Int {
        val src = recipe.copy(ingredients = lines ?: recipe.ingredients)
        val gen = GroceryEngine.generate(listOf(PlannedMeal(src, servings)))
        val existing = db.grocery().week(week.toString()).map { it.toModel() }
        // keep existing generated items from other recipes; merge this recipe's lines by key
        val byKey = existing.filter { it.key.isNotEmpty() }.associateBy { it.key }
        var next = (existing.maxOfOrNull { it.sortIndex } ?: -1) + 1
        var added = 0
        for (g in gen) {
            val old = byKey[g.key]
            if (old == null) { db.grocery().upsert(GroceryItem(weekStart = week.toString(), name = g.name, quantityText = g.quantityText, aisle = g.aisle, sortIndex = next++, key = g.key, generated = true, sources = g.sources).toEntity()); added++ }
            else if (g.sources.none { s -> old.sources.any { it.recipeId == s.recipeId } }) {
                val q = if (old.edited || old.quantityText.isEmpty()) old.quantityText else combineText(old.quantityText, g.quantityText)
                db.grocery().upsert(old.copy(quantityText = q, sources = old.sources + g.sources).toEntity()); added++
            }
        }
        return added
    }

    private fun combineText(a: String, b: String): String {
        val pa = GroceryEngine.parse(a + " x"); val pb = GroceryEngine.parse(b + " x")
        val qa = pa.quantity; val qb = pb.quantity
        if (qa != null && qb != null && pa.unit?.family == pb.unit?.family && pa.unitText == pb.unitText) {
            val fam = pa.unit?.family ?: Family.COUNT
            val base = qa * (pa.unit?.factor ?: 1.0) + qb * (pb.unit?.factor ?: 1.0)
            val (q, u) = if (fam == Family.COUNT) base to pa.unitText else Units.best(fam, base)
            return com.mundymorning.touchrecipe.core.quantity.Quantities.format(q) + if (u.isNotEmpty()) " $u" else ""
        }
        return "$a + $b"
    }

    // ---- cook mode ----
    data class CookSession(val recipeId: String, val stepIndex: Int, val completed: Set<Int>, val timer: CookTimer, val timerStep: Int, val finished: Boolean)
    private fun CookStateEntity.toSession() = CookSession(recipeId, stepIndex,
        runCatching { json.decodeFromString(ListSerializer(Int.serializer()), completedJson).toSet() }.getOrDefault(emptySet()),
        CookTimer(totalMs, remainingMs, endAtMs), timerStep, finished)

    suspend fun cookSession(recipeId: String): CookSession? = db.cook().get(recipeId)?.toSession()
    suspend fun activeCookSession(): CookSession? = db.cook().active()?.toSession()
    fun observeActiveCook(): Flow<CookSession?> = db.cook().observeActive().map { it?.toSession() }
    suspend fun saveCookSession(s: CookSession) = db.cook().upsert(CookStateEntity(s.recipeId, s.stepIndex,
        json.encodeToString(ListSerializer(Int.serializer()), s.completed.sorted()), s.timer.totalMs, s.timer.remainingMs, s.timer.endAtMs, s.timerStep, clock(), s.finished))
    suspend fun clearCookSession(recipeId: String) = db.cook().delete(recipeId)
}
