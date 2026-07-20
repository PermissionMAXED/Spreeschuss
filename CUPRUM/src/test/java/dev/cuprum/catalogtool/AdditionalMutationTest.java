package dev.cuprum.catalogtool;

import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.List;

import static dev.cuprum.catalogtool.CatalogValidatorTest.repoCatalog;
import static dev.cuprum.catalogtool.CatalogValidatorTest.repoCounts;
import static dev.cuprum.catalogtool.CatalogValidatorTest.schema;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Mutation tests against the real repository catalog proving the CP0B/CP0C-scale
 * semantic rules bite: duplicate additional names, broken per-family numbering,
 * forward dependencies (additional and user targets alike) and core→stretch
 * dependencies must each fail validation — including inside the CP0C VFX family.
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
    void forwardUserDependencyFails() throws Exception {
        JsonObject catalog = repoCatalog();
        // PWR-01 (sequence 23) must not reference the U23 user contract (sequence 273):
        // user deps are not exempt from the backward-only rule.
        entry(catalog, "PWR-01").getAsJsonArray("deps").add("U23");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e ->
                        e.contains("'PWR-01'") && e.contains("forward dependency") && e.contains("'U23'")),
                errors.toString());
    }

    @Test
    void backwardUserDependencyOnU23FromVfxRowsPasses() throws Exception {
        // The repo VFX rows (274..300) depend on U23 (273) — backward and legal.
        List<String> errors = CatalogValidator.validate(repoCatalog(), schema(), repoCounts());
        assertTrue(errors.isEmpty(), errors.toString());
    }

    @Test
    void duplicateVfxNameFails() throws Exception {
        JsonObject catalog = repoCatalog();
        // VFX-02 quietly takes VFX-01's canonical name.
        entry(catalog, "VFX-02").addProperty("name", "Prismatic Interference Lens");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e ->
                        e.contains("duplicate entry name") && e.contains("Prismatic Interference Lens")
                                && e.contains("VFX-01") && e.contains("VFX-02")),
                errors.toString());
    }

    @Test
    void brokenVfxFamilySequenceFails() throws Exception {
        JsonObject catalog = repoCatalog();
        // Renumbering the last VFX entry leaves a hole at VFX-27.
        entry(catalog, "VFX-27").addProperty("id", "VFX-28");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e -> e.contains("'VFX'") && e.contains("contiguous from 01")),
                errors.toString());
    }

    @Test
    void vfxCoreDependingOnVfxStretchFails() throws Exception {
        JsonObject catalog = repoCatalog();
        // VFX-22 (core, seq 295) gains a backward dep on VFX-09 (stretch, seq 282):
        // the core/stretch independence rule must fire inside the new family too.
        entry(catalog, "VFX-22").getAsJsonArray("deps").add("VFX-09");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e ->
                        e.contains("core entry 'VFX-22'") && e.contains("stretch entry 'VFX-09'")),
                errors.toString());
        assertTrue(errors.stream().noneMatch(e -> e.contains("forward dependency")), errors.toString());
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
