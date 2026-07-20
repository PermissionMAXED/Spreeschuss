package dev.cuprum.catalogtool;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static dev.cuprum.catalogtool.CatalogValidatorTest.repoCatalog;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Structural expectations for the CP0B+CP0C repository catalog: 23 user contracts
 * (U01–U22 at sequences 1–22, U23 at 273) plus the 277 additional concept features
 * (222 core / 55 stretch) in the fixed family order, with a dependency graph that is
 * closed, backward-only for additional entries, and whose core subset never depends on
 * stretch.
 *
 * <p>The per-family expectations here are an independent restatement of the INDEX.md
 * family-ranges table; full per-row agreement with the docs is enforced separately by
 * {@link ConceptParity} (see {@link ConceptParityTest}).
 */
class Cp0bCatalogTest {
    /** prefix, catalog family string, seqLo, seqHi, count, core, stretch, core wave. */
    private record Family(String prefix, String family, int seqLo, int seqHi, int count,
                          int core, int stretch, String coreWave) {
    }

    private static final List<Family> FAMILIES = List.of(
            new Family("PWR", "power_grid", 23, 46, 24, 21, 3, "W5"),
            new Family("OXI", "oxidation_metallurgy", 47, 64, 18, 16, 2, "W6"),
            new Family("SHD", "shield_tech", 65, 78, 14, 11, 3, "W7"),
            new Family("TES", "tesla_combat", 79, 94, 16, 12, 4, "W7"),
            new Family("TUB", "tube_logistics", 95, 108, 14, 12, 2, "W8"),
            new Family("RAIL", "mag_transport", 109, 122, 14, 11, 3, "W8"),
            new Family("GOL", "golemcraft", 123, 142, 20, 16, 4, "W9"),
            new Family("WEA", "weather_sky", 143, 156, 14, 10, 4, "W9"),
            new Family("TOOL", "gadgets", 157, 178, 22, 17, 5, "W10"),
            new Family("EXO", "exo_modules", 179, 192, 14, 11, 3, "W9"),
            new Family("MOB", "creatures", 193, 204, 12, 9, 3, "W11"),
            new Family("GEN", "worldgen", 205, 218, 14, 10, 4, "W11"),
            new Family("FX", "effects_enchants", 219, 234, 16, 13, 3, "W12"),
            new Family("ADV", "progression", 235, 244, 10, 9, 1, "W12"),
            new Family("DEC", "decor_building", 245, 260, 16, 12, 4, "W13"),
            new Family("QOL", "quality_of_life", 261, 272, 12, 12, 0, "W13"),
            // CP0C: U23 occupies global sequence 273; VFX follows at 274–300.
            new Family("VFX", "holo_projection", 274, 300, 27, 20, 7, "W13"));

    @Test
    void totalCountAndTierSplit() throws Exception {
        JsonArray entries = repoCatalog().getAsJsonArray("entries");
        assertEquals(300, entries.size(), "catalog must hold 23 user + 277 additional entries");

        int user = 0;
        int additionalCore = 0;
        int additionalStretch = 0;
        for (JsonElement element : entries) {
            JsonObject entry = element.getAsJsonObject();
            if ("user".equals(entry.get("origin").getAsString())) {
                user++;
            } else if ("core".equals(entry.get("tier").getAsString())) {
                additionalCore++;
            } else {
                additionalStretch++;
            }
        }
        assertEquals(23, user);
        assertEquals(222, additionalCore);
        assertEquals(55, additionalStretch);
    }

    @Test
    void sequenceIsContiguousOneToThreeHundred() throws Exception {
        JsonArray entries = repoCatalog().getAsJsonArray("entries");
        for (int i = 0; i < entries.size(); i++) {
            assertEquals(i + 1, entries.get(i).getAsJsonObject().get("sequence").getAsInt(),
                    "sequence at file position " + i);
        }
        assertEquals(300, entries.get(entries.size() - 1).getAsJsonObject().get("sequence").getAsInt());
        // U23 sits at file position 273 (sequence 273), directly before the VFX family.
        assertEquals("U23", entries.get(272).getAsJsonObject().get("id").getAsString());
    }

