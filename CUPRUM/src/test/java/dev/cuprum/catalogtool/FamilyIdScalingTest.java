package dev.cuprum.catalogtool;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import java.util.List;

import static dev.cuprum.catalogtool.CatalogValidatorTest.additionalEntry;
import static dev.cuprum.catalogtool.CatalogValidatorTest.counts;
import static dev.cuprum.catalogtool.CatalogValidatorTest.schema;
import static dev.cuprum.catalogtool.CatalogValidatorTest.userEntry;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves the schema/tooling already supports the CP0B shape: family ids such as
 * PWR-01, numeric-aware contiguity past two digits, and expected counts of
 * 202 additional core + 48 additional stretch entries.
 */
class FamilyIdScalingTest {

    @Test
    void familyIdsValidateAlongsideUserEntries() throws Exception {
        JsonObject catalog = JsonParser.parseString("{\"catalog_version\": 2, \"entries\": []}").getAsJsonObject();
        JsonArray entries = catalog.getAsJsonArray("entries");
        entries.add(userEntry("U01", 1, "storm_shield_core", ""));
        entries.add(additionalEntry("PWR-01", 2, "power_extra", "core"));
        entries.add(additionalEntry("PWR-02", 3, "power_extra", "stretch"));
        entries.add(additionalEntry("LOG-01", 4, "logistics_extra", "core"));
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(1, 2, 1));
        assertEquals(List.of(), errors);
    }

    @Test
    void cp0bScaleTwoHundredTwoCoreAndFortyEightStretchValidate() throws Exception {
        JsonObject catalog = JsonParser.parseString("{\"catalog_version\": 2, \"entries\": []}").getAsJsonObject();
        JsonArray entries = catalog.getAsJsonArray("entries");
        int sequence = 1;
        // 202 additional core across two families (including >99 numeric-aware ids)...
        for (int i = 1; i <= 150; i++) {
            entries.add(additionalEntry(String.format("PWR-%02d", i), sequence++, "power_extra", "core"));
        }
        for (int i = 1; i <= 52; i++) {
            entries.add(additionalEntry(String.format("LOG-%02d", i), sequence++, "logistics_extra", "core"));
        }
        // ...and 48 additional stretch in a third family.
        for (int i = 1; i <= 48; i++) {
            entries.add(additionalEntry(String.format("STR-%02d", i), sequence++, "stretch_extra", "stretch"));
        }
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(0, 202, 48));
        assertEquals(List.of(), errors, "CP0B-scale catalog (202 core + 48 stretch additional) must validate");
        assertEquals(250, entries.size());
    }

    @Test
    void numericAwareGapInFamilyNumbersIsRejected() throws Exception {
        JsonObject catalog = JsonParser.parseString("{\"catalog_version\": 2, \"entries\": []}").getAsJsonObject();
        JsonArray entries = catalog.getAsJsonArray("entries");
        entries.add(additionalEntry("PWR-01", 1, "power_extra", "core"));
        entries.add(additionalEntry("PWR-03", 2, "power_extra", "core"));
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(0, 2, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("contiguous from 01")), errors.toString());
    }

    @Test
    void familyPrefixMustMapToSingleFamilyName() throws Exception {
        JsonObject catalog = JsonParser.parseString("{\"catalog_version\": 2, \"entries\": []}").getAsJsonObject();
        JsonArray entries = catalog.getAsJsonArray("entries");
        entries.add(additionalEntry("PWR-01", 1, "power_extra", "core"));
        entries.add(additionalEntry("PWR-02", 2, "other_family", "core"));
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(0, 2, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("is used by families")), errors.toString());
    }

    @Test
    void familyNameMustMapToSinglePrefix() throws Exception {
        JsonObject catalog = JsonParser.parseString("{\"catalog_version\": 2, \"entries\": []}").getAsJsonObject();
        JsonArray entries = catalog.getAsJsonArray("entries");
        entries.add(additionalEntry("PWR-01", 1, "power_extra", "core"));
        entries.add(additionalEntry("PWX-01", 2, "power_extra", "core"));
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(0, 2, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("is used by id prefixes")), errors.toString());
    }

    @Test
    void countsMismatchOnTierSplitIsRejected() throws Exception {
        JsonObject catalog = JsonParser.parseString("{\"catalog_version\": 2, \"entries\": []}").getAsJsonObject();
        JsonArray entries = catalog.getAsJsonArray("entries");
        entries.add(additionalEntry("PWR-01", 1, "power_extra", "stretch"));
        List<String> errors = CatalogValidator.validate(catalog, schema(), counts(0, 1, 0));
        assertTrue(errors.stream().anyMatch(e -> e.contains("expected 1 additional core entries but found 0")), errors.toString());
        assertTrue(errors.stream().anyMatch(e -> e.contains("expected 0 additional stretch entries but found 1")), errors.toString());
    }
}
