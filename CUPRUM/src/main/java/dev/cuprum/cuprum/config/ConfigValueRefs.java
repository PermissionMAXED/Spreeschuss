package dev.cuprum.cuprum.config;

import java.util.Map;
import java.util.OptionalInt;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.ToIntFunction;

/**
 * The explicit typed map of config paths a handbook {@code charge} widget may reference
 * (plan §3.3): ref path → typed supplier over a {@link CuprumCommonConfig} snapshot. No
 * reflection — an unknown ref is a validation error at page decode, so handbook numbers can
 * never silently drift from the balance config or point at a renamed key. The path strings
 * are exactly the frozen {@code cuprum-common.json5} key set pinned by the
 * {@code configSchemaFreeze} GameTest; {@code configValueRefsMatchFrozenSchema} pins this
 * map against that same list.
 */
public final class ConfigValueRefs {
    private static final Map<String, ToIntFunction<CuprumCommonConfig>> REFS = Map.copyOf(new TreeMap<>(Map.of(
            "charge.passiveBaselineCgPerTick", config -> config.charge.passiveBaselineCgPerTick,
            "charge.leydenJarCapacityCg", config -> config.charge.leydenJarCapacityCg,
            "charge.strikeDepositCg", config -> config.charge.strikeDepositCg,
            "charge.wireLossPpTenthsPerSpanBare", config -> config.charge.wireLossPpTenthsPerSpanBare,
            "charge.wireLossPpTenthsPerSpanHv", config -> config.charge.wireLossPpTenthsPerSpanHv,
            "net.ratePerSecDefault", config -> config.net.ratePerSecDefault,
            "net.burstDefault", config -> config.net.burstDefault,
            "net.rateGlobalPerSec", config -> config.net.rateGlobalPerSec,
            "net.violationKickThreshold", config -> config.net.violationKickThreshold,
            "net.violationWindowTicks", config -> config.net.violationWindowTicks)));

    private ConfigValueRefs() {
    }

    /** True when {@code path} names an allowed ref (the widget codec rejects everything else). */
    public static boolean isValid(String path) {
        return path != null && REFS.containsKey(path);
    }

    /** The immutable set of allowed ref paths (sorted iteration via TreeMap copy source). */
    public static Set<String> allowedPaths() {
        return REFS.keySet();
    }

    /** Resolves {@code path} against {@code config}; empty for unknown paths (defense only). */
    public static OptionalInt resolve(String path, CuprumCommonConfig config) {
        ToIntFunction<CuprumCommonConfig> ref = REFS.get(path);
        return ref == null ? OptionalInt.empty() : OptionalInt.of(ref.applyAsInt(config));
    }
}
