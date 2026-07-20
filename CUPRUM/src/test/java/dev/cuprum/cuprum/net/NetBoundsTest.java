package dev.cuprum.cuprum.net;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MC-free unit tests (plan D9) for the payload string bounds/NFC helpers (plan §3.2).
 * NFC pivot strings used below:
 * <ul>
 *   <li>{@code "e\u0301"} (e + combining acute, 2 UTF-16 units) composes to {@code "\u00e9"}
 *       ("é", 1 unit) — NFC shrinks it;</li>
 *   <li>{@code "\u0958"} (DEVANAGARI QA, composition-excluded, 1 unit) decomposes to
 *       {@code "\u0915\u093C"} (2 units) — NFC grows it.</li>
 * </ul>
 */
class NetBoundsTest {
    private static final String DECOMPOSED_E_ACUTE = "e\u0301";
    private static final String COMPOSED_E_ACUTE = "\u00e9";
    private static final String NFC_GROWING = "\u0958";

    @Test
    void isNfcAcceptsAsciiAndComposedForms() {
        assertTrue(NetBounds.isNfc(""));
        assertTrue(NetBounds.isNfc("plain ascii 123"));
        assertTrue(NetBounds.isNfc(COMPOSED_E_ACUTE));
    }

    @Test
    void isNfcRejectsDecomposedForm() {
        assertFalse(NetBounds.isNfc(DECOMPOSED_E_ACUTE));
    }

    @Test
    void toNfcComposesAndIsIdempotent() {
        assertEquals(COMPOSED_E_ACUTE, NetBounds.toNfc(DECOMPOSED_E_ACUTE));
        assertEquals(COMPOSED_E_ACUTE, NetBounds.toNfc(COMPOSED_E_ACUTE));
        assertEquals(NetBounds.toNfc(NFC_GROWING), NetBounds.toNfc(NetBounds.toNfc(NFC_GROWING)));
    }

    @Test
    void fitsLengthIsAnInclusiveUtf16Bound() {
        assertTrue(NetBounds.fitsLength("", 0));
        assertTrue(NetBounds.fitsLength("abcd", 4));
        assertFalse(NetBounds.fitsLength("abcde", 4));
        // UTF-16 code units, not code points: an astral emoji is 2 units.
        assertFalse(NetBounds.fitsLength("\uD83D\uDE00", 1));
        assertTrue(NetBounds.fitsLength("\uD83D\uDE00", 2));
    }

    @Test
    void fitsLengthNfcPassesStringsThatShrinkUnderNfc() {
        // 2 raw units, 1 unit after NFC: honest bound is the normalized form's length.
        assertFalse(NetBounds.fitsLength(DECOMPOSED_E_ACUTE, 1));
        assertTrue(NetBounds.fitsLengthNfc(DECOMPOSED_E_ACUTE, 1));
    }

    @Test
    void fitsLengthNfcRejectsStringsThatGrowUnderNfc() {
        String tricky = NFC_GROWING.repeat(4); // 4 raw units, 8 after NFC
        assertEquals(4, tricky.length());
        assertEquals(8, NetBounds.toNfc(tricky).length());
        assertTrue(NetBounds.fitsLength(tricky, 4));
        assertFalse(NetBounds.fitsLengthNfc(tricky, 4));
        assertTrue(NetBounds.fitsLengthNfc(tricky, 8));
    }

    @Test
    void requireBoundedReturnsTheSameInstanceWithinBounds() {
        String value = "within";
        assertSame(value, NetBounds.requireBounded(value, 6, "field"));
        assertSame(value, NetBounds.requireBounded(value, 64, "field"));
    }

