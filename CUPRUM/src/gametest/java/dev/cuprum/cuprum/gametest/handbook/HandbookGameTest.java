package dev.cuprum.cuprum.gametest.handbook;

import dev.cuprum.cuprum.api.handbook.HandbookTopics;
import dev.cuprum.cuprum.handbook.HandbookManager;
import dev.cuprum.cuprum.handbook.HandbookModule;
import dev.cuprum.cuprum.handbook.net.HandbookRecipesPayload;
import dev.cuprum.cuprum.handbook.net.HandbookSyncPayload;
import dev.cuprum.cuprum.gametest.net.MockServerPlayers;
import io.netty.buffer.Unpooled;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.packs.PackLocationInfo;
import net.minecraft.server.packs.PackResources;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.metadata.MetadataSectionType;
import net.minecraft.server.packs.repository.KnownPack;
import net.minecraft.server.packs.repository.PackSource;
import net.minecraft.server.packs.resources.IoSupplier;
import net.minecraft.server.packs.resources.MultiPackResourceManager;
import net.minecraft.server.packs.resources.PreparableReloadListener;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.world.item.crafting.display.RecipeDisplay;

/**
 * Real-server handbook gates (plan §4-W1E). Malformed-data coverage drives the REAL
 * {@link HandbookManager} reloader against an in-memory resource set (the same sanctioned
 * pattern as {@code MultiblockPatternReloadGameTest}) so shipped/gametest data stays clean —
 * the smoke scripts scan production logs for ERROR lines, so hostile fixtures must never be
 * committed as static resources that load at every boot.
 */
public class HandbookGameTest {
    /** 3 shipped diagnostics pages + the gametest mod's locked fixture page (client unlock test). */
    private static final int EXPECTED_PAGES = 4;
    private static final int EXPECTED_CATEGORIES = 1;
    private static final ResourceLocation LOCKED_FIXTURE_PAGE =
            ResourceLocation.parse("cuprum-gametest:locked/gametest_probe");
    /** Fixture reload: parse kills syntax + unknown-key; link kills mismatched-id + orphan. */
    private static final int FIXTURE_LINK_SKIPS = 2;
    private static final int FIXTURE_PAGES = 2;

    /**
     * {@code handbook_completeness_registry} (handbook-config.md §9): every cuprum-namespace
     * block/item id appears in some loaded page's {@code subject}; the reviewed exempt list
     * is EMPTY in W1 (plan D6). Failure names every uncovered id.
     */
    @GameTest
    public void handbookCompletenessRegistry(GameTestHelper helper) {
        HandbookManager.Loaded loaded = HandbookManager.loaded();
        helper.assertValueEqual(0, loaded.exempt().size(),
                Component.literal("handbook/exempt.json must be empty in W1 (plan D6)"));

        Set<ResourceLocation> documented = loaded.documentedSubjects();
        TreeSet<ResourceLocation> uncovered = new TreeSet<>();
        for (ResourceLocation id : BuiltInRegistries.BLOCK.keySet()) {
            if (id.getNamespace().equals("cuprum") && !documented.contains(id)) {
                uncovered.add(id);
            }
        }
        for (ResourceLocation id : BuiltInRegistries.ITEM.keySet()) {
            if (id.getNamespace().equals("cuprum") && !documented.contains(id)) {
                uncovered.add(id);
            }
        }
        helper.assertTrue(uncovered.isEmpty(),
                Component.literal("undocumented cuprum registry ids (add pages + lang keys): " + uncovered));
        // Plan D6: the shipped id set is exactly these four (guards against silent registry drift).
        helper.assertValueEqual(
                new TreeSet<>(Set.of(
                        ResourceLocation.parse("cuprum:charge_probe"),
                        ResourceLocation.parse("cuprum:diagnostic_coil_core"),
                        ResourceLocation.parse("cuprum:diagnostic_coil_frame"),
                        ResourceLocation.parse("cuprum:fx_probe"))),
                new TreeSet<>(documented),
                Component.literal("documented subject union"));
        helper.succeed();
    }

