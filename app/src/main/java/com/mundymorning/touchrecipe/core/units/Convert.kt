package com.mundymorning.touchrecipe.core.units

import com.mundymorning.touchrecipe.core.quantity.Quantities

enum class Kind(val label: String) { VOLUME("Volume"), WEIGHT("Weight"), TEMPERATURE("Temperature") }

object Convert {
    private const val ML_PER_TSP = 4.92892159375
    private const val G_PER_OZ = 28.349523125
    val volumeUnits = listOf("tsp", "tbsp", "fl oz", "cup", "pint", "quart", "gallon", "ml", "l")
    val weightUnits = listOf("oz", "lb", "g", "kg")
    val temperatureUnits = listOf("°F", "°C", "Gas mark")
    fun units(kind: Kind) = when (kind) { Kind.VOLUME -> volumeUnits; Kind.WEIGHT -> weightUnits; Kind.TEMPERATURE -> temperatureUnits }

    private fun mlPer(u: String) = when (u) {
        "tsp" -> ML_PER_TSP; "tbsp" -> ML_PER_TSP * 3; "fl oz" -> ML_PER_TSP * 6; "cup" -> ML_PER_TSP * 48
        "pint" -> ML_PER_TSP * 96; "quart" -> ML_PER_TSP * 192; "gallon" -> ML_PER_TSP * 768; "ml" -> 1.0; "l" -> 1000.0
        else -> error("unit $u")
    }
    private fun gPer(u: String) = when (u) { "oz" -> G_PER_OZ; "lb" -> G_PER_OZ * 16; "g" -> 1.0; "kg" -> 1000.0; else -> error("unit $u") }
    private val gasMarks = listOf(1 to 275, 2 to 300, 3 to 325, 4 to 350, 5 to 375, 6 to 400, 7 to 425, 8 to 450, 9 to 475)

    private fun toF(v: Double, from: String): Double = when (from) {
        "°F" -> v; "°C" -> v * 9 / 5 + 32
        else -> gasMarks.minByOrNull { kotlin.math.abs(it.first - v) }!!.second.toDouble()
    }

    fun convert(kind: Kind, value: Double, from: String, to: String): Double = when (kind) {
        Kind.VOLUME -> value * mlPer(from) / mlPer(to)
        Kind.WEIGHT -> value * gPer(from) / gPer(to)
        Kind.TEMPERATURE -> { val f = toF(value, from); when (to) { "°F" -> f; "°C" -> (f - 32) * 5 / 9; else -> gasMarks.minByOrNull { kotlin.math.abs(it.second - f) }!!.first.toDouble() } }
    }

    fun format(kind: Kind, v: Double, unit: String): String =
        if (kind == Kind.TEMPERATURE) (if (unit == "Gas mark") v.toInt().toString() else Math.round(v).toString()) + (if (unit == "Gas mark") " (gas mark)" else unit)
        else (if (v < 0.01) "%.4f".format(v) else if (v < 10) Quantities.format(v).let { f -> if (f.contains('/')) "$f (${"%.2f".format(v)})" else f } else "%.1f".format(v).removeSuffix(".0")) + " $unit"

    val equivalents = listOf(
        "3 tsp = 1 tbsp", "2 tbsp = 1 fl oz", "4 tbsp = 1/4 cup", "5 1/3 tbsp = 1/3 cup", "8 tbsp = 1/2 cup", "16 tbsp = 1 cup",
        "1 cup = 8 fl oz = 237 ml", "2 cups = 1 pint", "2 pints = 1 quart", "4 quarts = 1 gallon", "1 stick butter = 1/2 cup = 113 g",
        "1 lb = 16 oz = 454 g", "1 oz = 28 g", "1 cup flour ≈ 120 g", "1 cup sugar ≈ 200 g", "1 cup butter = 227 g",
    )
    val ovenTemps = listOf("Very slow: 250 °F / 120 °C", "Slow: 300 °F / 150 °C (gas mark 2)", "Moderate: 350 °F / 180 °C (gas mark 4)", "Moderately hot: 400 °F / 200 °C (gas mark 6)", "Hot: 450 °F / 230 °C (gas mark 8)")
}
