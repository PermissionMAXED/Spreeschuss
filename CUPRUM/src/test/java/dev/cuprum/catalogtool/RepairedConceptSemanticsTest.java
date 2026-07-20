package dev.cuprum.catalogtool;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import static dev.cuprum.catalogtool.CatalogValidatorTest.repoCatalog;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Independent semantic regression tests for the final evaluator-repaired concept
 * contracts. These assert the repaired facts directly against the concept docs and the
 * catalog — deliberately not routed through {@link ConceptParity}'s generic checks — so
 * a regression of any individual repair fails its own named test.
 */
class RepairedConceptSemanticsTest {
    private static final Path DOCS_DIR =
            Path.of(System.getProperty("cuprum.conceptDocsDir", "docs/feature-concepts"));

    private static String indexText;
    private static Map<String, ConceptIndex.FamilyRow> rowsById;
    private static Map<String, String> waveById;
    private static Map<String, JsonObject> catalogById;

    @BeforeAll
    static void load() throws Exception {
        indexText = Files.readString(DOCS_DIR.resolve("INDEX.md"));
        ConceptIndex index = ConceptIndex.parse(DOCS_DIR);
        rowsById = new LinkedHashMap<>();
        for (ConceptIndex.FamilyRange range : index.familyRanges().values()) {
            for (ConceptIndex.FamilyRow row : ConceptIndex.parseFamilyFile(DOCS_DIR, range)) {
                rowsById.put(row.id(), row);
            }
        }
        waveById = new HashMap<>();
        for (ConceptIndex.ChecklistRow row : index.checklist()) {
            waveById.put(row.id(), row.wave());
        }
        catalogById = new HashMap<>();
        for (JsonElement element : repoCatalog().getAsJsonArray("entries")) {
            JsonObject entry = element.getAsJsonObject();
            catalogById.put(entry.get("id").getAsString(), entry);
        }
    }

    private static ConceptIndex.FamilyRow row(String id) {
        ConceptIndex.FamilyRow row = rowsById.get(id);
        assertTrue(row != null, "no concept row " + id);
        return row;
    }

    private static List<String> catalogDeps(String id) {
        JsonObject entry = catalogById.get(id);
        assertTrue(entry != null, "no catalog entry " + id);
        List<String> deps = new ArrayList<>();
        for (JsonElement dep : entry.getAsJsonArray("deps")) {
            deps.add(dep.getAsString());
        }
        return deps;
    }

    // ------------------------------------------------------------------
    // Canonical effect registrations (U03 Shock, U06 Corroded).
    // ------------------------------------------------------------------

    @Test
    void canonicalEffectValuesAreDeclaredInIndexVocabulary() {
        // U03 Shock: interrupt + Slowness IV, 40 ticks; 200-tick diminishing window
        // (20 then 10 ticks); 10-tick per-source re-application cooldown.
        assertTrue(indexText.contains("U03 owns and registers Shock"), "U03 registration sentence");
        assertTrue(indexText.contains("Slowness IV, 40 ticks"), "Shock base values");
        assertTrue(indexText.contains("repeat applications within 200 ticks last 20 then 10 ticks"),
                "Shock diminishing-return values");
        assertTrue(indexText.contains("10-tick per-source re-application cooldown"), "Shock cooldown");

        // U06 Corroded: -10% armor effectiveness per level, cap II = -20%, 200 ticks.
        assertTrue(indexText.contains("U06 owns and registers Corroded"), "U06 registration sentence");
        assertTrue(indexText.contains("\u221210% armor effectiveness per level, cap II = \u221220%,"
                + " 200 ticks"), "Corroded values");
    }