    /**
     * {@code handbook_pages_valid}: the strict-codec store holds exactly the three shipped
     * pages plus the gametest locked fixture in deterministic order with ZERO skips (all
     * committed data is clean), every {@code HandbookTopics} constant resolves, and every
     * recipe widget id resolves to a displayable recipe (zero "recipe unavailable").
     */
    @GameTest
    public void handbookPagesValid(GameTestHelper helper) {
        HandbookManager.Loaded loaded = HandbookManager.loaded();
        helper.assertValueEqual(EXPECTED_CATEGORIES, loaded.categories().size(),
                Component.literal("category count"));
        helper.assertValueEqual(EXPECTED_PAGES, loaded.pages().size(), Component.literal("page count"));
        helper.assertValueEqual(0, loaded.skippedFiles(),
                Component.literal("shipped handbook data parses and links with zero skips"));

        // Deterministic registry order: category sort/id, then page id (never parse order;
        // ResourceLocation compares path first, so the locked fixture sorts last).
        helper.assertValueEqual(
                List.of(HandbookTopics.CHARGE_PROBE, HandbookTopics.DIAGNOSTIC_COIL,
                        HandbookTopics.FX_PROBE, LOCKED_FIXTURE_PAGE),
                List.copyOf(loaded.pages().keySet()),
                Component.literal("deterministic page order"));

        for (ResourceLocation topic : HandbookTopics.all()) {
            helper.assertTrue(loaded.page(topic).isPresent(),
                    Component.literal("HandbookTopics constant does not resolve: " + topic));
        }

        MinecraftServer server = helper.getLevel().getServer();
        Map<ResourceLocation, RecipeDisplay> displays = HandbookModule.buildRecipesPayload(server).displays();
        TreeSet<ResourceLocation> wanted = new TreeSet<>();
        loaded.pages().values().forEach(page -> wanted.addAll(page.recipeIds()));
        helper.assertValueEqual(wanted, new TreeSet<>(displays.keySet()),
                Component.literal("every recipe widget id resolves to a RecipeDisplay"));
        helper.assertTrue(displays.containsKey(ResourceLocation.parse("cuprum:charge_probe")),
                Component.literal("charge_probe recipe display present"));
        helper.succeed();
    }

