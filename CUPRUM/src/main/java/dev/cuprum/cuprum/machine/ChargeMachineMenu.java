package dev.cuprum.cuprum.machine;

import dev.cuprum.cuprum.multiblock.FormationState;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ContainerData;
import net.minecraft.world.inventory.ContainerLevelAccess;
import net.minecraft.world.inventory.SimpleContainerData;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;

/**
 * Read-only charge-machine menu (multiblock.md §6.3, frozen; id ledger
 * {@code cuprum:charge_machine}). Server authority: W1 defines ZERO C2S payloads — no item
 * slots, no {@code clickMenuButton}; every mutation happens in the server ticker. The server
 * constructor exposes the machine's live {@link ChargeMachineBlockEntity#createMenuData} view;
 * vanilla syncs the four 16-bit data slots ({@link ShortSplit} lanes 0..2 + status ordinal).
 * {@code stillValid} enforces the vanilla block/range check through
 * {@code ContainerLevelAccess}.
 */
public class ChargeMachineMenu extends AbstractContainerMenu {
    private final ContainerData data;
    private final ContainerLevelAccess access;
    private final Block machineBlock;
    private final long capacityCg;

    /** Client constructor — invoked by {@code ExtendedScreenHandlerType} with the open data. */
    @SuppressWarnings("this-escape") // vanilla menu contract: addDataSlots must run in the ctor.
    public ChargeMachineMenu(int containerId, Inventory inventory, ChargeMachineOpenData openData) {
        this(containerId, new SimpleContainerData(ChargeMachineBlockEntity.DATA_SLOT_COUNT),
                ContainerLevelAccess.NULL, Blocks.AIR, openData.capacityCg());
    }

    /** Server constructor — live data view over the machine. */
    @SuppressWarnings("this-escape") // vanilla menu contract: addDataSlots must run in the ctor.
    public ChargeMachineMenu(int containerId, Inventory inventory, ChargeMachineBlockEntity machine) {
        this(containerId, machine.createMenuData(),
                ContainerLevelAccess.create(machine.getLevel(), machine.getBlockPos()),
                machine.getBlockState().getBlock(), machine.chargeBuffer().capacity());
    }

    private ChargeMachineMenu(int containerId, ContainerData data, ContainerLevelAccess access,
            Block machineBlock, long capacityCg) {
        super(MachineContent.CHARGE_MACHINE_MENU, containerId);
        this.data = data;
        this.access = access;
        this.machineBlock = machineBlock;
        this.capacityCg = ChargeMachineBlockEntity.requireSyncableCg("menu capacityCg", capacityCg);
        addDataSlots(data);
    }

    /** Stored Cg recombined from the three synced 16-bit lanes. */
    public long chargeCg() {
        return ShortSplit.combineThree(
                data.get(ChargeMachineBlockEntity.SLOT_CHARGE_LANE0),
                data.get(ChargeMachineBlockEntity.SLOT_CHARGE_LANE1),
                data.get(ChargeMachineBlockEntity.SLOT_CHARGE_LANE2));
    }

    public long capacityCg() {
        return capacityCg;
    }

    /** The machine's formation state from the status slot (hostile ordinals → UNFORMED). */
    public FormationState formationState() {
        return FormationState.byOrdinal(data.get(ChargeMachineBlockEntity.SLOT_STATUS));
    }

    @Override
    public ItemStack quickMoveStack(Player player, int index) {
        return ItemStack.EMPTY; // no item slots in W1
    }

    @Override
    public boolean stillValid(Player player) {
        return stillValid(access, player, machineBlock);
    }
}
