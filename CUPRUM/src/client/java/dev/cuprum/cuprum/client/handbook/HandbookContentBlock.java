package dev.cuprum.cuprum.client.handbook;

import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.narration.NarratedElementType;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.network.chat.Component;

/**
 * Base class for every handbook content block inside the screen's scrolled region. All
 * blocks are {@code NarratableEntry}s via {@link AbstractWidget} (handbook-config.md §7:
 * acceptance criterion, not an option), participate in vanilla Tab/arrow focus traversal,
 * and draw a focus outline when keyboard-focused. The scroll clip is enforced twice:
 * visually by the screen's scissor, and for input by {@link #isMouseOver} rejecting clicks
 * outside the visible content region (a scrolled-away block can never be clicked through
 * the header).
 */
abstract class HandbookContentBlock extends AbstractWidget {
    protected static final int FOCUS_OUTLINE_COLOR = 0xFFE8A33C;

    protected final HandbookScreen screen;

    protected HandbookContentBlock(HandbookScreen screen, int x, int y, int width, int height,
            Component message) {
        super(x, y, width, height, message);
        this.screen = screen;
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

    /** 1-px focus outline (keyboard navigation; always on, plan §7). */
    protected void renderFocusOutline(net.minecraft.client.gui.GuiGraphics guiGraphics) {
        if (isFocused()) {
            int x0 = getX() - 2;
            int y0 = getY() - 2;
            int x1 = getX() + getWidth() + 2;
            int y1 = getY() + getHeight() + 2;
            guiGraphics.fill(x0, y0, x1, y0 + 1, FOCUS_OUTLINE_COLOR);
            guiGraphics.fill(x0, y1 - 1, x1, y1, FOCUS_OUTLINE_COLOR);
            guiGraphics.fill(x0, y0, x0 + 1, y1, FOCUS_OUTLINE_COLOR);
            guiGraphics.fill(x1 - 1, y0, x1, y1, FOCUS_OUTLINE_COLOR);
        }
    }

    @Override
    protected void updateWidgetNarration(NarrationElementOutput narrationElementOutput) {
        narrationElementOutput.add(NarratedElementType.TITLE, createNarrationMessage());
    }
}
