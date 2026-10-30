package com.mundymorning.touchrecipe.data

import android.content.Context
import androidx.room.*
import com.mundymorning.touchrecipe.core.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

private val dbJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

@Entity(tableName = "recipes", indices = [Index("favorite"), Index("updatedAt")])
data class RecipeEntity(
    @PrimaryKey val id: String,
    val title: String, val description: String, val notes: String, val photo: String?,
    val sourceUrl: String?, val sourceName: String?, val cuisine: String?,
    val prepMinutes: Int?, val cookMinutes: Int?, val totalMinutes: Int?, val servings: Int?,
    val ingredientsJson: String, val directionsJson: String, val categoryIdsJson: String,
    val favorite: Boolean, val rawSource: String?, val createdAt: Long, val updatedAt: Long,
    val searchText: String,
)

@Entity(tableName = "categories")
data class CategoryEntity(@PrimaryKey val id: String, val name: String, val groupName: String, val builtIn: Boolean, val enabled: Boolean, val sortOrder: Int)

@Entity(tableName = "meal_plan")
data class MealEntity(@PrimaryKey val date: String, val recipeId: String, val servings: Int?)

@Entity(tableName = "grocery_items", indices = [Index("weekStart")])
data class GroceryEntity(
    @PrimaryKey val id: String, val weekStart: String, val name: String, val quantityText: String, val aisle: String,
    val checked: Boolean, val sortIndex: Int, val key: String, val generated: Boolean, val edited: Boolean, val sourcesJson: String,
)

@Entity(tableName = "grocery_aisles")
data class AisleEntity(@PrimaryKey val name: String, val sortOrder: Int)

/** Persisted Cook Mode progress and timer so leaving the screen or process death never loses state. */
@Entity(tableName = "cook_state")
data class CookStateEntity(
    @PrimaryKey val recipeId: String, val stepIndex: Int, val completedJson: String,
    val totalMs: Long, val remainingMs: Long, val endAtMs: Long?, val timerStep: Int, val updatedAt: Long, val finished: Boolean,
)

fun Recipe.toEntity() = RecipeEntity(
    id, title, description, notes, photo, sourceUrl, sourceName, cuisine, prepMinutes, cookMinutes, totalMinutes, servings,
    dbJson.encodeToString(ListSerializer(Ingredient.serializer()), ingredients),
    dbJson.encodeToString(ListSerializer(Direction.serializer()), directions),
    dbJson.encodeToString(ListSerializer(String.serializer()), categoryIds),
    favorite, rawSource, createdAt, updatedAt, searchText,
)

fun RecipeEntity.toModel() = Recipe(
    id, title, description, notes, photo, sourceUrl, sourceName, cuisine, prepMinutes, cookMinutes, totalMinutes, servings,
    runCatching { dbJson.decodeFromString(ListSerializer(Ingredient.serializer()), ingredientsJson) }.getOrDefault(emptyList()),
    runCatching { dbJson.decodeFromString(ListSerializer(Direction.serializer()), directionsJson) }.getOrDefault(emptyList()),
    runCatching { dbJson.decodeFromString(ListSerializer(String.serializer()), categoryIdsJson) }.getOrDefault(emptyList()),
    favorite, rawSource, createdAt, updatedAt,
)

fun CategoryEntity.toModel() = Category(id, name, groupName, builtIn, enabled, sortOrder)
fun Category.toEntity() = CategoryEntity(id, name, group, builtIn, enabled, sortOrder)
fun MealEntity.toModel() = MealEntry(date, recipeId, servings)
fun MealEntry.toEntity() = MealEntity(date, recipeId, servings)
fun GroceryEntity.toModel() = GroceryItem(id, weekStart, name, quantityText, aisle, checked, sortIndex, key, generated, edited,
    runCatching { dbJson.decodeFromString(ListSerializer(SourceRef.serializer()), sourcesJson) }.getOrDefault(emptyList()))
fun GroceryItem.toEntity() = GroceryEntity(id, weekStart, name, quantityText, aisle, checked, sortIndex, key, generated, edited,
    dbJson.encodeToString(ListSerializer(SourceRef.serializer()), sources))

