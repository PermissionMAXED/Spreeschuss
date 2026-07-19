package dev.cuprum.catalogtool;

import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.List;

import static dev.cuprum.catalogtool.CatalogValidatorTest.repoCatalog;
import static dev.cuprum.catalogtool.CatalogValidatorTest.repoCounts;
import static dev.cuprum.catalogtool.CatalogValidatorTest.schema;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Mutation tests against the real repository catalog proving the CP0B-scale
 * semantic rules bite: duplicate additional names, broken per-family numbering,
 * forward dependencies and core→stretch dependencies must each fail validation.
 */
class AdditionalMutationTest {
    private static JsonObject entry(JsonObject catalog, String id) {
        for (var element : catalog.getAsJsonArray("entries")) {
            JsonObject entry = element.getAsJsonObject();
            if (entry.get("id").getAsString().equals(id)) {
                return entry;
            }
        }
        throw new AssertionError("no entry " + id);
    }

    @Test
    void duplicateAdditionalNameFails() throws Exception {
        JsonObject catalog = repoCatalog();
        // PWR-02 quietly takes PWR-01's canonical name.
        entry(catalog, "PWR-02").addProperty("name", "Copper Bus Bar");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e ->
                        e.contains("duplicate entry name") && e.contains("Copper Bus Bar")
                                && e.contains("PWR-01") && e.contains("PWR-02")),
                errors.toString());
    }

    @Test
    void brokenFamilySequenceFails() throws Exception {
        JsonObject catalog = repoCatalog();
        // Renumbering the last TES entry leaves a hole at TES-16.
        entry(catalog, "TES-16").addProperty("id", "TES-17");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e -> e.contains("'TES'") && e.contains("contiguous from 01")),
                errors.toString());
    }

    @Test
    void forwardDependencyFails() throws Exception {
        JsonObject catalog = repoCatalog();
        // PWR-01 (sequence 23) must not reference OXI-01 (sequence 47).
        entry(catalog, "PWR-01").getAsJsonArray("deps").add("OXI-01");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e ->
                        e.contains("'PWR-01'") && e.contains("forward dependency") && e.contains("'OXI-01'")),
                errors.toString());
    }

    @Test
    void coreDependingOnStretchFails() throws Exception {
        JsonObject catalog = repoCatalog();
        // OXI-01 (core, sequence 47) gains a backward dep on PWR-22 (stretch, sequence 44):
        // no forward-dep error, but the core/stretch independence rule must fire.
        entry(catalog, "OXI-01").getAsJsonArray("deps").add("PWR-22");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e ->
                        e.contains("core entry 'OXI-01'") && e.contains("stretch entry 'PWR-22'")),
                errors.toString());
        assertTrue(errors.stream().noneMatch(e -> e.contains("forward dependency")), errors.toString());
    }
}
