package dev.cuprum.catalogtool;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.List;

import static dev.cuprum.catalogtool.CatalogValidatorTest.repoCatalog;
import static dev.cuprum.catalogtool.CatalogValidatorTest.repoCounts;
import static dev.cuprum.catalogtool.CatalogValidatorTest.schema;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Mutation tests proving semantic substitution of the binding U contracts is
 * impossible: every mutated variant of the real repository catalog must fail
 * validation with a contract error.
 */
class ContractMutationTest {
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
    void renamedContractKeyFails() throws Exception {
        JsonObject catalog = repoCatalog();
        // "Rename" the U05 contract: Leyden Jars quietly become a generic battery contract.
        entry(catalog, "U05").addProperty("contract_key", "generic_batteries");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e ->
                        e.contains("'U05'") && e.contains("generic_batteries") && e.contains("leyden_jar_batteries")),
                errors.toString());
    }

    @Test
    void swappedContractKeysFail() throws Exception {
        JsonObject catalog = repoCatalog();
        // Swap weapons and armor contracts between U06 and U07.
        String u06 = entry(catalog, "U06").get("contract_key").getAsString();
        String u07 = entry(catalog, "U07").get("contract_key").getAsString();
        entry(catalog, "U06").addProperty("contract_key", u07);
        entry(catalog, "U07").addProperty("contract_key", u06);
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e -> e.contains("'U06'") && e.contains("oxidation_armor")), errors.toString());
        assertTrue(errors.stream().anyMatch(e -> e.contains("'U07'") && e.contains("oxidation_weapons")), errors.toString());
    }

    @Test
    void swappedEntryIdsFail() throws Exception {
        JsonObject catalog = repoCatalog();
        // Swap the ids of U09 (tesla turrets) and U10 (mag-rails) while keeping everything else.
        entry(catalog, "U09").addProperty("id", "UXX");
        entry(catalog, "U10").addProperty("id", "U09");
        entry(catalog, "UXX").addProperty("id", "U10");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e -> e.contains("'U09'") && e.contains("tesla_turrets")), errors.toString());
        assertTrue(errors.stream().anyMatch(e -> e.contains("'U10'") && e.contains("hovering_mag_rails")), errors.toString());
    }

    @Test
    void droppedContractReplacedByInventedOneFails() throws Exception {
        JsonObject catalog = repoCatalog();
        // Replace the weather manipulator with an invented U23 feature (keeps count at 22).
        JsonObject u21 = entry(catalog, "U21");
        u21.addProperty("id", "U23");
        u21.addProperty("contract_key", "invented_feature");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e -> e.contains("missing binding user contract 'U21'")), errors.toString());
        assertTrue(errors.stream().anyMatch(e -> e.contains("'U23'") && e.contains("not a known user contract id")),
                errors.toString());
    }

    @Test
    void reorderedUserEntriesFail() throws Exception {
        JsonObject catalog = repoCatalog();
        JsonArray entries = catalog.getAsJsonArray("entries");
        // Swap positions of the first two entries but keep their sequence fields.
        JsonObject first = entries.get(0).getAsJsonObject();
        JsonObject second = entries.get(1).getAsJsonObject();
        entries.set(0, second);
        entries.set(1, first);
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e -> e.contains("sequence must be contiguous")), errors.toString());
    }

    @Test
    void repurposedNameWithCorrectKeyFails() throws Exception {
        JsonObject catalog = repoCatalog();
        // Keep the correct contract_key but repurpose the feature via its name.
        entry(catalog, "U09").addProperty("name", "Arrow Turrets");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e ->
                        e.contains("'U09'") && e.contains("Arrow Turrets") && e.contains("Tesla Turrets")),
                errors.toString());
    }

    @Test
    void repurposedFamilyWithCorrectKeyFails() throws Exception {
        JsonObject catalog = repoCatalog();
        // Keep the correct contract_key but move the feature into another family.
        entry(catalog, "U04").addProperty("family", "combat");
        List<String> errors = CatalogValidator.validate(catalog, schema(), repoCounts());
        assertTrue(errors.stream().anyMatch(e ->
                        e.contains("'U04'") && e.contains("family 'combat'") && e.contains("'power'")),
                errors.toString());
    }

    @Test
    void contractTableItselfIsComplete() {
        assertEquals(22, UserContracts.ALL.size());
        assertEquals(22, UserContracts.BY_ID.size());
        assertEquals(22, UserContracts.CONTRACTS.size());
        assertEquals("storm_shield_core", UserContracts.CONTRACTS.get("U01"));
        assertEquals("dynamic_handbook", UserContracts.CONTRACTS.get("U22"));
        assertEquals("Storm Shield Core", UserContracts.BY_ID.get("U01").name());
        assertEquals("meta", UserContracts.BY_ID.get("U22").family());
        // One-to-one: no duplicate contract keys or names in the table itself.
        assertEquals(22, UserContracts.ALL.stream().map(UserContracts.Contract::contractKey).distinct().count());
        assertEquals(22, UserContracts.ALL.stream().map(UserContracts.Contract::name).distinct().count());
    }
}
