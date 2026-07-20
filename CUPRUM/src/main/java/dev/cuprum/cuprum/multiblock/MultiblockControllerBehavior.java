package dev.cuprum.cuprum.multiblock;

import java.util.Optional;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.jetbrains.annotations.Nullable;

/**
 * The composable controller state machine (multiblock.md §5.2, frozen surface) — composition,
 * NOT a BE base class: the Diagnostic Coil core is BOTH a charge machine and a controller, so
 * hosts own one of these instead of inheriting.
 *
 * <p><b>Transitions (server-only):</b> UNFORMED→FORMED when {@code tryMatch} AND {@code claim}
 * succeed (claim conflict → FAULT(CONFLICT, firstConflictPos)); FORMED→FAULT(code, pos) when
 * revalidation fails — claims are retained in FAULT so member theft cannot happen while chunks
 * cycle; FAULT→FORMED when revalidation succeeds again (repair / chunk reload).
 *
 * <p><b>Budget (frozen §10):</b> at most one full {@code tryMatch} per {@link #serverTick};
 * steady state one per {@value #REVALIDATION_INTERVAL_TICKS} ticks; dirty marks, chunk events
 * and reload-generation changes only advance the schedule. Poll deadlines use absolute
 * {@code Level.getGameTime()} (plan §3.1 timed-state rule).
 *
 * <p><b>Persistence (plan §3.1):</b> {@link #save} writes child {@code multiblock}
 * ({@code formed}, {@code rotation}, {@code mirror} via the vanilla codecs) into the host's
 * {@code cuprum_state} child; faults and the pattern id are never persisted (each controller
 * BE type binds exactly one pattern id). On a formed load, provisional claims are re-registered
 * from the persisted orientation before the first verification tick (§5.1 rule 2).
 */
public final class MultiblockControllerBehavior {
    public static final int REVALIDATION_INTERVAL_TICKS = 20;

    private static final String MULTIBLOCK_KEY = "multiblock";
    private static final String FORMED_KEY = "formed";
    private static final String ROTATION_KEY = "rotation";
    private static final String MIRROR_KEY = "mirror";
    private static final String CLIENT_STATE_KEY = "formation_state";
    private static final String CLIENT_FAULT_CODE_KEY = "fault_code";
    private static final String CLIENT_FAULT_POS_KEY = "fault_pos";

    private final BlockEntity host;
    private final ResourceLocation patternId;
    private FormationState state = FormationState.UNFORMED;
    @Nullable
    private MultiblockFault fault;
    @Nullable
    private MultiblockOrientation orientation;
    private boolean dirty = true;
    private boolean pendingRetainedClaim;
    private boolean retainedUntilVerified;
    private long nextPollGameTime = Long.MIN_VALUE;
    private int seenReloadGeneration = Integer.MIN_VALUE;
    @Nullable
    private FormationListener listener;

    public MultiblockControllerBehavior(BlockEntity host, ResourceLocation patternId) {
        this.host = host;
        this.patternId = patternId;
    }

    public FormationState state() {
        return state;
    }

    /** Present iff {@link FormationState#FAULT}. */
    public Optional<MultiblockFault> fault() {
        return Optional.ofNullable(fault);
    }

    /** Present iff FORMED (or FAULT reached from FORMED). */
    public Optional<MultiblockOrientation> orientation() {
        return Optional.ofNullable(orientation);
    }

    /** Idempotent dirty flag; the next {@link #serverTick} revalidates immediately. */
    public void requestRevalidation() {
        dirty = true;
    }

    /**
     * Synchronous member-chunk lifecycle path. The index calls this only for an exact
     * already-loaded host identity; no world read is needed and retained claims stay intact.
     */
    void onMemberChunkUnloaded(BlockPos firstUnloadedMember) {
        dirty = true;
        setFault(new MultiblockFault(FaultCode.UNLOADED, Optional.of(firstUnloadedMember),
                "member chunk not loaded"));
    }

    public void setListener(FormationListener listener) {
        this.listener = listener;
    }

