package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.ChargePriority;
import net.minecraft.core.Direction;
import org.jetbrains.annotations.Nullable;

/**
 * A participant in the per-dimension charge graph (charge.md §2b, frozen). Role interfaces
 * ({@link ChargeProducer}, {@link ChargeStorage}, {@link ChargeConsumer}, {@link ChargeRelay},
 * {@link SurgeAbsorber}) extend this; a node may implement several (PWR-16 combines them in
 * later waves) — the solver honors exactly the interfaces implemented.
 */
public interface ChargeNode {
    /** PWR-18 allocation tier; DEFENSE is served first under brownout. */
    default ChargePriority priority() {
        return ChargePriority.MISC;
    }

    /**
     * Adjacency edge gate: whether this node connects through {@code side}. A {@code null} side
     * is the "any side / internal query" context and must be treated as connectable.
     */
    boolean canConnect(@Nullable Direction side);
}
