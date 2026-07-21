package dev.cuprum.cuprum.client.fx.particle;

import net.fabricmc.fabric.api.client.particle.v1.FabricSpriteProvider;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.particle.Particle;
import net.minecraft.client.particle.ParticleProvider;
import net.minecraft.client.particle.SingleQuadParticle;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraft.util.RandomSource;

/**
 * The copper mote — the T2/T3 fallback particle (client-fx.md §7, 1.21.9 shape:
 * {@code TextureSheetParticle} no longer exists; {@code SingleQuadParticle} takes the sprite
 * in the constructor and the abstract {@link #getLayer()} returns the Layer record carrying
 * the {@code RenderPipeline}). Deliberately deterministic for D12 screenshots: fixed lifetime,
 * fixed size, single sprite frame, no random jitter — the velocity fan comes fully from the
 * dispatcher. Physics off ({@code gravity 0}, no collision) so motes drift exactly along the
 * dispatcher's deterministic velocities.
 */
public final class CopperMoteParticle extends SingleQuadParticle {
    /** Fixed lifetime; must stay ≤ {@code FxParticleBudget.ASSUMED_MOTE_LIFETIME_TICKS}. */
    public static final int LIFETIME_TICKS = 24;

    private CopperMoteParticle(ClientLevel level, double x, double y, double z,
            double xSpeed, double ySpeed, double zSpeed, FabricSpriteProvider sprites) {
        super(level, x, y, z, xSpeed, ySpeed, zSpeed, sprites.get(0, 1));
        this.lifetime = LIFETIME_TICKS;
        this.quadSize = 0.09f;
        this.gravity = 0.0f;
        this.hasPhysics = false;
        this.friction = 1.0f;
        // Constructor super applies random ±0.4/0.1 velocity noise; restore determinism.
        this.xd = xSpeed;
        this.yd = ySpeed;
        this.zd = zSpeed;
        // Copper tone matching the ripple color 0xFFE77C56 (bright variant for additive-free
        // translucent layer visibility).
        this.setColor(0.906f, 0.486f, 0.337f);
    }

    @Override
    protected SingleQuadParticle.Layer getLayer() {
        return SingleQuadParticle.Layer.TRANSLUCENT;
    }

    @Override
    public void tick() {
        super.tick();
        // Tick-quantized linear fade-out, mirroring the ripple ring's alpha ramp.
        this.setAlpha(1.0f - (float) this.age / LIFETIME_TICKS);
    }

    /** Fabric {@code PendingParticleFactory} target (client-fx.md §7). */
    public static final class Provider implements ParticleProvider<SimpleParticleType> {
        private final FabricSpriteProvider sprites;

        public Provider(FabricSpriteProvider sprites) {
            this.sprites = sprites;
        }

        @Override
        public Particle createParticle(SimpleParticleType type, ClientLevel level, double x, double y, double z,
                double xSpeed, double ySpeed, double zSpeed, RandomSource random) {
            return new CopperMoteParticle(level, x, y, z, xSpeed, ySpeed, zSpeed, sprites);
        }
    }
}