    @Test
    void noPreW12RowReferencesTheFxExtensions() {
        // FX-01/FX-02 are W12 extensions; earlier-wave rows must reference only the
        // canonical U03/U06 registrations, never the FX rows, in any of their 12 cells.
        Pattern fxExtension = Pattern.compile("\\bFX-0[12]\\b");
        List<String> preW12 = List.of("W5", "W6", "W7", "W8", "W9", "W10", "W11");
        for (ConceptIndex.FamilyRow row : rowsById.values()) {
            if (!preW12.contains(waveById.get(row.id()))) {
                continue;
            }
            for (String cell : row.cells()) {
                assertFalse(fxExtension.matcher(cell).find(),
                        row.id() + " (" + waveById.get(row.id()) + ") references FX-01/FX-02: " + cell);
            }
        }
    }

    // ------------------------------------------------------------------
    // Repaired dependency shapes.
    // ------------------------------------------------------------------

    @Test
    void dec08IsStandaloneWithoutTeleprinterCoupling() {
        assertEquals(List.of(), catalogDeps("DEC-08"), "DEC-08 must have no deps");
        assertFalse(row("DEC-08").acceptance().contains("PWR-23"),
                "DEC-08 base acceptance must not require the optional PWR-23 stretch feed");
    }

    @Test
    void repairedAcquisitionDepsHold() {
        Map<String, List<String>> expected = new LinkedHashMap<>();
        expected.put("GEN-01", List.of("MOB-05"));
        expected.put("GEN-02", List.of("WEA-06"));
        expected.put("GEN-04", List.of("WEA-01", "MOB-04"));
        expected.put("GEN-07", List.of("TUB-08"));
        expected.put("GEN-08", List.of("MOB-08", "OXI-02"));
        expected.put("GEN-09", List.of("U05", "PWR-06", "TOOL-04")); // cache holds PWR-06 cells
        expected.put("MOB-02", List.of("U06", "OXI-04")); // dust feeds an OXI-04 alt recipe
        expected.put("MOB-05", List.of("OXI-15")); // scrap recycles at the casting table
        expected.put("QOL-01", List.of("U22", "OXI-03")); // "?" deep-links the kiln chapter
        expected.put("ADV-08", List.of("U22", "GEN-01"));
        expected.put("ADV-09", List.of("MOB-08", "ADV-04", "PWR-14", "SHD-10", "TES-08"));
        expected.put("MOB-07", List.of("TOOL-17"));
        expected.put("MOB-08", List.of("OXI-03", "GOL-03", "TOOL-04"));
        expected.put("FX-01", List.of("U03", "TES-03", "TES-04"));
        expected.put("FX-04", List.of("U03", "FX-03"));
        expected.put("FX-07", List.of("FX-04", "TES-04"));
        expected.put("FX-11", List.of("U05", "PWR-19"));
        expected.put("FX-12", List.of("OXI-13", "MOB-09"));
        expected.put("FX-14", List.of("FX-05", "OXI-16"));
        expected.put("WEA-11", List.of("U05", "PWR-09"));
        expected.put("EXO-06", List.of("EXO-01", "U05", "PWR-19"));
        expected.put("EXO-07", List.of("EXO-01", "U13"));
        expected.put("TES-10", List.of("U03", "U07", "U09", "TES-04", "OXI-06"));
        expected.put("TOOL-08", List.of("U05", "WEA-06"));
        expected.put("TOOL-17", List.of("U19"));
        expected.put("QOL-11", List.of("WEA-06"));
        expected.put("DEC-13", List.of("U05", "GEN-05"));
        expected.put("MOB-06", List.of("OXI-04"));
        expected.put("SHD-02", List.of("U01", "U02", "SHD-01"));
        for (Map.Entry<String, List<String>> entry : expected.entrySet()) {
            assertEquals(entry.getValue(), catalogDeps(entry.getKey()), entry.getKey() + " deps");
        }
        // GOL-20 sources from vanilla loot: no worldgen dependency.
        assertEquals(List.of("GOL-01"), catalogDeps("GOL-20"), "GOL-20 must not depend on worldgen");
    }

