package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.ChargePriority;
import net.minecraft.core.BlockPos;

/**
 * Diagnostics read of one graph node (charge.md §2b, frozen; consumed by the Charge Probe and
 * {@code /cuprum cg node}). {@code networkStored}/{@code networkCapacity} are computed over
 * LOADED members only; frozen nodes report their last-known stored shadow.
 */
public record NodeReport(BlockPos pos, int roleMask, ChargePriority priority, long stored, long capacity,
        int networkId, boolean frozen, long networkStored, long networkCapacity, long topologyVersion) {
}
