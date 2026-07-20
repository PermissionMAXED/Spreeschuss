package dev.cuprum.cuprum.charge.blockentity;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.charge.ChargeGraphManager;
import dev.cuprum.cuprum.charge.ChargeStorage;
import dev.cuprum.cuprum.charge.core.ChargeBuffer;
import dev.cuprum.cuprum.charge.core.ChargeMath;
import dev.cuprum.cuprum.state.CuprumSchema;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;

/**
 * Base class for every Cuprum BE that stores Cg (plan D7): owns the §3.1 persistence envelope
 * and delegates ALL storage mutation to one {@link ChargeBuffer} — the single clamp/insert/
 * extract authority. {@code ChargeMachineBlockEntity} (W1C) extends this, adding menu plumbing.
 *
 * <p><b>Envelope</b> (plan §3.1, binding): {@code saveAdditional} writes child
 * {@code cuprum_state} with {@code putInt("cuprum_schema", 1)} and
 * {@code putLong("charge", stored)}. {@code loadAdditional} reads
 * {@code getIntOr("cuprum_schema", 0)}: 0 ⇒ pre-versioned defaults (pre-Cg data carries no
 * {@code charge} key, so the default 0 applies); a version above current ⇒ WARN once per BE
 * type + best-effort read. Hostile stored values are clamped to {@code [0, capacity]} with a
 * warning. No {@code CompoundTag} override signatures — disk I/O is {@code ValueInput}/
 * {@code ValueOutput} only.
 *
 * <p><b>Lifecycle</b>: topology registration happens in the manager's {@code BLOCK_ENTITY_LOAD}
 * hook. In the pinned disk path components load BEFORE the event fires
 * ({@code promotePendingBlockEntity} → {@code loadStatic} → {@code addAndRegisterBlockEntity}),
 * but Fabric's public contract leaves callers/ordering unspecified ("data might not be loaded
 * yet"), so registration stays topology-only and the allocator pulls stored Cg lazily.
 * {@link #preRemoveSideEffects} reports explicit removal; the unload event that follows is an
 * idempotent no-op in the manager.
 */
public abstract class AbstractChargeStorageBlockEntity extends BlockEntity implements ChargeStorage {
    /** BE-envelope child (plan §3.1). */
    public static final String STATE_KEY = "cuprum_state";
    /** Stored-Cg key inside the {@code cuprum_state} child (plan §3.1). */
    public static final String CHARGE_KEY = "charge";

    private static final Set<String> FORWARD_VERSION_WARNED_TYPES = ConcurrentHashMap.newKeySet();

    protected final ChargeBuffer buffer;

    protected AbstractChargeStorageBlockEntity(BlockEntityType<?> type, BlockPos pos, BlockState state,
            long capacityCg, long maxInsertPerTickCg, long maxExtractPerTickCg) {
        super(type, pos, state);
        this.buffer = new ChargeBuffer(capacityCg, maxInsertPerTickCg, maxExtractPerTickCg);
    }

    // ------------------------------------------------------------------
    // ChargeStorage (delegation to the buffer)
    // ------------------------------------------------------------------

    @Override
    public long stored() {
        return buffer.stored();
    }

    @Override
    public long capacity() {
        return buffer.capacity();
    }

    @Override
    public long maxInsertPerTick() {
        return buffer.maxInsertPerTick();
    }

    @Override
    public long maxExtractPerTick() {
        return buffer.maxExtractPerTick();
    }

    @Override
    public long insert(long amountCg, boolean simulate) {
        assertServerThread();
        beginNormalBudgetWindow();
        long accepted = buffer.insert(amountCg, simulate);
        if (!simulate && accepted != 0L) {
            setChanged();
        }
        return accepted;
    }

    @Override
    public long extract(long amountCg, boolean simulate) {
        assertServerThread();
        beginNormalBudgetWindow();
        long extracted = buffer.extract(amountCg, simulate);
        if (!simulate && extracted != 0L) {
            setChanged();
        }
        return extracted;
    }

    @Override
    public long insertSurge(long amountCg) {
        assertServerThread();
        long accepted = buffer.depositSurge(amountCg);
        if (accepted != 0L) {
            setChanged();
        }
        return accepted;
    }

    // ------------------------------------------------------------------
    // Persistence (§3.1 envelope; ValueInput/ValueOutput only)
    // ------------------------------------------------------------------

    @Override
    protected void saveAdditional(ValueOutput output) {
        super.saveAdditional(output);
        ValueOutput state = output.child(STATE_KEY);
        state.putInt(CuprumSchema.KEY, CuprumSchema.BLOCK_ENTITY);
        state.putLong(CHARGE_KEY, buffer.stored());
    }

    @Override
    protected void loadAdditional(ValueInput input) {
        super.loadAdditional(input);
        ValueInput state = input.childOrEmpty(STATE_KEY);
        int version = state.getIntOr(CuprumSchema.KEY, 0);
        if (version > CuprumSchema.BLOCK_ENTITY) {
            String typeId = String.valueOf(BlockEntityType.getKey(getType()));
            if (FORWARD_VERSION_WARNED_TYPES.add(typeId)) {
                Cuprum.LOGGER.warn(
                        "[charge] {} cuprum_schema {} is from a newer Cuprum (current {}); best-effort read",
                        typeId, version, CuprumSchema.BLOCK_ENTITY);
            }
        }
        long raw = state.getLongOr(CHARGE_KEY, 0L);
        long clamped = ChargeMath.clamp(raw, 0L, buffer.capacity());
        if (clamped != raw) {
            Cuprum.LOGGER.warn("[charge] hostile stored value {} Cg at {} clamped to {} (capacity {})",
                    raw, worldPosition, clamped, buffer.capacity());
        }
        buffer.setStored(clamped);
    }

    @Override
    public void preRemoveSideEffects(BlockPos pos, BlockState state) {
        super.preRemoveSideEffects(pos, state);
        if (level instanceof ServerLevel serverLevel) {
            ChargeGraphManager.of(serverLevel).notifyNodeRemoved(this);
        }
    }

    private void assertServerThread() {
        if (level != null && !level.isClientSide()
                && level.getServer() != null && !level.getServer().isSameThread()) {
            throw new IllegalStateException("Cg: off-thread access");
        }
    }

    private void beginNormalBudgetWindow() {
        if (level != null) {
            buffer.beginGameTick(level.getGameTime());
        }
    }
}