    @Test
    void routeCardsAndPunchCardsStayIndependent() {
        assertFalse(catalogDeps("RAIL-10").contains("GOL-03"), "RAIL-10 must not depend on GOL-03");
        assertFalse(catalogDeps("GOL-03").contains("RAIL-10"), "GOL-03 must not depend on RAIL-10");
        assertTrue(row("RAIL-10").playerBehavior().contains("separate from golem punch cards"),
                "RAIL-10 behavior must state codec independence");
    }

    @Test
    void oxi04BootstrapsFromVanillaMaterials() {
        // OXI-04 must not depend on MOB-06 (feathers are an optional later alternative);
        // MOB-06 declares the backward dependency instead.
        assertEquals(List.of(), catalogDeps("OXI-04"), "OXI-04 must be dependency-free");
        assertTrue(catalogDeps("MOB-06").contains("OXI-04"), "MOB-06 adds the optional alternative");
        assertTrue(row("OXI-04").acceptance().contains("4 oxidized cut copper + 1 bottle"),
                "OXI-04 acceptance must assert the vanilla-material bootstrap recipe");
        // OXI-03 likewise bootstraps: its only dep is its registered output OXI-02.
        assertEquals(List.of("OXI-02"), catalogDeps("OXI-03"));
        assertTrue(row("OXI-03").acceptance().contains("6 bricks + 2 copper ingots + 1 furnace"),
                "OXI-03 acceptance must assert the vanilla-material kiln recipe");
    }

    @Test
    void adv04GatesOnlyTheOverdriveModeNeverBaseU21() {
        assertEquals(List.of("U21", "MOB-04"), catalogDeps("ADV-04"));
        assertTrue(row("ADV-04").acceptance().contains("Without the core, U21 crafts and runs all base modes"),
                "ADV-04 acceptance must assert base U21 stays ungated");
        // No user contract may depend on any additional entry.
        for (Map.Entry<String, JsonObject> entry : catalogById.entrySet()) {
            if (!"user".equals(entry.getValue().get("origin").getAsString())) {
                continue;
            }
            for (String dep : catalogDeps(entry.getKey())) {
                assertTrue(dep.startsWith("U"), entry.getKey() + " gated on additional " + dep);
            }
        }
    }

    // ------------------------------------------------------------------
    // Authority/permission rules.
    // ------------------------------------------------------------------

    @Test
    void wea03IsPermissionGatedGlobalWithCooldown() {
        ConceptIndex.FamilyRow row = row("WEA-03");
        assertTrue(row.playerBehavior().contains("dimension-global"), "WEA-03 declares global scope");
        assertTrue(row.playerBehavior().contains("cuprum.weather.use"), "WEA-03 permission node");
        assertTrue(row.playerBehavior().contains("36,000-tick per-dimension cooldown"), "WEA-03 cooldown");
        assertTrue(row.acceptance().contains("A second launch within 36,000 ticks is refused")
                        || row.acceptance().contains("a second launch within 36,000 ticks is refused"),
                "WEA-03 acceptance asserts the 36,000-tick cooldown: " + row.acceptance());
        assertTrue(row.acceptance().contains("non-permitted launch is refused"),
                "WEA-03 acceptance asserts the permission gate");
        assertTrue(indexText.contains("WEA-03 (cloud seeder) and U21 (weather manipulator) are the"
                        + " only dimension-global weather actions"),
                "INDEX sanctions exactly the two global weather actions");
    }

    @Test
    void qol03WrenchIsOwnerGatedAtomicWithRollback() {
        ConceptIndex.FamilyRow row = row("QOL-03");
        assertTrue(row.playerBehavior().contains("owner/team-permitted only"), "QOL-03 ownership gate");
        assertTrue(row.playerBehavior().contains("one atomic transaction"), "QOL-03 atomicity");
        assertTrue(row.acceptance().contains("a non-owner attempt on a claimed machine changes 0 blocks"),
                "QOL-03 acceptance asserts the ownership gate");
        assertTrue(row.acceptance().contains("rollback, 0 loss"), "QOL-03 acceptance asserts rollback");
    }

