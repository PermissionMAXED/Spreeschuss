package dev.cuprum.cuprum.charge.core;

/**
 * The solver's ONLY window onto node state (charge.md §2a; reshaped by the W1B Eval-A repair):
 * it pulls offers/demands/stored levels and pushes charge through EXPLICIT phase-specific
 * operations — one per role-flow — so multi-role nodes (e.g. producer+storage) are never
 * ambiguous. Cross-node charge transfer happens exclusively through
 * {@link ChargeGraphCore#tick} / {@link ChargeGraphCore#depositSurge} calling these mutators;
 * BE tickers may only mutate their own node's internal state.
 *
 * <p><b>Actual-amount contract</b>: every mutator returns the amount ACTUALLY applied, in
 * {@code [0, amountCg]}. The solver's accounting (pools, budgets, relay charges, moved/vented
 * counters, conservation) is driven only by these returned actuals — never by the requested
 * amount. Out-of-range returns are clamped defensively by the solver; well-behaved receivers
 * (the manager, {@link ChargeBuffer}-backed storages) never trigger the clamp.
 */
public interface NodeAccess {
    /** Producers: Cg offered this tick (values below 0 are treated as 0). */
    long offer(int nodeId);

    /** Consumers: Cg wanted this tick (values below 0 are treated as 0). */
    long demand(int nodeId);

    /** Storages: current stored Cg (clamped by the solver into {@code [0, capacity]}). */
    long stored(int nodeId);

    /**
     * Producer drain: commits up to {@code amountCg} of the node's offer. Returns the Cg
     * actually drained. Called once per producer per allocator pass with the full offer
     * (charge.md §3: producers are always drained their full offer; what the network cannot
     * place is vented).
     */
    long drain(int nodeId, long amountCg);

    /** Consumer delivery: feeds up to {@code amountCg}; returns the Cg actually accepted. */
    long accept(int nodeId, long amountCg);

    /**
     * Normal storage fill: inserts up to {@code amountCg}, sharing the storage's one per-game-
     * tick insert budget with external API calls. Returns the Cg actually inserted.
     */
    long insertStorage(int nodeId, long amountCg);

    /**
     * Normal storage draw: extracts up to {@code amountCg}, sharing the storage's one per-game-
     * tick extract budget with external API calls. Returns the Cg actually extracted.
     */
    long extractStorage(int nodeId, long amountCg);

    /**
     * Surge-only storage fill: capacity-clamped but independent of the normal insert budget.
     * Returns the Cg actually inserted.
     */
    long insertSurgeStorage(int nodeId, long amountCg);

    /** Surge-absorber feed: absorbs up to {@code amountCg}; returns the Cg actually absorbed. */
    long absorb(int nodeId, long amountCg);
}
