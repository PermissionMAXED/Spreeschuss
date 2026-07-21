package dev.cuprum.cuprum.client.fx.render;

import com.mojang.blaze3d.pipeline.BlendFunction;
import com.mojang.blaze3d.pipeline.RenderPipeline;
import com.mojang.blaze3d.vertex.VertexFormat;
import com.mojang.blaze3d.vertex.VertexFormatElement;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.resources.ResourceLocation;

/**
 * Cuprum's custom {@link RenderPipeline} registry (client-fx.md §3; append-only for later
 * waves). W1D registers exactly one pipeline — the T1 copper ripple — mirroring the verified
 * Cuprum-authored ripple recipe: {@code MATRICES_FOG_SNIPPET} base, additive blend
 * ({@link BlendFunction#LIGHTNING} = SRC_ALPHA, ONE), depth <b>test</b> on (occluded by
 * terrain) but depth <b>write</b> off (translucent FX never occludes), packed
 * {@code POSITION_COLOR_TEX}/QUADS vertices. UV carries the signed band coordinate and
 * normalized lifetime consumed by the original quartic fragment profile.
 *
 * <p>Registration is a static initializer so the pipeline is in
 * {@code RenderPipelines.getStaticPipelines()} before the first {@code ShaderManager} apply;
 * {@code FxClientModule.init()} forces the classload. CP0C uniform posture: the pipeline
 * inherits only DynamicTransforms/Projection/Fog from the snippet — <b>no</b> {@code Globals}
 * UBO (built-in GameTime) and no per-draw uniforms, because neither is probe-proven for custom
 * pipelines (docs/API_PROBES.md "GameTime uncertainty"); the ripple animates from CPU-computed
 * geometry instead.
 */
public final class CuprumRenderPipelines {
    /**
     * Exact position/color/UV0 contract required by the authored ripple shader. Minecraft
     * 1.21.9 does not expose a {@code DefaultVertexFormat.POSITION_COLOR_TEX} constant, so
     * Cuprum composes that format from the public, compile-pinned elements instead of adding
     * an unrelated lightmap attribute or silently changing attribute order.
     */
    public static final VertexFormat POSITION_COLOR_TEX = VertexFormat.builder()
            .add("Position", VertexFormatElement.POSITION)
            .add("Color", VertexFormatElement.COLOR)
            .add("UV0", VertexFormatElement.UV0)
            .build();

    /** Ledger id {@code cuprum:pipeline/fx_ripple} (plan §3.4). */
    public static final RenderPipeline FX_RIPPLE = RenderPipelines.register(
            RenderPipeline.builder(RenderPipelines.MATRICES_FOG_SNIPPET)
                    .withLocation(ResourceLocation.fromNamespaceAndPath("cuprum", "pipeline/fx_ripple"))
                    .withVertexShader(ResourceLocation.fromNamespaceAndPath("cuprum", "core/fx_ripple"))
                    .withFragmentShader(ResourceLocation.fromNamespaceAndPath("cuprum", "core/fx_ripple"))
                    .withBlend(BlendFunction.LIGHTNING)
                    .withDepthWrite(false)
                    .withVertexFormat(POSITION_COLOR_TEX, VertexFormat.Mode.QUADS)
                    .build());

    private CuprumRenderPipelines() {
    }

    /** Forces the static registration from {@code FxClientModule.init()}. */
    public static void init() {
        // Static initializer above performs the registration.
    }
}
