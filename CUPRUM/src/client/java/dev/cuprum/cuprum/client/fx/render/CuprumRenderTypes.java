package dev.cuprum.cuprum.client.fx.render;

import dev.cuprum.cuprum.fx.core.FxBudgets;
import java.util.List;
import net.minecraft.client.renderer.RenderType;

/**
 * Cuprum's world-FX {@link RenderType} registry (client-fx.md §3/§11; append-only). Budget ★:
 * T1 adds exactly <b>one</b> RenderType batch ({@code cuprum:fx_ripple}); T2 adds zero (it
 * rides the vanilla {@code lightning()} batch — {@code CustomFeatureRenderer} batches per
 * RenderType, one VertexConsumer per type per frame, verified). CP0C census: at most
 * {@value dev.cuprum.cuprum.fx.core.FxBudgets#MAX_WORLD_FX_RENDER_TYPES} distinct Cuprum
 * world-FX RenderTypes ever — ripple (now) plus the reserved arc / dome / aurora slots
 * (TES/SHD waves append here); {@link #worldFxTypes()} is the census the client GameTest
 * asserts against.
 */
public final class CuprumRenderTypes {
    /** Ledger id {@code cuprum:fx_ripple} (plan §3.4); transient buffer, no crumbling, sorted. */
    public static final RenderType FX_RIPPLE = RenderType.create(
            "cuprum:fx_ripple", RenderType.TRANSIENT_BUFFER_SIZE, false, true,
            CuprumRenderPipelines.FX_RIPPLE,
            RenderType.CompositeState.builder().createCompositeState(false));

    /** The full world-FX census (append-only; ≤ {@code MAX_WORLD_FX_RENDER_TYPES} forever). */
    private static final List<RenderType> WORLD_FX_TYPES = List.of(FX_RIPPLE);

    static {
        if (WORLD_FX_TYPES.size() > FxBudgets.MAX_WORLD_FX_RENDER_TYPES) {
            throw new IllegalStateException("CP0C census breached: " + WORLD_FX_TYPES.size()
                    + " world-FX RenderTypes > " + FxBudgets.MAX_WORLD_FX_RENDER_TYPES);
        }
    }

    private CuprumRenderTypes() {
    }

    /** Immutable census list for CI/gametest assertions (client-fx.md §11). */
    public static List<RenderType> worldFxTypes() {
        return WORLD_FX_TYPES;
    }

    /** Forces the static registration from {@code FxClientModule.init()}. */
    public static void init() {
        // Static initializer above performs the registration.
    }
}
