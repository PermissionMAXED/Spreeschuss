package dev.cuprum.cuprum.client;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.client.config.CuprumClientConfigs;
import dev.cuprum.cuprum.client.machine.MachineClientModule;
import dev.cuprum.cuprum.client.net.CuprumClientNet;
import net.fabricmc.api.ClientModInitializer;

public final class CuprumClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        // Bootstrap order is binding (FOUNDATION_PLAN §5.1); each W1 phase appends its line(s).
        // RenderApiProbe and ClientNetApiProbe are compile-time-only signature probes and are
        // deliberately never touched at runtime.
        CuprumClientConfigs.init();
        CuprumClientNet.init();
        MachineClientModule.init();
        Cuprum.LOGGER.info("Cuprum client initialized");
    }
}
