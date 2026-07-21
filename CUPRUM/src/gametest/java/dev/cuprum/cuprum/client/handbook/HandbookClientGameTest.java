package dev.cuprum.cuprum.client.handbook;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.api.handbook.HandbookUnlocks;
import dev.cuprum.cuprum.client.api.handbook.HandbookClientApi;
import dev.cuprum.cuprum.perf.PerfBudget;
import dev.cuprum.cuprum.perf.PerfBudgets;
import dev.cuprum.cuprum.perf.PerfSampler;
import dev.cuprum.cuprum.state.CuprumAttachments;
import java.nio.file.Files;
import java.util.List;
import java.util.Set;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.fabricmc.fabric.api.client.gametest.v1.screenshot.TestScreenshotComparisonOptions;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.resources.language.I18n;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.contents.TranslatableContents;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import org.lwjgl.glfw.GLFW;

/**
 * W1E client end-to-end slice (handbook-config.md §10 client rows): real keybind open, real
 * mouse/keyboard navigation, EN + DE search over the localized index, widget rendering
 * (recipe/image/charge/multiblock) with a region-scoped template comparison, GUI-scale +
 * window-resize responsiveness, bookmark toggle via a real star click + on-disk round-trip,
 * the locked-deeplink → server grant → attachment sync → live unlock flow, the missing-page
 * notice, and the {@code w1_perf_baseline_handbook} calibration gate.
 *
 * <p>Runs AFTER the FX client tests (entrypoint order) so the W1A–W1D screenshot numbering
 * expected by {@code scripts/client_smoke.sh} is unchanged; this test appends 0008–0014.
 * The locked fixture page ({@code cuprum-gametest:locked/gametest_probe}, gametest mod data)
 * exists precisely for the unlock flow — production data ships no key-locked page in W1.
 */
public class HandbookClientGameTest implements FabricClientGameTest {
    private static final ResourceLocation PROBE_PAGE =
            ResourceLocation.parse("cuprum:diagnostics/charge_probe");
    private static final ResourceLocation COIL_PAGE =
            ResourceLocation.parse("cuprum:diagnostics/diagnostic_coil");
    private static final ResourceLocation LOCKED_PAGE =
            ResourceLocation.parse("cuprum-gametest:locked/gametest_probe");
    private static final ResourceLocation MISSING_PAGE =
            ResourceLocation.parse("cuprum:diagnostics/no_such_page");
    private static final ResourceLocation UNLOCK_KEY =
            ResourceLocation.parse("cuprum:unlock/gametest_probe");
    private static final int SYNCED_PAGES = 4;
    /** Frozen config literal rendered by the probe page's charge widget (plan §3.3). */
    private static final String CHARGE_LITERAL = "5 Cg/t";
    /** Template comparisons render at exactly this size regardless of the window. */
    private static final int SHOT_W = 854;
    private static final int SHOT_H = 480;

    @Override
    public void runTest(ClientGameTestContext context) {
        try (TestSingleplayerContext singleplayer = context.worldBuilder().create()) {
            singleplayer.getClientWorld().waitForChunksRender();

            // Deterministic backdrop for the template comparison (same levers as the FX test).
            singleplayer.getServer().runCommand("time set noon");
            singleplayer.getServer().runCommand("gamerule doDaylightCycle false");
            singleplayer.getServer().runCommand("weather clear");
            singleplayer.getServer().runCommand("tp @p 0.5 -60 0.5 0 25");
            context.waitTicks(5);

            // Late-join sync contract: the full snapshot (3 shipped pages + locked fixture)
            // and the resolved recipe displays arrived without any client disk read.
            context.waitFor(client -> HandbookClientCache.snapshot().pages().size() == SYNCED_PAGES
                    && HandbookClientCache.snapshot()
                            .recipe(ResourceLocation.parse("cuprum:charge_probe")).isPresent());

            openViaKeybindAndNavigate(context);
            assertProbePageWidgets(context);
            assertResponsiveLayout(context);
            searchEnglishAndGerman(context);
            bookmarkToggleAndPersist(context);
            lockedDeeplinkThenServerGrant(context, singleplayer);
            missingPageNotice(context);
            perfBaselineHandbook(context);

            context.runOnClient(client -> client.setScreen(null));
            context.waitTick();
        }
    }

    // ── keybind + navigation (handbook_open_navigate) ────────────────────────────────