    @Test
    void familyRangesCountsAndWaves() throws Exception {
        JsonArray entries = repoCatalog().getAsJsonArray("entries");
        Map<String, List<JsonObject>> byPrefix = new HashMap<>();
        for (JsonElement element : entries) {
            JsonObject entry = element.getAsJsonObject();
            String id = entry.get("id").getAsString();
            if (id.startsWith("U") && !id.contains("-")) {
                continue;
            }
            byPrefix.computeIfAbsent(id.substring(0, id.indexOf('-')), key -> new ArrayList<>()).add(entry);
        }
        assertEquals(FAMILIES.size(), byPrefix.size(), "unexpected set of family prefixes: " + byPrefix.keySet());

        for (Family family : FAMILIES) {
            List<JsonObject> members = byPrefix.get(family.prefix());
            assertEquals(family.count(), members.size(), family.prefix() + " count");
            int core = 0;
            int stretch = 0;
            for (int i = 0; i < members.size(); i++) {
                JsonObject entry = members.get(i);
                String id = entry.get("id").getAsString();
                assertEquals(String.format("%s-%02d", family.prefix(), i + 1), id,
                        family.prefix() + " ids must be contiguous from 01 in order");
                int sequence = entry.get("sequence").getAsInt();
                assertEquals(family.seqLo() + i, sequence, id + " global sequence");
                assertTrue(sequence >= family.seqLo() && sequence <= family.seqHi(), id + " in range");
                assertEquals(family.family(), entry.get("family").getAsString(), id + " family string");
                String tier = entry.get("tier").getAsString();
                String wave = entry.get("planned_wave").getAsString();
                if ("core".equals(tier)) {
                    core++;
                    assertEquals(family.coreWave(), wave, id + " core wave");
                } else {
                    stretch++;
                    assertEquals("W15", wave, id + " stretch wave");
                }
            }
            assertEquals(family.core(), core, family.prefix() + " core count");
            assertEquals(family.stretch(), stretch, family.prefix() + " stretch count");
        }
    }

    @Test
    void dependencyClosureIsBackwardOnlyAndAcyclic() throws Exception {
        JsonArray entries = repoCatalog().getAsJsonArray("entries");
        Map<String, JsonObject> byId = new HashMap<>();
        for (JsonElement element : entries) {
            JsonObject entry = element.getAsJsonObject();
            byId.put(entry.get("id").getAsString(), entry);
        }
        for (JsonElement element : entries) {
            JsonObject entry = element.getAsJsonObject();
            String id = entry.get("id").getAsString();
            boolean additional = "additional".equals(entry.get("origin").getAsString());
            for (JsonElement dep : entry.getAsJsonArray("deps")) {
                String depId = dep.getAsString();
                JsonObject depEntry = byId.get(depId);
                assertTrue(depEntry != null, id + " depends on unknown id " + depId);
                if (additional && "additional".equals(depEntry.get("origin").getAsString())) {
                    // Backward-only deps make the additional-graph a DAG by construction.
                    assertTrue(depEntry.get("sequence").getAsInt() < entry.get("sequence").getAsInt(),
                            id + " must not have a forward dependency on " + depId);
                }
            }
        }
    }

    @Test
    void coreEntriesNeverDependOnStretch() throws Exception {
        JsonArray entries = repoCatalog().getAsJsonArray("entries");
        Map<String, String> tierById = new HashMap<>();
        for (JsonElement element : entries) {
            JsonObject entry = element.getAsJsonObject();
            tierById.put(entry.get("id").getAsString(), entry.get("tier").getAsString());
        }
        for (JsonElement element : entries) {
            JsonObject entry = element.getAsJsonObject();
            if (!"core".equals(entry.get("tier").getAsString())) {
                continue;
            }
            String id = entry.get("id").getAsString();
            for (JsonElement dep : entry.getAsJsonArray("deps")) {
                assertEquals("core", tierById.get(dep.getAsString()),
                        id + " (core) must not depend on stretch entry " + dep.getAsString());
            }
        }
    }

