package dev.cuprum.cuprum.handbook;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;

/**
 * The W1 planning half of the handbook completeness contract: all 300 sealed catalog entries
 * map deterministically onto a PLANNED handbook page id
 * ({@code cuprum:<family>/<contract_key|folded id>}), the mapping is collision-free, and —
 * critically — nothing shipped by this foundation claims any of it is implemented: the
 * shipped {@code diagnostics} category is not a catalog family, and the committed page ids
 * and subjects are fully disjoint from the planned set (catalog gameplay like U04–U20 is
 * owned by other specialists). The registry-driven runtime gate
 * ({@code handbook_completeness_registry} server GameTest) enforces the shipped half; this
 * test pins the forward contract each feature wave inherits (handbook-config.md §9 ratchet).
 */
final class HandbookPlanCompletenessTest {
    @Test
    void allCatalogEntriesMapToUniquePlannedPages() throws IOException {
        Map<String, String> planned = plannedPagesByEntry();
        assertEquals(300, planned.size(), "the sealed catalog has exactly 300 entries");
        TreeSet<String> uniquePages = new TreeSet<>(planned.values());
        assertEquals(planned.size(), uniquePages.size(),
                "planned handbook page ids must be collision-free across all catalog entries");
        for (Map.Entry<String, String> entry : planned.entrySet()) {
            assertTrue(entry.getValue().matches("cuprum:[a-z0-9_]+/[a-z0-9_]+"),
                    "planned page id for " + entry.getKey() + " is malformed: " + entry.getValue());
        }
    }

    @Test
    void shippedSubjectsDocumentOnlyNonCatalogInfrastructure() throws IOException {
        // The catalog contains W1-planned gameplay entries (U04/U05/U06/U07/U16/U20 — owned
        // by other specialists, not this foundation). The binding invariant is that nothing
        // SHIPPED claims them: every committed subject id is diagnostics infrastructure whose
        // path never matches a catalog contract slug.
        TreeSet<String> catalogSlugs = new TreeSet<>();
        for (JsonElement element : catalogEntries()) {
            JsonObject entry = element.getAsJsonObject();
            assertTrue(entry.get("planned_wave").getAsString().matches("W\\d+"),
                    entry.get("id").getAsString() + " has a malformed planned_wave");
            catalogSlugs.add(slugOf(entry));
        }
        for (Map.Entry<String, JsonObject> page : HandbookJsonFixture.loadAll("pages").entrySet()) {
            for (String subject : HandbookJsonFixture.stringList(page.getValue(), "subject")) {
                String path = subject.substring(subject.indexOf(':') + 1);
                assertFalse(catalogSlugs.contains(path),
                        "shipped page " + page.getKey() + " documents subject " + subject
                                + " which matches catalog contract slug '" + path
                                + "' — that would falsely claim the feature is implemented");
            }
        }
    }

    @Test
    void shippedPagesAreDisjointFromThePlannedCatalogSet() throws IOException {
        TreeSet<String> plannedPages = new TreeSet<>(plannedPagesByEntry().values());
        TreeSet<String> catalogFamilies = new TreeSet<>();
        for (JsonElement element : catalogEntries()) {
            catalogFamilies.add(element.getAsJsonObject().get("family").getAsString());
        }
        Map<String, JsonObject> committed = HandbookJsonFixture.loadAll("pages");
        assertEquals(3, committed.size(), "W1 ships exactly the three diagnostics pages (plan D6)");
        for (Map.Entry<String, JsonObject> page : committed.entrySet()) {
            String pageId = page.getValue().get("id").getAsString();
            assertFalse(plannedPages.contains(pageId),
                    "shipped page " + pageId + " collides with a planned catalog page — "
                            + "it would falsely claim that feature is implemented");
            String category = pageId.substring("cuprum:".length(), pageId.indexOf('/'));
            assertFalse(catalogFamilies.contains(category),
                    "shipped W1 category '" + category + "' must not be a catalog family");
        }
    }

    /** Deterministic forward contract: {@code cuprum:<family>/<contract_key|folded id>}. */
    private static Map<String, String> plannedPagesByEntry() throws IOException {
        TreeMap<String, String> out = new TreeMap<>();
        for (JsonElement element : catalogEntries()) {
            JsonObject entry = element.getAsJsonObject();
            out.put(entry.get("id").getAsString(),
                    "cuprum:" + entry.get("family").getAsString() + "/" + slugOf(entry));
        }
        return out;
    }

    private static String slugOf(JsonObject entry) {
        return entry.has("contract_key")
                ? entry.get("contract_key").getAsString()
                : entry.get("id").getAsString().toLowerCase(Locale.ROOT).replace('-', '_');
    }

    private static List<JsonElement> catalogEntries() throws IOException {
        Path file = Path.of(System.getProperty("cuprum.catalogDir", "catalog")).resolve("catalog.json");
        assertTrue(Files.isRegularFile(file), "catalog.json missing: " + file);
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            return new Gson().fromJson(reader, JsonObject.class).getAsJsonArray("entries").asList();
        }
    }
}
