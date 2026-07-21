package dev.cuprum.cuprum.fx;

import dev.cuprum.cuprum.fx.core.FxBudgets;
import dev.cuprum.cuprum.fx.core.FxSendWindow;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.fabricmc.fabric.api.networking.v1.PlayerLookup;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;

/**
 * Server-side ripple dispatch (client-fx.md §6/§11): sends one {@link FxRipplePayload} to every
 * player tracking the anchor chunk, coalescing to at most
 * {@link FxBudgets#RIPPLE_SENDS_PER_SECOND} payloads per second <b>per client</b>. Overflow is
 * dropped silently — ripples are idempotent, loss-tolerant cosmetic events (plan §3.2), and the
 * client pool would evict past 16 concurrent ripples anyway (window cap == pool capacity).
 *
 * <p>Determinism: the payload carries the server game time of the emitting event; the client
 * derives its tick-quantized animation phase from that seed, so every tracking client renders
 * the identical ripple for the identical event. One-way S2C only; nothing here reads back
 * client state (outcome neutrality).
 *
 * <p>Session identity: the UUID is only the map lookup key. Every window is owned by the exact
 * {@link ServerGamePacketListenerImpl} created for that connection. JOIN installs the session;
 * sends are get-only and require {@code session.owner == player.connection}; DISCONNECT is
 * serialized through {@link MinecraftServer#execute(Runnable)} and conditionally removes only
 * the disconnecting owner. A stale disconnect can therefore neither erase a same-UUID reconnect
 * nor reset its already-consumed budget.
 *
 * <p>Threading mirrors the hardened {@code NetRateLimiter}: sends/JOIN run on the server thread,
 * while DISCONNECT may originate on a Netty event loop. The outer concurrent map makes that
 * cross-thread delivery safe; the per-session window is touched only on the server thread.
 * SERVER_STOPPED performs a synchronous sweep because executor work queued after the final drain
 * is not guaranteed to run and static state outlives an integrated-server lifecycle.
 */
public final class FxRippleBroadcaster {
    private static final Map<UUID, Session> WINDOWS = new ConcurrentHashMap<>();

    /** Identity semantics are intentional; a new connection always gets a distinct instance. */
    private static final class Session {
        final ServerGamePacketListenerImpl owner;
        final FxSendWindow window =
                new FxSendWindow(FxBudgets.RIPPLE_SENDS_PER_SECOND, FxBudgets.SEND_WINDOW_TICKS);

        Session(ServerGamePacketListenerImpl owner) {
            this.owner = owner;
        }
    }

    private FxRippleBroadcaster() {
    }

    /** JOIN lifecycle hook: installs fresh rate state bound to this exact connection. */
    public static void handleJoin(ServerGamePacketListenerImpl handler) {
        WINDOWS.put(handler.player.getUUID(), new Session(handler));
    }

    /**
     * Broadcasts one ripple event to all tracking players, respecting each player's coalescing
     * window. Returns the number of payloads actually sent (diagnostics/gametests).
     */
    public static int broadcast(ServerLevel level, BlockPos center, int radiusQ8, int colorArgb) {
        long gameTime = level.getGameTime();
        FxRipplePayload payload = new FxRipplePayload(center.immutable(), radiusQ8, colorArgb, gameTime);
        int sent = 0;
        for (ServerPlayer player : PlayerLookup.tracking(level, center)) {
            Session session = WINDOWS.get(player.getUUID());
            if (session != null && session.owner == player.connection && session.window.tryAcquire(gameTime)) {
                ServerPlayNetworking.send(player, payload);
                sent++;
            }
        }
        return sent;
    }

    /**
     * Production DISCONNECT entry point: server-serialized, owner-conditional and idempotent.
     */
    public static void handleDisconnect(ServerGamePacketListenerImpl handler, MinecraftServer server) {
        UUID playerId = handler.player.getUUID();
        server.execute(() -> {
            Session session = WINDOWS.get(playerId);
            if (session != null && session.owner == handler) {
                WINDOWS.remove(playerId, session);
            }
        });
    }

    /** Server-stop sweep: static maps outlive the server instance inside one JVM. */
    public static void handleServerStopped() {
        WINDOWS.clear();
    }

    /** Number of live per-connection windows (server lifecycle GameTest diagnostics only). */
    public static int trackedWindowCount() {
        return WINDOWS.size();
    }

    /**
     * Whether the UUID's live window belongs to this exact connection (race GameTest hook).
     * Identity comparison is the production ownership rule, not a relaxed test approximation.
     */
    public static boolean isOwnedByForTesting(UUID playerId, ServerGamePacketListenerImpl handler) {
        Session session = WINDOWS.get(playerId);
        return session != null && session.owner == handler;
    }
}
