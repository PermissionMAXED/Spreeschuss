package dev.cuprum.cuprum.client.machine;

import dev.cuprum.cuprum.machine.ChargeMachineMenu;
import dev.cuprum.cuprum.machine.MachineContent;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.MenuScreens;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.network.chat.Component;

/**
 * Compile-time signature probe for the W1C client screen layer (multiblock.md §12.4, frozen
 * {@code RenderApiProbe} rules): {@code MenuScreens.register} is reachable from mod client
 * code through Fabric's transitive access widener, and the texture-free {@code GuiGraphics}
 * members the screen draws with keep their signatures.
 *
 * <p>Nothing here is ever invoked: all members are private, the class is never instantiated and
 * no static initializer performs work. See docs/API_PROBES.md ("Multiblock & charge machine").
 */
public final class MachineClientApiProbe {
    private MachineClientApiProbe() {
    }

    /** Probe 1 (§12.4): the TAW-widened {@code MenuScreens.register} with a screen constructor
     * reference against the {@code ExtendedScreenHandlerType}-typed menu. */
    private static void probeMenuScreensRegister() {
        MenuScreens.register(MachineContent.CHARGE_MACHINE_MENU, ChargeMachineScreen::new);
    }

    /** Probe 2 (§6.3): the texture-free screen surface — {@code AbstractContainerScreen}
     * hooks and the {@code GuiGraphics} fill/drawString members. */
    private static void probeScreenSurface(GuiGraphics graphics, AbstractContainerScreen<ChargeMachineMenu> screen,
            net.minecraft.client.gui.Font font) {
        graphics.fill(0, 0, 16, 16, 0xFF000000);
        graphics.drawString(font, Component.literal("probe"), 0, 0, 0xFFFFFFFF, false);
    }
}
