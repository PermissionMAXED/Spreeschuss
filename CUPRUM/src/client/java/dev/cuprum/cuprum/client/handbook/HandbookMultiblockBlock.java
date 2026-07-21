package dev.cuprum.cuprum.client.handbook;

import dev.cuprum.cuprum.client.api.handbook.HandbookMultiblockPreview;
import dev.cuprum.cuprum.handbook.HandbookWidget;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

/**
 * The {@code multiblock} widget: renders one layer at a time through the frozen
 * {@link HandbookMultiblockPreview} flat item grid (the pinned T3 floor, plan D10) with a
 * localized "layer i/n" caption. Click steps to the next layer (wraps); when keyboard-
 * focused, left/right arrows step too, and narration announces the current layer — the
 * widget stays fully usable without a mouse (§7).
 */
final class HandbookMultiblockBlock extends HandbookContentBlock {
    private static final int COLOR_CAPTION = 0xFF9A8C80;
    private static final int CAPTION_GAP = 3;

    private final HandbookWidget.Multiblock widget;
    private int layerIndex;

    HandbookMultiblockBlock(HandbookScreen screen, int width, HandbookWidget.Multiblock widget) {
        super(screen, 0, 0, width,
                HandbookMultiblockPreview.maxLayerHeight(widget) + CAPTION_GAP
                        + Minecraft.getInstance().font.lineHeight + 4,
                layerLabel(widget, 0));
        this.widget = widget;
    }

    private static Component layerLabel(HandbookWidget.Multiblock widget, int layerIndex) {
        return Component.translatable("handbook.cuprum.multiblock_layer",
                layerIndex + 1, widget.layers().size());
    }

    private void stepLayer(int direction) {
        layerIndex = Math.floorMod(layerIndex + direction, widget.layers().size());
        setMessage(layerLabel(widget, layerIndex));
    }

    @Override
    public void onClick(MouseButtonEvent event, boolean isDoubleClick) {
        stepLayer(1);
    }

    @Override
    public boolean keyPressed(KeyEvent event) {
        if (event.key() == GLFW.GLFW_KEY_RIGHT) {
            stepLayer(1);
            return true;
        }
        if (event.key() == GLFW.GLFW_KEY_LEFT) {
            stepLayer(-1);
            return true;
        }
        return super.keyPressed(event);
    }

    @Override
    protected void renderWidget(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
        int gridWidth = HandbookMultiblockPreview.layerWidth(widget, layerIndex);
        int gridX = getX() + Math.max(0, (getWidth() - gridWidth) / 2);
        HandbookMultiblockPreview.render(guiGraphics, widget, layerIndex, gridX, getY());
        Component caption = getMessage();
        int captionWidth = Minecraft.getInstance().font.width(caption);
        guiGraphics.drawString(Minecraft.getInstance().font, caption,
                getX() + Math.max(0, (getWidth() - captionWidth) / 2),
                getY() + HandbookMultiblockPreview.maxLayerHeight(widget) + CAPTION_GAP,
                COLOR_CAPTION, false);
        renderFocusOutline(guiGraphics);
    }

    /** Currently shown layer (client GameTest assertion hook). */
    int layerIndex() {
        return layerIndex;
    }
}
