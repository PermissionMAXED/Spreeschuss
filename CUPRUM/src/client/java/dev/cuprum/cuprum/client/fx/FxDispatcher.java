package dev.cuprum.cuprum.client.fx;

import dev.cuprum.cuprum.client.fx.render.FxProbeRenderState;
import dev.cuprum.cuprum.fx.FxContent;
import dev.cuprum.cuprum.fx.core.FxBudgets;
import dev.cuprum.cuprum.fx.core.FxRippleRing;
import dev.cuprum.cuprum.fx.core.RippleMath;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.level.Level;

/**
 * The pooled client FX dispatcher (client-fx.md §5): owns the single fixed-capacity
 * {@link FxRippleRing} (16 slots, oldest evicted, zero steady-state allocation), ticks ripple
 * expiry and fallback-mote spawning, and copies primitives into render states during extract.
 *
 * <p>Tier behavior (single gate {@link FxTierPolicy#effectiveTier()}):
 * <ul>
 *   <li><b>T1</b> — geometry only (custom pipeline); no motes.</li>
 *   <li><b>T2</b> — geometry via vanilla {@code lightning()} + at most
 *       {@value dev.cuprum.cuprum.fx.core.FxBudgets#T2_MOTES_PER_BURST} motes per ripple per
 *       {@value dev.cuprum.cuprum.fx.core.FxBudgets#T2_MOTE_INTERVAL_TICKS} ticks.</li>
 *   <li><b>T3</b> — exactly one 8-mote burst on ripple arrival; no geometry (the world visual
 *       is particle-only; HUD badge indicators are a later QOL wave concern).</li>
 *   <li><b>OFF</b> — log-only terminal rung: the arrival is dropped entirely.</li>
 * </ul>
 *
 * <p>Threading: payload handlers are documented render-thread and {@code END_WORLD_TICK} runs
 * on the client thread — the same thread in-game — but connection lifecycle clear can run on a
 * Netty event-loop thread, so every state-touching method is {@code synchronized} (16 slots; the
 * contention cost is negligible). The lifecycle lock is always acquired before this instance
 * monitor and is never acquired from dispatcher code. {@link #clear()} touches no Minecraft/world
 * state. Mote spawning happens only from {@link #tick} and {@link #enqueueRipple} (client thread).
 */
public final class FxDispatcher {
    private static final FxDispatcher INSTANCE = new FxDispatcher();

    private final FxRippleRing ring = new FxRippleRing(FxBudgets.MAX_RIPPLES);

    private long droppedWhileOff;
    private long wrongDimensionDrops;
    private ResourceKey<Level> dimensionKey;

    private FxDispatcher() {
    }

    public static FxDispatcher get() {
        return INSTANCE;
    }

    /** Render-thread payload handler entry point (no extra queue needed, §6). */
    public synchronized void enqueueRipple(FxRippleSnapshot snapshot) {
        ClientLevel currentLevel = Minecraft.getInstance().level;
        if (currentLevel == null) {
            return;
        }
        enqueueRippleFromDimension(snapshot, currentLevel.dimension(), currentLevel.dimension());
    }

    /**
     * Dimension-checked delivery seam. Direct tests and future non-network producers may supply
     * distinct observed/current keys; the session-guarded networking receiver supplies the
     * current key for both because its exact response-sender identity rejects old-session work.
     */
    synchronized boolean enqueueRippleFromDimension(FxRippleSnapshot snapshot,
            ResourceKey<Level> sourceDimension, ResourceKey<Level> currentDimension) {
        ensureDimension(currentDimension);
        if (!sourceDimension.equals(currentDimension)) {
            wrongDimensionDrops++;
            return false;
        }
        FxTier tier = FxTierPolicy.effectiveTier();
        if (tier == FxTier.OFF) {
            droppedWhileOff++;
            return false; // terminal rung: log-only posture is handled by the demotion log itself
        }
        boolean added = ring.addIfAbsent(snapshot.center().asLong(), snapshot.startGameTime(),
                snapshot.colorArgb(), RippleMath.toQ8(snapshot.maxRadius()));
        if (!added) {
            return false;
        }
        if (tier == FxTier.T3) {
            // T3 world visual: exactly one burst on arrival (§5); geometry stays off.
            ClientLevel level = Minecraft.getInstance().level;
            if (level != null) {
                spawnMoteBurst(level, snapshot.center(), FxBudgets.T3_MOTES_ON_ARRIVAL, 0.0f);
            }
        }
        return true;
    }