@Dao
interface RecipeDao {
    @Query("SELECT * FROM recipes ORDER BY updatedAt DESC") fun observeAll(): Flow<List<RecipeEntity>>
    @Query("SELECT * FROM recipes WHERE id = :id") fun observe(id: String): Flow<RecipeEntity?>
    @Query("SELECT * FROM recipes WHERE id = :id") suspend fun get(id: String): RecipeEntity?
    @Query("SELECT * FROM recipes") suspend fun all(): List<RecipeEntity>
    @Query("SELECT COUNT(*) FROM recipes") suspend fun count(): Int
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(e: RecipeEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertAll(e: List<RecipeEntity>)
    @Query("DELETE FROM recipes WHERE id = :id") suspend fun delete(id: String)
    @Query("DELETE FROM recipes") suspend fun clear()
    @Query("UPDATE recipes SET favorite = :fav WHERE id = :id") suspend fun setFavorite(id: String, fav: Boolean)
}

@Dao
interface CategoryDao {
    @Query("SELECT * FROM categories ORDER BY builtIn DESC, sortOrder, name") fun observeAll(): Flow<List<CategoryEntity>>
    @Query("SELECT * FROM categories") suspend fun all(): List<CategoryEntity>
    @Query("SELECT COUNT(*) FROM categories") suspend fun count(): Int
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(e: CategoryEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertAll(e: List<CategoryEntity>)
    @Query("DELETE FROM categories WHERE id = :id") suspend fun delete(id: String)
    @Query("DELETE FROM categories") suspend fun clear()
}

@Dao
interface MealDao {
    @Query("SELECT * FROM meal_plan WHERE date >= :from AND date <= :to") fun observeRange(from: String, to: String): Flow<List<MealEntity>>
    @Query("SELECT * FROM meal_plan WHERE date >= :from AND date <= :to") suspend fun range(from: String, to: String): List<MealEntity>
    @Query("SELECT * FROM meal_plan") suspend fun all(): List<MealEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(e: MealEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertAll(e: List<MealEntity>)
    @Query("DELETE FROM meal_plan WHERE date = :date") suspend fun delete(date: String)
    @Query("DELETE FROM meal_plan WHERE recipeId = :recipeId") suspend fun deleteForRecipe(recipeId: String)
    @Query("DELETE FROM meal_plan") suspend fun clear()
}

@Dao
interface GroceryDao {
    @Query("SELECT * FROM grocery_items WHERE weekStart = :week ORDER BY sortIndex, name") fun observeWeek(week: String): Flow<List<GroceryEntity>>
    @Query("SELECT * FROM grocery_items WHERE weekStart = :week ORDER BY sortIndex, name") suspend fun week(week: String): List<GroceryEntity>
    @Query("SELECT * FROM grocery_items") suspend fun all(): List<GroceryEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(e: GroceryEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertAll(e: List<GroceryEntity>)
    @Query("DELETE FROM grocery_items WHERE id = :id") suspend fun delete(id: String)
    @Query("DELETE FROM grocery_items WHERE weekStart = :week") suspend fun clearWeek(week: String)
    @Query("DELETE FROM grocery_items WHERE weekStart = :week AND checked = 1") suspend fun clearChecked(week: String)
    @Query("DELETE FROM grocery_items") suspend fun clear()
    @Query("SELECT * FROM grocery_aisles ORDER BY sortOrder, name") fun observeAisles(): Flow<List<AisleEntity>>
    @Query("SELECT * FROM grocery_aisles ORDER BY sortOrder, name") suspend fun aisles(): List<AisleEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertAisle(e: AisleEntity)
    @Query("DELETE FROM grocery_aisles WHERE name = :name") suspend fun deleteAisle(name: String)
}

@Dao
interface CookDao {
    @Query("SELECT * FROM cook_state WHERE recipeId = :id") suspend fun get(id: String): CookStateEntity?
    @Query("SELECT * FROM cook_state WHERE finished = 0 ORDER BY updatedAt DESC LIMIT 1") suspend fun active(): CookStateEntity?
    @Query("SELECT * FROM cook_state WHERE finished = 0 ORDER BY updatedAt DESC LIMIT 1") fun observeActive(): Flow<CookStateEntity?>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(e: CookStateEntity)
    @Query("DELETE FROM cook_state WHERE recipeId = :id") suspend fun delete(id: String)
    @Query("DELETE FROM cook_state") suspend fun clear()
}

@Database(
    entities = [RecipeEntity::class, CategoryEntity::class, MealEntity::class, GroceryEntity::class, AisleEntity::class, CookStateEntity::class],
    version = 1, exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun recipes(): RecipeDao
    abstract fun categories(): CategoryDao
    abstract fun meals(): MealDao
    abstract fun grocery(): GroceryDao
    abstract fun cook(): CookDao

    companion object {
        fun create(context: Context): AppDatabase =
            Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, "touch_recipe.db").build()
        fun inMemory(context: Context): AppDatabase =
            Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
    }
}
