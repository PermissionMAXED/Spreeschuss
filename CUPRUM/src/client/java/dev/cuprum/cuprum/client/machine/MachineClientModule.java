package dev.cuprum.cuprum.client.machine;

import dev.cuprum.cuprum.machine.MachineContent;
import net.minecraft.client.gui.screens.MenuScreens;

/**
 * Machine-module client bootstrap (plan §5.1): called exactly once from
 * {@code CuprumClient.onInitializeClient()}. {@code MenuScreens.register} is mod-accessible via
 * the Fabric transitive access widener (multiblock.md §1); it throws on duplicate registration,
 * which the single-call bootstrap order guarantees never happens.
 */
public final class MachineClientModule {
    private MachineClientModule() {
    }

    public static void init() {
        MenuScreens.register(MachineContent.CHARGE_MACHINE_MENU, ChargeMachineScreen::new);
    }
}
