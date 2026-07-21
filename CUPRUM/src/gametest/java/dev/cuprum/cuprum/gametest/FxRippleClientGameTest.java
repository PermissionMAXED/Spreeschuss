package dev.cuprum.cuprum.gametest;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.block.FxProbeBlock;
import dev.cuprum.cuprum.client.config.CuprumClientConfig;
import dev.cuprum.cuprum.client.config.CuprumClientConfigs;
import dev.cuprum.cuprum.client.fx.ColorblindPalettes;
import dev.cuprum.cuprum.client.fx.FxCapabilityProbe;
import dev.cuprum.cuprum.client.fx.FxDispatcher;
import dev.cuprum.cuprum.client.fx.FxFrameStats;
import dev.cuprum.cuprum.client.fx.FxParticleBudget;
import dev.cuprum.cuprum.client.fx.FxRippleSnapshot;
import dev.cuprum.cuprum.client.fx.FxSettings;
import dev.cuprum.cuprum.client.fx.FxTier;
import dev.cuprum.cuprum.client.fx.FxTierPolicy;
import dev.cuprum.cuprum.client.fx.render.CuprumRenderTypes;
import dev.cuprum.cuprum.fx.FxRippleBroadcaster;
import dev.cuprum.cuprum.fx.core.FxBudgets;
import java.util.function.Function;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.fabricmc.fabric.api.client.gametest.v1.screenshot.TestScreenshotComparisonOptions;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;

/**
 * W1D client end-to-end slice (plan §4-W1D + client-fx.md §12): drives the diagnostic copper
 * ripple through every tier rung in a real singleplayer world.
 *
 * <p><b>Determinism levers (D12):</b> the client GameTest framework tick-steps the client, so
 * game time only advances through {@code waitTicks} (screenshot capture also pumps a few
 * ticks while saving — counters are therefore always captured <i>after</i> the pools they
 * measure were cleared, never across a screenshot). The T1 visual regression uses the normal
 * game clock and the complete production path (real right-click → server pulse → S2C payload
 * → session gate → pool → renderer), then advances exactly to the template age; it never
 * injects or rewrites an event age. Other tier snapshots use a fixed age where the production
 * network path is not the behavior under test. Fixed tp poses, frozen time/weather, hidden GUI, forced
 * 854x480 screenshot size, region-scoped fuzzy compare (default 0.5% mean squared
 * difference) on committed templates.
 *
 * <p>Runs AFTER {@link ChargeMachineClientGameTest} (entrypoint order) so the W1A–W1C
 * screenshot numbering expected by {@code scripts/client_smoke.sh} is unchanged; this test
 * appends screenshots 0004–0007.
 */
public class FxRippleClientGameTest implements FabricClientGameTest {
    private static final BlockPos PROBE_POS = new BlockPos(0, -60, 3);
    private static final BlockPos TOP_DOWN_PROBE_POS = new BlockPos(0, -60, 4);
    /** Fixed ring age for template screenshots: radius 3.0 x 16/40 = 1.2 blocks, alpha 60%. */
    private static final int TEMPLATE_AGE_TICKS = 16;
    /** Template comparisons render at exactly this size regardless of the window. */
    private static final int SHOT_W = 854;
    private static final int SHOT_H = 480;
    /** Screenshot comparison region: centered 400x280 of the forced 854x480 frame. */
    private static final int REGION_X = 227;
    private static final int REGION_Y = 100;
    private static final int REGION_W = 400;
    private static final int REGION_H = 280;