    private void openViaKeybindAndNavigate(ClientGameTestContext context) {
        KeyMapping handbookKey = context.computeOnClient(client -> {
            for (KeyMapping mapping : client.options.keyMappings) {
                if (mapping.getName().equals("key.cuprum.handbook")) {
                    return mapping;
                }
            }
            throw new AssertionError("key.cuprum.handbook is not registered");
        });
        context.getInput().pressKey(handbookKey);
        context.waitForScreen(HandbookScreen.class);
        context.waitTick();
        assertOnClient(context, "keybind opens the landing view",
                client -> screen(client).viewDescriptor().equals("landing"));
        context.takeScreenshot("cuprum_handbook_landing");

        // Real mouse navigation: category row, then the probe page row.
        clickRow(context, "handbook.cuprum.category.diagnostics");
        assertOnClient(context, "category listing shows all four pages (locked fixture included)",
                client -> screen(client).viewDescriptor().equals("category:cuprum:diagnostics")
                        && screen(client).contentBlocks().size() == SYNCED_PAGES);
        clickRow(context, "handbook.cuprum.page.charge_probe.title");
        assertOnClient(context, "navigation reaches the probe page id",
                client -> screen(client).viewDescriptor().equals("page:" + PROBE_PAGE));
    }

    // ── widgets render (handbook_widgets_render) ─────────────────────────────────────

    private void assertProbePageWidgets(ClientGameTestContext context) {
        assertOnClient(context, "recipe widget's result slot resolves to cuprum:charge_probe",
                client -> {
                    HandbookRecipeBlock recipe = firstBlock(client, HandbookRecipeBlock.class);
                    return recipe != null
                            && recipe.recipeWidget().recipe().toString().equals("cuprum:charge_probe")
                            && BuiltInRegistries.ITEM.getKey(recipe.resultStack().getItem())
                                    .toString().equals("cuprum:charge_probe");
                });
        assertOnClient(context, "charge widget renders the frozen config literal " + CHARGE_LITERAL,
                client -> {
                    HandbookChargeBlock charge = firstBlock(client, HandbookChargeBlock.class);
                    return charge != null
                            && charge.chargeWidget().valueRef().equals("charge.passiveBaselineCgPerTick")
                            && HandbookChargeBlock.valueText(charge.chargeWidget()).equals(CHARGE_LITERAL)
                            && charge.getMessage().getString().equals(CHARGE_LITERAL);
                });
        assertOnClient(context, "image widget present and its texture resolves",
                client -> firstBlock(client, HandbookImageBlock.class) != null
                        && client.getResourceManager().getResource(
                                ResourceLocation.parse("cuprum:textures/block/charge_probe.png")).isPresent());
        context.takeScreenshot("cuprum_handbook_charge_probe_page");
        // Region-scoped template pin of the whole content column (flat panels; item icons are
        // deterministic GUI blits; committed template bootstraps via the sanctioned flow).
        context.assertScreenshotEquals(TestScreenshotComparisonOptions.of("handbook_charge_probe_page")
                .withSize(SHOT_W, SHOT_H)
                .withRegion(40, 80, 760, 340));

        // The multiblock widget renders on the coil page (Esc back + real row click).
        context.getInput().pressKey(GLFW.GLFW_KEY_ESCAPE);
        context.waitTick();
        clickRow(context, "handbook.cuprum.page.diagnostic_coil.title");
        assertOnClient(context, "multiblock widget present on the coil page",
                client -> screen(client).viewDescriptor().equals("page:" + COIL_PAGE)
                        && firstBlock(client, HandbookMultiblockBlock.class) != null);
        // Return to the probe page for the layout checks below.
        context.getInput().pressKey(GLFW.GLFW_KEY_ESCAPE);
        context.waitTick();
        clickRow(context, "handbook.cuprum.page.charge_probe.title");
    }

    // ── responsive layout: window resize + GUI scale (§7) ───────────────────────────

    private void assertResponsiveLayout(ClientGameTestContext context) {
        int[] originalWindow = context.computeOnClient(client -> new int[]{
                client.getWindow().getWidth(), client.getWindow().getHeight()});
        context.getInput().resizeWindow(1600, 900);
        context.waitTick();
        assertOnClient(context, "window resize preserves the view and re-lays the content column",
                client -> screen(client).viewDescriptor().equals("page:" + PROBE_PAGE)
                        && contentWidthMatchesWindow(client));

        int originalScale = context.computeOnClient(client -> client.options.guiScale().get());
        context.runOnClient(client -> {
            client.options.guiScale().set(1);
            client.resizeDisplay();
        });
        context.waitTick();
        assertOnClient(context, "GUI scale 1 preserves the view and re-lays the content column",
                client -> screen(client).viewDescriptor().equals("page:" + PROBE_PAGE)
                        && contentWidthMatchesWindow(client));
        context.runOnClient(client -> {
            client.options.guiScale().set(originalScale);
            client.resizeDisplay();
        });
        context.getInput().resizeWindow(originalWindow[0], originalWindow[1]);
        context.waitTick();
    }