    @Test
    void tes12EmpDefaultsToHostileInfrastructureOnly() {
        ConceptIndex.FamilyRow row = row("TES-12");
        assertTrue(row.playerBehavior().contains("allied, neutral and claim-protected machines are exempt"),
                "TES-12 exemptions");
        assertTrue(row.playerBehavior().contains("emp_pvp_enabled")
                        && row.playerBehavior().contains("cuprum.emp.pvp"),
                "TES-12 pvp config/permission gate");
        assertTrue(row.acceptance().contains("allied-team and claim-protected machines are disabled 0 ticks"),
                "TES-12 acceptance asserts the exemption");
        assertTrue(row.acceptance().contains("per-thrower reuse cooldown 600 ticks"),
                "TES-12 acceptance asserts the cooldown");
    }

    @Test
    void gen14CraterCanNeverTouchPlayerBuilds() {
        ConceptIndex.FamilyRow row = row("GEN-14");
        assertTrue(row.acceptance().contains("newly generated, unclaimed chunk inside the world border"),
                "GEN-14 acceptance asserts chunk restrictions");
        assertTrue(row.acceptance().contains("replacing only natural-whitelist blocks"),
                "GEN-14 acceptance asserts the block whitelist");
        assertTrue(row.acceptance().contains("placement aborts with 0 blocks changed"),
                "GEN-14 acceptance asserts the abort path");
        assertTrue(indexText.contains("it can never touch player builds"), "INDEX security contract");
    }

    // ------------------------------------------------------------------
    // Numeric formula regressions.
    // ------------------------------------------------------------------

    @Test
    void gen03ViaductFitsInsideJigsawCap() {
        ConceptIndex.FamilyRow row = row("GEN-03");
        assertTrue(row.playerBehavior().contains("within 96 blocks of its structure center"),
                "GEN-03 declares the 96-block bound");
        assertTrue(row.acceptance().contains("96-block radius"), "GEN-03 acceptance asserts the bound");
        assertFalse(row.playerBehavior().contains("300") || row.acceptance().contains("300"),
                "GEN-03 must not claim a 300-block span (impossible under the 128-block jigsaw cap)");
        assertTrue(row.playerBehavior().contains("128-block jigsaw cap"), "GEN-03 cites the engine cap");
    }

    @Test
    void chargeEconomyFormulasAreArithmeticallyConsistent() {
        // One strike = 270,000 Cg; jar = 100,000 Cg; baseline B = 5 Cg/t.
        assertTrue(indexText.contains("one natural lightning strike deposits **270,000 Cg**"),
                "canonical strike deposit");
        assertTrue(indexText.contains("jar fill = 100,000 \u00f7 5 = 20,000 ticks"),
                "jar-fill formula literal");
        assertTrue(indexText.contains("one strike = 270,000 \u00f7 5 = 54,000 ticks"),
                "strike-equivalence formula literal");
        assertEquals(20_000, 100_000 / 5, "jar fill arithmetic");
        assertEquals(54_000, 270_000 / 5, "strike equivalence arithmetic");
        // 20,000 ticks = 16 min 40 s sits inside the documented 10-20 minute window.
        assertEquals(1_000, 20_000 / 20, "20,000 ticks in seconds");
        assertTrue(1_000 >= 600 && 1_000 <= 1_200, "jar fill inside the 10-20 min window");
        // The strike deposit is quoted consistently where it is consumed.
        assertTrue(row("PWR-13").acceptance().contains("270,000 Cg"), "PWR-13 surge magnitude");
        assertTrue(row("PWR-24").acceptance().contains("243,000 Cg (270,000 minus 10% string loss)"),
                "PWR-24 kite arithmetic (270,000 x 0.9 = 243,000)");
        assertEquals(243_000, 270_000 * 9 / 10, "kite loss arithmetic");
        assertTrue(row("SHD-04").acceptance().contains("243,000 Cg (270,000 minus 10% arc loss)"),
                "SHD-04 capture arithmetic");
        assertTrue(row("TES-11").acceptance().contains("full 270,000 Cg deposit"), "TES-11 full deposit");
    }

