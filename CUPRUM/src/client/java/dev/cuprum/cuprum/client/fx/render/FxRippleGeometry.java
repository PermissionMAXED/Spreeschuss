package dev.cuprum.cuprum.client.fx.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import dev.cuprum.cuprum.fx.core.FxBudgets;
import net.minecraft.util.Mth;

/**
 * CPU-side ripple ring tesselation (client-fx.md §3/§11): emits one flat annular ring per
 * live ripple on the probe's top face, exactly {@link FxBudgets#RIPPLE_SEGMENTS} segments x 4
 * vertices = {@value dev.cuprum.cuprum.fx.core.FxBudgets#RIPPLE_VERTICES} vertices per ripple
 * (★ budget row). Positions are block-local (the BER pose stack is already translated to the
 * block origin, camera-relative). T1 uses {@code POSITION_COLOR_TEX}/QUADS: UV0.x is the signed
 * band coordinate (-1 inner, +1 outer) and UV0.y is normalized lifetime. T2 uses the same
 * positions through vanilla's {@code POSITION_COLOR} lightning format and omits UV writes.
 *
 * <p>T1's original fragment shader derives a symmetric quartic profile and life tint/fade from
 * UV. T2 retains a simple inner-to-outer alpha fade as the deliberately cheaper vanilla
 * fallback. No trigonometry per frame beyond the segment table — angles are precomputed once
 * (radii vary per ripple, so sin/cos stay per-vertex multiplies of the cached unit circle).
 */
public final class FxRippleGeometry {
    /** Ring band width in blocks (outer radius - inner radius). */
    static final float BAND_WIDTH = 0.35f;
    /** Ring height above the block top (avoids z-fighting with the top face). */
    static final float HEIGHT_ABOVE_TOP = 0.0625f;

    private static final float[] UNIT_X = new float[FxBudgets.RIPPLE_SEGMENTS + 1];
    private static final float[] UNIT_Z = new float[FxBudgets.RIPPLE_SEGMENTS + 1];

    static {
        for (int i = 0; i <= FxBudgets.RIPPLE_SEGMENTS; i++) {
            float angle = (Mth.TWO_PI * i) / FxBudgets.RIPPLE_SEGMENTS;
            UNIT_X[i] = Mth.cos(angle);
            UNIT_Z[i] = Mth.sin(angle);
        }
    }

    private FxRippleGeometry() {
    }

    /**
     * Emits every live ripple ring in {@code state} into {@code vertexConsumer}. Returns the
     * emitted vertex count (recorded by {@code FxFrameStats}; ≤
     * {@value dev.cuprum.cuprum.fx.core.FxBudgets#MAX_RIPPLE_VERTICES_PER_FRAME} by pool cap).
     */
    public static int emitRings(PoseStack.Pose pose, VertexConsumer vertexConsumer, FxProbeRenderState state) {
        int vertices = 0;
        for (int r = 0; r < state.rippleCount; r++) {
            vertices += emitRing(pose, vertexConsumer, state.rippleRadius[r],
                    state.rippleColorArgb[r], state.rippleLife[r], true);
        }
        return vertices;
    }

    /** Emits the UV-free T2 geometry into vanilla's POSITION_COLOR lightning consumer. */
    public static int emitFallbackRings(
            PoseStack.Pose pose, VertexConsumer vertexConsumer, FxProbeRenderState state) {
        int vertices = 0;
        for (int r = 0; r < state.rippleCount; r++) {
            vertices += emitRing(pose, vertexConsumer, state.rippleRadius[r],
                    state.rippleColorArgb[r], state.rippleLife[r], false);
        }
        return vertices;
    }

    private static int emitRing(PoseStack.Pose pose, VertexConsumer vertexConsumer,
            float radius, int colorArgb, float life, boolean includeUv) {
        float cx = 0.5f;
        float cy = 1.0f + HEIGHT_ABOVE_TOP;
        float cz = 0.5f;
        float inner = Math.max(0.0f, radius - BAND_WIDTH * 0.5f);
        float outer = radius + BAND_WIDTH * 0.5f;
        int innerColor = colorArgb;
        if (!includeUv) {
            int lifeAlpha = Math.round((1.0f - life) * 255.0f);
            int alpha = (colorArgb >>> 24) * lifeAlpha / 255;
            innerColor = (alpha << 24) | (colorArgb & 0x00FFFFFF);
        }
        int outerColor = includeUv ? colorArgb : colorArgb & 0x00FFFFFF;
        int vertices = 0;
        for (int i = 0; i < FxBudgets.RIPPLE_SEGMENTS; i++) {
            float x0 = UNIT_X[i];
            float z0 = UNIT_Z[i];
            float x1 = UNIT_X[i + 1];
            float z1 = UNIT_Z[i + 1];
            // Both pipelines cull back faces (vanilla LIGHTNING recipe, default cull=true):
            // inner0 → inner1 → outer1 → outer0 is CCW (front-facing) seen from above, the
            // diagnostic's canonical viewpoint (§12 gametest looks down at the ring).
            VertexConsumer inner0 = vertexConsumer.addVertex(pose, cx + x0 * inner, cy, cz + z0 * inner)
                    .setColor(innerColor);
            if (includeUv) {
                inner0.setUv(-1.0f, life);
            }
            vertices++;
            VertexConsumer inner1 = vertexConsumer.addVertex(pose, cx + x1 * inner, cy, cz + z1 * inner)
                    .setColor(innerColor);
            if (includeUv) {
                inner1.setUv(-1.0f, life);
            }
            vertices++;
            VertexConsumer outer1 = vertexConsumer.addVertex(pose, cx + x1 * outer, cy, cz + z1 * outer)
                    .setColor(outerColor);
            if (includeUv) {
                outer1.setUv(1.0f, life);
            }
            vertices++;
            VertexConsumer outer0 = vertexConsumer.addVertex(pose, cx + x0 * outer, cy, cz + z0 * outer)
                    .setColor(outerColor);
            if (includeUv) {
                outer0.setUv(1.0f, life);
            }
            vertices++;
        }
        return vertices;
    }
}