    private static boolean contentWidthMatchesWindow(Minecraft client) {
        List<AbstractWidget> blocks = screen(client).contentBlocks();
        int expected = Math.min(client.getWindow().getGuiScaledWidth() - 32, 440);
        return !blocks.isEmpty() && blocks.get(0).getWidth() == expected;
    }

    // ── search EN + DE (handbook_search_finds_probe) ────────────────────────────────

    private void searchEnglishAndGerman(ClientGameTestContext context) {
        // Real keyboard path: Esc x2 back to landing, Tab focuses the search box, type query.
        context.getInput().pressKey(GLFW.GLFW_KEY_ESCAPE);
        context.waitTick();
        context.getInput().pressKey(GLFW.GLFW_KEY_ESCAPE);
        context.waitTick();
        assertOnClient(context, "Esc pops back to the landing view",
                client -> screen(client).viewDescriptor().equals("landing"));
        context.getInput().pressKey(GLFW.GLFW_KEY_TAB);
        context.waitTick();
        context.getInput().typeChars("probe");
        context.waitTick();
        assertOnClient(context, "EN 'probe' hits include the probe page; gibberish returns zero",
                client -> HandbookSearchIndex.search("probe").contains(PROBE_PAGE)
                        && HandbookSearchIndex.search("zzqxv").isEmpty()
                        && !screen(client).contentBlocks().isEmpty());
        context.takeScreenshot("cuprum_handbook_search_results_en");

        // Language switch to DE: the cuprum:handbook_search reloader (ordered after
        // minecraft:languages) re-localizes every doc; "sonde" now hits "Ladungssonde".
        switchLanguage(context, "de_de");
        assertOnClient(context, "DE 'sonde' hits include the probe page; gibberish returns zero",
                client -> HandbookSearchIndex.search("sonde").contains(PROBE_PAGE)
                        && HandbookSearchIndex.search("zzqxv").isEmpty());
        context.runOnClient(client -> screen(client).searchNow("sonde"));
        context.waitTick();
        assertOnClient(context, "DE result rows show the localized title",
                client -> screen(client).contentBlocks().stream().anyMatch(
                        block -> block.getMessage().getString().equals("Ladungssonde")));
        context.takeScreenshot("cuprum_handbook_search_results_de");
        switchLanguage(context, "en_us");
        context.runOnClient(client -> screen(client).searchNow(""));
        context.waitTick();
    }

    private void switchLanguage(ClientGameTestContext context, String code) {
        context.runOnClient(client -> {
            client.options.languageCode = code;
            client.getLanguageManager().setSelected(code);
            client.reloadResourcePacks();
        });
        for (int i = 0; i < 80; i++) {
            context.waitTicks(5);
            boolean done = context.computeOnClient(client -> client.getOverlay() == null
                    && client.getLanguageManager().getSelected().equals(code));
            if (done) {
                return;
            }
        }
        throw new AssertionError("language switch to " + code + " did not complete within 400 ticks");
    }

    // ── bookmark toggle + persistence (handbook_bookmark_persist) ────────────────────

