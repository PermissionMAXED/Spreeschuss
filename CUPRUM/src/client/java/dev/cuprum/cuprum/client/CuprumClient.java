package dev.cuprum.cuprum.client;

import dev.cuprum.cuprum.Cuprum;
import net.fabricmc.api.ClientModInitializer;

public final class CuprumClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        // RenderApiProbe (same package) is a compile-time-only signature probe and is
        // deliberately never touched at runtime.
        Cuprum.LOGGER.info("Cuprum client initialized");
    }
}
