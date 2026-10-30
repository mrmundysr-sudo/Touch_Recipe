package com.mundymorning.touchrecipe.core

import com.mundymorning.touchrecipe.core.quantity.Quantities
import org.junit.Assert.*
import org.junit.Test

class QuantityTest {
    @Test fun scalesSimpleAmounts() {
        assertEquals("2 cups flour", Quantities.scale("1 cup flour", 2.0))
        assertEquals("1/2 cup flour", Quantities.scale("1 cup flour", 0.5))
        assertEquals("4 tbsp butter", Quantities.scale("2 tbsp butter", 2.0))
        assertEquals("1 clove garlic", Quantities.scale("2 cloves garlic", 0.5))
        assertEquals("3 eggs", Quantities.scale("2 eggs", 1.5))
        assertEquals("1/2 tsp salt", Quantities.scale("1 tsp salt", 0.5))
    }
    @Test fun scalesMixedAndUnicodeFractions() {
        assertEquals("3 cups milk", Quantities.scale("1 1/2 cups milk", 2.0))
        assertEquals("1 cup sugar", Quantities.scale("½ cup sugar", 2.0))
        assertEquals("3 cups rice", Quantities.scale("1½ cups rice", 2.0))
    }
    @Test fun scalesRanges() {
        assertEquals("4-6 cloves garlic", Quantities.scale("2-3 cloves garlic", 2.0))
        assertEquals("4-6 cloves garlic", Quantities.scale("2 to 3 cloves garlic", 2.0))
    }
    @Test fun leavesTextAmountsAlone() {
        assertEquals("salt to taste", Quantities.scale("salt to taste", 3.0))
        assertEquals("a pinch of nutmeg", Quantities.scale("a pinch of nutmeg", 3.0))
        assertEquals("Salt and pepper", Quantities.scale("Salt and pepper", 2.0))
    }
    @Test fun onlyScalesLeadingAmount() {
        assertEquals("2 (14 oz) cans tomatoes", Quantities.scale("1 (14 oz) cans tomatoes", 2.0))
        assertEquals("4 chicken thighs, cooked at 350F", Quantities.scale("2 chicken thighs, cooked at 350F", 2.0))
    }
    @Test fun doesNotCorruptOnBadFactor() {
        assertEquals("1 cup flour", Quantities.scale("1 cup flour", 0.0))
        assertEquals("1 cup flour", Quantities.scale("1 cup flour", Double.NaN))
    }
    @Test fun formatsFractions() {
        assertEquals("1/3", Quantities.format(1.0 / 3))
        assertEquals("2/3", Quantities.format(2.0 / 3))
        assertEquals("1 1/4", Quantities.format(1.25))
        assertEquals("12", Quantities.format(12.0))
    }
    @Test fun servingsFactor() {
        assertEquals(2.0, Quantities.factor(4, 8), 0.0001)
        assertEquals(1.0, Quantities.factor(null, 8), 0.0001)
    }
    @Test fun decimalCommaAndMalformed() {
        assertEquals("3 dl milk", Quantities.scale("1,5 dl milk", 2.0))
        assertEquals("2x4 board", Quantities.scale("2x4 board", 2.0))
    }
}