    private void bookmarkToggleAndPersist(ClientGameTestContext context) {
        clickRow(context, "handbook.cuprum.category.diagnostics");
        clickRow(context, "handbook.cuprum.page.charge_probe.title");
        // Rerun safety: a bookmarks file from an earlier launch may already hold this page.
        context.runOnClient(client -> {
            String worldKey = HandbookBookmarks.worldKey(client);
            if (HandbookBookmarks.isBookmarked(worldKey, PROBE_PAGE)) {
                HandbookBookmarks.toggle(worldKey, PROBE_PAGE);
            }
        });
        context.waitTick();

        // Real mouse click on the header star ("+" = not bookmarked).
        double[] starCenter = context.computeOnClient(client -> {
            for (var child : screen(client).children()) {
                if (child instanceof Button button && button.getMessage().getString().equals("+")) {
                    return widgetCenter(client, button);
                }
            }
            throw new AssertionError("bookmark star button not found on the page header");
        });
        clickAt(context, starCenter);
        assertOnClient(context, "star click bookmarks the page (exactly one rail entry)",
                client -> HandbookBookmarks.bookmarks(HandbookBookmarks.worldKey(client))
                        .equals(List.of(PROBE_PAGE)));

        // On-disk round-trip: the file parses and re-loading from disk retains the entry.
        assertOnClient(context, "bookmarks file exists on disk and contains the page id",
                client -> {
                    try {
                        return Files.isRegularFile(HandbookBookmarks.filePath())
                                && Files.readString(HandbookBookmarks.filePath())
                                        .contains(PROBE_PAGE.toString());
                    } catch (Exception e) {
                        return false;
                    }
                });
        context.runOnClient(client -> HandbookBookmarks.invalidate());
        assertOnClient(context, "re-parsed on-disk bookmarks retain the entry",
                client -> HandbookBookmarks.bookmarks(HandbookBookmarks.worldKey(client))
                        .equals(List.of(PROBE_PAGE)));

        // Close fully, reopen via keybind: the last-read page comes back; Esc shows the rail.
        context.getInput().pressKey(GLFW.GLFW_KEY_ESCAPE);
        context.waitTick();
        context.getInput().pressKey(GLFW.GLFW_KEY_ESCAPE);
        context.waitTick();
        context.getInput().pressKey(GLFW.GLFW_KEY_ESCAPE);
        context.waitTick();
        assertOnClient(context, "Esc from the landing view closes the handbook",
                client -> !(client.screen instanceof HandbookScreen));
        KeyMapping handbookKey = context.computeOnClient(client -> {
            for (KeyMapping mapping : client.options.keyMappings) {
                if (mapping.getName().equals("key.cuprum.handbook")) {
                    return mapping;
                }
            }
            throw new AssertionError("key.cuprum.handbook is not registered");
        });
        context.getInput().pressKey(handbookKey);
        context.waitForScreen(HandbookScreen.class);
        context.waitTick();
        assertOnClient(context, "keybind reopens the last-read page",
                client -> screen(client).viewDescriptor().equals("page:" + PROBE_PAGE));
        context.getInput().pressKey(GLFW.GLFW_KEY_ESCAPE);
        context.waitTick();
        assertOnClient(context, "landing view shows the bookmark rail heading + one entry",
                client -> {
                    List<AbstractWidget> blocks = screen(client).contentBlocks();
                    boolean heading = blocks.stream().anyMatch(block -> block.getMessage()
                            .getString().equals(I18n.get("handbook.cuprum.bookmarks")));
                    long rows = blocks.stream().filter(HandbookListButton.class::isInstance).count();
                    return screen(client).viewDescriptor().equals("landing") && heading && rows == 2;
                });
        context.takeScreenshot("cuprum_handbook_bookmark_rail");
    }

    // ── locked deep link → real server grant → attachment sync (handbook_deeplink_locked) ──

    private void lockedDeeplinkThenServerGrant(ClientGameTestContext context,
            TestSingleplayerContext singleplayer) {
        context.runOnClient(client -> HandbookClientApi.open(LOCKED_PAGE));
        context.waitTick();
        assertOnClient(context, "locked page shows title + lock notice and zero content widgets",
                client -> {
                    List<AbstractWidget> blocks = screen(client).contentBlocks();
                    return screen(client).viewDescriptor().equals("page:" + LOCKED_PAGE)
                            && blocks.size() == 2
                            && hasBlockText(blocks, I18n.get(HandbookScreen.LOCKED_NOTICE_KEY))
                            && !hasBlockText(blocks, I18n.get("handbook.cuprum-gametest.page.locked.body"));
                });
        context.takeScreenshot("cuprum_handbook_locked_page");

        // Server-truth grant through the frozen API; Fabric syncs the attachment (targetOnly).
        singleplayer.getServer().runOnServer(server -> {
            ServerPlayer player = server.getPlayerList().getPlayers().get(0);
            if (!HandbookUnlocks.grant(player, UNLOCK_KEY)) {
                throw new AssertionError("grant must report newly added");
            }
        });
        context.waitFor(client -> client.player != null && client.player
                .getAttachedOrElse(CuprumAttachments.HANDBOOK_UNLOCKS, Set.of()).contains(UNLOCK_KEY));
        context.waitTick(); // open screen notices the lock flip in tick() and rebuilds in place
        assertOnClient(context, "after the grant the same link renders the content widgets",
                client -> {
                    List<AbstractWidget> blocks = screen(client).contentBlocks();
                    return hasBlockText(blocks, I18n.get("handbook.cuprum-gametest.page.locked.body"))
                            && !hasBlockText(blocks, I18n.get(HandbookScreen.LOCKED_NOTICE_KEY));
                });
        context.takeScreenshot("cuprum_handbook_unlocked_page");
    }

