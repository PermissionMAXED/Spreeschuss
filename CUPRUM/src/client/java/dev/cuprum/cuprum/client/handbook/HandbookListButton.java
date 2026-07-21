package dev.cuprum.cuprum.client.handbook;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.ItemStack;

/**
 * One row in the handbook's scrolled lists (categories, pages, search results, bookmark
 * rail): flat panel styling, optional item icon, hover/focus highlight, full narration via
 * the vanilla button base. Lives in the scrolled content region, so clicks outside the
 * visible region are rejected ({@code isMouseOver} region guard mirroring
 * {@link HandbookContentBlock}).
 */
final class HandbookListButton extends net.minecraft.client.gui.components.Button {
    private static final int COLOR_BG = 0xFF2A1C14;
    private static final int COLOR_BG_HOVER = 0xFF3A2A20;
    private static final int COLOR_BORDER = 0xFF4A3628;
    private static final int COLOR_BORDER_FOCUS = 0xFFE8A33C;

    private final HandbookScreen screen;
    private final ItemStack icon;
    private final int textColor;

    HandbookListButton(HandbookScreen screen, int width, Component label, ItemStack icon,
            int textColor, OnPress onPress) {
        super(0, 0, width, 20, label, onPress, DEFAULT_NARRATION);
        this.screen = screen;
        this.icon = icon == null ? ItemStack.EMPTY : icon;
        this.textColor = textColor;
    }

    @Override
    public boolean isMouseOver(double mouseX, double mouseY) {
        return super.isMouseOver(mouseX, mouseY) && screen.isInContentRegion(mouseY);
    }

    @Override
    public void setFocused(boolean focused) {
        super.setFocused(focused);
        if (focused) {
            screen.ensureVisible(this);
        }
    }

    @Override
    protected void renderWidget(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
        boolean highlight = isHoveredOrFocused() && isActive();
        guiGraphics.fill(getX(), getY(), getX() + getWidth(), getY() + getHeight(),
                isFocused() ? COLOR_BORDER_FOCUS : COLOR_BORDER);
        guiGraphics.fill(getX() + 1, getY() + 1, getX() + getWidth() - 1, getY() + getHeight() - 1,
                highlight ? COLOR_BG_HOVER : COLOR_BG);
        int textX = getX() + 6;
        if (!icon.isEmpty()) {
            guiGraphics.renderItem(icon, getX() + 3, getY() + 2);
            textX = getX() + 24;
        }
        guiGraphics.drawString(Minecraft.getInstance().font, getMessage(), textX,
                getY() + (getHeight() - 8) / 2, textColor, false);
    }
}
