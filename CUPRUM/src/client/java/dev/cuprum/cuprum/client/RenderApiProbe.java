package dev.cuprum.cuprum.client;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import net.fabricmc.fabric.api.client.particle.v1.ParticleFactoryRegistry;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.particle.Particle;
import net.minecraft.client.particle.ParticleProvider;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderer;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderers;
import net.minecraft.client.renderer.blockentity.state.BlockEntityRenderState;
import net.minecraft.client.renderer.feature.ModelFeatureRenderer;
import net.minecraft.client.renderer.state.CameraRenderState;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.phys.Vec3;

/**
 * Compile-time signature probe for the 1.21.9 client rendering stack. Every member
 * below is a real implementation or call of the exact API the future Storm Shield
 * renderer (catalog U01/U02) will use, so an upstream signature change fails this
 * module's compilation immediately ({@code @Override} on interface methods makes
 * renames/parameter changes hard errors, and the probe methods type-check the exact
 * registration entry points).
 *
 * <p>Nothing here is ever invoked: all members are private, the class is never
 * instantiated and no static initializer performs work, so the probe is side-effect
 * free at runtime. It is client-only (client source set). See docs/API_PROBES.md and
 * docs/RENDERING_NOTES.md for the corresponding findings.
 */
public final class RenderApiProbe {
    private RenderApiProbe() {
    }

    /**
     * Probe 1: the 1.21.9 extract/submit BlockEntityRenderer pipeline.
     * {@code @Override} guarantees these are the real
     * {@code createRenderState()/extractRenderState(...)/submit(...)} signatures.
     */
    private static final class ProbeBlockEntityRenderer
            implements BlockEntityRenderer<BlockEntity, BlockEntityRenderState> {
        @Override
        public BlockEntityRenderState createRenderState() {
            return new BlockEntityRenderState();
        }

        @Override
        public void extractRenderState(BlockEntity blockEntity, BlockEntityRenderState renderState, float partialTick,
                Vec3 cameraPosition, ModelFeatureRenderer.CrumblingOverlay breakProgress) {
            BlockEntityRenderState.extractBase(blockEntity, renderState, breakProgress);
        }

        @Override
        public void submit(BlockEntityRenderState renderState, PoseStack poseStack,
                SubmitNodeCollector nodeCollector, CameraRenderState cameraRenderState) {
            // Probe 2: queued custom geometry submission,
            // submitCustomGeometry(PoseStack, RenderType, SubmitNodeCollector.CustomGeometryRenderer).
            nodeCollector.submitCustomGeometry(poseStack, RenderType.lines(), RenderApiProbe::renderCustomGeometry);
        }
    }

    /** Signature match for {@link SubmitNodeCollector.CustomGeometryRenderer#render}. */
    private static void renderCustomGeometry(PoseStack.Pose pose, VertexConsumer vertexConsumer) {
        // Intentionally empty: compile-time signature probe only.
    }

    /**
     * Probe 3: renderer registration. In 1.21.9 mods register through the vanilla
     * {@link BlockEntityRenderers#register} (public; Fabric's own
     * BlockEntityRendererRegistry is deprecated in Fabric API 0.134.1).
     */
    private static <T extends BlockEntity, S extends BlockEntityRenderState> void probeRendererRegistration(
            BlockEntityType<? extends T> type, BlockEntityRendererProvider<T, S> provider) {
        BlockEntityRenderers.register(type, provider);
    }

    /**
     * Probe 4: particle factory implementation. {@code @Override} pins the 1.21.9
     * {@code createParticle} signature (which gained a {@link RandomSource} parameter).
     */
    private static final class ProbeParticleProvider implements ParticleProvider<SimpleParticleType> {
        @Override
        public Particle createParticle(SimpleParticleType particleType, ClientLevel level,
                double x, double y, double z, double xSpeed, double ySpeed, double zSpeed, RandomSource random) {
            return null; // never called; the vanilla interface is @Nullable here
        }
    }

    /** Probe 5: Fabric particle registration entry point. */
    private static void probeParticleRegistration(SimpleParticleType type) {
        ParticleFactoryRegistry.getInstance().register(type, new ProbeParticleProvider());
    }
}
