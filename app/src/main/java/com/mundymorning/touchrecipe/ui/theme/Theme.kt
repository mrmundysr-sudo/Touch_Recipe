package com.mundymorning.touchrecipe.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.*
import androidx.compose.ui.unit.sp
import com.mundymorning.touchrecipe.R
import com.mundymorning.touchrecipe.data.ThemeMode

object Palette {
    val Forest = Color(0xFF1F4D3A)
    val ForestDeep = Color(0xFF143426)
    val Cream = Color(0xFFF6EBD6)
    val CreamDeep = Color(0xFFE9D8B7)
    val Tomato = Color(0xFFC63D22)       // contrast on cream >= 4.5:1 for text
    val TomatoBright = Color(0xFFE2572F)
    val Brass = Color(0xFFB58A3C)
    val Wood = Color(0xFF6B4423)
    val Ink = Color(0xFF2A2118)          // text printed on the (always light) parchment artwork
    val Parchment = Color(0xFFF3EBDB)
}

@OptIn(ExperimentalTextApi::class)
private fun variable(res: Int, w: Int) = Font(res, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))

val DisplayFont = FontFamily(variable(R.font.playfair_display, 400), variable(R.font.playfair_display, 600), variable(R.font.playfair_display, 700))
val BodyFont = FontFamily(variable(R.font.source_sans_3, 400), variable(R.font.source_sans_3, 600), variable(R.font.source_sans_3, 700))

private val LightColors = lightColorScheme(
    primary = Palette.Forest, onPrimary = Palette.Cream, secondary = Palette.Tomato, onSecondary = Color.White,
    tertiary = Palette.Brass, background = Palette.Cream, onBackground = Palette.Ink,
    surface = Color(0xFFFBF4E6), onSurface = Palette.Ink, surfaceVariant = Palette.CreamDeep, onSurfaceVariant = Color(0xFF50443A),
    outline = Color(0xFF7A6A58), error = Color(0xFFB3261E),
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFF8FD1AE), onPrimary = Color(0xFF0C2A1D), secondary = Color(0xFFFF8A65), onSecondary = Color(0xFF2B0E05),
    tertiary = Color(0xFFE0B865), background = Color(0xFF17211B), onBackground = Palette.Cream,
    surface = Color(0xFF1F2B24), onSurface = Palette.Cream, surfaceVariant = Color(0xFF2C3B32), onSurfaceVariant = Color(0xFFD9CCB4),
    outline = Color(0xFF9C9079), error = Color(0xFFFFB4AB),
)

private val GardenColors = lightColorScheme(
    primary = Color(0xFF2E6B3F), onPrimary = Color.White, secondary = Color(0xFF8A4B14), onSecondary = Color.White,
    tertiary = Color(0xFF6B8E23), background = Color(0xFFE8F1E2), onBackground = Color(0xFF14231A),
    surface = Color(0xFFF3F8EE), onSurface = Color(0xFF14231A), surfaceVariant = Color(0xFFD3E4CA), onSurfaceVariant = Color(0xFF354A3C),
    outline = Color(0xFF5F7566), error = Color(0xFFB3261E),
)
private val HarvestColors = lightColorScheme(
    primary = Color(0xFF9A3412), onPrimary = Color.White, secondary = Color(0xFF7A4A00), onSecondary = Color.White,
    tertiary = Color(0xFFB45309), background = Color(0xFFFBE9CF), onBackground = Color(0xFF2E1A0B),
    surface = Color(0xFFFFF4E3), onSurface = Color(0xFF2E1A0B), surfaceVariant = Color(0xFFF2D5AA), onSurfaceVariant = Color(0xFF59391B),
    outline = Color(0xFF8A6A47), error = Color(0xFFB3261E),
)
private val BerryColors = darkColorScheme(
    primary = Color(0xFFE6A8D7), onPrimary = Color(0xFF3A0F31), secondary = Color(0xFFFFB68A), onSecondary = Color(0xFF3A1A06),
    tertiary = Color(0xFFD9C27A), background = Color(0xFF241421), onBackground = Color(0xFFF7E8F2),
    surface = Color(0xFF33202F), onSurface = Color(0xFFF7E8F2), surfaceVariant = Color(0xFF4A3045), onSurfaceVariant = Color(0xFFE6CDE0),
    outline = Color(0xFFB596AE), error = Color(0xFFFFB4AB),
)

private val AppTypography = Typography(
    displayLarge = TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 40.sp),
    headlineLarge = TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 30.sp),
    headlineMedium = TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 26.sp),
    headlineSmall = TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.SemiBold, fontSize = 22.sp),
    titleLarge = TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.SemiBold, fontSize = 20.sp),
    titleMedium = TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.SemiBold, fontSize = 17.sp),
    titleSmall = TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
    bodyLarge = TextStyle(fontFamily = BodyFont, fontSize = 17.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = BodyFont, fontSize = 15.sp, lineHeight = 21.sp),
    bodySmall = TextStyle(fontFamily = BodyFont, fontSize = 13.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
    labelMedium = TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.SemiBold, fontSize = 13.sp),
    labelSmall = TextStyle(fontFamily = BodyFont, fontWeight = FontWeight.SemiBold, fontSize = 12.sp),
)

/** True when the user wants less motion (system "remove animations" or the in-app switch). */
val LocalReducedMotion = staticCompositionLocalOf { false }
val LocalGlowGuide = staticCompositionLocalOf { true }

@Composable
fun TouchRecipeTheme(mode: ThemeMode = ThemeMode.SYSTEM, reducedMotion: Boolean = false, glowGuide: Boolean = true, content: @Composable () -> Unit) {
    val systemDark = isSystemInDarkTheme()
    val scheme = when (mode) {
        ThemeMode.SYSTEM -> if (systemDark) DarkColors else LightColors
        ThemeMode.DARK -> DarkColors; ThemeMode.LIGHT -> LightColors
        ThemeMode.GARDEN -> GardenColors; ThemeMode.HARVEST -> HarvestColors; ThemeMode.BERRY -> BerryColors
    }
    CompositionLocalProvider(LocalReducedMotion provides reducedMotion, LocalGlowGuide provides glowGuide) {
        MaterialTheme(colorScheme = scheme, typography = AppTypography, content = content)
    }
}
