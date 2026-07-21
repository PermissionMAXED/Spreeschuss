package dev.cuprum.cuprum.client.fx;

/**
 * Declared-now, stubbed pool slot for the TES arc effects (client-fx.md §5): the arc wave
 * lands here with the same shape as the ripple pool — bounded capacity, snapshot-in /
 * primitive-extract-out, and ONE RenderType batch per frame (TES.md pin: "all active arcs
 * batch into one render submit pass (T1) or one particle batch (T2/T3)"). The arc RenderType
 * occupies one of the reserved CP0C world-FX census slots (arc/dome/aurora,
 * {@code CuprumRenderTypes}).
 *
 * <p>W1D intentionally ships no arc state or methods: later waves may append {@code enqueue*}
 * entry points and pool internals here but never modify {@code FxDispatcher} internals, pool
 * classes or {@code FxBudgets} values (§14 ownership rules).
 */
public final class FxArcPool {
    private FxArcPool() {
    }
}
