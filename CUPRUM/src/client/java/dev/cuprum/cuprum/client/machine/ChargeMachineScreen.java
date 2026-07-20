package dev.cuprum.cuprum.client.machine;

import dev.cuprum.cuprum.machine.ChargeMachineMenu;
import dev.cuprum.cuprum.multiblock.FormationState;
import java.util.Locale;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Inventory;

/**
 * Read-only charge-machine screen scaffold (multiblock.md §6.3): panel + charge bar drawn with
 * {@code GuiGraphics.fill} — deliberately no texture asset in W1. Labels show the localized
 * {@code cuprum.charge.readout} ("%,d / %,d Cg", numbers pre-formatted in ROOT locale) and the
 * {@code cuprum.formation.*} line. All values arrive through the vanilla menu data slots
 * (server-authoritative; zero C2S).
 */
public class ChargeMachineScreen extends AbstractContainerScreen<ChargeMachineMenu> {
    private static final int PANEL_WIDTH = 176;
    private static final int PANEL_HEIGHT = 84;

    private static final int COLOR_PANEL_BG = 0xFF201410;
    private static final int COLOR_PANEL_BORDER = 0xFFB7683C;
    private static final int COLOR_BAR_BACK = 0xFF3A2A20;
    private static final int COLOR_BAR_FILL = 0xFFE8A33C;
    private static final int COLOR_TEXT = 0xFFE0D6CC;

    private static final int BAR_X = 10;
    private static final int BAR_Y = 40;
    private static final int BAR_WIDTH = PANEL_WIDTH - 20;
    private static final int BAR_HEIGHT = 12;

    public ChargeMachineScreen(ChargeMachineMenu menu, Inventory playerInventory, Component title) {
        super(menu, playerInventory, title);
        this.imageWidth = PANEL_WIDTH;
        this.imageHeight = PANEL_HEIGHT;
    }

    @Override
    protected void renderBg(GuiGraphics guiGraphics, float partialTick, int mouseX, int mouseY) {
        int x = leftPos;
        int y = topPos;
        guiGraphics.fill(x - 1, y - 1, x + imageWidth + 1, y + imageHeight + 1, COLOR_PANEL_BORDER);
        guiGraphics.fill(x, y, x + imageWidth, y + imageHeight, COLOR_PANEL_BG);

        guiGraphics.fill(x + BAR_X, y + BAR_Y, x + BAR_X + BAR_WIDTH, y + BAR_Y + BAR_HEIGHT, COLOR_BAR_BACK);
        long capacity = Math.max(1L, menu.capacityCg());
        long charge = Math.min(menu.chargeCg(), capacity);
        int fill = (int) (BAR_WIDTH * charge / capacity);
        if (charge > 0 && fill == 0) {
            fill = 1; // non-empty always shows at least one pixel
        }
        if (fill > 0) {
            guiGraphics.fill(x + BAR_X, y + BAR_Y, x + BAR_X + fill, y + BAR_Y + BAR_HEIGHT, COLOR_BAR_FILL);
        }
    }

    @Override
    protected void renderLabels(GuiGraphics guiGraphics, int mouseX, int mouseY) {
        guiGraphics.drawString(font, title, titleLabelX, titleLabelY, COLOR_TEXT, false);
        Component readout = Component.translatable("cuprum.charge.readout",
                String.format(Locale.ROOT, "%,d", menu.chargeCg()),
                String.format(Locale.ROOT, "%,d", menu.capacityCg()));
        guiGraphics.drawString(font, readout, BAR_X, BAR_Y - 14, COLOR_TEXT, false);
        guiGraphics.drawString(font, formationLine(menu.formationState()), BAR_X, BAR_Y + BAR_HEIGHT + 6,
                COLOR_TEXT, false);
    }

    private static Component formationLine(FormationState state) {
        return switch (state) {
            case FORMED -> Component.translatable("cuprum.formation.formed");
            case UNFORMED -> Component.translatable("cuprum.formation.unformed");
            case FAULT -> Component.translatable("cuprum.formation.fault");
        };
    }
}
