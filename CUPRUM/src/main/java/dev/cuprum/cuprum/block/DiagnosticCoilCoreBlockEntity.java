package dev.cuprum.cuprum.block;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.machine.ChargeMachineBlockEntity;
import dev.cuprum.cuprum.machine.ChargeMachineMenu;
import dev.cuprum.cuprum.machine.ChargeMachineOpenData;
import dev.cuprum.cuprum.machine.MachineContent;
import dev.cuprum.cuprum.multiblock.FormationState;
import dev.cuprum.cuprum.multiblock.MultiblockControllerBehavior;
import dev.cuprum.cuprum.multiblock.MultiblockControllerHost;
import net.fabricmc.fabric.api.screenhandler.v1.ExtendedScreenHandlerFactory;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.jetbrains.annotations.Nullable;

/**
 * The Diagnostic Coil core BE (multiblock.md §7): BOTH a charge machine and a multiblock
 * controller — the composition rationale behind {@link MultiblockControllerBehavior}. Constants
 * are diagnostic-only pins (NOT the Cg economy): {@value #CAPACITY_CG} Cg capacity,
 * +{@value #CHARGE_PER_TICK_CG} Cg/t self-charge while FORMED (INDEX.md baseline B), halting
 * otherwise. Self-charge goes through the buffer's surge path (capacity-clamped) — the coil's
 * normal insert/extract budgets are 0, so the graph can observe but never move its charge and
 * the 5 Cg/t line stays exact. Syncs are throttled to ≥10 ticks except on formation
 * transitions (the behavior listener fires the immediate path).
 */
public final class DiagnosticCoilCoreBlockEntity extends ChargeMachineBlockEntity
        implements ExtendedScreenHandlerFactory<ChargeMachineOpenData>, MultiblockControllerHost {
    public static final ResourceLocation PATTERN_ID =
            ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "diagnostic_coil");
    public static final long CAPACITY_CG = 1_000L;
    public static final long CHARGE_PER_TICK_CG = 5L;

    private final MultiblockControllerBehavior behavior;

    public DiagnosticCoilCoreBlockEntity(BlockPos pos, BlockState state) {
        super(MachineContent.DIAGNOSTIC_COIL_CORE_BLOCK_ENTITY, pos, state, CAPACITY_CG, 0L, 0L);
        behavior = new MultiblockControllerBehavior(this, PATTERN_ID);
        behavior.setListener((prev, cur) -> markChangedAndSync());
    }

    @Override
    public MultiblockControllerBehavior multiblockBehavior() {
        return behavior;
    }

    /** Server-only BE ticker (bound by {@code DiagnosticCoilCoreBlock.getTicker}). */
    public static void serverTick(Level level, BlockPos pos, BlockState state, DiagnosticCoilCoreBlockEntity coil) {
        if (!(level instanceof ServerLevel serverLevel)) {
            return;
        }
        coil.behavior.serverTick(serverLevel);
        if (coil.behavior.state() == FormationState.FORMED) {
            long accepted = coil.chargeBuffer().depositSurge(CHARGE_PER_TICK_CG);
            if (accepted > 0L) {
                coil.markChangedAndSyncThrottled();
            }
        }
    }

    @Override
    protected int formationStateOrdinalForMenu() {
        return behavior.state().ordinal();
    }

    @Override
    public void preRemoveSideEffects(BlockPos pos, BlockState state) {
        if (level instanceof ServerLevel serverLevel) {
            behavior.onHostRemoved(serverLevel);
        }
        super.preRemoveSideEffects(pos, state);
    }

    // ------------------------------------------------------------------
    // Persistence + client sync (hooks into the §3.1 envelope)
    // ------------------------------------------------------------------

    @Override
    protected void saveMachineData(ValueOutput stateChild) {
        behavior.save(stateChild);
    }

    @Override
    protected void loadMachineData(ValueInput input) {
        behavior.load(input.childOrEmpty(STATE_KEY));
        behavior.readClientData(input);
    }

    @Override
    protected void writeClientExtras(CompoundTag updateTag) {
        behavior.writeClientData(updateTag);
    }

    // ------------------------------------------------------------------
    // ChargeNode (D7: probe-visible storage node)
    // ------------------------------------------------------------------

    @Override
    public boolean canConnect(@Nullable Direction side) {
        return true;
    }

    // ------------------------------------------------------------------
    // ExtendedScreenHandlerFactory (S2C open data; zero C2S in W1)
    // ------------------------------------------------------------------

    @Override
    public Component getDisplayName() {
        return Component.translatable("container.cuprum.charge_machine");
    }

    @Override
    public AbstractContainerMenu createMenu(int containerId, Inventory inventory, Player player) {
        return new ChargeMachineMenu(containerId, inventory, this);
    }

    @Override
    public ChargeMachineOpenData getScreenOpeningData(ServerPlayer player) {
        return new ChargeMachineOpenData(worldPosition, chargeBuffer().capacity());
    }
}
