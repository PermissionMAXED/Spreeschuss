package dev.cuprum.cuprum.fx.core;

/**
 * Frozen FX budget contract constants (plan D2: budget literals live in code, never config —
 * they pin SHD/QOL acceptance numbers; client-fx.md §11). MC-free so the budget math is unit
 * tested in {@code src/test} (plan D9). Value changes require budget review against the
 * family-header pins (SHD/TES/QOL/FX docs); waves may reference, never edit.
 */
public final class FxBudgets {
    /** SHD.md pin "max 16 concurrent ripples"; the ring pool capacity enforces it. */
    public static final int MAX_RIPPLES = 16;

    /** Ring tessellation: 32 segments per ripple (client-fx.md §11). */
    public static final int RIPPLE_SEGMENTS = 32;

    /** 32 segments x 4 quad vertices = 128 vertices per ripple (client-fx.md §11). */
    public static final int RIPPLE_VERTICES = RIPPLE_SEGMENTS * 4;

    /** Pool-wide vertex ceiling per frame: 16 ripples x 128 verts (client-fx.md §11). */
    public static final int MAX_RIPPLE_VERTICES_PER_FRAME = MAX_RIPPLES * RIPPLE_VERTICES;

    /** Diagnostic ripple lifetime in game ticks (client-fx.md §12: 40-tick expanding ring). */
    public static final int RIPPLE_LIFETIME_TICKS = 40;

    /** Cuprum FX particle spawn budget per client tick (client-fx.md §11). */
    public static final int PARTICLE_SPAWN_PER_TICK = 64;

    /** Cuprum FX live-particle ceiling, beneath the vanilla ParticleLimit (client-fx.md §11). */
    public static final int PARTICLE_LIVE_MAX = 256;

    /** T2 mote budget: at most 8 copper motes per ripple per 5 ticks (client-fx.md §5). */
    public static final int T2_MOTES_PER_BURST = 8;

    /** T2 mote cadence: one burst per ripple per this many ticks (client-fx.md §5). */
    public static final int T2_MOTE_INTERVAL_TICKS = 5;

    /** T3 world visual: exactly one 8-mote burst on ripple arrival (client-fx.md §5). */
    public static final int T3_MOTES_ON_ARRIVAL = 8;

    /** Server coalescing cap: at most 16 ripple payloads per second per client (§11). */
    public static final int RIPPLE_SENDS_PER_SECOND = 16;

    /** Game ticks per coalescing window (one second at the fixed 20 TPS tick rate). */
    public static final int SEND_WINDOW_TICKS = 20;

    /** Wire budget for one {@code cuprum:s2c/fx/ripple} payload in bytes (§11: <=32 B). */
    public static final int RIPPLE_PAYLOAD_MAX_BYTES = 32;

    /**
     * Radius wire bound in Q8.8 fixed point: 64 blocks is far beyond any diagnostic or
     * SHD-pinned effect radius and keeps the VAR_INT within two wire bytes.
     */
    public static final int MAX_RADIUS_Q8 = 64 * 256;

    /**
     * CP0C census: at most 4 distinct Cuprum world-FX RenderTypes ever (ripple now; arc, dome
     * and aurora slots reserved for TES/SHD waves). Asserted against the client registry.
     */
    public static final int MAX_WORLD_FX_RENDER_TYPES = 4;

    private FxBudgets() {
    }
}
