package dev.cuprum.cuprum.net.server;

import java.util.concurrent.atomic.AtomicLong;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;

/**
 * Mod-owned monotonic tick counter (plan §3.2): rate buckets and violation windows refill against
 * this counter instead of {@code MinecraftServer.getTickCount()}. Incremented on
 * {@code END_SERVER_TICK}; being global monotonic time (not per-player/per-world state) it never
 * resets and is wraparound-safe by contract with {@link TokenBucket}.
 */
public final class NetTicks {
    private static final AtomicLong TICKS = new AtomicLong();

    private NetTicks() {
    }

    /** Called exactly once, from {@code CuprumNet.init()}. */
    public static void init() {
        ServerTickEvents.END_SERVER_TICK.register(server -> TICKS.incrementAndGet());
    }

    public static long current() {
        return TICKS.get();
    }
}
