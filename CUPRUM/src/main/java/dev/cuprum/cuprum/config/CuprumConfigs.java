package dev.cuprum.cuprum.config;

import dev.cuprum.cuprum.Cuprum;
import me.shedaniel.autoconfig.AutoConfig;
import me.shedaniel.autoconfig.ConfigHolder;
import me.shedaniel.autoconfig.serializer.JanksonConfigSerializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.networking.v1.PlayerLookup;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/**
 * The config module's bootstrap + typed accessor (plan D2): registers the single common config
 * authority (AutoConfig + Jankson → {@code config/cuprum-common.json5}), the
 * {@code cuprum:s2c/config/common} payload type, and the two sync triggers — JOIN (per player)
 * and datapack reload (file re-read, then broadcast). No other class registers a serializer or
 * config file for common values. Runs first in {@code Cuprum.onInitialize()} (plan §5.1) so
 * every module reads typed config from day one.
 */
public final class CuprumConfigs {
    private static ConfigHolder<CuprumCommonConfig> holder;

    private CuprumConfigs() {
    }

    public static void init() {
        holder = AutoConfig.register(CuprumCommonConfig.class, JanksonConfigSerializer::new);
        ConfigPayloads.register();
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) ->
                sender.sendPacket(ConfigSyncPayload.of(common())));
        ServerLifecycleEvents.END_DATA_PACK_RELOAD.register((server, resourceManager, success) ->
                reloadAndResync(server));
        Cuprum.LOGGER.info("[config] common config registered (cuprum-common.json5)");
    }

    /** The authoritative common config (server truth; on clients see the client-side overlay). */
    public static CuprumCommonConfig common() {
        ConfigHolder<CuprumCommonConfig> h = holder;
        if (h == null) {
            throw new IllegalStateException("CuprumConfigs.init() has not run");
        }
        return h.getConfig();
    }

    /**
     * Re-reads {@code cuprum-common.json5} (clamping via {@code validatePostLoad}) and broadcasts
     * a fresh snapshot to every connected player — the {@code /reload} half of the sync contract
     * (plan §3.3). Runs on the server thread (lifecycle event).
     */
    private static void reloadAndResync(MinecraftServer server) {
        holder.load();
        ConfigSyncPayload snapshot = ConfigSyncPayload.of(common());
        for (ServerPlayer player : PlayerLookup.all(server)) {
            ServerPlayNetworking.send(player, snapshot);
        }
        Cuprum.LOGGER.info("[config] reloaded and resynced common config to {} player(s)",
                PlayerLookup.all(server).size());
    }
}
