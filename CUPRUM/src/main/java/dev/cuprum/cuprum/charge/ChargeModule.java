package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.Cuprum;

/**
 * Charge-module bootstrap (plan §5.1): called exactly once from {@code Cuprum.onInitialize()},
 * after {@code StateProbe.init()}. Delegates to {@link ChargeGraphManager#init()} (events,
 * lookup registration hookpoint, {@code /cuprum cg} command).
 */
public final class ChargeModule {
    private ChargeModule() {
    }

    public static void init() {
        ChargeGraphManager.init();
        Cuprum.LOGGER.info("[charge] charge graph initialized");
    }
}
