package dev.cuprum.catalogtool;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CatalogValidatorTest {
    private static final Path CATALOG_DIR = Path.of(System.getProperty("cuprum.catalogDir", "catalog"));

    static JsonObject schema() throws Exception {
        return CatalogValidator.parseObject(CATALOG_DIR.resolve("schema.json"));
    }

    static JsonObject repoCatalog() throws Exception {
        return CatalogValidator.parseObject(CATALOG_DIR.resolve("catalog.json"));
    }

    static JsonObject repoCounts() throws Exception {
        return CatalogValidator.parseObject(CATALOG_DIR.resolve("expected_counts.json"));
    }

    static JsonObject counts(int user, int additionalCore, int additionalStretch) {
        return JsonParser.parseString("{\"user\":" + user + ",\"additional_core\":" + additionalCore
                + ",\"additional_stretch\":" + additionalStretch + "}").getAsJsonObject();
    }

    static JsonObject userEntry(String id, int sequence, String contractKey, String deps) {
        // Name/family must match the binding contract table (they are validated too).
        UserContracts.Contract contract = UserContracts.BY_ID.get(id);
        String name = contract != null ? contract.name() : "N " + id;
        String family = contract != null ? contract.family() : "shield";
        return JsonParser.parseString("""
                {"id": "%s", "sequence": %d, "origin": "user", "family": "%s", "name": "%s",
                 "type": "system", "tier": "core", "progression_tier": 1, "deps": [%s],
                 "vanilla_overlap": "none: test", "summary": "test summary", "planned_wave": "W1",
                 "contract_key": "%s"}
                """.formatted(id, sequence, family, name, deps, contractKey)).getAsJsonObject();
    }

    static JsonObject additionalEntry(String id, int sequence, String family, String tier) {
        return JsonParser.parseString("""
                {"id": "%s", "sequence": %d, "origin": "additional", "family": "%s", "name": "N %s",
                 "type": "block", "tier": "%s", "progression_tier": 1, "deps": [],
                 "vanilla_overlap": "none: test", "summary": "test summary", "planned_wave": "W2"}
                """.formatted(id, sequence, family, id, tier)).getAsJsonObject();
    }

    static JsonObject minimalCatalog() {
        JsonObject catalog = JsonParser.parseString("{\"catalog_version\": 2, \"entries\": []}").getAsJsonObject();
        catalog.getAsJsonArray("entries").add(userEntry("U01", 1, "storm_shield_core", ""));
        catalog.getAsJsonArray("entries").add(userEntry("U02", 2, "storm_shield_projectile_interception", "\"U01\""));
        return catalog;
    }

    @Test
    void repoCatalogIsValid() throws Exception {
        List<String> errors = CatalogValidator.validate(repoCatalog(), schema(), repoCounts());
        assertEquals(List.of(), errors, "repository catalog must validate cleanly");
    }

    @Test
    void repoCatalogCoversAllTwentyThreeUserContractsExactly() throws Exception {
        JsonObject catalog = repoCatalog();
        assertEquals(300, catalog.getAsJsonArray("entries").size());
        assertEquals(23, UserContracts.CONTRACTS.size());
        for (int i = 0; i < 22; i++) {
            JsonObject entry = catalog.getAsJsonArray("entries").get(i).getAsJsonObject();
            String id = String.format("U%02d", i + 1);
            assertEquals(id, entry.get("id").getAsString(), "position " + i);
            assertEquals(UserContracts.CONTRACTS.get(id), entry.get("contract_key").getAsString(), id);
            assertEquals("user", entry.get("origin").getAsString(), id);
            assertEquals("core", entry.get("tier").getAsString(), id);
            assertEquals(i + 1, entry.get("sequence").getAsInt(), id);
        }
        // CP0C: U23 holds global sequence 273 (file position 273), after the CP0B
        // additional block and directly before the VFX family.
        JsonObject u23 = catalog.getAsJsonArray("entries").get(272).getAsJsonObject();
        assertEquals("U23", u23.get("id").getAsString());
        assertEquals(UserContracts.CONTRACTS.get("U23"), u23.get("contract_key").getAsString());
        assertEquals("user", u23.get("origin").getAsString());
        assertEquals("core", u23.get("tier").getAsString());
        assertEquals(273, u23.get("sequence").getAsInt());
        // Entries 23..272 (CP0B) and 274..300 (VFX) are additional; no contract_key.
        for (int i = 22; i < 300; i++) {
            if (i == 272) {
                continue; // U23
            }
            JsonObject entry = catalog.getAsJsonArray("entries").get(i).getAsJsonObject();
            assertEquals("additional", entry.get("origin").getAsString(), entry.get("id").getAsString());
            assertFalse(entry.has("contract_key"), entry.get("id").getAsString());
        }
    }

    @Test
    void minimalCatalogIsValid() throws Exception {
        assertEquals(List.of(), CatalogValidator.validate(minimalCatalog(), schema(), counts(2, 0, 0)));
    }

    @Test
    void duplicateIdsAreRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        catalog.getAsJsonArray("entries").get(1).getAsJsonObject().addProperty("id", "U01");
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(1, 0, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("duplicate entry id")), errors.toString());
    }

    @Test
    void unknownFieldsAreRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        catalog.getAsJsonArray("entries").get(0).getAsJsonObject().addProperty("bogus", "x");
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(2, 0, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("additional field 'bogus'")), errors.toString());
    }

    @Test
    void missingRequiredFieldIsRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        catalog.getAsJsonArray("entries").get(0).getAsJsonObject().remove("summary");
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(2, 0, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("missing required field 'summary'")), errors.toString());
    }

    @Test
    void unknownDependencyIsRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        catalog.getAsJsonArray("entries").get(0).getAsJsonObject().getAsJsonArray("deps").add("U99");
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(2, 0, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("unknown id 'U99'")), errors.toString());
    }

    @Test
    void dependencyCyclesAreRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        // U01 -> U02 while U02 -> U01 already holds.
        catalog.getAsJsonArray("entries").get(0).getAsJsonObject().getAsJsonArray("deps").add("U02");
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(2, 0, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("cycle")), errors.toString());
    }

    @Test
    void selfDependencyIsRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        catalog.getAsJsonArray("entries").get(0).getAsJsonObject().getAsJsonArray("deps").add("U01");
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(2, 0, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("depends on itself")), errors.toString());
    }

    @Test
    void countMismatchIsRejected() throws Exception {
        List<String> errors = CatalogValidator.validate(minimalCatalog(), schema(), counts(3, 0, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("expected 3 user entries but found 2")), errors.toString());
    }

    @Test
    void blankDispositionIsRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        catalog.getAsJsonArray("entries").get(0).getAsJsonObject().addProperty("vanilla_overlap", "   ");
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(2, 0, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("blank 'vanilla_overlap'")), errors.toString());
    }

    @Test
    void nonContiguousSequenceIsRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        catalog.getAsJsonArray("entries").get(1).getAsJsonObject().addProperty("sequence", 5);
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(2, 0, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("sequence must be contiguous")), errors.toString());
    }

    @Test
    void originIdShapeMismatchIsRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        catalog.getAsJsonArray("entries").get(1).getAsJsonObject().addProperty("origin", "additional");
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(1, 1, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("has a U id but origin 'additional'")), errors.toString());
    }

    @Test
    void missingContractKeyIsRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        catalog.getAsJsonArray("entries").get(0).getAsJsonObject().remove("contract_key");
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(2, 0, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("missing required 'contract_key'")), errors.toString());
    }

    @Test
    void contractKeyOnAdditionalEntryIsRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        JsonObject extra = additionalEntry("PWR-01", 3, "power_extra", "core");
        extra.addProperty("contract_key", "sneaky_contract");
        catalog.getAsJsonArray("entries").add(extra);
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(2, 1, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("must not declare 'contract_key'")), errors.toString());
    }

    @Test
    void nonCoreUserEntryIsRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        catalog.getAsJsonArray("entries").get(1).getAsJsonObject().addProperty("tier", "stretch");
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(2, 0, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("must have tier 'core'")), errors.toString());
    }

    @Test
    void invalidProgressionTierAndWaveAreRejected() throws Exception {
        JsonObject catalog = minimalCatalog();
        catalog.getAsJsonArray("entries").get(0).getAsJsonObject().addProperty("progression_tier", 9);
        catalog.getAsJsonArray("entries").get(1).getAsJsonObject().addProperty("planned_wave", "wave1");
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(2, 0, 0));
        assertFalse(errors.isEmpty());
        assertTrue(errors.stream().anyMatch(e -> e.contains("above maximum")), errors.toString());
        assertTrue(errors.stream().anyMatch(e -> e.contains("does not match pattern")), errors.toString());
    }
}
