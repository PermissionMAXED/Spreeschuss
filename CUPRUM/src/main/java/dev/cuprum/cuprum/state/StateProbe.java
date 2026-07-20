package dev.cuprum.cuprum.state;

import dev.cuprum.cuprum.Cuprum;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.server.MinecraftServer;

/**
 * State-module bootstrap (plan §5.1): on SERVER_STARTED, loads {@link StateProbeSavedData} from
 * the overworld's {@code DimensionDataStorage}, increments the boot counter, marks it dirty and
 * logs the exact line the restart probe greps for.
 */
public final class StateProbe {
    private StateProbe() {
    }

    public static void init() {
        ServerLifecycleEvents.SERVER_STARTED.register(StateProbe::recordBoot);
    }

    /** Runs the boot-count increment; exposed so GameTests exercise the same code path. */
    public static int recordBoot(MinecraftServer server) {
        StateProbeSavedData data = server.overworld().getDataStorage().computeIfAbsent(StateProbeSavedData.TYPE);
        int boots = data.incrementBoots();
        Cuprum.LOGGER.info("[state] cuprum_state_probe boots={}", boots);
        return boots;
    }
}
