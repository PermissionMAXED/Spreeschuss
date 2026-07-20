package dev.cuprum.cuprum.net;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.net.server.C2SGuard;
import dev.cuprum.cuprum.net.server.GuardResult;
import dev.cuprum.cuprum.net.server.GuardSpec;
import dev.cuprum.cuprum.net.server.NetRateLimiter;
import dev.cuprum.cuprum.net.server.NetTicks;
import dev.cuprum.cuprum.net.server.NetViolations;
import dev.cuprum.cuprum.net.server.RateKey;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;

/**
 * Network infrastructure owner (plan D3): guard pipeline, rate limiter, violations and the module
 * registration hook. Modules register their payload types via {@code PayloadTypeRegistry}
 * directly and their C2S receivers <b>only</b> through {@link #registerGuardedC2S} — every C2S
 * path runs through the two-stage {@link C2SGuard} plus a top-level catch (no crash-DoS through
 * handlers), and no unguarded receiver can exist.
 *
 * <p>Dispatch order is hardened against hostile traffic: the registration-owned {@link RateKey}
 * lets liveness + rate-token checks run <b>before</b> the payload's guard-spec factory is
 * invoked, so a dead or rate-limited sender can never trigger spec construction, and the
 * payload-only factory cannot touch world state even if it wanted to run early.
 */
public final class CuprumNet {
    /**
     * Builds the guard spec for one arriving payload. Deliberately <b>payload-only</b> — no
     * player/world parameter — so nothing world-derived can be resolved before the arrival gate;
     * world-derived ownership/state inputs go into the spec as lazy suppliers instead
     * (see {@link GuardSpec}). Runs on the server thread.
     */
    @FunctionalInterface
    public interface GuardSpecFactory<T extends CustomPacketPayload> {
        GuardSpec create(T payload);
    }

    /** Handler body, invoked only after the guard passed (server thread). */
    @FunctionalInterface
    public interface GuardedHandler<T extends CustomPacketPayload> {
        void handle(T payload, ServerPlayer player);
    }

    private record Registration<T extends CustomPacketPayload>(
            CustomPacketPayload.Type<T> type, RateKey rateKey,
            GuardSpecFactory<T> guardSpecFactory, GuardedHandler<T> handler) {
    }

    private static final Map<ResourceLocation, Registration<?>> GUARDED = new ConcurrentHashMap<>();

    private CuprumNet() {
    }

    /** Bootstrap (integration-owned order, plan §5.1): guard infra, then net-owned payloads. */
    public static void init() {
        NetTicks.init();
        NetRateLimiter.init();
        NetViolations.init();
        // The single server-stop sweep registration (no competing path): queued per-connection
        // cleanup is not guaranteed to run once the game loop's final drain has passed (a task
        // queued off-thread just before `stopped = true` is never executed), and static maps
        // outlive the server instance inside one JVM (integrated server / gametest server).
        // SERVER_STOPPED fires synchronously on the server thread at the end of
        // MinecraftServer.stopServer(), after every world/connection is closed.
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> {
            NetRateLimiter.handleServerStopped();
            NetViolations.handleServerStopped();
            Cuprum.LOGGER.info("[net] per-connection state cleared (server stopped)");
        });
        CuprumPayloads.register();
        Cuprum.LOGGER.info("[net] initialized (net version {})", CuprumNetVersion.NET_VERSION);
    }

    /**
     * The module registration hook (plan D3): binds the payload to its {@link RateKey} (charged
     * at the arrival gate, before spec construction), wraps {@code handler} in the mandatory
     * guard and registers the Fabric global receiver. Payload types must already be registered
     * (Fabric requires type-before-receiver per type; module-local ordering satisfies this).
     */
    public static <T extends CustomPacketPayload> void registerGuardedC2S(
            CustomPacketPayload.Type<T> type, RateKey rateKey,
            GuardSpecFactory<T> guardSpecFactory, GuardedHandler<T> handler) {
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(rateKey, "rateKey");
        Objects.requireNonNull(guardSpecFactory, "guardSpecFactory");
        Objects.requireNonNull(handler, "handler");
        Registration<T> registration = new Registration<>(type, rateKey, guardSpecFactory, handler);
        if (GUARDED.putIfAbsent(type.id(), registration) != null) {
            throw new IllegalStateException("duplicate guarded C2S registration for " + type.id());
        }
        ServerPlayNetworking.registerGlobalReceiver(type,
                (payload, context) -> dispatch(registration, payload, context.player()));
    }

    /**
     * The single choke point every guarded C2S payload passes through — the Fabric receiver
     * delegates here, and server GameTests inject forged payloads through the same path so no
     * test can bypass the guard. Returns the guard result ({@code PASS} means the handler ran).
     */
    public static <T extends CustomPacketPayload> GuardResult dispatch(
            CustomPacketPayload.Type<T> type, T payload, ServerPlayer player) {
        @SuppressWarnings("unchecked") // GUARDED maps a type's id to its own registration only.
        Registration<T> registration = (Registration<T>) GUARDED.get(type.id());
        if (registration == null) {
            throw new IllegalStateException("no guarded C2S registration for " + type.id());
        }
        return dispatch(registration, payload, player);
    }

    private static <T extends CustomPacketPayload> GuardResult dispatch(
            Registration<T> registration, T payload, ServerPlayer player) {
        try {
            // Arrival gate first: liveness + exactly-once rate-token charge, BEFORE the spec
            // factory runs — rejected arrivals never construct a spec.
            GuardResult arrival = C2SGuard.checkArrival(player, registration.type().id(), registration.rateKey());
            if (arrival != GuardResult.PASS) {
                return arrival;
            }
            GuardSpec spec = registration.guardSpecFactory().create(payload);
            GuardResult result = C2SGuard.check(player, registration.type().id(), spec);
            if (result == GuardResult.PASS) {
                registration.handler().handle(payload, player);
            }
            return result;
        } catch (Exception e) {
            // Top-level catch (plan §3.2/net-state §4.6): log, count a violation, never rethrow.
            Cuprum.LOGGER.error("[net] exception handling {} from {}",
                    registration.type().id(), player.getUUID(), e);
            NetViolations.record(player, registration.type().id(),
                    "handler exception: " + e.getClass().getSimpleName());
            return GuardResult.VIOLATION;
        }
    }
}