    @Test
    void exo11HeatModelIsArithmeticallyConsistent() {
        ConceptIndex.FamilyRow row = row("EXO-11");
        assertTrue(row.acceptance().contains("Heat rises 0.3/tick"), "heat rise rate");
        assertTrue(row.acceptance().contains("throttling starts at exactly 120 heat"), "throttle threshold");
        assertTrue(row.acceptance().contains("dissipating 0.2/tick (net 0.1/tick)"), "loop dissipation");
        assertTrue(row.acceptance().contains("exactly 1,200 ticks before throttle versus exactly 400"),
                "throttle windows");
        assertEquals(400, Math.round(120 / 0.3), "120 heat / 0.3 per tick without the loop");
        assertEquals(1_200, Math.round(120 / (0.3 - 0.2)), "120 heat / 0.1 net with the loop");
    }

    @Test
    void oxi03KilnCostsAreExact() {
        ConceptIndex.FamilyRow row = row("OXI-03");
        assertTrue(row.acceptance().contains("an unpowered alloy op takes exactly 200 ticks at 0 Cg"),
                "unpowered path: 0 Cg over 200 ticks");
        assertTrue(row.acceptance().contains("debits exactly 500 Cg upfront and completes in 100 ticks"),
                "fast path: 500 Cg upfront over 100 ticks");
        assertTrue(row.acceptance().contains("no per-tick draw"), "fast path is an upfront debit");
    }

    @Test
    void pwr14LineLossPercentagesAreExact() {
        // Binding line-loss model: 2 pp per 16-block span bare, 0.5 pp per span HV;
        // a 128-block run = 8 spans, so 100 - 8x2 = 84% bare and 100 - 8x0.5 = 96% HV.
        ConceptIndex.FamilyRow row = row("PWR-14");
        assertTrue(row.acceptance().contains("HV delivers exactly 96% of input (8 \u00d7 0.5 pp linear loss)"),
                "PWR-14 HV percentage");
        assertTrue(row.acceptance().contains("delivers exactly 84% (8 \u00d7 2 pp linear loss, clamped at 0%)"),
                "PWR-14 bare-wire percentage");
        assertEquals(84, 100 - 8 * 2, "bare-wire loss arithmetic");
        assertEquals(96.0, 100 - 8 * 0.5, "HV loss arithmetic");
        assertTrue(indexText.contains("a 128-block run delivers exactly 84% bare and 96% HV"),
                "INDEX quotes the same span numbers");
    }

    @Test
    void shdUpkeepCeilValuesAreArithmeticallyExact() throws Exception {
        // Dome upkeep = ceil(0.5*R^2); modulators = ceil(base*0.6) / ceil(base*0.7).
        int[] radii = {8, 12, 16, 24};
        int[] base = {32, 72, 128, 288};
        int[] kinetic = {20, 44, 77, 173};
        int[] biotic = {23, 51, 90, 202};
        for (int i = 0; i < radii.length; i++) {
            assertEquals(base[i], (int) Math.ceil(0.5 * radii[i] * radii[i]),
                    "ceil(0.5*R^2) for R=" + radii[i]);
            assertEquals(kinetic[i], (int) Math.ceil(base[i] * 0.6),
                    "ceil(base*0.6) for base=" + base[i]);
            assertEquals(biotic[i], (int) Math.ceil(base[i] * 0.7),
                    "ceil(base*0.7) for base=" + base[i]);
        }
        String shd = Files.readString(DOCS_DIR.resolve("SHD.md"));
        assertTrue(shd.contains("ceil(0.5\u00b7R\u00b2) Cg/t (R8=32, R12=72, R16=128, R24=288)"),
                "SHD balance constants declare the ceil formula and values");
        assertTrue(row("SHD-01").acceptance().contains("radius exactly 8/12/16/24 with upkeep 32/72/128/288 Cg/t"),
                "SHD-01 quotes the base upkeep tiers");
        assertTrue(row("SHD-02").acceptance().contains("exactly 20/44/77/173 for bases 32/72/128/288"),
                "SHD-02 quotes the kinetic ceil values");
        assertTrue(row("SHD-03").acceptance().contains("exactly 23/51/90/202 for bases 32/72/128/288"),
                "SHD-03 quotes the biotic ceil values");
    }

