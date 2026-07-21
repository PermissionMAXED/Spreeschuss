package dev.cuprum.cuprum.client.fx;

import dev.cuprum.cuprum.fx.core.FxBudgetCounter;
import dev.cuprum.cuprum.fx.core.FxBudgets;
import java.util.Arrays;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.particles.ParticleOptions;

/**
 * The single spawn gate for every Cuprum FX particle (client-fx.md §5/§11 ★): enforces the
 * {@link FxBudgets#PARTICLE_SPAWN_PER_TICK} and {@link FxBudgets#PARTICLE_LIVE_MAX} caps, then
 * delegates to {@link ClientLevel#addParticle}; the vanilla {@code ParticleEngine}
 * {@code ParticleLimit} caps and {@code Options.particles()} still apply underneath.
 *
 * <p>Vanilla never reports particle death back, so the live count is an <b>estimate</b>: a
 * fixed-size per-tick spawn window aged over {@link #ASSUMED_MOTE_LIFETIME_TICKS} (an upper
 * bound of the mote's real lifetime — over-estimating live particles only makes the gate
 * stricter, never looser than the ★ budget). Budget math is the MC-free
 * {@link FxBudgetCounter} (plan D9). All access is client-thread only (dispatcher tick and
 * render-thread payload handlers).
 */
public final class FxParticleBudget {
    /** Upper bound of {@code CopperMoteParticle} lifetime; ages the live-estimate window. */
    static final int ASSUMED_MOTE_LIFETIME_TICKS = 32;

    private static final FxBudgetCounter COUNTER =
            new FxBudgetCounter(FxBudgets.PARTICLE_SPAWN_PER_TICK, FxBudgets.PARTICLE_LIVE_MAX);

    /** Ring of spawn counts for the last {@code ASSUMED_MOTE_LIFETIME_TICKS} ticks. */
    private static final int[] SPAWN_WINDOW = new int[ASSUMED_MOTE_LIFETIME_TICKS];
    private static long windowNowTick = Long.MIN_VALUE;
    private static int liveEstimate;

    private FxParticleBudget() {
    }

    /** Advances the live-estimate window to {@code nowTick} (called from the dispatcher tick). */
    public static void tick(long nowTick) {
        advanceTo(nowTick);
    }

    /**
     * Tries to spawn one FX particle; false means the ★ budget gate rejected it (silently —
     * particles are presentation only). Client thread only.
     */
    public static boolean trySpawn(ClientLevel level, ParticleOptions options,
            double x, double y, double z, double vx, double vy, double vz) {
        long nowTick = level.getGameTime();
        return trySpawnAt(nowTick, () -> level.addParticle(options, x, y, z, vx, vy, vz));
    }

    /** Package-private production seam used by the permanent failure-path client test. */
    static boolean trySpawnAt(long nowTick, Runnable spawner) {
        advanceTo(nowTick);
        if (!COUNTER.tryReserve(nowTick, liveEstimate)) {
            return false;
        }
        try {
            spawner.run();
        } catch (RuntimeException exception) {
            COUNTER.rollbackReservation(nowTick);
            FxTierPolicy.demote(FxTier.OFF,
                    "particle spawn failure (" + exception.getClass().getSimpleName() + ")");
            return false;
        }
        SPAWN_WINDOW[slot(nowTick)]++;
        liveEstimate++;
        return true;
    }

    /** Live Cuprum FX particle estimate (★ ≤ {@link FxBudgets#PARTICLE_LIVE_MAX}). */
    public static int liveEstimate() {
        return liveEstimate;
    }

    public static long acceptedTotal() {
        return COUNTER.acceptedTotal();
    }

    public static long rejectedTotal() {
        return COUNTER.rejectedTotal();
    }

    /** Wired to render invalidation and identity-guarded session lifecycle via dispatcher clear. */
    public static void reset() {
        COUNTER.reset();
        Arrays.fill(SPAWN_WINDOW, 0);
        windowNowTick = Long.MIN_VALUE;
        liveEstimate = 0;
    }

    private static void advanceTo(long nowTick) {
        if (nowTick == windowNowTick) {
            return;
        }
        if (windowNowTick == Long.MIN_VALUE || nowTick < windowNowTick
                || nowTick - windowNowTick >= ASSUMED_MOTE_LIFETIME_TICKS) {
            // Fresh start, time rewind or full window elapsed: everything has expired.
            Arrays.fill(SPAWN_WINDOW, 0);
            liveEstimate = 0;
        } else {
            for (long t = windowNowTick + 1; t <= nowTick; t++) {
                int expiring = SPAWN_WINDOW[slot(t)];
                liveEstimate -= expiring;
                SPAWN_WINDOW[slot(t)] = 0;
            }
        }
        windowNowTick = nowTick;
    }

    private static int slot(long tick) {
        return Math.floorMod(tick, ASSUMED_MOTE_LIFETIME_TICKS);
    }
}
