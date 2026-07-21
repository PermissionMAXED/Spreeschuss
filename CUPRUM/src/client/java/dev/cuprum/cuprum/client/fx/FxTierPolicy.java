package dev.cuprum.cuprum.client.fx;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.client.config.CuprumClientConfig;
import dev.cuprum.cuprum.client.config.CuprumClientConfigs;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The single tier gate (client-fx.md §1): every renderer/dispatcher consults
 * {@link #effectiveTier()}; there is no second gate anywhere. Resolution order — each step can
 * only lower the cap:
 *
 * <ol>
 *   <li>{@code CuprumClientConfig.fxTierCap} (QOL-04 switch; plan D2: field lives in the
 *       config module, read here),</li>
 *   <li>{@link FxCapabilityProbe#capabilityCap()} (device/assets/pipeline, cached per reload),</li>
 *   <li>{@link FxCompat#compatCap()} (W1D: always T1 — log-only posture, plan D10),</li>
 *   <li>the runtime failure cap installed by {@link #demote} (failure ladder §9: never crash,
 *       log once per reason, T1 → T2 → T3 → OFF).</li>
 * </ol>
 *
 * <p>Reads are lock-free (volatile); demotion may be requested from any thread but in practice
 * arrives on the render thread. {@link #resetForReload()} clears the failure cap and the
 * logged-reason set — a resource reload is the sanctioned recovery path (§9).
 */
public final class FxTierPolicy {
    private static volatile FxTier failureCap = FxTier.T1;
    private static final Set<String> LOGGED_REASONS = ConcurrentHashMap.newKeySet();

    /** Notifies {@code FxFrameStats} on effective-tier flips (QOL-04 counter epoch). */
    private static volatile FxTier lastObservedTier;

    private FxTierPolicy() {
    }

    /** min(configCap, capabilityCap, compatCap, failureCap) on the T1→OFF ladder. */
    public static FxTier effectiveTier() {
        FxTier tier = FxTier.lowerOf(configCap(),
                FxTier.lowerOf(FxCapabilityProbe.capabilityCap(),
                        FxTier.lowerOf(FxCompat.compatCap(), failureCap)));
        FxTier previous = lastObservedTier;
        if (previous != tier) {
            lastObservedTier = tier;
            if (previous != null) {
                FxFrameStats.onTierChanged();
            }
        }
        return tier;
    }

    /** Lowers the runtime failure cap to {@code cap}; each distinct reason is logged once. */
    public static void demote(FxTier cap, String reason) {
        FxTier current = failureCap;
        if (cap.ordinal() > current.ordinal()) {
            failureCap = cap;
        }
        if (LOGGED_REASONS.add(reason)) {
            Cuprum.LOGGER.warn("[fx] demoted to cap {} ({})", cap, reason);
        }
    }

    /** Called by {@code FxReloadListener}: a reload is the recovery path (§9). */
    public static void resetForReload() {
        failureCap = FxTier.T1;
        LOGGED_REASONS.clear();
    }

    /** The current runtime failure cap (diagnostics/gametests). */
    public static FxTier failureCap() {
        return failureCap;
    }

    private static FxTier configCap() {
        CuprumClientConfig.FxTierCap cap;
        try {
            cap = CuprumClientConfigs.client().fxTierCap;
        } catch (IllegalStateException e) {
            // Config not bootstrapped yet (defensive: init order puts config first).
            return FxTier.T1;
        }
        return switch (cap) {
            case FULL -> FxTier.T1;
            case REDUCED -> FxTier.T2;
            case MINIMAL -> FxTier.T3;
        };
    }
}
