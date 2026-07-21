package dev.cuprum.cuprum.blockentity;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.fx.FxContent;
import dev.cuprum.cuprum.state.CuprumSchema;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;

/**
 * The FX probe's block entity (CP0 diagnostic infrastructure, client-fx.md §12): counts the
 * server-side use pulses that dispatched a ripple payload. The counter is dispatch/state proof
 * for the server GameTest — pure diagnostics, no gameplay meaning (outcome neutrality:
 * {@code client.fx} presentation can never read or affect it).
 *
 * <p><b>Envelope</b> (plan §3.1, binding): {@code saveAdditional} writes child
 * {@code cuprum_state} with {@code putInt("cuprum_schema", 1)} and {@code putLong("pulses",
 * count)}. {@code loadAdditional} reads {@code getIntOr("cuprum_schema", 0)}: 0 means
 * pre-versioned defaults; a version above current logs one WARN and reads best-effort.
 * Hostile negative counts are floored at 0 with a warning. Disk I/O is {@code ValueInput}/
 * {@code ValueOutput} only (no {@code CompoundTag} override signatures).
 */
public final class FxProbeBlockEntity extends BlockEntity {
    /** BE-envelope child (plan §3.1). */
    public static final String STATE_KEY = "cuprum_state";
    /** Pulse-counter key inside the {@code cuprum_state} child. */
    public static final String PULSES_KEY = "pulses";

    private static volatile boolean forwardVersionWarned;

    private long pulses;

    public FxProbeBlockEntity(BlockPos pos, BlockState state) {
        super(FxContent.FX_PROBE_BLOCK_ENTITY, pos, state);
    }

    /** Records one server-side use pulse; returns the new total (server GameTest proof). */
    public long recordPulse() {
        pulses++;
        setChanged();
        return pulses;
    }

    public long pulses() {
        return pulses;
    }

    @Override
    protected void saveAdditional(ValueOutput output) {
        super.saveAdditional(output);
        ValueOutput state = output.child(STATE_KEY);
        state.putInt(CuprumSchema.KEY, CuprumSchema.BLOCK_ENTITY);
        state.putLong(PULSES_KEY, pulses);
    }

    @Override
    protected void loadAdditional(ValueInput input) {
        super.loadAdditional(input);
        ValueInput state = input.childOrEmpty(STATE_KEY);
        int version = state.getIntOr(CuprumSchema.KEY, 0);
        if (version > CuprumSchema.BLOCK_ENTITY && !forwardVersionWarned) {
            forwardVersionWarned = true;
            Cuprum.LOGGER.warn("[fx] fx_probe cuprum_schema {} is from a newer Cuprum (current {}); best-effort read",
                    version, CuprumSchema.BLOCK_ENTITY);
        }
        long raw = state.getLongOr(PULSES_KEY, 0L);
        if (raw < 0L) {
            Cuprum.LOGGER.warn("[fx] hostile pulse count {} at {} floored to 0", raw, worldPosition);
            raw = 0L;
        }
        pulses = raw;
    }
}
