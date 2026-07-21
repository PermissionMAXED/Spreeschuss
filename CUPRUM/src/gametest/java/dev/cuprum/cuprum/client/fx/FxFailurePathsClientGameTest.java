package dev.cuprum.cuprum.client.fx;

import dev.cuprum.cuprum.client.config.CuprumClientConfig;
import dev.cuprum.cuprum.client.config.CuprumClientConfigs;
import dev.cuprum.cuprum.fx.core.FxBudgets;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;

/**
 * Permanent tests for interceptable production failure seams, frame accounting, idempotent
 * delivery, and dimension-race defense. No test calls {@link FxTierPolicy#demote} directly.
 */
public class FxFailurePathsClientGameTest implements FabricClientGameTest {
    @Override
    public void runTest(ClientGameTestContext context) {
        try (TestSingleplayerContext singleplayer = context.worldBuilder().create()) {
            singleplayer.getClientWorld().waitForChunksRender();
            context.runOnClient(client -> {
                testCapabilityDemotionSeam(client.getResourceManager());
                testSubmitAndCallbackFailureSeams();
                testActualFrameAggregation();
                testParticleFailureSeam();
                testDuplicateAndDimensionDelivery();

                CuprumClientConfigs.client().fxTierCap = CuprumClientConfig.FxTierCap.FULL;
                FxTierPolicy.resetForReload();
                FxDispatcher.get().clear();
                FxFrameStats.clear();
            });
        }
    }

    private static void testCapabilityDemotionSeam(
            net.minecraft.server.packs.resources.ResourceManager resourceManager) {
        FxTierPolicy.resetForReload();
        require(FxCapabilityProbe.evaluateDeviceForTesting(false, () -> true) == FxTier.T2,
                "missing device must resolve T2");
        require(FxTierPolicy.failureCap() == FxTier.T2,
                "missing device must call production demotion");

        FxTierPolicy.resetForReload();
        require(FxCapabilityProbe.evaluateDeviceForTesting(true, () -> false) == FxTier.T2,
                "invalid precompile result must resolve T2");
        require(FxTierPolicy.failureCap() == FxTier.T2,
                "invalid precompile result must call production demotion");

        FxTierPolicy.resetForReload();
        require(FxCapabilityProbe.evaluateDeviceForTesting(true, () -> {
            throw new IllegalStateException("injected backend failure");
        }) == FxTier.T2, "precompile exception must resolve T2");
        require(FxTierPolicy.failureCap() == FxTier.T2,
                "precompile exception must call production demotion");

        FxTierPolicy.resetForReload();
        require(FxCapabilityProbe.evaluateDeviceForTesting(true, () -> true) == FxTier.T1,
                "valid device/precompile result must recover T1");
        require(FxTierPolicy.failureCap() == FxTier.T1, "valid probe leaves failure cap clear");

        require(FxCapabilityProbe.evaluateDeviceForTesting(false, () -> true) == FxTier.T2,
                "pre-reload injected device loss must demote");
        new FxReloadListener().onResourceManagerReload(resourceManager);
        require(FxTierPolicy.failureCap() == FxTier.T1,
                "production reload listener must clear the runtime failure cap");
        require(FxCapabilityProbe.capabilityCap() == FxTier.T1,
                "valid packaged resources/device must recover T1 on reload");
    }

