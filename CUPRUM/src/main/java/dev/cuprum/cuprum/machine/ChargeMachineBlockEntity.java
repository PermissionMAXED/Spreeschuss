package dev.cuprum.cuprum.machine;

import dev.cuprum.cuprum.charge.blockentity.AbstractChargeStorageBlockEntity;
import dev.cuprum.cuprum.charge.core.ChargeBuffer;
import dev.cuprum.cuprum.multiblock.FormationState;
import dev.cuprum.cuprum.state.CuprumSchema;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.protocol.game.ClientboundBlockEntityDataPacket;
import net.minecraft.world.inventory.ContainerData;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;

/**
 * Base BE for menu-carrying charge machines (multiblock.md §6.2 with the plan-D7 override:
 * extends the frozen W1B {@code AbstractChargeStorageBlockEntity}, which owns the §3.1
 * envelope and the {@code ChargeBuffer} delegation). This layer adds the {@code ContainerData}
 * lanes, the S2C sync throttle and the update-packet plumbing.
 *
 * <p><b>Envelope note (binding):</b> {@code TagValueOutput.child(key)} REPLACES an existing
 * child, so {@link #saveAdditional} first runs the full {@code super} chain (base BlockEntity
 * bookkeeping + the frozen charge envelope) and then rewrites the {@code cuprum_state} child
 * with the identical schema/charge values plus the {@link #saveMachineData} extension — the
 * frozen W1B class cannot grow a hook (public surface frozen after W1B), and the resulting
 * bytes for non-machine storages are unchanged.
 *
 * <p><b>Wire vs disk (plan §3.1):</b> {@code getUpdateTag} = {@code saveCustomOnly} +
 * transient {@link #writeClientExtras} extras (Beacon precedent); {@code CompoundTag} appears
 * only in the two vanilla-mandated wire methods. Sync spacing ≥{@value #SYNC_MIN_INTERVAL_TICKS}
 * ticks through {@link #markChangedAndSyncThrottled}; state transitions use the immediate
 * {@link #markChangedAndSync}.
 */
public abstract class ChargeMachineBlockEntity extends AbstractChargeStorageBlockEntity {
    public static final int SLOT_CHARGE_LANE0 = 0;
    public static final int SLOT_CHARGE_LANE1 = 1;
    public static final int SLOT_CHARGE_LANE2 = 2;
    public static final int SLOT_STATUS = 3;
    public static final int DATA_SLOT_COUNT = 4;
    /** Minimum ticks between throttled BE update packets (frozen; transitions bypass it). */
    public static final int SYNC_MIN_INTERVAL_TICKS = ChargeMachineSyncPolicy.MIN_INTERVAL_TICKS;
    /** Exact maximum representable by the three 16-bit menu lanes. */
    public static final long MAX_SYNCABLE_CG = ChargeMachineSyncPolicy.MAX_SYNCABLE_CG;

    private long lastSyncGameTime = ChargeMachineSyncPolicy.NEVER_SYNCED;

    protected ChargeMachineBlockEntity(BlockEntityType<?> type, BlockPos pos, BlockState state,
            long capacityCg, long maxInsertPerTickCg, long maxExtractPerTickCg) {
        super(type, pos, state, requireSyncableCg("capacityCg", capacityCg),
                maxInsertPerTickCg, maxExtractPerTickCg);
    }

    /** The single storage authority (frozen W1B field, exposed for menus and machine tickers). */
    public final ChargeBuffer chargeBuffer() {
        return buffer;
    }

    /**
     * A live server-side view for {@code AbstractContainerMenu.addDataSlots}: three 16-bit
     * charge lanes ({@link ShortSplit}) plus the formation-status ordinal. Vanilla broadcasts
     * per-slot short deltas; writes are ignored (server-authoritative, zero C2S in W1).
     */
    public ContainerData createMenuData() {
        return new ContainerData() {
            @Override
            public int get(int index) {
                return switch (index) {
                    case SLOT_CHARGE_LANE0 -> ShortSplit.syncLane(syncableStored(), 0);
                    case SLOT_CHARGE_LANE1 -> ShortSplit.syncLane(syncableStored(), 1);
                    case SLOT_CHARGE_LANE2 -> ShortSplit.syncLane(syncableStored(), 2);
                    case SLOT_STATUS -> formationStateOrdinalForMenu();
                    default -> 0;
                };
            }

            @Override
            public void set(int index, int value) {
                // Server-authoritative: the menu never writes machine state (multiblock.md §6.3).
            }

            @Override
            public int getCount() {
                return DATA_SLOT_COUNT;
            }
        };
    }

