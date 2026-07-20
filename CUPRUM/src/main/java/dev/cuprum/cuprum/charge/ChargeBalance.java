package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.config.CuprumConfigs;

/**
 * Thin typed accessor over the config module's {@code charge} section (plan D2: the config
 * module solely owns file/serializer/schema; charge owns the section's semantics). No static
 * defaults live here — the INDEX literals are the {@code CuprumCommonConfig.ChargeSection} field
 * initializers — and no config keys are added by this class. GameTests read the same config
 * object (INDEX vocabulary contract). All Cg amounts widen to {@code long}.
 */
public final class ChargeBalance {
    private ChargeBalance() {
    }

    /** Passive baseline B (INDEX): Cg per tick. */
    public static long passiveBaselineCgPerTick() {
        return CuprumConfigs.common().charge.passiveBaselineCgPerTick;
    }

    /** U05 Leyden jar capacity in Cg. */
    public static long leydenJarCapacityCg() {
        return CuprumConfigs.common().charge.leydenJarCapacityCg;
    }

    /** Lightning strike deposit in Cg (U04 consumes via {@code depositSurge}). */
    public static long strikeDepositCg() {
        return CuprumConfigs.common().charge.strikeDepositCg;
    }

    /** Bare U19 wire loss in tenths of a percentage point per full 16-block span (PWR-14). */
    public static int wireLossPpTenthsPerSpanBare() {
        return CuprumConfigs.common().charge.wireLossPpTenthsPerSpanBare;
    }

    /** HV wire loss in tenths of a percentage point per full 16-block span (PWR-14). */
    public static int wireLossPpTenthsPerSpanHv() {
        return CuprumConfigs.common().charge.wireLossPpTenthsPerSpanHv;
    }
}