    // ── missing page (reload/late-join contract, client half) ───────────────────────

    private void missingPageNotice(ClientGameTestContext context) {
        context.runOnClient(client -> screen(client).openPage(MISSING_PAGE));
        context.waitTick();
        assertOnClient(context, "a dangling page id renders the localized missing notice",
                client -> hasBlockText(screen(client).contentBlocks(),
                        I18n.get(HandbookScreen.MISSING_NOTICE_KEY)));
    }

    // ── w1_perf_baseline_handbook (handbook-config.md §9) ───────────────────────────

    private void perfBaselineHandbook(ClientGameTestContext context) {
        context.runOnClient(client -> screen(client).openPage(PROBE_PAGE));
        context.waitTick();
        PerfSampler sampler = PerfSampler.create();
        int total = PerfBudgets.W1_HANDBOOK_FRAME_SAMPLES + PerfBudgets.W1_WARMUP_SAMPLES;
        for (int i = 0; i < total; i++) {
            context.waitTick();
            sampler.addNs(context.computeOnClient(Minecraft::getFrameTimeNs));
        }
        PerfBudget.Result result = PerfBudget.assertMeanBelow(sampler, "w1_perf_baseline_handbook",
                PerfBudgets.W1_HANDBOOK_FRAME_MEAN_NS, PerfBudgets.W1_WARMUP_SAMPLES);
        Cuprum.LOGGER.info("[perf] w1_perf_baseline_handbook: mean {} ns (p95 {} ns, max {} ns)"
                        + " over {} samples — budget {} ns", result.meanNs(), result.p95Ns(),
                result.maxNs(), result.samples(), result.budgetNs());
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────

    /**
     * Clicks a handbook row through the REAL mouse path (cursor move + left click) — the
     * framework's {@code clickScreenButton} matches resolved display strings, which breaks
     * under the DE half of this test, so rows are located by their translatable label key.
     */
    private void clickRow(ClientGameTestContext context, String translationKey) {
        double[] center = context.computeOnClient(client -> {
            for (var child : screen(client).children()) {
                if (child instanceof AbstractWidget widget
                        && widget.getMessage().getContents()
                                instanceof TranslatableContents translatable
                        && translatable.getKey().equals(translationKey)) {
                    return widgetCenter(client, widget);
                }
            }
            throw new AssertionError("no row labeled " + translationKey + " on the current view");
        });
        clickAt(context, center);
    }

    private void clickAt(ClientGameTestContext context, double[] windowPos) {
        context.getInput().setCursorPos(windowPos[0], windowPos[1]);
        context.getInput().pressMouse(GLFW.GLFW_MOUSE_BUTTON_LEFT);
        context.waitTick();
    }

    /** GUI-space widget center converted to window coordinates (real cursor space). */
    private static double[] widgetCenter(Minecraft client, AbstractWidget widget) {
        double factor = client.getWindow().getScreenWidth()
                / (double) client.getWindow().getGuiScaledWidth();
        return new double[]{
                (widget.getX() + widget.getWidth() / 2.0) * factor,
                (widget.getY() + widget.getHeight() / 2.0) * factor};
    }

    private static HandbookScreen screen(Minecraft client) {
        if (!(client.screen instanceof HandbookScreen handbook)) {
            throw new AssertionError("expected the handbook screen, found: " + client.screen);
        }
        return handbook;
    }

    private static <T> T firstBlock(Minecraft client, Class<T> type) {
        for (AbstractWidget block : screen(client).contentBlocks()) {
            if (type.isInstance(block)) {
                return type.cast(block);
            }
        }
        return null;
    }

    private static boolean hasBlockText(List<AbstractWidget> blocks, String text) {
        return blocks.stream().anyMatch(block -> block.getMessage().getString().equals(text));
    }

    private static void assertOnClient(ClientGameTestContext context, String message, ClientCheck check) {
        if (!context.computeOnClient(check::test)) {
            throw new AssertionError(message);
        }
    }

    @FunctionalInterface
    private interface ClientCheck {
        boolean test(Minecraft client);
    }
}
