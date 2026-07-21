package dev.cuprum.cuprum.client.fx;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.cuprum.cuprum.client.fx.render.CuprumRenderTypes;
import dev.cuprum.cuprum.client.fx.render.FxProbeRenderState;
import dev.cuprum.cuprum.client.fx.render.FxRippleGeometry;
import java.util.function.IntSupplier;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.SubmitNodeCollector;

/**
 * Production failure boundary around deferred FX geometry registration and execution.
 *
 * <p>Only a callback that returns a positive actual vertex count is recorded as a successful
 * submit. Interceptable T1 failures demote to T2; failures while already attempting the vanilla
 * T2 geometry fallback demote to T3. The next frame observes the single tier gate.
 */
public final class FxRenderSubmission {
    private FxRenderSubmission() {
    }

    /** Registers one deferred callback through the guarded production path. */
    public static void submit(PoseStack poseStack, SubmitNodeCollector collector,
            RenderType type, FxTier attemptedTier, FxProbeRenderState state) {
        registerGeometry(attemptedTier, () -> collector.submitCustomGeometry(poseStack, type,
                (pose, vertexConsumer) -> {
                    runEmitter(attemptedTier, type,
                            () -> attemptedTier == FxTier.T1
                                    ? FxRippleGeometry.emitRings(pose, vertexConsumer, state)
                                    : FxRippleGeometry.emitFallbackRings(pose, vertexConsumer, state));
                }));
    }

    /** Package-private production seam exercised by the permanent client failure-path test. */
    static boolean registerGeometry(FxTier attemptedTier, Runnable registration) {
        try {
            registration.run();
            return true;
        } catch (RuntimeException exception) {
            demoteGeometryFailure(attemptedTier, "submit", exception);
            return false;
        }
    }

    /** Package-private production seam exercised with zero and throwing emitters. */
    static int runEmitter(FxTier attemptedTier, RenderType type, IntSupplier emitter) {
        try {
            int actualVertices = emitter.getAsInt();
            if (actualVertices <= 0) {
                demoteGeometryFailure(attemptedTier, "callback returned zero vertices", null);
                return 0;
            }
            FxFrameStats.recordSubmit(type, actualVertices);
            return actualVertices;
        } catch (RuntimeException exception) {
            demoteGeometryFailure(attemptedTier, "callback", exception);
            return 0;
        }
    }

    private static void demoteGeometryFailure(
            FxTier attemptedTier, String stage, RuntimeException exception) {
        FxTier fallback = attemptedTier == FxTier.T1 ? FxTier.T2 : FxTier.T3;
        String path = attemptedTier == FxTier.T1 ? "custom pipeline" : "T2 vanilla fallback";
        String exceptionKind = exception == null ? "" : " (" + exception.getClass().getSimpleName() + ")";
        FxTierPolicy.demote(fallback, path + " " + stage + " failure" + exceptionKind);
    }

    /** Compile-time/test identity check without exposing RenderType internals. */
    static RenderType customTypeForTesting() {
        return CuprumRenderTypes.FX_RIPPLE;
    }
}
