package dev.cuprum.cuprum.client.fx.render;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.cuprum.cuprum.blockentity.FxProbeBlockEntity;
import dev.cuprum.cuprum.client.fx.FxDispatcher;
import dev.cuprum.cuprum.client.fx.FxFrameStats;
import dev.cuprum.cuprum.client.fx.FxRenderSubmission;
import dev.cuprum.cuprum.client.fx.FxTier;
import dev.cuprum.cuprum.client.fx.FxTierPolicy;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderer;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.client.renderer.blockentity.state.BlockEntityRenderState;
import net.minecraft.client.renderer.feature.ModelFeatureRenderer;
import net.minecraft.client.renderer.state.CameraRenderState;
import net.minecraft.world.phys.Vec3;
import org.jetbrains.annotations.Nullable;

/**
 * The FX probe's extract/submit BER (client-fx.md §4). Contract rules: extract copies
 * primitives only ({@link FxDispatcher#extractRipplesAt} → preallocated arrays, zero
 * allocation); {@code submit} never touches GL/{@code RenderSystem} state — it only hands a
 * geometry callback to the {@link SubmitNodeCollector}, batched per {@link RenderType} by
 * {@code CustomFeatureRenderer} (one VertexConsumer per type per frame, verified).
 *
 * <p>Tier fan-out (single gate, resolved once per extract into the state): T1 → the custom
 * {@code cuprum:fx_ripple} type (★ exactly one extra RenderType batch); T2 → the identical
 * geometry through vanilla {@code RenderType.lightning()} (★ zero extra batches); T3/OFF → no
 * geometry (T3's world visual is particle-only, spawned by the dispatcher tick, not here).
 */
public final class FxProbeRenderer implements BlockEntityRenderer<FxProbeBlockEntity, FxProbeRenderState> {
    public FxProbeRenderer(BlockEntityRendererProvider.Context context) {
    }

    @Override
    public FxProbeRenderState createRenderState() {
        return new FxProbeRenderState();
    }

    @Override
    public void extractRenderState(FxProbeBlockEntity blockEntity, FxProbeRenderState renderState,
            float partialTick, Vec3 cameraPosition, @Nullable ModelFeatureRenderer.CrumblingOverlay breakProgress) {
        BlockEntityRenderState.extractBase(blockEntity, renderState, breakProgress);
        FxFrameStats.beginFrame(cameraPosition);
        renderState.tier = FxTierPolicy.effectiveTier();
        // Tick-quantized phase (§4): partialTick deliberately unused for the diagnostic.
        long nowTick = blockEntity.getLevel() != null ? blockEntity.getLevel().getGameTime() : 0L;
        FxDispatcher.get().extractRipplesAt(renderState, blockEntity.getBlockPos(), nowTick);
    }

    @Override
    public void submit(FxProbeRenderState renderState, PoseStack poseStack,
            SubmitNodeCollector nodeCollector, CameraRenderState cameraRenderState) {
        if (renderState.tier == FxTier.OFF || renderState.tier == FxTier.T3 || renderState.rippleCount == 0) {
            return;
        }
        RenderType type = renderState.tier == FxTier.T1 ? CuprumRenderTypes.FX_RIPPLE : RenderType.lightning();
        FxRenderSubmission.submit(poseStack, nodeCollector, type, renderState.tier, renderState);
    }

    @Override
    public int getViewDistance() {
        return 64;
    }
}