    /**
     * Evaluator-repaired semantic contracts that are machine-checkable from the catalog:
     * RAIL-10 route cards and GOL-03 punch cards are independent codecs (neither depends
     * on the other); FX-14's brewing ingredient OXI-16 is core so the core potion line
     * never needs stretch content; GEN-07's loot dependency TUB-08 is core for the same
     * reason; ADV-04 depends on U21 (it unlocks an overdrive mode) but nothing user-side
     * or base depends on ADV-04, so base U21 is never gated behind the boss drop.
     */
    @Test
    void repairedSemanticContractsHold() throws Exception {
        JsonArray entries = repoCatalog().getAsJsonArray("entries");
        Map<String, JsonObject> byId = new HashMap<>();
        for (JsonElement element : entries) {
            JsonObject entry = element.getAsJsonObject();
            byId.put(entry.get("id").getAsString(), entry);
        }

        // Route cards (RAIL-10) and golem punch cards (GOL-03) are independent contracts.
        assertTrue(depsOf(byId.get("RAIL-10")).stream().noneMatch("GOL-03"::equals),
                "RAIL-10 route cards must not depend on GOL-03 punch cards");
        assertTrue(depsOf(byId.get("GOL-03")).stream().noneMatch("RAIL-10"::equals),
                "GOL-03 punch cards must not depend on RAIL-10 route cards");

        // FX-14 (core) brews from OXI-16, which must itself be core.
        assertEquals("core", byId.get("FX-14").get("tier").getAsString());
        assertTrue(depsOf(byId.get("FX-14")).contains("OXI-16"), "FX-14 must consume OXI-16");
        assertEquals("core", byId.get("OXI-16").get("tier").getAsString(),
                "FX-14's brewing ingredient must be core");

        // GEN-07 (core) shipwreck loot carries TUB-08 capsules, which must be core.
        assertEquals("core", byId.get("GEN-07").get("tier").getAsString());
        assertTrue(depsOf(byId.get("GEN-07")).contains("TUB-08"), "GEN-07 loot must reference TUB-08");
        assertEquals("core", byId.get("TUB-08").get("tier").getAsString(),
                "GEN-07's loot dependency must be core");

        // ADV-04 unlocks a U21 overdrive mode: ADV-04 -> U21, never the reverse; no user
        // contract may depend on any additional entry (base features stay ungated).
        assertTrue(depsOf(byId.get("ADV-04")).containsAll(List.of("U21", "MOB-04")));
        for (JsonElement element : entries) {
            JsonObject entry = element.getAsJsonObject();
            if (!"user".equals(entry.get("origin").getAsString())) {
                continue;
            }
            for (String dep : depsOf(entry)) {
                assertTrue(dep.startsWith("U"),
                        entry.get("id").getAsString() + " (user) must not be gated on additional entry " + dep);
            }
        }

        // Evaluator retiering swap: QOL-11/QOL-12 are core; WEA-05/TES-16 are stretch.
        assertEquals("core", byId.get("QOL-11").get("tier").getAsString());
        assertEquals("core", byId.get("QOL-12").get("tier").getAsString());
        assertEquals("stretch", byId.get("WEA-05").get("tier").getAsString());
        assertEquals("stretch", byId.get("TES-16").get("tier").getAsString());
    }

    private static List<String> depsOf(JsonObject entry) {
        List<String> deps = new ArrayList<>();
        for (JsonElement dep : entry.getAsJsonArray("deps")) {
            deps.add(dep.getAsString());
        }
        return deps;
    }

    @Test
    void additionalNamesAreUniqueAndDistinctFromUserNames() throws Exception {
        JsonArray entries = repoCatalog().getAsJsonArray("entries");
        Set<String> names = new HashSet<>();
        for (JsonElement element : entries) {
            String name = element.getAsJsonObject().get("name").getAsString();
            assertTrue(names.add(name), "duplicate entry name '" + name + "'");
        }
        assertEquals(300, names.size());
    }
}
