package dev.cuprum.cuprum.perf;

/**
 * Centralized perf budget literals (handbook-config.md §9; plan §6-9). W1 ships the two
 * deliberately loose calibration gates; W14 appends its scene budgets here (FX owns the FX
 * literals — plan D2/§6 flag) and binds {@code w14_*} gates to the same
 * {@link PerfBudget#assertMeanBelow} API. Append-only.
 */
public final class PerfBudgets {
    /** {@code w1_perf_baseline_idle}: mean server tick over 1,000 idle ticks ≤ 10 ms. */
    public static final long W1_IDLE_TICK_MEAN_NS = 10_000_000L;
    /** {@code w1_perf_baseline_idle} sampled tick count. */
    public static final int W1_IDLE_TICK_SAMPLES = 1_000;
    /** {@code w1_perf_baseline_handbook}: mean client frame with the probe page open ≤ 33.3 ms. */
    public static final long W1_HANDBOOK_FRAME_MEAN_NS = 33_300_000L;
    /** {@code w1_perf_baseline_handbook} sampled tick count (page open). */
    public static final int W1_HANDBOOK_FRAME_SAMPLES = 200;
    /** Warmup samples dropped by both W1 gates (JIT/chunk-load noise). */
    public static final int W1_WARMUP_SAMPLES = 40;

    private PerfBudgets() {
    }
}
