package dev.cuprum.cuprum.client;

import com.mojang.blaze3d.pipeline.BlendFunction;
import com.mojang.blaze3d.pipeline.CompiledRenderPipeline;
import com.mojang.blaze3d.pipeline.RenderPipeline;
import com.mojang.blaze3d.systems.GpuDevice;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.blaze3d.vertex.VertexFormat;
import com.mojang.blaze3d.vertex.VertexFormatElement;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.client.particle.v1.FabricSpriteProvider;
import net.fabricmc.fabric.api.client.particle.v1.ParticleFactoryRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.InvalidateRenderStateCallback;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.resource.v1.ResourceLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.particle.ParticleProvider;
import net.minecraft.client.particle.SingleQuadParticle;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.texture.TextureAtlasSprite;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.server.packs.resources.ResourceManagerReloadListener;

/**
 * Compile-time signature probe for the W1D client FX foundation surfaces (client-fx.md §13;
 * RenderApiProbe rules: private members, never invoked, no static-initializer work, so
 * {@code @Override}/typed calls make upstream signature changes hard compile errors under
 * {@code -Xlint -Werror}). See docs/API_PROBES.md "Custom pipelines & FX foundation".
 *
 * <p><b>Built-in GameTime posture (CP0C):</b> {@code GameTime} lives in the {@code Globals}
 * UBO ({@code GLOBALS_SNIPPET}), which {@code MATRICES_FOG_SNIPPET} does <b>not</b> include;
 * whether a custom pipeline may bind {@code Globals} is unproven at W1D, so no Cuprum shader
 * promises it — ripple animation is CPU-computed geometry. The runtime half of the pipeline
 * probe is {@code FxCapabilityProbe} step 3 (same {@code precompilePipeline().isValid()}
 * mechanism pinned in {@link #probePipelineCompile}).
 */
public final class FxApiProbe {
    private FxApiProbe() {
    }

    /**
     * Probe 1: the exact T1 pipeline builder recipe over the verified
     * {@code MATRICES_FOG_SNIPPET} (packed {@code POSITION_COLOR_TEX} attributes, additive
     * blend, no depth write) plus the typed static registration entry point.
     */
    private static RenderPipeline probePipelineBuilder(ResourceLocation location) {
        return RenderPipelines.register(RenderPipeline.builder(RenderPipelines.MATRICES_FOG_SNIPPET)
                .withLocation(location)
                .withVertexShader(location)
                .withFragmentShader(location)
                .withBlend(BlendFunction.LIGHTNING)
                .withDepthWrite(false)
                .withVertexFormat(probePositionColorTexFormat(), VertexFormat.Mode.QUADS)
                .build());
    }

    /** Probe 1b: 1.21.9's public elements compose the exact Position/Color/UV0 format. */
    private static VertexFormat probePositionColorTexFormat() {
        return VertexFormat.builder()
                .add("Position", VertexFormatElement.POSITION)
                .add("Color", VertexFormatElement.COLOR)
                .add("UV0", VertexFormatElement.UV0)
                .build();
    }

    /**
     * Probe 2: typed world {@code RenderType} creation over a custom pipeline with the
     * no-frills composite state ({@code TRANSIENT_BUFFER_SIZE} = 1536, no crumbling, sorted).
     */
    private static RenderType probeRenderTypeCreate(String name, RenderPipeline pipeline) {
        return RenderType.create(name, RenderType.TRANSIENT_BUFFER_SIZE, false, true,
                pipeline, RenderType.CompositeState.builder().createCompositeState(false));
    }

    /** Probe 2b: POSITION_COLOR_TEX geometry can write packed color followed by UV0. */
    private static void probePositionColorTexEmitter(PoseStack.Pose pose, VertexConsumer consumer) {
        consumer.addVertex(pose, 0.0f, 0.0f, 0.0f).setColor(0xFFFFFFFF).setUv(-1.0f, 0.5f);
    }

    /**
     * Probe 3: the runtime pipeline-compile check — the same {@code GameRenderer} mechanism
     * {@code FxCapabilityProbe} uses — plus the sanctioned nullable device accessor.
     */
    private static boolean probePipelineCompile(RenderPipeline pipeline) {
        GpuDevice device = RenderSystem.tryGetDevice();
        if (device == null) {
            return false;
        }
        CompiledRenderPipeline compiled = device.precompilePipeline(pipeline);
        return compiled.isValid();
    }

    /**
     * Probe 4a: 1.21.9 particle shape — {@code SingleQuadParticle} ctor takes the
     * {@link TextureAtlasSprite}; the abstract {@code getLayer()} returns the Layer record
     * carrying the {@code RenderPipeline} ({@code TextureSheetParticle} no longer exists).
     */
    private static final class ProbeQuadParticle extends SingleQuadParticle {
        private ProbeQuadParticle(ClientLevel level, double x, double y, double z, TextureAtlasSprite sprite) {
            super(level, x, y, z, sprite);
        }

        @Override
        protected SingleQuadParticle.Layer getLayer() {
            return SingleQuadParticle.Layer.TRANSLUCENT;
        }
    }

    /** Probe 4b: the sprite-lambda provider shape plus the typed pending-factory hook. */
    private static void probeParticleRegistration(SimpleParticleType type) {
        ParticleProvider.Sprite<SimpleParticleType> sprite =
                (particleOptions, level, x, y, z, xSpeed, ySpeed, zSpeed, random) -> null;
        ParticleFactoryRegistry.PendingParticleFactory<SimpleParticleType> pending =
                (FabricSpriteProvider provider) -> (particleOptions, level, x, y, z, xs, ys, zs, random) ->
                        new ProbeQuadParticle(level, x, y, z, provider.get(0, 1));
        ParticleFactoryRegistry.getInstance().register(type, pending);
        assert sprite != null;
    }

    /** Probe 5: typed S2C payload type registration + render-thread client receiver shape. */
    private static <T extends CustomPacketPayload> void probePayloadHooks(
            CustomPacketPayload.Type<T> type, StreamCodec<? super RegistryFriendlyByteBuf, T> codec) {
        PayloadTypeRegistry.playS2C().register(type, codec);
        ClientPlayNetworking.registerGlobalReceiver(type, (payload, context) -> {
            Minecraft minecraft = context.client();
            assert minecraft != null;
        });
    }

    /** Probe 6: the non-deprecated v1 reload path with a vanilla sync reload listener. */
    private static void probeReloadRegistration(ResourceLocation id) {
        ResourceManagerReloadListener listener = new ResourceManagerReloadListener() {
            @Override
            public void onResourceManagerReload(ResourceManager resourceManager) {
            }
        };
        ResourceLoader.get(PackType.CLIENT_RESOURCES).registerReloader(id, listener);
    }

    /** Probe 7: FX lifecycle events (render-state invalidation + end-of-world-tick). */
    private static void probeLifecycleEvents() {
        InvalidateRenderStateCallback.EVENT.register(() -> {
        });
        ClientTickEvents.END_WORLD_TICK.register(level -> {
        });
    }

    /** Probe 8: the vanilla accessibility option accessors FxSettings reads. */
    private static double probeOptionsAccessors(Minecraft minecraft) {
        boolean hideFlash = minecraft.options.hideLightningFlash().get();
        double screenEffectScale = minecraft.options.screenEffectScale().get();
        var particleStatus = minecraft.options.particles().get();
        return hideFlash ? 0.0 : screenEffectScale + particleStatus.getId();
    }
}