    @Test
    void fxPerformanceBudgetIsNumeric() throws Exception {
        // The FX family budget is fully numeric: 500 instances, 0.20 ms/server tick,
        // averaged over 1,000 ticks, enforced by a named W14 perf gate.
        String fx = Files.readString(DOCS_DIR.resolve("FX.md"));
        assertTrue(fx.contains("500 concurrently active Cuprum effect instances add at most"
                        + " 0.20 ms/server tick averaged over 1,000 ticks"),
                "FX budget declares 500 instances / 0.20 ms / 1,000 ticks");
        assertTrue(fx.contains("`w14_fx_effect_budget`"), "FX budget names its perf gate");
    }

    @Test
    void vfxHolosphereBudgetIsNumericAndFrozen() throws Exception {
        // CP0C VFX family budget pins: frozen shader inventory of exactly 2
        // RenderTypes, per-projector vert/callback caps, the HOLO particle carve-out
        // inside the existing FX totals, the 3 Hz flash cap, the W14 frame gate and
        // the exact +2/+4 Cg/t upkeep adders.
        String vfx = Files.readString(DOCS_DIR.resolve("VFX.md"));
        assertTrue(vfx.contains("exactly 2 RenderTypes family-wide"),
                "VFX budget freezes the shader inventory at 2 RenderTypes");
        assertTrue(vfx.contains("`cuprum:holo_surface`") && vfx.contains("`cuprum:holo_interior`"),
                "VFX budget names both RenderTypes");
        assertTrue(vfx.contains("one no-cull additive surface geometry callback \u22644,096 verts"
                        + " + one interior geometry callback \u22648,192 verts,"
                        + " \u22642 geometry callbacks total per frame"),
                "VFX budget pins the per-projector 4,096/8,192 vert and \u22642 callback caps");
        assertTrue(vfx.contains("HOLO particle sub-pool \u226432 spawn/tick and \u2264128 live,"
                        + " carved from the existing 64/256 family totals"),
                "VFX budget pins the HOLO 32/128 carve-out of the 64/256 totals");
        assertTrue(vfx.contains("flash rate \u22643 Hz everywhere"),
                "VFX budget pins the 3 Hz flash cap");
        assertTrue(vfx.contains("\u22641.5 ms/frame") && vfx.contains("`w14_holo_frame_budget`"),
                "VFX budget names the 1.5 ms W14 frame gate");
        assertTrue(vfx.contains("lens +2 Cg/t, cartridge +4 Cg/t on U23 upkeep"),
                "VFX balance constants pin the +2/+4 Cg/t upkeep adders");
        assertTrue(vfx.contains("the 6 support systems (VFX-22..27) add zero pipelines"),
                "VFX budget keeps the support systems pipeline-free");
    }

    @Test
    void tesFxStackingNeverReplacesTheBaseShock() {
        // TES-03 applies the base canonical U03 Shock; FX-01 is a separate stackable
        // W12 layer on top — the base effect is never replaced or re-registered.
        assertTrue(row("TES-03").playerBehavior().contains("base canonical U03 Shock stun proc"),
                "TES-03 applies the base Shock");
        assertTrue(row("TES-03").playerBehavior().contains(
                        "stack on top of this base Shock and never replace or re-register it"),
                "TES-03 declares the stacking contract");
        assertTrue(row("FX-01").playerBehavior().contains("Separate stackable W12 effect layered over"
                        + " the canonical U03 Shock"),
                "FX-01 is a separate stackable layer");
        assertTrue(row("FX-01").playerBehavior().contains("never replaced or re-registered"),
                "FX-01 never replaces the base registration");
        assertTrue(row("FX-01").acceptance().contains("applies both the base 40-tick U03 Shock and"
                        + " Overload Shock for exactly 60 ticks"),
                "FX-01 acceptance asserts both effect instances");
        assertTrue(row("FX-01").acceptance().contains("2 effect instances present"),
                "FX-01 acceptance counts 2 stacked instances");
    }