    /** {@code ClientTickEvents.END_WORLD_TICK}: expiry + T2 mote cadence (client thread). */
    public synchronized void tick(ClientLevel level) {
        ensureDimension(level.dimension());
        long now = level.getGameTime();
        FxParticleBudget.tick(now);
        ring.expire(now, FxBudgets.RIPPLE_LIFETIME_TICKS);
        if (FxTierPolicy.effectiveTier() != FxTier.T2) {
            return;
        }
        ring.visitAll((posKey, startTick, colorArgb, radiusQ8) -> {
            long age = now - startTick;
            if (age >= 0 && age % FxBudgets.T2_MOTE_INTERVAL_TICKS == 0) {
                // Deterministic cadence (§5): one ≤8-mote burst per ripple every 5 ticks,
                // fanned outward proportional to the current tick-quantized ring radius.
                float ringRadius = RippleMath.fromQ8(
                        RippleMath.radiusQ8AtAge(radiusQ8, age, FxBudgets.RIPPLE_LIFETIME_TICKS));
                spawnMoteBurst(level, BlockPos.of(posKey), FxBudgets.T2_MOTES_PER_BURST, ringRadius);
            }
        });
    }

    /** Extract: pool → preallocated primitive arrays, zero allocation (client-fx.md §4). */
    public synchronized void extractRipplesAt(FxProbeRenderState out, BlockPos anchor, long nowTick) {
        ClientLevel currentLevel = Minecraft.getInstance().level;
        if (currentLevel != null) {
            ensureDimension(currentLevel.dimension());
        }
        out.rippleCount = 0;
        ring.visitAt(anchor.asLong(), (posKey, startTick, colorArgb, radiusQ8) -> {
            if (out.rippleCount >= FxBudgets.MAX_RIPPLES) {
                return; // defensive: the ring capacity already guarantees this bound
            }
            long age = nowTick - startTick;
            int currentQ8 = RippleMath.radiusQ8AtAge(radiusQ8, age, FxBudgets.RIPPLE_LIFETIME_TICKS);
            if (currentQ8 <= 0) {
                return; // age 0 (radius 0) or already expired but not yet ticked out
            }
            int slot = out.rippleCount++;
            out.rippleStartTick[slot] = startTick;
            out.rippleColorArgb[slot] = colorArgb;
            out.rippleRadius[slot] = RippleMath.fromQ8(currentQ8);
            out.rippleLife[slot] = Math.clamp(
                    (float) age / FxBudgets.RIPPLE_LIFETIME_TICKS, 0.0f, 1.0f);
        });
    }

    /** Reload/invalidation/session lifecycle: mod-owned pools cleared, lazily reinit (§5/§9). */
    public synchronized void clear() {
        ring.clear();
        FxParticleBudget.reset();
        dimensionKey = null;
    }

    /** Live pooled ripple count (diagnostics/gametests). */
    public synchronized int liveRippleCount() {
        return ring.size();
    }

    /** Ripples evicted by pool overflow since startup (★ pool-cap proof). */
    public synchronized long evictedTotal() {
        return ring.evictedTotal();
    }

    /** Arrivals dropped at the OFF rung (diagnostics). */
    public synchronized long droppedWhileOff() {
        return droppedWhileOff;
    }

    /** Payloads rejected because their source player belongs to an old dimension. */
    public synchronized long wrongDimensionDrops() {
        return wrongDimensionDrops;
    }

    /** Active pool dimension, or null after a lifecycle clear and before the next world event. */
    synchronized ResourceKey<Level> dimensionKeyForTesting() {
        return dimensionKey;
    }

    /** Production dimension-observation seam (tick/extract use the same transition helper). */
    synchronized void observeDimension(ResourceKey<Level> currentDimension) {
        ensureDimension(currentDimension);
    }

    private void spawnMoteBurst(ClientLevel level, BlockPos center, int count, float speed) {
        double cx = center.getX() + 0.5;
        double cy = center.getY() + 1.1;
        double cz = center.getZ() + 0.5;
        for (int i = 0; i < count; i++) {
            // Deterministic fan: evenly spaced directions, slight upward drift.
            double angle = (Math.PI * 2.0 * i) / count;
            double vx = Math.cos(angle) * speed * 0.05;
            double vz = Math.sin(angle) * speed * 0.05;
            boolean spawned = FxParticleBudget.trySpawn(
                    level, FxContent.COPPER_MOTE, cx, cy, cz, vx, 0.02, vz);
            if (!spawned && FxTierPolicy.effectiveTier() == FxTier.OFF) {
                return;
            }
        }
    }

    private void ensureDimension(ResourceKey<Level> currentDimension) {
        if (dimensionKey == null) {
            dimensionKey = currentDimension;
        } else if (!dimensionKey.equals(currentDimension)) {
            ring.clear();
            FxParticleBudget.reset();
            FxFrameStats.clear();
            dimensionKey = currentDimension;
        }
    }
}
