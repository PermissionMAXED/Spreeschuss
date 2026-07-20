package dev.cuprum.cuprum.client.config;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.config.CuprumCommonConfig;
import dev.cuprum.cuprum.config.CuprumConfigs;
import me.shedaniel.autoconfig.AutoConfig;
import me.shedaniel.autoconfig.ConfigHolder;
import me.shedaniel.autoconfig.serializer.JanksonConfigSerializer;

/**
 * Client config bootstrap + accessors (plan §5.1: first line of
 * {@code CuprumClient.onInitializeClient()}). Also holds the server-sent common-config overlay
 * (plan §3.3): while connected, {@link #effectiveCommon()} returns the server's snapshot; the
 * local file is never rewritten and the overlay is dropped on disconnect (wired in
 * {@code CuprumClientNet}). The overlay reference is volatile and mutated only under
 * {@code CuprumClientNet}'s session lock: receivers write it on the client thread, and the
 * disconnect restore runs synchronously inside the DISCONNECT callback (possibly a Netty
 * event-loop thread — it must never be deferred via {@code Minecraft.execute}, because
 * teardown's {@code dropAllTasks()} deletes queued runnables). The volatile keeps lock-free
 * reads from any thread safe.
 */
public final class CuprumClientConfigs {
    private static ConfigHolder<CuprumClientConfig> holder;
    private static volatile CuprumCommonConfig commonOverlay;

    private CuprumClientConfigs() {
    }

    public static void init() {
        holder = AutoConfig.register(CuprumClientConfig.class, JanksonConfigSerializer::new);
        Cuprum.LOGGER.info("[config] client config registered (cuprum-client.json5)");
    }

    /** The local client config (presentation + accessibility; never server-overridden). */
    public static CuprumClientConfig client() {
        ConfigHolder<CuprumClientConfig> h = holder;
        if (h == null) {
            throw new IllegalStateException("CuprumClientConfigs.init() has not run");
        }
        return h.getConfig();
    }

    /** The common config this client should act on: server overlay while connected, else local. */
    public static CuprumCommonConfig effectiveCommon() {
        CuprumCommonConfig overlay = commonOverlay;
        return overlay != null ? overlay : CuprumConfigs.common();
    }

    /** True while a server snapshot overlay is active (test/diagnostics hook). */
    public static boolean hasCommonOverlay() {
        return commonOverlay != null;
    }

    /** Installs the server snapshot (already clamped by {@code toOverlayConfig()}). */
    public static void applyCommonOverlay(CuprumCommonConfig overlay) {
        commonOverlay = overlay;
    }

    /** Restores local values — called on DISCONNECT (plan §3.3: overlay dropped). */
    public static void clearCommonOverlay() {
        commonOverlay = null;
    }
}