    @Test
    void decLampBrightnessAndChimeSwayBandsAreExact() {
        // DEC-05 arc lamps: 4 exact brightness bands over live supply.
        assertTrue(row("DEC-05").acceptance().contains(
                        "exactly 0 at 0 Cg/t (dark), 7 at 1\u20134 Cg/t, 11 at 5\u201314 Cg/t and 15 at \u226515 Cg/t"),
                "DEC-05 quotes the 4 brightness bands");
        assertTrue(row("DEC-05").acceptance().contains("goes dark within 20 ticks"),
                "DEC-05 asserts the supply-loss deadline");
        // DEC-15 storm chimes: sway state tracks the 3 wind strength bands.
        assertTrue(row("DEC-15").acceptance().contains("sway state matches the 3 wind strength bands"),
                "DEC-15 quotes the 3 sway bands");
        assertTrue(row("DEC-15").acceptance().contains("exactly once per weather change to thunder"),
                "DEC-15 asserts the once-per-storm chord");
    }

    @Test
    void qol07ReiIntegrationScopeIsPinnedAndClientTested() {
        ConceptIndex.FamilyRow row = row("QOL-07");
        assertEquals("integration", row.type(), "QOL-07 is an integration entry");
        assertEquals(List.of(), catalogDeps("QOL-07"), "QOL-07 has no catalog deps");
        assertTrue(row.acceptance().contains("With REI 21.9.813 loaded"),
                "QOL-07 pins the exact REI version");
        assertTrue(row.acceptance().contains("all 4 machine categories appear")
                        && row.acceptance().contains("4 of 4 categories present"),
                "QOL-07 asserts the exact category count");
        assertTrue(row.test().startsWith("client_gametest:"),
                "QOL-07 REI assertions are client-scoped");
    }

    @Test
    void gen08UsesTheVanillaCopperBulbLampWithoutDecDependency() {
        ConceptIndex.FamilyRow row = row("GEN-08");
        assertTrue(row.playerBehavior().contains(
                        "lit lamp post built from the vanilla 1.21.9 copper bulb (available at W11; no DEC dependency)"),
                "GEN-08 lamp is the vanilla copper bulb");
        assertTrue(row.acceptance().contains("1 lit vanilla copper-bulb lamp post"),
                "GEN-08 acceptance asserts the vanilla lamp");
        assertTrue(catalogDeps("GEN-08").stream().noneMatch(dep -> dep.startsWith("DEC-")),
                "GEN-08 (W11) must not depend on the W13 DEC family");
    }

    @Test
    void mobDropSinkRoutesAreRegisteredWithTheMobFeatures() {
        // MOB-02 patina dust feeds an optional OXI-04 alternative recipe; MOB-05 cuprite
        // scrap recycles at the OXI-15 casting table. Both routes are registered with
        // the mob feature (backward dep), leaving the OXI bootstraps independent.
        assertTrue(row("MOB-02").acceptance().contains(
                        "the optional 3 dust + 1 bottle \u2192 1 OXI-04 extract recipe is registered"),
                "MOB-02 registers the dust-to-extract sink route");
        assertTrue(row("MOB-02").playerBehavior().contains("the OXI-04 vanilla bootstrap stays independent"),
                "MOB-02 keeps the OXI-04 bootstrap independent");
        assertTrue(row("MOB-05").acceptance().contains(
                        "the 4 scrap \u2192 1 cuprite alloy ingot casting-table recycle recipe is registered"),
                "MOB-05 registers the scrap recycle sink route");
        assertTrue(row("MOB-05").playerBehavior().contains("recycles at the OXI-15 casting table"),
                "MOB-05 behavior names the casting-table route");
    }

