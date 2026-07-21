package dev.cuprum.cuprum.handbook;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.cuprum.cuprum.handbook.HandbookSearchCore.Doc;
import dev.cuprum.cuprum.handbook.HandbookSearchCore.Hit;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * MC-free search core pins (plan §4-W1E "search-index core tests"): tokenizer, diacritic
 * folding, prefix-vs-substring ranking, field weighting, AND semantics and deterministic tie
 * breaks — the client index ({@code HandbookSearchIndex}) delegates all semantics here, so
 * these tests define the search behavior the client GameTest then observes end to end.
 */
final class HandbookSearchCoreTest {
    private static final Doc PROBE = new Doc("cuprum:diagnostics/charge_probe", "Charge Probe",
            List.of("Charge Probe"), List.of("Right-click reads the charge network", "diagnostics", "cg"));
    private static final Doc COIL = new Doc("cuprum:diagnostics/diagnostic_coil", "Diagnostic Coil",
            List.of("Diagnostic Coil Core", "Diagnostic Coil Frame"), List.of("A 3x3x3 multiblock"));
    private static final Doc SONDE = new Doc("cuprum:diagnostics/fx_probe", "FX-Sonde",
            List.of("FX-Sonde"), List.of("Löst dekorative Wellen aus"));

    @Test
    void foldLowercasesAndStripsDiacritics() {
        assertEquals("sonde", HandbookSearchCore.fold("Sondé"));
        assertEquals("lost", HandbookSearchCore.fold("LÖST"));
        assertEquals("", HandbookSearchCore.fold(null));
        assertEquals("strasse", HandbookSearchCore.fold("STRASSE"));
    }

    @Test
    void tokenizeSplitsOnNonAlphanumerics() {
        assertEquals(List.of("charge", "probe"), HandbookSearchCore.tokenize("Charge-Probe!"));
        assertEquals(List.of("3", "x", "3"), HandbookSearchCore.tokenize("3 x 3"));
        assertEquals(List.of(), HandbookSearchCore.tokenize("  ...  "));
        assertEquals(List.of("fx", "sonde"), HandbookSearchCore.tokenize("FX-Sonde"));
    }

    @Test
    void blankQueryReturnsNoHits() {
        assertEquals(List.of(), HandbookSearchCore.search(List.of(PROBE, COIL), ""));
        assertEquals(List.of(), HandbookSearchCore.search(List.of(PROBE, COIL), "   "));
    }

    @Test
    void gibberishReturnsZeroHits() {
        assertEquals(List.of(), HandbookSearchCore.search(List.of(PROBE, COIL, SONDE), "zzqxjv"));
    }

    @Test
    void titlePrefixOutranksSubstringAndBody() {
        // "probe": title-prefix on PROBE's second title token; body-only on none of COIL.
        List<Hit> hits = HandbookSearchCore.search(List.of(COIL, PROBE), "probe");
        assertEquals(1, hits.size());
        assertEquals(PROBE.id(), hits.get(0).id());
        assertEquals(HandbookSearchCore.TITLE_PREFIX, hits.get(0).score());
    }

    @Test
    void germanQueryWithDiacriticsMatchesFoldedTitle() {
        List<Hit> hits = HandbookSearchCore.search(List.of(PROBE, COIL, SONDE), "sondé");
        assertEquals(1, hits.size());
        assertEquals(SONDE.id(), hits.get(0).id());
    }

    @Test
    void andSemanticsRequireEveryToken() {
        assertEquals(1, HandbookSearchCore.search(List.of(PROBE, COIL), "charge probe").size());
        assertEquals(0, HandbookSearchCore.search(List.of(PROBE, COIL), "charge multiblock").size());
    }

    @Test
    void bodyMatchesScoreLowestAndTiesBreakById() {
        Doc bodyA = new Doc("cuprum:a", "Alpha", List.of(), List.of("shared term"));
        Doc bodyB = new Doc("cuprum:b", "Beta", List.of(), List.of("shared term"));
        List<Hit> hits = HandbookSearchCore.search(List.of(bodyB, bodyA), "shared");
        assertEquals(2, hits.size());
        assertEquals("cuprum:a", hits.get(0).id());
        assertEquals("cuprum:b", hits.get(1).id());
        assertEquals(HandbookSearchCore.BODY_SUBSTRING, hits.get(0).score());
    }

    @Test
    void substringMatchScoresBelowPrefixWithinTitle() {
        Doc doc = new Doc("cuprum:x", "Recharge", List.of(), List.of());
        List<Hit> prefix = HandbookSearchCore.search(List.of(doc), "rech");
        List<Hit> substring = HandbookSearchCore.search(List.of(doc), "charge");
        assertEquals(HandbookSearchCore.TITLE_PREFIX, prefix.get(0).score());
        assertEquals(HandbookSearchCore.TITLE_SUBSTRING, substring.get(0).score());
    }

    @Test
    void resultsAreDeterministicForIdenticalInputs() {
        List<Doc> docs = List.of(PROBE, COIL, SONDE);
        assertEquals(HandbookSearchCore.search(docs, "diagnostic"),
                HandbookSearchCore.search(docs, "diagnostic"));
    }

    @Test
    void docRejectsBlankIds() {
        assertThrows(IllegalArgumentException.class, () -> new Doc(" ", "t", List.of(), List.of()));
        assertThrows(IllegalArgumentException.class, () -> new Doc(null, "t", List.of(), List.of()));
    }

    @Test
    void docNormalizesNullFieldsToEmpty() {
        Doc doc = new Doc("cuprum:x", null, null, null);
        assertEquals("", doc.title());
        assertTrue(doc.subjects().isEmpty() && doc.body().isEmpty());
    }
}
