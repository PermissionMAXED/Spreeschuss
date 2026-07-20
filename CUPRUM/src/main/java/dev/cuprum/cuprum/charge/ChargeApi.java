package dev.cuprum.cuprum.charge;

import net.fabricmc.fabric.api.lookup.v1.block.BlockApiLookup;
import net.minecraft.core.Direction;
import net.minecraft.resources.ResourceLocation;

/**
 * The sided charge-node lookup (charge.md §2b [PROBE-1], id ledger {@code cuprum:charge_node}).
 * Mirrors the proven Fabric energy-API pattern: context {@code null} means "any side / internal
 * query" — providers registered through
 * {@code ChargeApi.NODE.registerForBlockEntity((be, side) -> ..., TYPE)} must treat a null side
 * as connectable. Documented server-thread-only: query results are only valid on the server
 * thread and must never be cached across ticks by callers.
 */
public final class ChargeApi {
    public static final BlockApiLookup<ChargeNode, Direction> NODE = BlockApiLookup.get(
            ResourceLocation.fromNamespaceAndPath("cuprum", "charge_node"),
            ChargeNode.class, Direction.class);

    private ChargeApi() {
    }
}
