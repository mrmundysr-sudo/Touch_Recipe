package com.mundymorning.touchrecipe.core.search

import com.mundymorning.touchrecipe.core.model.Category
import com.mundymorning.touchrecipe.core.model.Recipe

enum class Sort(val label: String) {
    RECENT("Recently added"), TITLE("Title A–Z"), QUICKEST("Quickest first"), FAVORITES("Favorites first"), OLDEST("Oldest first")
}

object RecipeSearch {
    /** Every word must match somewhere in: title, ingredients, categories, source, cuisine, description or notes. */
    fun filter(recipes: List<Recipe>, categories: List<Category>, query: String, categoryId: String?, favoritesOnly: Boolean, sort: Sort): List<Recipe> {
        val names = categories.associate { it.id to it.name.lowercase() }
        val words = query.lowercase().split(Regex("""\s+""")).filter { it.isNotEmpty() }
        val filtered = recipes.filter { r ->
            (!favoritesOnly || r.favorite) && (categoryId == null || categoryId in r.categoryIds) &&
                (words.isEmpty() || r.searchText.let { hay ->
                    val cats = r.categoryIds.mapNotNull { names[it] }.joinToString(" ")
                    words.all { w -> hay.contains(w) || cats.contains(w) }
                })
        }
        return when (sort) {
            Sort.RECENT -> filtered.sortedByDescending { it.createdAt }
            Sort.OLDEST -> filtered.sortedBy { it.createdAt }
            Sort.TITLE -> filtered.sortedBy { it.title.lowercase() }
            Sort.QUICKEST -> filtered.sortedWith(compareBy<Recipe> { it.effectiveTotal ?: Int.MAX_VALUE }.thenBy { it.title.lowercase() })
            Sort.FAVORITES -> filtered.sortedWith(compareByDescending<Recipe> { it.favorite }.thenBy { it.title.lowercase() })
        }
    }
}