    /**
     * Runs at most one {@code tryMatch}: immediately when dirty (own flag, bounded index flag
     * or reload generation), else on the 20-tick baseline poll in every formation state.
     */
    public void serverTick(ServerLevel level) {
        MultiblockLevelIndex index = MultiblockLevelIndex.get(level);
        BlockPos pos = host.getBlockPos();
        index.ensureControllerRegistered(host);
        if (pendingRetainedClaim) {
            registerRetainedClaim(index, pos);
        }
        boolean revalidate = dirty;
        if (index.consumeDirty(pos)) {
            revalidate = true;
        }
        if (MultiblockPatterns.reloadGeneration() != seenReloadGeneration) {
            revalidate = true;
        }
        if (level.getGameTime() >= nextPollGameTime) {
            revalidate = true;
        }
        if (!revalidate) {
            return;
        }
        dirty = false;
        seenReloadGeneration = MultiblockPatterns.reloadGeneration();
        nextPollGameTime = level.getGameTime() + REVALIDATION_INTERVAL_TICKS;
        verify(level, index, pos);
    }

    private void verify(ServerLevel level, MultiblockLevelIndex index, BlockPos pos) {
        Optional<MultiblockPattern> pattern = MultiblockPatterns.get(patternId);
        if (pattern.isEmpty()) {
            if (state != FormationState.UNFORMED) {
                // Claims and orientation retained: the pattern may come back on the next reload.
                setFault(new MultiblockFault(FaultCode.PATTERN_MISSING, Optional.of(pos),
                        "pattern " + patternId + " is not loaded"));
            }
            return;
        }
        MultiblockMatchResult result = pattern.get().tryMatch(level, pos);
        if (result.match().isPresent()) {
            MultiblockMatch match = result.match().get();
            long[] members = match.memberPositions();
            boolean claimed = retainedUntilVerified
                    ? index.claimRetained(pos, members)
                    : index.claim(pos, members);
            if (claimed) {
                index.markVerified(pos);
                retainedUntilVerified = false;
                fault = null;
                boolean orientationChanged = !match.orientation().equals(orientation);
                orientation = match.orientation();
                if (orientationChanged && state == FormationState.FORMED) {
                    notifyClientVisibleChange();
                }
                setState(FormationState.FORMED);
            } else {
                BlockPos conflict = index.firstConflict(pos, members);
                setFault(new MultiblockFault(FaultCode.CONFLICT,
                        Optional.ofNullable(conflict), "member claimed by another controller"));
            }
        } else if (state != FormationState.UNFORMED) {
            // Claims and orientation retained in FAULT (§5.2) so repair can reform in place.
            setFault(result.bestFault().orElseGet(() -> new MultiblockFault(FaultCode.MISMATCH,
                    Optional.of(pos), "pattern does not match")));
        }
    }

    /** Called synchronously from the production {@code BLOCK_ENTITY_LOAD} listener. */
    void onHostLoaded(MultiblockLevelIndex index) {
        index.ensureControllerRegistered(host);
        if (pendingRetainedClaim) {
            registerRetainedClaim(index, host.getBlockPos());
        }
    }

    private void registerRetainedClaim(MultiblockLevelIndex index, BlockPos pos) {
        pendingRetainedClaim = false;
        if (orientation == null) {
            return;
        }
        Optional<MultiblockPattern> pattern = MultiblockPatterns.get(patternId);
        if (pattern.isEmpty()) {
            setFault(new MultiblockFault(FaultCode.PATTERN_MISSING, Optional.of(pos),
                    "pattern " + patternId + " is not loaded"));
            return;
        }
        long[] members = pattern.get().memberPositions(pos, orientation);
        if (!index.claimRetained(pos, members)) {
            BlockPos conflict = index.firstConflict(pos, members);
            setFault(new MultiblockFault(FaultCode.CONFLICT,
                    Optional.ofNullable(conflict), "member claimed by another controller"));
        }
    }

    private void setFault(MultiblockFault newFault) {
        boolean clientVisibleChange = fault == null
                || fault.code() != newFault.code()
                || !fault.pos().equals(newFault.pos());
        fault = newFault;
        if (state == FormationState.FAULT) {
            if (clientVisibleChange) {
                notifyClientVisibleChange();
            }
        } else {
            setState(FormationState.FAULT);
        }
    }