    @Override
    public void runTest(ClientGameTestContext context) {
        try (TestSingleplayerContext singleplayer = context.worldBuilder().create()) {
            singleplayer.getClientWorld().waitForChunksRender();

            singleplayer.getServer().runCommand("time set noon");
            singleplayer.getServer().runCommand("gamerule doDaylightCycle false");
            singleplayer.getServer().runCommand("weather clear");
            singleplayer.getServer().runCommand("setblock 0 -60 3 cuprum:fx_probe");
            context.runOnClient(client -> client.options.hideGui = true);
            context.waitTicks(10);

            assertOnClient(context, "capability probe ran on the initial resource reload",
                    client -> FxCapabilityProbe.lastReport() != null);
            assertOnClient(context, "GL device present and fx_ripple pipeline valid (cap T1)",
                    client -> FxCapabilityProbe.capabilityCap() == FxTier.T1
                            && FxCapabilityProbe.lastReport().pipelineValid()
                            && FxCapabilityProbe.lastReport().shaderAssetsPresent()
                            && FxCapabilityProbe.lastReport().particleAssetPresent());
            assertOnClient(context, "colorblind.json parsed on reload",
                    client -> ColorblindPalettes.isLoaded());
            assertOnClient(context, "CP0C census: exactly 1 world-FX RenderType at W1D, cap 4",
                    client -> CuprumRenderTypes.worldFxTypes().size() == 1
                            && CuprumRenderTypes.worldFxTypes().size() <= FxBudgets.MAX_WORLD_FX_RENDER_TYPES);
            assertOnClient(context, "effective tier resolves T1 (FULL config, no failure cap)",
                    client -> FxTierPolicy.effectiveTier() == FxTier.T1);

            // ── Network/normal-clock visual slice: stand on the probe, real use key → server
            // pulse → S2C payload → render-thread pool enqueue (client-fx.md §6).
            FxFrameStats.clear();
            singleplayer.getServer().runCommand("tp @p 0.5 -59 3.5 0 90");
            context.waitTicks(10);
            context.getInput().holdKeyFor(options -> options.keyUse, 2);
            waitForPooledRipple(context);

            // Move to the canonical south-side view, then advance the received event's normal
            // clock to the same age as the committed template. No direct dispatcher enqueue,
            // fixed-age replacement, or clock mutation is allowed in this regression.
            singleplayer.getServer().runCommand("tp @p 0.5 -60 7.5 180 25");
            context.waitTicks(TEMPLATE_AGE_TICKS);
            assertOnClient(context, "network ripple remains live at the visual checkpoint",
                    client -> FxDispatcher.get().liveRippleCount() == 1);
            context.takeScreenshot("cuprum_fx_ripple_t1");
            assertOnClient(context, "T1 callback recorded its actual 128 emitted vertices",
                    client -> FxFrameStats.customPipelineSubmits() > 0
                            && FxFrameStats.rippleVerticesTotal()
                                    == FxFrameStats.customPipelineSubmits() * FxBudgets.RIPPLE_VERTICES
                            && FxFrameStats.currentFrameRippleVertices() == FxBudgets.RIPPLE_VERTICES
                            && FxFrameStats.peakFrameRippleVertices() == FxBudgets.RIPPLE_VERTICES
                            && FxFrameStats.vertexBudgetBreaches() == 0);
            Cuprum.LOGGER.info("[fx-gametest] T1 actual callback counters: {}",
                    frameCounterSummary(context));

            // ── T1 template comparison: the same production-network ripple, still advancing
            // on the normal client clock.
            context.assertScreenshotEquals(TestScreenshotComparisonOptions.of("fx_ripple_t1_ring")
                    .withSize(SHOT_W, SHOT_H)
                    .withRegion(REGION_X, REGION_Y, REGION_W, REGION_H));

            // ── QOL-04 config cap: REDUCED ⇒ T2 (vanilla lightning batch, zero new custom
            // submits since the tier flip), identical geometry, plus the mote cadence.
            singleplayer.getServer().runCommand("tp @p 0.5 -60 7.5 180 25");
            context.waitTicks(2);
            context.runOnClient(client -> {
                CuprumClientConfigs.client().fxTierCap = CuprumClientConfig.FxTierCap.REDUCED;
                FxDispatcher.get().clear();
                FxFrameStats.clear();
                FxDispatcher.get().enqueueRipple(new FxRippleSnapshot(PROBE_POS, 3.0f,
                        FxProbeBlock.RIPPLE_COLOR_ARGB,
                        client.level.getGameTime() - TEMPLATE_AGE_TICKS));
            });
            context.assertScreenshotEquals(TestScreenshotComparisonOptions.of("fx_ripple_t2_ring")
                    .withSize(SHOT_W, SHOT_H)
                    .withRegion(REGION_X, REGION_Y, REGION_W, REGION_H));
            assertOnClient(context, "REDUCED: zero custom submits since tier change, vanilla batch used",
                    client -> FxFrameStats.customPipelineSubmitsSinceTierChange() == 0
                            && FxFrameStats.customPipelineSubmits() == 0
                            && FxFrameStats.vanillaFallbackSubmits() > 0
                            && FxFrameStats.rippleVerticesTotal()
                                    == FxFrameStats.vanillaFallbackSubmits() * FxBudgets.RIPPLE_VERTICES
                            && FxFrameStats.currentFrameRippleVertices() == FxBudgets.RIPPLE_VERTICES
                            && FxFrameStats.peakFrameRippleVertices() == FxBudgets.RIPPLE_VERTICES
                            && FxFrameStats.vertexBudgetBreaches() == 0);
            Cuprum.LOGGER.info("[fx-gametest] T2 actual callback counters: {}",
                    frameCounterSummary(context));
            long acceptedBeforeT2Motes = counter(context, client -> FxParticleBudget.acceptedTotal());
            context.waitTicks(2 * FxBudgets.T2_MOTE_INTERVAL_TICKS); // crosses ≥1 cadence tick
            context.takeScreenshot("cuprum_fx_ripple_t2");
            assertOnClient(context, "T2 cadence spawned whole ≤8-mote budgeted bursts",
                    client -> {
                        long delta = FxParticleBudget.acceptedTotal() - acceptedBeforeT2Motes;
                        return delta > 0 && delta % FxBudgets.T2_MOTES_PER_BURST == 0
                                && delta <= 4L * FxBudgets.T2_MOTES_PER_BURST;
                    });

            // ── MINIMAL ⇒ T3: no geometry, exactly one 8-mote burst on arrival.
            context.runOnClient(client -> {
                CuprumClientConfigs.client().fxTierCap = CuprumClientConfig.FxTierCap.MINIMAL;
                FxDispatcher.get().clear(); // also resets the particle budget counters
            });
            long vanillaBeforeT3 = counter(context, client -> FxFrameStats.vanillaFallbackSubmits());
            context.runOnClient(client -> FxDispatcher.get().enqueueRipple(new FxRippleSnapshot(
                    PROBE_POS, 3.0f, FxProbeBlock.RIPPLE_COLOR_ARGB, client.level.getGameTime())));
            assertOnClient(context, "T3: exactly one 8-mote burst on arrival",
                    client -> FxParticleBudget.acceptedTotal() == FxBudgets.T3_MOTES_ON_ARRIVAL
                            && FxParticleBudget.rejectedTotal() == 0);
            context.takeScreenshot("cuprum_fx_ripple_t3_motes");
            assertOnClient(context, "T3: zero geometry submits of either kind",
                    client -> FxFrameStats.vanillaFallbackSubmits() == vanillaBeforeT3
                            && FxFrameStats.customPipelineSubmitsSinceTierChange() == 0);

            // ── A real resource reload re-runs the packaged-resource/device gate. Production
            // failure-seam demotion and recovery are asserted by FxFailurePathsClientGameTest.
            context.runOnClient(client ->
                    CuprumClientConfigs.client().fxTierCap = CuprumClientConfig.FxTierCap.FULL);
            context.runOnClient(Minecraft::reloadResourcePacks);
            waitForReloadRecovery(context);
            assertOnClient(context, "reload: valid resources/device remain T1 and pools reset",
                    client -> FxTierPolicy.effectiveTier() == FxTier.T1
                            && FxTierPolicy.failureCap() == FxTier.T1
                            && FxCapabilityProbe.capabilityCap() == FxTier.T1
                            && FxDispatcher.get().liveRippleCount() == 0);

            // ── Accessibility: reduced flash (vanilla hideLightningFlash forces 0) and the
            // colorblind snapshot remap (applied once at snapshot creation, never per frame).
            assertOnClient(context, "hideLightningFlash forces effectiveFlash() to 0",
                    client -> {
                        client.options.hideLightningFlash().set(true);
                        float forced = FxSettings.effectiveFlash();
                        client.options.hideLightningFlash().set(false);
                        return forced == 0.0f;
                    });
            assertOnClient(context, "flashScale x screenEffectScale composes into effectiveFlash()",
                    client -> {
                        CuprumClientConfigs.client().flashScale = 0.5f;
                        client.options.screenEffectScale().set(0.5);
                        float composed = FxSettings.effectiveFlash();
                        CuprumClientConfigs.client().flashScale = 1.0f;
                        client.options.screenEffectScale().set(1.0);
                        return Math.abs(composed - 0.25f) < 1.0e-6f;
                    });
            assertOnClient(context, "deuteranopia palette actually changes the copper ripple color",
                    client -> ColorblindPalettes.remap(FxProbeBlock.RIPPLE_COLOR_ARGB,
                            CuprumClientConfig.ColorblindMode.DEUTERANOPIA) != FxProbeBlock.RIPPLE_COLOR_ARGB);
            context.runOnClient(client -> {
                CuprumClientConfigs.client().colorblindMode = CuprumClientConfig.ColorblindMode.DEUTERANOPIA;
                FxDispatcher.get().clear();
                // The remap runs in FxRippleSnapshot.of on payload arrival; mirror it here for
                // the direct enqueue (same single call site the receiver uses).
                FxDispatcher.get().enqueueRipple(new FxRippleSnapshot(PROBE_POS, 3.0f,
                        FxSettings.remapColor(FxProbeBlock.RIPPLE_COLOR_ARGB),
                        client.level.getGameTime() - TEMPLATE_AGE_TICKS));
            });
            context.takeScreenshot("cuprum_fx_ripple_t1_colorblind");
            context.runOnClient(client ->
                    CuprumClientConfigs.client().colorblindMode = CuprumClientConfig.ColorblindMode.OFF);

            // ── ★ budgets: pool ring eviction at 16, per-tick particle spawn cap at 64.
            context.runOnClient(client -> {
                FxDispatcher.get().clear();
                long now = client.level.getGameTime();
                for (int i = 0; i < FxBudgets.MAX_RIPPLES + 4; i++) {
                    FxDispatcher.get().enqueueRipple(new FxRippleSnapshot(PROBE_POS, 3.0f,
                            FxProbeBlock.RIPPLE_COLOR_ARGB, now - i));
                }
            });
            assertOnClient(context, "pool ★: capacity 16, oldest evicted",
                    client -> FxDispatcher.get().liveRippleCount() == FxBudgets.MAX_RIPPLES
                            && FxDispatcher.get().evictedTotal() >= 4);
            context.runOnClient(client -> {
                CuprumClientConfigs.client().fxTierCap = CuprumClientConfig.FxTierCap.MINIMAL;
                FxDispatcher.get().clear(); // budget counters restart at 0 for the exact assert
                long now = client.level.getGameTime();
                for (int i = 0; i < 10; i++) { // 10 bursts x 8 motes = 80 > 64/tick cap
                    FxDispatcher.get().enqueueRipple(new FxRippleSnapshot(PROBE_POS, 3.0f,
                            FxProbeBlock.RIPPLE_COLOR_ARGB, now - i));
                }
                CuprumClientConfigs.client().fxTierCap = CuprumClientConfig.FxTierCap.FULL;
            });
            assertOnClient(context, "particle ★: 80 requested in one tick → exactly 64 accepted, 16 rejected",
                    client -> FxParticleBudget.acceptedTotal() == FxBudgets.PARTICLE_SPAWN_PER_TICK
                            && FxParticleBudget.rejectedTotal() == 16
                            && FxParticleBudget.liveEstimate() <= FxBudgets.PARTICLE_LIVE_MAX);

            // Exact manual-reproduction camera: establish the top-down view before a second
            // production S2C send, then let its server timestamp advance on the normal clock.
            // This runs after every pre-existing visual assertion so its stone plane/probe
            // cluster cannot contaminate the canonical T1/T2/colorblind comparison regions.
            // Direct broadcaster invocation isolates camera visibility from use-key reach while
            // retaining the real send window, codec, response-sender session guard and pool path.
            context.runOnClient(client -> {
                FxDispatcher.get().clear();
                FxFrameStats.clear();
            });
            singleplayer.getServer().runCommand("fill -5 -61 0 5 -61 10 minecraft:stone replace");
            singleplayer.getServer().runCommand("setblock 0 -61 3 cuprum:fx_probe");
            singleplayer.getServer().runCommand("setblock 0 -60 3 cuprum:fx_probe");
            singleplayer.getServer().runCommand("setblock 0 -60 4 cuprum:fx_probe");
            singleplayer.getServer().runCommand("tp @p 0.5 -57 4.5 0 90");
            context.waitTicks(10);
            int topDownSent = singleplayer.getServer().computeOnServer(server ->
                    FxRippleBroadcaster.broadcast(server.overworld(), TOP_DOWN_PROBE_POS,
                            FxProbeBlock.RIPPLE_RADIUS_Q8, FxProbeBlock.RIPPLE_COLOR_ARGB));
            if (topDownSent != 1) {
                throw new AssertionError("top-down network regression must send exactly one payload");
            }
            waitForPooledRipple(context);
            context.waitTicks(TEMPLATE_AGE_TICKS);
            assertOnClient(context, "top-down network ripple remains live at the visual checkpoint",
                    client -> FxDispatcher.get().liveRippleCount() == 1);
            context.assertScreenshotEquals(TestScreenshotComparisonOptions.of(
                    "fx_ripple_t1_network_top_down_cluster").withSize(SHOT_W, SHOT_H));
            assertOnClient(context, "top-down T1 network ripple emitted only budgeted geometry",
                    client -> FxFrameStats.customPipelineSubmits() > 0
                            && FxFrameStats.rippleVerticesTotal()
                                    == FxFrameStats.customPipelineSubmits() * FxBudgets.RIPPLE_VERTICES
                            && FxFrameStats.vertexBudgetBreaches() == 0);

            context.runOnClient(client -> {
                FxDispatcher.get().clear();
                client.options.hideGui = false;
            });
        }

        // DISCONNECT (possibly on a Netty thread) must have cleared pools and counters (§9).
        boolean cleared = context.computeOnClient(client ->
                FxDispatcher.get().liveRippleCount() == 0 && FxFrameStats.customPipelineSubmits() == 0L);
        if (!cleared) {
            throw new AssertionError("disconnect must clear the ripple pool and FxFrameStats");
        }
    }

