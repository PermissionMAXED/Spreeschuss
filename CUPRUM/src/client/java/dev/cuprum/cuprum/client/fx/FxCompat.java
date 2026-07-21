package dev.cuprum.cuprum.client.fx;

import dev.cuprum.cuprum.Cuprum;
import net.fabricmc.loader.api.FabricLoader;

/**
 * Third-party renderer compatibility posture (client-fx.md §10 with the plan D10 override):
 * W1D only <b>logs</b> {@code isModLoaded("sodium"/"iris")} — no reflection, no compile-time
 * dependency, no cap. The Iris active-shaderpack query (which would set {@code compatCap = T2})
 * is explicitly deferred: generic FxCompat → W12, the U23-only probe → W4 (CP0C amendment).
 * Misrender risk without it is cosmetic-only (outcome-neutral) and the capability probe still
 * catches actual pipeline failures.
 *
 * <p>Refreshed by {@code FxReloadListener} because shaderpack toggles trigger a resource
 * reload — the refresh hook is wired now so the W4/W12 query lands without touching callers.
 */
public final class FxCompat {
    private static volatile boolean sodiumLoaded;
    private static volatile boolean irisLoaded;
    private static volatile boolean loggedOnce;

    private FxCompat() {
    }

    /** Called from {@code FxReloadListener}; W1D: detection + one log line, never a cap. */
    public static void refresh() {
        sodiumLoaded = FabricLoader.getInstance().isModLoaded("sodium");
        irisLoaded = FabricLoader.getInstance().isModLoaded("iris");
        if (!loggedOnce) {
            loggedOnce = true;
            Cuprum.LOGGER.info("[fx] compat: sodium={} iris={} (W1D log-only; no compat cap)",
                    sodiumLoaded, irisLoaded);
        }
    }

    /** W1D posture (plan D10): never lowers the ladder. */
    public static FxTier compatCap() {
        return FxTier.T1;
    }

    public static boolean sodiumLoaded() {
        return sodiumLoaded;
    }

    public static boolean irisLoaded() {
        return irisLoaded;
    }
}
