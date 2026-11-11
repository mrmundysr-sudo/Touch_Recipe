package com.mundymorning.touchrecipe.core.categories

import com.mundymorning.touchrecipe.core.model.Category

const val MAX_CUSTOM_CATEGORIES = 50
const val MAX_CATEGORY_NAME = 40

object CategoryCatalog {
    /** The short set shown in the normal picker (DEC-011). */
    val starter = listOf("Breakfast", "Lunch", "Dinner", "Appetizers", "Main Dishes", "Side Dishes", "Snacks", "Desserts", "Drinks")

    val groups: List<Pair<String, List<String>>> = listOf(
        "Meal and course" to listOf("Breakfast", "Brunch", "Lunch", "Dinner", "Appetizers", "Main Dishes", "Side Dishes", "Snacks", "Desserts", "Drinks", "Sauces, Dressings and Condiments"),
        "Dish and cooking style" to listOf("Soup and Stew", "Salad", "Pasta and Noodles", "Rice and Grains", "Casserole and Bake", "Sandwich and Wrap", "Pizza and Flatbread", "Tacos and Burritos", "Stir-Fry", "Sheet-Pan Meal", "One-Pot Meal", "Slow Cooker", "Pressure Cooker", "Air Fryer", "Grilling and BBQ", "Roasting", "No-Cook", "Bread and Rolls", "Cookies and Bars", "Cakes and Cupcakes", "Pies and Tarts", "Preserves and Pickles"),
        "Main ingredient" to listOf("Chicken and Turkey", "Beef", "Pork", "Lamb", "Seafood", "Eggs", "Beans and Lentils", "Tofu and Plant Protein", "Vegetables", "Fruit", "Dairy and Cheese", "Nuts and Seeds"),
        "Cuisine and flavor" to listOf("American", "Southern", "Cajun and Creole", "Italian", "Mexican", "French", "Greek", "Mediterranean", "Spanish", "British and Irish", "German", "Caribbean", "Chinese", "Japanese", "Korean", "Thai", "Vietnamese", "Filipino", "Indian", "Middle Eastern", "North African", "Ethiopian"),
        "Dietary and eating preference" to listOf("Vegetarian", "Vegan", "Pescatarian", "Gluten-Free", "Dairy-Free", "Nut-Free", "Egg-Free", "Low-Carb", "Keto", "Paleo", "High-Protein", "Low-Sodium", "Low-Sugar"),
        "Time, planning and occasion" to listOf("30 Minutes or Less", "Quick and Easy", "Make-Ahead", "Meal Prep", "Freezer-Friendly", "Budget-Friendly", "Family Favorite", "Kid-Friendly", "Comfort Food", "Holiday", "Party", "Potluck", "Special Occasion", "Camping and Outdoors"),
    )

    fun idFor(name: String) = "b_" + name.lowercase().replace(Regex("""[^a-z0-9]+"""), "_").trim('_')

    fun seed(): List<Category> {
        var order = 0
        return groups.flatMap { (group, names) ->
            names.map { Category(idFor(it), it, group, builtIn = true, enabled = it in starter, sortOrder = order++) }
        }
    }
}

sealed interface CategoryResult {
    data class Ok(val name: String) : CategoryResult
    data class Rejected(val reason: String) : CategoryResult
}

object CategoryRules {
    fun clean(name: String) = name.trim().replace(Regex("""\s+"""), " ")

    /** Validates a custom category name against existing categories (case-insensitive, trimmed) and the 50 limit. */
    fun validateNew(name: String, existing: List<Category>): CategoryResult {
        val n = clean(name)
        if (n.isEmpty()) return CategoryResult.Rejected("Type a category name first.")
        if (n.length > MAX_CATEGORY_NAME) return CategoryResult.Rejected("Category names can be up to $MAX_CATEGORY_NAME characters.")
        if (existing.count { !it.builtIn } >= MAX_CUSTOM_CATEGORIES)
            return CategoryResult.Rejected("You have reached the limit of $MAX_CUSTOM_CATEGORIES custom categories. Delete one to add another.")
        val dup = existing.firstOrNull { it.name.equals(n, ignoreCase = true) }
        if (dup != null) return CategoryResult.Rejected("\"${dup.name}\" already exists.")
        return CategoryResult.Ok(n)
    }

    fun validateRename(id: String, name: String, existing: List<Category>): CategoryResult {
        val n = clean(name)
        if (n.isEmpty()) return CategoryResult.Rejected("Category name can't be empty.")
        if (n.length > MAX_CATEGORY_NAME) return CategoryResult.Rejected("Category names can be up to $MAX_CATEGORY_NAME characters.")
        val dup = existing.firstOrNull { it.id != id && it.name.equals(n, ignoreCase = true) }
        if (dup != null) return CategoryResult.Rejected("\"${dup.name}\" already exists.")
        return CategoryResult.Ok(n)
    }
}