    /**
     * {@code handbook_sync_on_join}: a real JOIN (mock player over an embedded channel) sends
     * exactly one sync + one recipes payload; the wire round-trip of the captured snapshot
     * decodes to the server store counts; both encodings stay under the 8 KiB S2C budget.
     */
    @GameTest(environment = "cuprum-gametest:handbook_join")
    public void handbookSyncOnJoin(GameTestHelper helper) {
        MinecraftServer server = helper.getLevel().getServer();
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "hbJoin")) {
            List<HandbookSyncPayload> syncs = mock.sentPayloads(HandbookSyncPayload.class);
            List<HandbookRecipesPayload> recipes = mock.sentPayloads(HandbookRecipesPayload.class);
            helper.assertValueEqual(1, syncs.size(), Component.literal("exactly one handbook/sync on join"));
            helper.assertValueEqual(1, recipes.size(), Component.literal("exactly one handbook/recipes on join"));

            HandbookSyncPayload decoded = wireRoundTrip(server, syncs.get(0));
            helper.assertValueEqual(HandbookManager.loaded().pages().size(), decoded.pages().size(),
                    Component.literal("decoded page count equals server store count"));
            helper.assertValueEqual(HandbookManager.loaded().categories().size(),
                    decoded.categories().size(),
                    Component.literal("decoded category count equals server store count"));

            int syncBytes = HandbookModule.encodedSize(server, syncs.get(0), HandbookSyncPayload.STREAM_CODEC);
            int recipeBytes = HandbookModule.encodedSize(server, recipes.get(0), HandbookRecipesPayload.STREAM_CODEC);
            helper.assertTrue(syncBytes > 0 && syncBytes <= HandbookModule.S2C_DEFAULT_BUDGET_BYTES,
                    Component.literal("sync payload " + syncBytes + " B within the 8 KiB budget"));
            helper.assertTrue(recipeBytes > 0 && recipeBytes <= HandbookModule.S2C_DEFAULT_BUDGET_BYTES,
                    Component.literal("recipes payload " + recipeBytes + " B within the 8 KiB budget"));
        }
        helper.succeed();
    }

    /**
     * {@code handbook_reload_resync} (handbook-config.md §10): the datapack-reload half of
     * the sync contract, against the REAL reloader fed an in-memory resource set of two
     * valid fixture pages plus four hostile files (bad syntax, unknown key, mismatched id,
     * orphan category) and a non-empty exempt list. The broken files are logged + skipped
     * (server demonstrably up — this test keeps running), the resync broadcast delivers
     * exactly one sync + one recipes pair carrying only the valid pages, previously shipped
     * pages are MISSING from the new store (the client's missing-page path input), and the
     * production data is restored afterwards with exact counts.
     */
    @GameTest(environment = "cuprum-gametest:handbook_resync")
    public void handbookReloadResync(GameTestHelper helper) {
        MinecraftServer server = helper.getLevel().getServer();
        ResourceManager production = server.getResourceManager();
        int generationBefore = HandbookManager.reloadGeneration();
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "hbResync")) {
            // Drop the join-time payloads so the resync counts below are exact.
            mock.connection().flushChannel();
            mock.channel().outboundMessages().clear();

            boolean restored = false;
            try {
                try (MultiPackResourceManager fixture = new MultiPackResourceManager(
                        PackType.SERVER_DATA, List.of(new JsonPack(fixtureFiles())))) {
                    reloadHandbook(fixture);
                }

                HandbookManager.Loaded loaded = HandbookManager.loaded();
                helper.assertValueEqual(FIXTURE_PAGES, loaded.pages().size(),
                        Component.literal("only the two valid fixture pages survive the reload"));
                helper.assertValueEqual(1, loaded.categories().size(),
                        Component.literal("fixture category loaded"));
                helper.assertValueEqual(FIXTURE_LINK_SKIPS, loaded.skippedFiles(),
                        Component.literal("mismatched-id + orphan die at link (syntax/unknown-key at parse)"));
                helper.assertValueEqual(1, loaded.exempt().size(),
                        Component.literal("fixture exempt list parsed"));
                helper.assertTrue(loaded.page(HandbookTopics.CHARGE_PROBE).isEmpty(),
                        Component.literal("previously shipped page is missing after the fixture reload"));
                helper.assertValueEqual(
                        List.of(ResourceLocation.parse("cuprum-gametest:fixture/alpha"),
                                ResourceLocation.parse("cuprum-gametest:fixture/beta")),
                        List.copyOf(loaded.pages().keySet()),
                        Component.literal("fixture pages in deterministic order"));

                HandbookModule.resyncAll(server);
                List<HandbookSyncPayload> syncs = mock.sentPayloads(HandbookSyncPayload.class);
                List<HandbookRecipesPayload> recipes = mock.sentPayloads(HandbookRecipesPayload.class);
                helper.assertValueEqual(1, syncs.size(), Component.literal("exactly one resync sync payload"));
                helper.assertValueEqual(1, recipes.size(),
                        Component.literal("exactly one resync recipes payload"));
                helper.assertValueEqual(FIXTURE_PAGES, syncs.get(0).pages().size(),
                        Component.literal("resync snapshot carries exactly the valid fixture pages"));
                helper.assertValueEqual(0, recipes.get(0).displays().size(),
                        Component.literal("fixture pages reference no recipes"));

                reloadHandbook(production);
                restored = true;
            } finally {
                if (!restored) {
                    reloadHandbook(production);
                }
            }

            helper.assertValueEqual(EXPECTED_PAGES, HandbookManager.loaded().pages().size(),
                    Component.literal("production pages restored"));
            helper.assertValueEqual(0, HandbookManager.loaded().skippedFiles(),
                    Component.literal("production data restores with zero skips"));
            helper.assertValueEqual(0, HandbookManager.loaded().exempt().size(),
                    Component.literal("production exempt list restored empty"));
            helper.assertValueEqual(generationBefore + 2, HandbookManager.reloadGeneration(),
                    Component.literal("each real reload bumps the generation exactly once"));
        }
        helper.succeed();
    }

    private static HandbookSyncPayload wireRoundTrip(MinecraftServer server, HandbookSyncPayload payload) {
        RegistryFriendlyByteBuf buf = new RegistryFriendlyByteBuf(Unpooled.buffer(), server.registryAccess());
        try {
            HandbookSyncPayload.STREAM_CODEC.encode(buf, payload);
            return HandbookSyncPayload.STREAM_CODEC.decode(buf);
        } finally {
            buf.release();
        }
    }

    /** Drives the REAL reloader (prepare + link + apply) against the given resources. */
    private static void reloadHandbook(ResourceManager resources) {
        PreparableReloadListener.SharedState state = new PreparableReloadListener.SharedState(resources);
        new HandbookManager().reload(
                state,
                Runnable::run,
                new PreparableReloadListener.PreparationBarrier() {
                    @Override
                    public <T> java.util.concurrent.CompletableFuture<T> wait(T value) {
                        return java.util.concurrent.CompletableFuture.completedFuture(value);
                    }
                },
                Runnable::run).join();
    }

    private static Map<ResourceLocation, String> fixtureFiles() {
        return Map.of(
                ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "handbook/categories/fixture.json"),
                """
                {
                  "id": "cuprum-gametest:fixture",
                  "title_key": "handbook.cuprum.category.diagnostics",
                  "icon": "cuprum:charge_probe",
                  "sort": 100
                }
                """,
                ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "handbook/pages/fixture/alpha.json"),
                """
                {
                  "id": "cuprum-gametest:fixture/alpha",
                  "category": "cuprum-gametest:fixture",
                  "title_key": "handbook.cuprum.page.charge_probe.title",
                  "widgets": [
                    { "type": "text", "key": "handbook.cuprum.page.charge_probe.intro" }
                  ]
                }
                """,
                ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "handbook/pages/fixture/beta.json"),
                """
                {
                  "id": "cuprum-gametest:fixture/beta",
                  "category": "cuprum-gametest:fixture",
                  "title_key": "handbook.cuprum.page.fx_probe.title",
                  "widgets": [
                    { "type": "text", "key": "handbook.cuprum.page.fx_probe.intro" }
                  ]
                }
                """,
                ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "handbook/pages/broken/syntax.json"),
                "{ this is deliberately not JSON — the reloader must log + skip, never crash",
                ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "handbook/pages/broken/unknown_key.json"),
                """
                {
                  "id": "cuprum-gametest:broken/unknown_key",
                  "category": "cuprum-gametest:fixture",
                  "title_key": "handbook.cuprum.page.charge_probe.title",
                  "titel_key": "the strict codec must reject this typo key, so this file is skipped",
                  "widgets": [
                    { "type": "text", "key": "handbook.cuprum.page.charge_probe.intro" }
                  ]
                }
                """,
                ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "handbook/pages/broken/mismatched_id.json"),
                """
                {
                  "id": "cuprum-gametest:broken/some_other_id",
                  "category": "cuprum-gametest:fixture",
                  "title_key": "handbook.cuprum.page.charge_probe.title",
                  "widgets": [
                    { "type": "text", "key": "handbook.cuprum.page.charge_probe.intro" }
                  ]
                }
                """,
                ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "handbook/pages/broken/orphan.json"),
                """
                {
                  "id": "cuprum-gametest:broken/orphan",
                  "category": "cuprum-gametest:no_such_category",
                  "title_key": "handbook.cuprum.page.charge_probe.title",
                  "widgets": [
                    { "type": "text", "key": "handbook.cuprum.page.charge_probe.intro" }
                  ]
                }
                """,
                HandbookManager.EXEMPT_FILE,
                "[\"cuprum-gametest:exempted_probe\"]");
    }

    /** In-memory SERVER_DATA pack (same shape as the multiblock reload regression's). */
    private static final class JsonPack implements PackResources {
        private final Map<ResourceLocation, byte[]> data;
        private final PackLocationInfo location;

        private JsonPack(Map<ResourceLocation, String> jsonByFile) {
            this.data = jsonByFile.entrySet().stream().collect(java.util.stream.Collectors.toUnmodifiableMap(
                    Map.Entry::getKey, entry -> entry.getValue().getBytes(StandardCharsets.UTF_8)));
            this.location = new PackLocationInfo("cuprum-handbook-reload-regression",
                    Component.literal("Cuprum handbook malformed-resource regression"),
                    PackSource.BUILT_IN, Optional.<KnownPack>empty());
        }

        @Override
        public IoSupplier<InputStream> getRootResource(String... path) {
            return null;
        }

        @Override
        public IoSupplier<InputStream> getResource(PackType type, ResourceLocation id) {
            byte[] bytes = type == PackType.SERVER_DATA ? data.get(id) : null;
            return bytes == null ? null : () -> new ByteArrayInputStream(bytes);
        }

        @Override
        public void listResources(PackType type, String namespace, String path, ResourceOutput output) {
            if (type != PackType.SERVER_DATA) {
                return;
            }
            for (Map.Entry<ResourceLocation, byte[]> entry : data.entrySet()) {
                ResourceLocation file = entry.getKey();
                if (file.getNamespace().equals(namespace) && file.getPath().startsWith(path + "/")) {
                    byte[] bytes = entry.getValue();
                    output.accept(file, () -> new ByteArrayInputStream(bytes));
                }
            }
        }

        @Override
        public Set<String> getNamespaces(PackType type) {
            return type == PackType.SERVER_DATA
                    ? data.keySet().stream().map(ResourceLocation::getNamespace)
                            .collect(java.util.stream.Collectors.toUnmodifiableSet())
                    : Set.of();
        }

        @Override
        public <T> T getMetadataSection(MetadataSectionType<T> type) throws IOException {
            return null;
        }

        @Override
        public PackLocationInfo location() {
            return location;
        }

        @Override
        public void close() {
        }
    }
}
