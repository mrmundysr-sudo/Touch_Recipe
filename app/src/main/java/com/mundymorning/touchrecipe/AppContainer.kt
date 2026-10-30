package com.mundymorning.touchrecipe

import android.app.Application
import android.content.Context
import com.mundymorning.touchrecipe.core.model.ImportDraft
import com.mundymorning.touchrecipe.data.*
import com.mundymorning.touchrecipe.ui.art.ArtLoader
import kotlinx.coroutines.flow.MutableStateFlow

/** Holds an import between "Continue to Review" and Save. Nothing here is persisted until the user saves. */
class ImportSession {
    val draft = MutableStateFlow<ImportDraft?>(null)
    var photoFile: String? = null
    fun clear() { draft.value = null; photoFile = null }
}

/** Manual dependency graph; every collaborator can be replaced in tests. */
class AppContainer(
    val context: Context,
    val db: AppDatabase = AppDatabase.create(context),
    val fetcher: PageFetcher = HttpPageFetcher(),
    val ocr: OcrEngine = MlKitOcr(),
    val prefs: Prefs = Prefs(context),
    val clock: () -> Long = System::currentTimeMillis,
) {
    val repo = Repository(db, clock)
    val photos = PhotoStore(context)
    val art = ArtLoader(context)
    val importer = ImportService(context, fetcher, ocr, photos)
    val backup = BackupManager(context, repo, photos, prefs)
    val importSession = ImportSession()
    /** The week shown by both the Meal Planner and the Grocery List. */
    val selectedWeek = MutableStateFlow(com.mundymorning.touchrecipe.core.planner.Planner.weekStart(java.time.LocalDate.now(), if (prefs.sundayStart.value) java.time.DayOfWeek.SUNDAY else java.time.DayOfWeek.MONDAY))
    /** Content handed over by the Android share sheet, consumed by the Import screen. */
    val pendingShare = MutableStateFlow<ImportInput?>(null)
}

class TouchRecipeApplication : Application() {
    val container by lazy { AppContainer(this) }
}
