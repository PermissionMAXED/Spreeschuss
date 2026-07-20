package dev.cuprum.cuprum.config;

import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;

/**
 * The config module's own payload registration hook (plan D3: every module registers its payload
 * types module-locally, type-before-receiver). W1A ships one S2C snapshot payload and no config
 * C2S payloads, so there is no guarded receiver to wire here. Called exactly once, from
 * {@link CuprumConfigs#init()}.
 */
public final class ConfigPayloads {
    private ConfigPayloads() {
    }

    public static void register() {
        PayloadTypeRegistry.playS2C().register(ConfigSyncPayload.TYPE, ConfigSyncPayload.STREAM_CODEC);
    }
}