    private static void assertOnClient(ClientGameTestContext context, String message, ClientCheck check) {
        boolean ok = context.computeOnClient(check::test);
        if (!ok) {
            throw new AssertionError(message);
        }
    }

    private static long counter(ClientGameTestContext context, Function<Minecraft, Long> counterFn) {
        return context.computeOnClient(counterFn::apply);
    }

    private static String frameCounterSummary(ClientGameTestContext context) {
        return context.computeOnClient(client ->
                "custom=" + FxFrameStats.customPipelineSubmits()
                        + ", fallback=" + FxFrameStats.vanillaFallbackSubmits()
                        + ", vertices=" + FxFrameStats.rippleVerticesTotal()
                        + ", currentFrame=" + FxFrameStats.currentFrameRippleVertices()
                        + ", peakFrame=" + FxFrameStats.peakFrameRippleVertices()
                        + ", breaches=" + FxFrameStats.vertexBudgetBreaches());
    }

    /**
     * Bounded poll for the network vertical slice: the C2S use packet, the server pulse and
     * the S2C payload each need a (client-stepped) tick to drain, so the pool fills a few
     * ticks after the click. 20 ticks is half the 40-tick ripple lifetime — early enough
     * that the pooled ripple is still young for the screenshot that follows.
     */
    private static void waitForPooledRipple(ClientGameTestContext context) {
        for (int i = 0; i < 60; i++) {
            context.waitTicks(1);
            boolean pooled = context.computeOnClient(client -> FxDispatcher.get().liveRippleCount() >= 1);
            if (pooled) {
                return;
            }
        }
        throw new AssertionError("S2C ripple payload was not pooled within 60 ticks of the click");
    }

    /**
     * Bounded poll for the async {@code reloadResourcePacks()} recovery. Two conditions: the
     * FX listener ran (failure cap reset) AND the loading overlay finished its fade-out —
     * the listener fires while the overlay still covers the screen, so later screenshots
     * would otherwise capture the Mojang loading screen instead of the world.
     */
    private static void waitForReloadRecovery(ClientGameTestContext context) {
        for (int i = 0; i < 80; i++) {
            context.waitTicks(5);
            boolean recovered = context.computeOnClient(client ->
                    FxTierPolicy.failureCap() == FxTier.T1 && client.getOverlay() == null);
            if (recovered) {
                return;
            }
        }
        throw new AssertionError("resource reload did not complete within 400 ticks");
    }

    @FunctionalInterface
    private interface ClientCheck {
        boolean test(Minecraft client);
    }
}