    private static void testSubmitAndCallbackFailureSeams() {
        FxFrameStats.clear();
        FxFrameStats.beginFrame(new Object());
        FxTierPolicy.resetForReload();
        require(!FxRenderSubmission.registerGeometry(FxTier.T1, () -> {
            throw new IllegalStateException("injected submit failure");
        }), "throwing custom submit must be intercepted");
        require(FxTierPolicy.failureCap() == FxTier.T2, "custom submit failure must demote to T2");
        requireNoSuccessfulGeometry("throwing custom submit");

        FxFrameStats.clear();
        FxFrameStats.beginFrame(new Object());
        FxTierPolicy.resetForReload();
        require(FxRenderSubmission.runEmitter(
                FxTier.T1, FxRenderSubmission.customTypeForTesting(), () -> 0) == 0,
                "zero emitter must report zero");
        require(FxTierPolicy.failureCap() == FxTier.T2, "zero custom emitter must demote to T2");
        requireNoSuccessfulGeometry("zero custom emitter");

        FxFrameStats.clear();
        FxFrameStats.beginFrame(new Object());
        FxTierPolicy.resetForReload();
        require(FxRenderSubmission.runEmitter(
                FxTier.T1, FxRenderSubmission.customTypeForTesting(), () -> {
                    throw new IllegalArgumentException("injected callback failure");
                }) == 0, "throwing custom callback must be intercepted");
        require(FxTierPolicy.failureCap() == FxTier.T2, "custom callback failure must demote to T2");
        requireNoSuccessfulGeometry("throwing custom callback");

        FxFrameStats.clear();
        FxFrameStats.beginFrame(new Object());
        FxTierPolicy.resetForReload();
        require(FxRenderSubmission.runEmitter(FxTier.T2,
                net.minecraft.client.renderer.RenderType.lightning(), () -> {
                    throw new IllegalStateException("injected fallback failure");
                }) == 0, "throwing T2 callback must be intercepted");
        require(FxTierPolicy.failureCap() == FxTier.T3, "T2 fallback failure must demote to T3");
        requireNoSuccessfulGeometry("throwing T2 callback");
    }

    private static void testActualFrameAggregation() {
        FxFrameStats.clear();
        FxTierPolicy.resetForReload();
        Object frameOne = new Object();
        FxFrameStats.beginFrame(frameOne);
        int first = FxBudgets.MAX_RIPPLE_VERTICES_PER_FRAME - 1;
        require(FxRenderSubmission.runEmitter(
                FxTier.T1, FxRenderSubmission.customTypeForTesting(), () -> first) == first,
                "first actual callback count");
        require(FxRenderSubmission.runEmitter(
                FxTier.T1, FxRenderSubmission.customTypeForTesting(), () -> 2) == 2,
                "second actual callback count");
        require(FxFrameStats.currentFrameRippleVertices()
                        == FxBudgets.MAX_RIPPLE_VERTICES_PER_FRAME + 1L,
                "frame total must aggregate actual callback returns");
        require(FxFrameStats.vertexBudgetBreaches() == 1,
                "aggregate crossing records exactly one frame breach");
        require(FxFrameStats.peakFrameRippleVertices()
                        == FxBudgets.MAX_RIPPLE_VERTICES_PER_FRAME + 1L,
                "peak tracks aggregate frame total");

        FxFrameStats.beginFrame(new Object());
        require(FxRenderSubmission.runEmitter(
                FxTier.T1, FxRenderSubmission.customTypeForTesting(), () -> 4) == 4,
                "next-frame actual callback count");
        require(FxFrameStats.currentFrameRippleVertices() == 4,
                "new frame identity resets only the current-frame aggregate");
        require(FxFrameStats.peakFrameRippleVertices()
                        == FxBudgets.MAX_RIPPLE_VERTICES_PER_FRAME + 1L,
                "peak survives frame rollover");
        require(FxFrameStats.vertexBudgetBreaches() == 1,
                "non-breaching next frame does not increment breaches");
    }

    private static void testParticleFailureSeam() {
        FxParticleBudget.reset();
        FxTierPolicy.resetForReload();
        require(!FxParticleBudget.trySpawnAt(90L, () -> {
            throw new IllegalStateException("injected particle failure");
        }), "throwing particle spawn must be intercepted");
        require(FxTierPolicy.failureCap() == FxTier.OFF, "particle spawn failure must demote OFF");
        require(FxParticleBudget.acceptedTotal() == 0,
                "failed particle spawn must roll back accepted accounting");
        require(FxParticleBudget.liveEstimate() == 0,
                "failed particle spawn must not increase live estimate");

        FxDispatcher dispatcher = FxDispatcher.get();
        dispatcher.clear();
        long droppedBefore = dispatcher.droppedWhileOff();
        FxRippleSnapshot arrival =
                new FxRippleSnapshot(new BlockPos(1, 2, 3), 3.0f, 0xFFE77C56, 90L);
        require(!dispatcher.enqueueRippleFromDimension(arrival, Level.OVERWORLD, Level.OVERWORLD),
                "OFF failure cap must drop subsequent presentation events");
        require(dispatcher.droppedWhileOff() == droppedBefore + 1,
                "OFF drop must be counted without pooling the event");
        require(dispatcher.liveRippleCount() == 0, "OFF arrival must not mutate the ripple pool");
    }

