package dev.cuprum.cuprum.gametest.net;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * Invocation counters for the {@link GuardProbePayload} registration: each counter increments
 * when the corresponding stage of the guarded dispatch actually runs. Tests reset them, drive
 * {@code CuprumNet.dispatch} and assert exactly which stages executed — the laziness proof for
 * the redesigned pipeline (spec construction only after liveness+rate, claim/state resolution
 * only at their canonical step). All access is on the server thread; atomics keep it simple.
 */
public final class GuardProbeCounters {
    public static final AtomicInteger SPEC_FACTORY_CALLS = new AtomicInteger();
    public static final AtomicInteger CLAIM_RESOLUTIONS = new AtomicInteger();
    public static final AtomicInteger STATE_CHECKS = new AtomicInteger();
    public static final AtomicInteger HANDLER_RUNS = new AtomicInteger();

    private GuardProbeCounters() {
    }

    public static void reset() {
        SPEC_FACTORY_CALLS.set(0);
        CLAIM_RESOLUTIONS.set(0);
        STATE_CHECKS.set(0);
        HANDLER_RUNS.set(0);
    }
}