    private long syncableStored() {
        return requireSyncableCg("stored Cg", buffer.stored());
    }

    /** Shared fail-fast wire-domain check for machine capacity and every synced Cg value. */
    public static long requireSyncableCg(String label, long value) {
        return ChargeMachineSyncPolicy.requireSyncableCg(label, value);
    }

    /** Status-slot value; plain (non-controller) machines report FORMED, controllers override. */
    protected int formationStateOrdinalForMenu() {
        return FormationState.FORMED.ordinal();
    }

    /** Immediate sync: {@code setChanged} + a client block update (state transitions). */
    protected final void markChangedAndSync() {
        setChanged();
        if (level != null && !level.isClientSide()) {
            lastSyncGameTime = level.getGameTime();
            level.sendBlockUpdated(worldPosition, getBlockState(), getBlockState(), Block.UPDATE_CLIENTS);
        }
    }

    /** Throttled sync: always {@code setChanged}, update packet ≥10 ticks apart (frozen §10). */
    protected final void markChangedAndSyncThrottled() {
        setChanged();
        long gameTime = level == null ? 0L : level.getGameTime();
        boolean send = level != null && !level.isClientSide() && throttleElapsed(gameTime, lastSyncGameTime);
        if (send) {
            lastSyncGameTime = gameTime;
            level.sendBlockUpdated(worldPosition, getBlockState(), getBlockState(), Block.UPDATE_CLIENTS);
        }
    }

    /**
     * First call always sends. A backwards/reset game clock also starts a fresh window; only
     * non-negative subtraction is performed, so neither sentinel nor long wrap can overflow.
     */
    static boolean throttleElapsed(long gameTime, long previousSyncGameTime) {
        return ChargeMachineSyncPolicy.elapsed(gameTime, previousSyncGameTime);
    }

    // ------------------------------------------------------------------
    // Persistence (§3.1 envelope; ValueInput/ValueOutput only)
    // ------------------------------------------------------------------

    @Override
    protected void saveAdditional(ValueOutput output) {
        super.saveAdditional(output);
        // child() replaced the frozen parent's cuprum_state — rewrite it with identical
        // values, then append machine extensions (see class javadoc for the rationale).
        ValueOutput state = output.child(STATE_KEY);
        state.putInt(CuprumSchema.KEY, CuprumSchema.BLOCK_ENTITY);
        state.putLong(CHARGE_KEY, buffer.stored());
        saveMachineData(state);
    }

    @Override
    protected void loadAdditional(ValueInput input) {
        super.loadAdditional(input);
        loadMachineData(input);
    }

    /** Subclass extension point inside the {@code cuprum_state} child (e.g. {@code multiblock}). */
    protected void saveMachineData(ValueOutput stateChild) {
    }

    /**
     * Subclass load hook; receives the ROOT input so implementations can read both the
     * {@code cuprum_state} child (disk data) and transient update-tag extras (client mirror).
     */
    protected void loadMachineData(ValueInput input) {
    }

    // ------------------------------------------------------------------
    // Wire methods (the only two CompoundTag signatures, plan §3.1)
    // ------------------------------------------------------------------

    @Override
    public ClientboundBlockEntityDataPacket getUpdatePacket() {
        return ClientboundBlockEntityDataPacket.create(this);
    }

    @Override
    public CompoundTag getUpdateTag(HolderLookup.Provider registries) {
        CompoundTag tag = saveCustomOnly(registries);
        writeClientExtras(tag);
        return tag;
    }

    /** Transient client extras appended to the update tag (never written to disk). */
    protected void writeClientExtras(CompoundTag updateTag) {
    }
}