    private static void testDuplicateAndDimensionDelivery() {
        FxDispatcher dispatcher = FxDispatcher.get();
        CuprumClientConfigs.client().fxTierCap = CuprumClientConfig.FxTierCap.FULL;
        FxTierPolicy.resetForReload();
        dispatcher.clear();
        long evictions = dispatcher.evictedTotal();
        FxRippleSnapshot first =
                new FxRippleSnapshot(new BlockPos(1, 2, 3), 3.0f, 0xFFE77C56, 100L);
        require(dispatcher.enqueueRippleFromDimension(first, Level.OVERWORLD, Level.OVERWORLD),
                "first delivery must enqueue");
        require(!dispatcher.enqueueRippleFromDimension(first, Level.OVERWORLD, Level.OVERWORLD),
                "duplicate event identity must be ignored");
        require(dispatcher.liveRippleCount() == 1, "duplicate must not consume a pool slot");
        require(dispatcher.evictedTotal() == evictions, "duplicate must not evict");
        FxRippleSnapshot nearDuplicate =
                new FxRippleSnapshot(first.center(), first.maxRadius(), first.colorArgb(), 101L);
        require(dispatcher.enqueueRippleFromDimension(
                        nearDuplicate, Level.OVERWORLD, Level.OVERWORLD),
                "adjacent startGameTime remains a distinct event");
        require(dispatcher.liveRippleCount() == 2, "near-duplicate must remain distinct");

        CuprumClientConfigs.client().fxTierCap = CuprumClientConfig.FxTierCap.MINIMAL;
        FxTierPolicy.resetForReload();
        dispatcher.clear();
        require(dispatcher.enqueueRippleFromDimension(first, Level.OVERWORLD, Level.OVERWORLD),
                "first T3 delivery must enqueue");
        require(FxParticleBudget.acceptedTotal() == FxBudgets.T3_MOTES_ON_ARRIVAL,
                "first T3 delivery emits one burst");
        require(!dispatcher.enqueueRippleFromDimension(first, Level.OVERWORLD, Level.OVERWORLD),
                "duplicate T3 delivery must be ignored");
        require(FxParticleBudget.acceptedTotal() == FxBudgets.T3_MOTES_ON_ARRIVAL,
                "duplicate must not emit a second burst");

        CuprumClientConfigs.client().fxTierCap = CuprumClientConfig.FxTierCap.FULL;
        FxTierPolicy.resetForReload();
        dispatcher.clear();
        require(dispatcher.enqueueRippleFromDimension(first, Level.OVERWORLD, Level.OVERWORLD),
                "overworld event must enqueue before direct swap");
        dispatcher.observeDimension(Level.NETHER);
        require(dispatcher.liveRippleCount() == 0, "direct dimension observation clears old pool");
        require(dispatcher.dimensionKeyForTesting().equals(Level.NETHER),
                "dispatcher tracks the new exact dimension key");
        long dropsBefore = dispatcher.wrongDimensionDrops();
        require(!dispatcher.enqueueRippleFromDimension(first, Level.OVERWORLD, Level.NETHER),
                "post-swap old-dimension payload must be dropped");
        require(dispatcher.liveRippleCount() == 0,
                "post-swap race cannot repopulate new dimension with old state");
        require(dispatcher.wrongDimensionDrops() == dropsBefore + 1,
                "post-swap race increments only the dimension-drop diagnostic");
        require(dispatcher.enqueueRippleFromDimension(first, Level.NETHER, Level.NETHER),
                "valid new-dimension delivery remains accepted");
    }

    private static void requireNoSuccessfulGeometry(String label) {
        require(FxFrameStats.customPipelineSubmits() == 0, label + " custom submit counter");
        require(FxFrameStats.vanillaFallbackSubmits() == 0, label + " fallback submit counter");
        require(FxFrameStats.rippleVerticesTotal() == 0, label + " vertex counter");
        require(FxFrameStats.currentFrameRippleVertices() == 0, label + " frame vertex counter");
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
