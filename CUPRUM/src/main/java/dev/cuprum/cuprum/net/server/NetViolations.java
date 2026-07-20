package dev.cuprum.cuprum.net.server;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.config.CuprumCommonConfig;
import dev.cuprum.cuprum.config.CuprumConfigs;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;

/**
 * Per-connection protocol-violation bookkeeping (plan §3.2): logging is throttled to at most one
 * line per second per player, violations are counted in a sliding {@code net.violationWindowTicks}
 * window, and reaching {@code net.violationKickThreshold} requests a kick through an overridable
 * {@link KickSink} — GameTests swap the sink and assert the request instead of a real disconnect.
 * State lives per connection: created fresh on JOIN, dropped after DISCONNECT.
 *
 * <p>Lifecycle and threading follow the exact same rules as {@link NetRateLimiter} (see its
 * javadoc for the verified sources): state is bound to the connection's
 * {@link ServerGamePacketListenerImpl}, {@link #handleDisconnect} serializes a
 * <b>handler-conditional</b> removal onto the server executor (a stale cleanup draining after a
 * same-UUID rejoin must never delete — or worse, get its violations counted against — the newer
 * session), {@link #record} never creates state and refuses a sender whose connection does not
 * own the tracked state (a stale connection must not be able to push a newer session toward a
 * kick), and {@link #handleServerStopped} sweeps the map synchronously at SERVER_STOPPED so
 * nothing survives into the next integrated-server lifecycle. The map stays a
 * {@link ConcurrentHashMap} for safe cross-thread access; the {@link State} internals are only
 * touched from the server thread.
 */
public final class NetViolations {
    /** Kick request sink; the default disconnects through the player's connection. */
    @FunctionalInterface
    public interface KickSink {
        void requestKick(ServerPlayer player, Component reason);
    }

    private static final KickSink DEFAULT_SINK =
            (player, reason) -> player.connection.disconnect(reason);
    private static final long LOG_THROTTLE_TICKS = 20;

    private static volatile KickSink sink = DEFAULT_SINK;
    private static final Map<UUID, State> STATES = new ConcurrentHashMap<>();

    /**
     * One connection's violation state, identity-bound to its network handler; no
     * {@code equals} override so the conditional removal is exact (see {@link NetRateLimiter}).
     */
    private static final class State {
        final ServerGamePacketListenerImpl owner;
        final ArrayDeque<Long> violationTicks = new ArrayDeque<>();
        long lastLogTick = -LOG_THROTTLE_TICKS; // first record always logs
        boolean kickRequested;

        State(ServerGamePacketListenerImpl owner) {
            this.owner = owner;
        }
    }

    private NetViolations() {
    }

    /** Called exactly once, from {@code CuprumNet.init()}. */
    public static void init() {
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) ->
                STATES.put(handler.player.getUUID(), new State(handler)));
        ServerPlayConnectionEvents.DISCONNECT.register(NetViolations::handleDisconnect);
    }

    /**
     * The production disconnect cleanup entry point (also what the Fabric DISCONNECT event
     * calls): serializes the removal onto the server executor so it can never interleave with
     * an in-flight guarded dispatch, and removes the entry <b>only while it is still owned by
     * the disconnecting handler</b> — a stale cleanup draining after a same-UUID rejoin must
     * not delete the newer session's state. Idempotent: duplicate delivery removes nothing.
     */
    public static void handleDisconnect(ServerGamePacketListenerImpl handler, MinecraftServer server) {
        UUID playerId = handler.player.getUUID();
        server.execute(() -> {
            State state = STATES.get(playerId);
            if (state != null && state.owner == handler) {
                STATES.remove(playerId, state);
            }
        });
    }

    /**
     * The production server-stop sweep (registered on {@code ServerLifecycleEvents.SERVER_STOPPED}
     * in {@code CuprumNet.init()}): synchronously clears all violation state without relying on
     * queued per-connection cleanup having drained. Idempotent by construction; see
     * {@link NetRateLimiter#handleServerStopped} for the verified shutdown semantics.
     */
    public static void handleServerStopped() {
        STATES.clear();
    }

    /**
     * Records one violation; called from the guard (VALUE failures) and the top-level catch.
     * Violations attributed to a connection without state (never joined, or cleanup already
     * ran) or to a connection that does not own the tracked state (a stale connection after a
     * same-UUID rejoin) are dropped without creating or mutating any state — a disconnected
     * player cannot be kicked, and a stale one must not push the live session toward a kick.
     */
    public static void record(ServerPlayer player, ResourceLocation payloadId, String reason) {
        long now = NetTicks.current();
        CuprumCommonConfig.NetSection net = CuprumConfigs.common().net;
        State state = STATES.get(player.getUUID());
        if (state == null || state.owner != player.connection) {
            return;
        }
        while (!state.violationTicks.isEmpty()
                && now - state.violationTicks.peekFirst() >= net.violationWindowTicks) {
            state.violationTicks.pollFirst();
        }
        state.violationTicks.addLast(now);
        if (now - state.lastLogTick >= LOG_THROTTLE_TICKS) {
            state.lastLogTick = now;
            Cuprum.LOGGER.warn("[net] violation by {} ({}): payload {} — {} ({} in window)",
                    player.getGameProfile().name(), player.getUUID(), payloadId, reason,
                    state.violationTicks.size());
        }
        if (!state.kickRequested && state.violationTicks.size() >= net.violationKickThreshold) {
            state.kickRequested = true;
            sink.requestKick(player, Component.literal("Cuprum: too many protocol violations"));
        }
    }

    /** Violations currently inside the player's sliding window. */
    public static int violationsInWindow(UUID playerId) {
        State state = STATES.get(playerId);
        return state == null ? 0 : state.violationTicks.size();
    }

    /** Whether a kick has been requested for this connection. */
    public static boolean kickRequested(UUID playerId) {
        State state = STATES.get(playerId);
        return state != null && state.kickRequested;
    }

    /** Swaps the kick sink (GameTests capture requests); returns the previous sink for restore. */
    public static KickSink setKickSink(KickSink newSink) {
        KickSink previous = sink;
        sink = Objects.requireNonNull(newSink, "newSink");
        return previous;
    }

    /** Test hook: whether any violation state is tracked for this player (leak detection). */
    public static boolean hasStateForTesting(UUID playerId) {
        return STATES.containsKey(playerId);
    }
}
