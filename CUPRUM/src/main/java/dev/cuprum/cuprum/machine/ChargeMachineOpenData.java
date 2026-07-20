package dev.cuprum.cuprum.machine;

import net.minecraft.core.BlockPos;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;

/**
 * S2C screen-opening data for {@code ChargeMachineMenu} (multiblock.md §6.3, frozen): the
 * machine position plus its capacity (capacity is static per machine, so it rides the open
 * packet instead of burning data-slot lanes). Bounded primitives only ({@code BlockPos} +
 * {@code VAR_LONG}) per the plan §3.2 codec rules.
 */
public record ChargeMachineOpenData(BlockPos pos, long capacityCg) {
    public static final StreamCodec<RegistryFriendlyByteBuf, ChargeMachineOpenData> STREAM_CODEC =
            StreamCodec.composite(
                    BlockPos.STREAM_CODEC, ChargeMachineOpenData::pos,
                    ByteBufCodecs.VAR_LONG, ChargeMachineOpenData::capacityCg,
                    ChargeMachineOpenData::new);

    public ChargeMachineOpenData {
        ChargeMachineBlockEntity.requireSyncableCg("open-data capacityCg", capacityCg);
    }
}
