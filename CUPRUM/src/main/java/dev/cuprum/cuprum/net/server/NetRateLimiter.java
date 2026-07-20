package dev.cuprum.cuprum.net.server;

import dev.cuprum.cuprum.config.CuprumCommonConfig;
import dev.cuprum.cuprum.config.CuprumConfigs;
import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;

/**
 * Per-connection token buckets (plan §3.2): created on JOIN, dropped after DISCONNECT (a
 * reconnect resets by design), one lazy {@link TokenBucket} per {@link RateKey}, refilled
 * against the mod-owned {@link NetTicks} counter. Every acquire also charges the
 * {@link RateKey#GLOBAL} aggregate bucket. Rates come from the config module's {@code net.*}
 * section (plan D2), snapshotted at bucket creation.
 *
 * <p><b>Session identity, not UUID identity.</b> A UUID is a <i>player</i> identity; the state
 * here is <i>connection</i> state, so every entry is bound to the connection's
 * {@link ServerGamePacketListenerImpl} (verified 1.21.9: unique per connection, reused across
 * respawn — {@code PlayerList.respawn} moves the same handler onto the new {@code ServerPlayer}
 * — and never reused across reconnects). Two hazards force this:
 * <ul>
 *   <li><b>Stale disconnect vs. same-UUID rejoin:</b> connection A's cleanup is queued on the
 *       server executor (the DISCONNECT event can fire on a Netty thread); if connection B with
 *       the same UUID joins before that queue drains, an unconditional {@code remove(uuid)}
 *       would delete B's fresh state — and because Fabric fires DISCONNECT once per connection,
 *       B would silently lose all guarded traffic for its whole session.
 *       {@link #handleDisconnect} therefore removes the entry <b>only if it is still owned by
 *       the disconnecting handler</b>; a stale cleanup can never touch a newer session. (The
 *       ordering can also invert: vanilla's duplicate-login kick closes the old channel
 *       asynchronously, so the old DISCONNECT may even arrive after the new JOIN.)</li>
 *   <li><b>Stale connection vs. newer session state:</b> {@link #tryAcquire} refuses a sender
 *       whose {@code player.connection} is not the entry's owner, so late traffic attributed to
 *       a replaced connection can neither consume the new session's tokens nor (in
 *       {@link NetViolations}) count violations against it.</li>
 * </ul>
 *
 * <p>Threading (verified executor semantics in {@code docs/API_PROBES.md}): {@link #tryAcquire}
 * runs on the server thread only (guarded dispatch) and JOIN fires on the server thread, but
 * the Fabric DISCONNECT event can fire on a <b>Netty event-loop thread</b>
 * ({@code Connection.channelInactive}). {@link #handleDisconnect} serializes the conditional
 * removal onto the server executor ({@code MinecraftServer.execute}): fired from a Netty thread
 * it queues behind the active dispatch; fired on the server thread it runs inline. Lookups
 * never create the outer entry ({@code Map.get}, never {@code computeIfAbsent}), so an absent
 * or disconnected connection can never regain state. Because a task queued off-thread after the
 * game loop's final drain (but before {@code stopped = true}) is never executed,
 * {@link #handleServerStopped} additionally sweeps the whole map synchronously at
 * SERVER_STOPPED — static maps must not survive into the next integrated-server lifecycle.
 * The outer map stays a {@link ConcurrentHashMap} for safe cross-thread access; the
 * per-session {@link EnumMap} internals are only ever touched from the server thread.
 */
public final class NetRateLimiter {
    private static final Map<UUID, Session> SESSIONS = new ConcurrentHashMap<>();
    private static final AtomicLong DROPPED = new AtomicLong();

    /**
     * One connection's bucket state, identity-bound to its network handler. No
     * {@code equals}/{@code hashCode} override: identity semantics make the conditional
     * {@code remove(key, value)} in {@link #handleDisconnect} exact (a fresh session with
     * equal-looking buckets can never be mistaken for the stale one).
     */
    private static final class Session {
        final ServerGamePacketListenerImpl owner;
        final EnumMap<RateKey, TokenBucket> buckets = new EnumMap<>(RateKey.class);

        Session(ServerGamePacketListenerImpl owner) {
            this.owner = owner;
        }
    }

    private NetRateLimiter() {
    }

    /** Called exactly once, from {@code CuprumNet.init()}. */
    public static void init() {
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) ->
                SESSIONS.put(handler.player.getUUID(), new Session(handler)));
        ServerPlayConnectionEvents.DISCONNECT.register(NetRateLimiter::handleDisconnect);
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
            Session session = SESSIONS.get(playerId);
            if (session != null && session.owner == handler) {
                SESSIONS.remove(playerId, session);
            }
        });
    }

    /**
     * The production server-stop sweep (registered on {@code ServerLifecycleEvents.SERVER_STOPPED}
     * in {@code CuprumNet.init()}): synchronously clears every session, without relying on the
     * queued per-connection cleanup having drained (a task queued off-thread after the game
     * loop's final drain is never executed — verified in {@code MinecraftServer.runServer}).
     * Statics outlive the server instance inside one JVM (integrated server, gametest server),
     * so the next lifecycle must start empty. Idempotent by construction.
     */
    public static void handleServerStopped() {
        SESSIONS.clear();
    }

    /**
     * Attempts to take one token from the sender's {@code key} bucket <b>and</b> the GLOBAL
     * bucket; consumes both only when both have capacity (no partial charge). A failure is a
     * silent drop by contract — legitimate under lag, never a kick by itself. Senders without
     * session state (never joined, or cleanup already ran) and senders whose connection does
     * not own the tracked session (a stale connection after a same-UUID rejoin) are refused
     * without creating or mutating any state.
     */
    public static boolean tryAcquire(ServerPlayer player, RateKey key) {
        long now = NetTicks.current();
        Session session = SESSIONS.get(player.getUUID());
        if (session == null || session.owner != player.connection) {
            DROPPED.incrementAndGet();
            return false;
        }
        EnumMap<RateKey, TokenBucket> buckets = session.buckets;
        TokenBucket keyBucket = buckets.computeIfAbsent(key, k -> newBucket(k, now));
        TokenBucket globalBucket = key == RateKey.GLOBAL
                ? null
                : buckets.computeIfAbsent(RateKey.GLOBAL, k -> newBucket(k, now));
        boolean allowed = keyBucket.canAcquire(now) && (globalBucket == null || globalBucket.canAcquire(now));
        if (!allowed) {
            DROPPED.incrementAndGet();
            return false;
        }
        keyBucket.consume();
        if (globalBucket != null) {
            globalBucket.consume();
        }
        return true;
    }

    private static TokenBucket newBucket(RateKey key, long nowTick) {
        CuprumCommonConfig.NetSection net = CuprumConfigs.common().net;
        return switch (key) {
            case DEFAULT -> new TokenBucket(net.ratePerSecDefault, net.burstDefault, nowTick);
            case GLOBAL -> new TokenBucket(net.rateGlobalPerSec, net.rateGlobalPerSec, nowTick);
        };
    }

    /** Total silently dropped acquires (feeds the future QOL-10 diagnostics overlay). */
    public static long droppedCount() {
        return DROPPED.get();
    }

    /** Test hook: whether any bucket state is tracked for this player (leak detection). */
    public static boolean hasBucketsForTesting(UUID playerId) {
        return SESSIONS.containsKey(playerId);
    }
}