    // ------------------------------------------------------------------
    // Family-header budgets and row-level invariants (independent restatements).
    // ------------------------------------------------------------------

    @Test
    void everyFamilyFileDeclaresNumericBudgets() throws Exception {
        ConceptIndex index = ConceptIndex.parse(DOCS_DIR);
        Pattern digits = Pattern.compile("\\d");
        for (ConceptIndex.FamilyRange range : index.familyRanges().values()) {
            String text = Files.readString(DOCS_DIR.resolve(range.file()));
            assertTrue(text.contains("**Performance budget:**"),
                    range.file() + " must declare a performance budget");
            for (String label : List.of("**Performance budget:**", "**Balance constants:**")) {
                int at = text.indexOf(label);
                if (at < 0) {
                    continue; // balance constants: QOL's numbers live in its perf/security lines
                }
                String line = text.substring(at, text.indexOf('\n', at));
                assertTrue(digits.matcher(line).find(),
                        range.file() + " " + label + " line must carry concrete numbers: " + line);
            }
        }
    }

    @Test
    void everyRowCarriesStructuredVisualFallbacksAndScopedTests() {
        // Independent restatement of the ConceptParity row-quality rules, asserted
        // directly over the parsed rows so the invariant does not depend on the
        // ConceptParity implementation. Words that appear in the row's own feature name
        // (e.g. "Frame" in GOL-13 Backpack Frame) refer to that named game object and
        // are removed before scanning, mirroring the documented exemption.
        Pattern serverForbidden = Pattern.compile(
                "(?i)\\brender(?:s|ed|ing)?\\b|\\bvisuals?(?:ly)?\\b|\\bscreens?\\b"
                        + "|\\bdisplays?(?:ed|ing)?\\b|\\bpixels?\\b|\\bHUD\\b|\\bGUIs?\\b"
                        + "|\\bclients?(?:-side)?\\b|\\bfps\\b|\\bframes?(?:[- ]rates?)?\\b"
                        + "|\\bshaders?\\b|\\btextures?\\b|\\bmodels?\\b|\\baudio\\b");
        Pattern unitForbidden = Pattern.compile(
                "(?i)\\bblocks?\\b|\\bworlds?\\b|\\blevels?\\b|\\bentit(?:y|ies)\\b|\\bplayers?\\b"
                        + "|\\binventor(?:y|ies)\\b|\\bclaims?\\b|\\bpermissions?\\b"
                        + "|\\brender(?:s|ed|ing)?\\b|\\bscreens?\\b|\\bdisplays?(?:ed|ing)?\\b|\\bGUIs?\\b");
        Pattern nameWord = Pattern.compile("[A-Za-z]{3,}");
        for (ConceptIndex.FamilyRow row : rowsById.values()) {
            String visual = row.visualSignature();
            int t2 = visual.indexOf("T2:");
            int t3 = visual.indexOf("T3:");
            assertTrue(t2 >= 0 && t3 > t2,
                    row.id() + " visual must carry ordered structured T2: then T3: clauses");
            assertTrue(row.test().matches("(server_gametest|client_gametest|unit_test):[a-z0-9_]+"),
                    row.id() + " test id must carry a supported prefix");
            String scopeText = row.acceptance();
            var word = nameWord.matcher(row.name());
            while (word.find()) {
                scopeText = scopeText.replaceAll("(?i)\\b" + Pattern.quote(word.group()) + "s?\\b", " ");
            }
            if (row.test().startsWith("server_gametest:")) {
                assertFalse(serverForbidden.matcher(scopeText).find(),
                        row.id() + " server test must not assert client-side vocabulary: "
                                + row.acceptance());
            } else if (row.test().startsWith("unit_test:")) {
                assertFalse(unitForbidden.matcher(scopeText).find(),
                        row.id() + " unit test must not assert runtime vocabulary: "
                                + row.acceptance());
            }
        }
        assertEquals(277, rowsById.size());
    }
}