    private void setState(FormationState newState) {
        if (newState == state) {
            return;
        }
        FormationState previous = state;
        state = newState;
        host.setChanged();
        if (listener != null) {
            listener.formationChanged(previous, newState);
        }
    }

    /** Same-enum changes still traverse the listener because their update tags differ. */
    private void notifyClientVisibleChange() {
        host.setChanged();
        if (listener != null) {
            listener.formationChanged(state, state);
        }
    }

    /** Call from the host's {@code preRemoveSideEffects} — releases claims (§5.1 rule 2). */
    public void onHostRemoved(ServerLevel level) {
        MultiblockLevelIndex.get(level).release(host);
    }

    // ------------------------------------------------------------------
    // Persistence + client sync (plan §3.1)
    // ------------------------------------------------------------------

    /** Writes child {@code multiblock} into the host's {@code cuprum_state} output. */
    public void save(ValueOutput output) {
        ValueOutput multiblock = output.child(MULTIBLOCK_KEY);
        boolean formed = orientation != null;
        multiblock.putBoolean(FORMED_KEY, formed);
        if (formed) {
            multiblock.store(ROTATION_KEY, Rotation.CODEC, orientation.rotation());
            multiblock.store(MIRROR_KEY, Mirror.CODEC, orientation.mirror());
        }
    }

    /** Reads the {@code multiblock} child; a formed load schedules the provisional re-claim. */
    public void load(ValueInput input) {
        ValueInput multiblock = input.childOrEmpty(MULTIBLOCK_KEY);
        boolean formed = multiblock.getBooleanOr(FORMED_KEY, false);
        fault = null;
        dirty = true;
        if (formed) {
            Rotation rotation = multiblock.read(ROTATION_KEY, Rotation.CODEC).orElse(Rotation.NONE);
            Mirror mirror = multiblock.read(MIRROR_KEY, Mirror.CODEC).orElse(Mirror.NONE);
            if (mirror == Mirror.FRONT_BACK) {
                mirror = Mirror.NONE; // hostile value clamp (plan D5 best-effort read)
            }
            orientation = new MultiblockOrientation(rotation, mirror);
            state = FormationState.FORMED;
            retainedUntilVerified = true;
            pendingRetainedClaim = true;
        } else {
            orientation = null;
            state = FormationState.UNFORMED;
            retainedUntilVerified = false;
            pendingRetainedClaim = false;
        }
    }

    /** Transient client extras for {@code getUpdateTag} (Beacon precedent; never on disk). */
    public void writeClientData(CompoundTag updateTag) {
        updateTag.putByte(CLIENT_STATE_KEY, (byte) state.ordinal());
        if (fault != null) {
            updateTag.putString(CLIENT_FAULT_CODE_KEY, fault.code().getSerializedName());
            fault.pos().ifPresent(pos -> updateTag.putIntArray(CLIENT_FAULT_POS_KEY,
                    new int[] {pos.getX(), pos.getY(), pos.getZ()}));
        }
    }

    /** Client mirror: applies only when the transient key is present (disk loads skip it). */
    public void readClientData(ValueInput input) {
        byte raw = input.getByteOr(CLIENT_STATE_KEY, (byte) -1);
        if (raw < 0) {
            return;
        }
        state = FormationState.byOrdinal(raw);
        if (state == FormationState.FAULT) {
            FaultCode code = FaultCode.byName(
                    input.getStringOr(CLIENT_FAULT_CODE_KEY, FaultCode.MISMATCH.getSerializedName()));
            Optional<BlockPos> pos = input.getIntArray(CLIENT_FAULT_POS_KEY)
                    .filter(array -> array.length == 3)
                    .map(array -> new BlockPos(array[0], array[1], array[2]));
            fault = new MultiblockFault(code, pos, "");
        } else {
            fault = null;
        }
    }

    @FunctionalInterface
    public interface FormationListener {
        void formationChanged(FormationState prev, FormationState cur);
    }
}
