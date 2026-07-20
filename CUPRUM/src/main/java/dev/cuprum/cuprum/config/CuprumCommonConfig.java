package dev.cuprum.cuprum.config;

import dev.cuprum.cuprum.Cuprum;
import me.shedaniel.autoconfig.ConfigData;
import me.shedaniel.autoconfig.annotation.Config;

/**
 * The single common (main/server) config authority (plan D2): AutoConfig + Jankson →
 * {@code config/cuprum-common.json5} (machine-managed; explanations live in lang-keyed tooltips
 * once the W1E screens land). Section contents and defaults are owned semantically by their
 * modules — {@code charge.*} by charge, {@code net.*} by net-state — but only this class defines
 * the file, serializer and schema. GameTests read the same object (INDEX vocabulary contract).
 * The exact key set is pinned by the {@code configSchemaFreeze} GameTest.
 *
 * <p>{@link Bounds} is the one place the per-key valid ranges live. Local <b>file</b> values are
 * clamped (with a warning) by {@link #validatePostLoad}; <b>wire</b> values are rejected outright
 * by the {@link ConfigSyncPayload} canonical constructor against the same ranges — a skewed or
 * hostile peer gets a decode failure, never a silent clamp.
 */
@Config(name = "cuprum-common")
public class CuprumCommonConfig implements ConfigData {
    /** Inclusive per-key valid range, shared by file clamping and wire rejection. */
    public record IntRange(int min, int max) {
        public boolean contains(int value) {
            return value >= min && value <= max;
        }

        public int clamp(int value) {
            return Math.max(min, Math.min(max, value));
        }
    }

    /** The frozen valid ranges for every {@code cuprum-common.json5} key (plan §3.3). */
    public static final class Bounds {
        public static final IntRange PASSIVE_BASELINE_CG_PER_TICK = new IntRange(0, 1_000_000);
        public static final IntRange LEYDEN_JAR_CAPACITY_CG = new IntRange(1, 100_000_000);
        public static final IntRange STRIKE_DEPOSIT_CG = new IntRange(0, 100_000_000);
        public static final IntRange WIRE_LOSS_PP_TENTHS_PER_SPAN_BARE = new IntRange(0, 1000);
        public static final IntRange WIRE_LOSS_PP_TENTHS_PER_SPAN_HV = new IntRange(0, 1000);
        public static final IntRange RATE_PER_SEC_DEFAULT = new IntRange(1, 1000);
        public static final IntRange BURST_DEFAULT = new IntRange(1, 10_000);
        public static final IntRange RATE_GLOBAL_PER_SEC = new IntRange(1, 10_000);
        public static final IntRange VIOLATION_KICK_THRESHOLD = new IntRange(1, 10_000);
        public static final IntRange VIOLATION_WINDOW_TICKS = new IntRange(20, 1_728_000);

        private Bounds() {
        }
    }

    /** Charge-economy constants (INDEX literals; semantic owner: charge, plan §3.3). */
    public static class ChargeSection {
        public int passiveBaselineCgPerTick = 5;
        public int leydenJarCapacityCg = 100_000;
        public int strikeDepositCg = 270_000;
        public int wireLossPpTenthsPerSpanBare = 20;
        public int wireLossPpTenthsPerSpanHv = 5;
    }

    /** Network guard constants (semantic owner: net-state, plan §3.3). */
    public static class NetSection {
        public int ratePerSecDefault = 4;
        public int burstDefault = 8;
        public int rateGlobalPerSec = 16;
        public int violationKickThreshold = 8;
        public int violationWindowTicks = 6000;
    }

    public ChargeSection charge = new ChargeSection();
    public NetSection net = new NetSection();

    /** Clamps out-of-range file values and logs each correction (plan §3.3). */
    @Override
    public void validatePostLoad() {
        if (charge == null) {
            charge = new ChargeSection();
            Cuprum.LOGGER.warn("[config] missing charge section restored to defaults");
        }
        if (net == null) {
            net = new NetSection();
            Cuprum.LOGGER.warn("[config] missing net section restored to defaults");
        }
        charge.passiveBaselineCgPerTick = clamp("charge.passiveBaselineCgPerTick",
                charge.passiveBaselineCgPerTick, Bounds.PASSIVE_BASELINE_CG_PER_TICK);
        charge.leydenJarCapacityCg = clamp("charge.leydenJarCapacityCg",
                charge.leydenJarCapacityCg, Bounds.LEYDEN_JAR_CAPACITY_CG);
        charge.strikeDepositCg = clamp("charge.strikeDepositCg",
                charge.strikeDepositCg, Bounds.STRIKE_DEPOSIT_CG);
        charge.wireLossPpTenthsPerSpanBare = clamp("charge.wireLossPpTenthsPerSpanBare",
                charge.wireLossPpTenthsPerSpanBare, Bounds.WIRE_LOSS_PP_TENTHS_PER_SPAN_BARE);
        charge.wireLossPpTenthsPerSpanHv = clamp("charge.wireLossPpTenthsPerSpanHv",
                charge.wireLossPpTenthsPerSpanHv, Bounds.WIRE_LOSS_PP_TENTHS_PER_SPAN_HV);
        net.ratePerSecDefault = clamp("net.ratePerSecDefault",
                net.ratePerSecDefault, Bounds.RATE_PER_SEC_DEFAULT);
        net.burstDefault = clamp("net.burstDefault", net.burstDefault, Bounds.BURST_DEFAULT);
        net.rateGlobalPerSec = clamp("net.rateGlobalPerSec",
                net.rateGlobalPerSec, Bounds.RATE_GLOBAL_PER_SEC);
        net.violationKickThreshold = clamp("net.violationKickThreshold",
                net.violationKickThreshold, Bounds.VIOLATION_KICK_THRESHOLD);
        net.violationWindowTicks = clamp("net.violationWindowTicks",
                net.violationWindowTicks, Bounds.VIOLATION_WINDOW_TICKS);
    }

    private static int clamp(String key, int value, IntRange range) {
        int clamped = range.clamp(value);
        if (clamped != value) {
            Cuprum.LOGGER.warn("[config] {} = {} out of range [{}, {}]; clamped to {}",
                    key, value, range.min(), range.max(), clamped);
        }
        return clamped;
    }
}