    @Test
    void requireBoundedThrowsBeyondBoundsNamingTheField() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> NetBounds.requireBounded("sevench", 6, "note"));
        assertTrue(e.getMessage().contains("note"));
        assertTrue(e.getMessage().contains("7"));
        assertTrue(e.getMessage().contains("6"));
    }

    @Test
    void isLogSafeAcceptsOrdinaryText() {
        assertTrue(NetBounds.isLogSafe(""));
        assertTrue(NetBounds.isLogSafe("plain ascii 123 !@#"));
        assertTrue(NetBounds.isLogSafe(COMPOSED_E_ACUTE));
        assertTrue(NetBounds.isLogSafe("\uD83D\uDE00")); // astral emoji is fine
    }

    @Test
    void isLogSafeRejectsC0AndC1ControlCharacters() {
        // C0 block boundaries + the classics.
        assertFalse(NetBounds.isLogSafe("a\u0000b")); // NUL
        assertFalse(NetBounds.isLogSafe("a\nb"));     // LF
        assertFalse(NetBounds.isLogSafe("a\rb"));     // CR
        assertFalse(NetBounds.isLogSafe("a\tb"));     // TAB
        assertFalse(NetBounds.isLogSafe("a\u001Fb")); // last C0
        // DEL + C1 block boundaries + NEL.
        assertFalse(NetBounds.isLogSafe("a\u007Fb")); // DEL
        assertFalse(NetBounds.isLogSafe("a\u0080b")); // first C1
        assertFalse(NetBounds.isLogSafe("a\u0085b")); // NEL
        assertFalse(NetBounds.isLogSafe("a\u009Fb")); // last C1
    }

    @Test
    void isLogSafeRejectsUnicodeLineAndParagraphSeparators() {
        assertFalse(NetBounds.isLogSafe("a\u2028b"));
        assertFalse(NetBounds.isLogSafe("a\u2029b"));
        // Immediate neighbors are ordinary characters and must pass.
        assertTrue(NetBounds.isLogSafe("a\u2027b"));
        assertTrue(NetBounds.isLogSafe("a\u202Ab"));
    }

    @Test
    void escapeForLogIsIdentityForCleanInput() {
        String clean = "clean text \u00e9 \uD83D\uDE00";
        assertSame(clean, NetBounds.escapeForLog(clean));
    }

    @Test
    void escapeForLogEscapesEveryRejectedCharacter() {
        assertEquals("a\\u000Ab", NetBounds.escapeForLog("a\nb"));
        assertEquals("\\u000D\\u0000", NetBounds.escapeForLog("\r\u0000"));
        assertEquals("x\\u2028y\\u2029z", NetBounds.escapeForLog("x\u2028y\u2029z"));
        assertEquals("\\u007F", NetBounds.escapeForLog("\u007F"));
        // Escaped output is always log-safe.
        assertTrue(NetBounds.isLogSafe(NetBounds.escapeForLog("a\n\r\t\u0085\u2028b")));
    }

    @Test
    void isValidRangeDistanceAcceptsTheHalfOpenIntervalUpToTheCap() {
        assertTrue(NetBounds.isValidRangeDistance(0.0001));
        assertTrue(NetBounds.isValidRangeDistance(4.5));
        assertTrue(NetBounds.isValidRangeDistance(8.0)); // exact cap is valid
        assertEquals(8.0, NetBounds.MAX_RANGE_DISTANCE);
    }

    @Test
    void isValidRangeDistanceRejectsNonFiniteNonPositiveAndOversized() {
        assertFalse(NetBounds.isValidRangeDistance(Double.NaN));
        assertFalse(NetBounds.isValidRangeDistance(Double.POSITIVE_INFINITY));
        assertFalse(NetBounds.isValidRangeDistance(Double.NEGATIVE_INFINITY));
        assertFalse(NetBounds.isValidRangeDistance(0.0));
        assertFalse(NetBounds.isValidRangeDistance(-0.0));
        assertFalse(NetBounds.isValidRangeDistance(-1.0));
        assertFalse(NetBounds.isValidRangeDistance(8.0001)); // just above the cap
        assertFalse(NetBounds.isValidRangeDistance(Math.nextUp(8.0)));
    }

    @Test
    void helpersRejectNullInput() {
        assertThrows(NullPointerException.class, () -> NetBounds.isNfc(null));
        assertThrows(NullPointerException.class, () -> NetBounds.toNfc(null));
        assertThrows(NullPointerException.class, () -> NetBounds.fitsLength(null, 1));
        assertThrows(NullPointerException.class, () -> NetBounds.requireBounded(null, 1, "field"));
        assertThrows(NullPointerException.class, () -> NetBounds.isLogSafe(null));
        assertThrows(NullPointerException.class, () -> NetBounds.escapeForLog(null));
    }
}
