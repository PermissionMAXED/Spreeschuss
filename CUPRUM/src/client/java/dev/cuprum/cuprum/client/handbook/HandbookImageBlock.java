package dev.cuprum.cuprum.client.handbook;

import dev.cuprum.cuprum.handbook.HandbookWidget;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.network.chat.Component;

/**
 * The {@code image} widget renderer: a full-texture blit at the declared size (codec-capped
 * ≤512²), centered in the content column, with an optional localized caption underneath.
 * Narration reads the caption (or a generic image label) — every widget narrates (§7).
 */
final class HandbookImageBlock extends HandbookContentBlock {
    private static final int COLOR_CAPTION = 0xFF9A8C80;
    private static final int CAPTION_GAP = 3;

    private final HandbookWidget.Image widget;
    private final Component caption;

    HandbookImageBlock(HandbookScreen screen, int width, HandbookWidget.Image widget) {
        super(screen, 0, 0, width, height(width, widget), narration(widget));
        this.widget = widget;
        this.caption = widget.captionKey().map(Component::translatable).orElse(null);
    }

    private static int height(int width, HandbookWidget.Image widget) {
        int height = widget.height();
        if (widget.captionKey().isPresent()) {
            height += CAPTION_GAP + Minecraft.getInstance().font.lineHeight;
        }
        return height + 4;
    }

    private static Component narration(HandbookWidget.Image widget) {
        return widget.captionKey()
                .map(key -> (Component) Component.translatable(key))
                .orElseGet(() -> Component.literal(widget.texture().toString()));
    }

    @Override
    protected void renderWidget(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
        int imageX = getX() + Math.max(0, (getWidth() - widget.width()) / 2);
        guiGraphics.blit(RenderPipelines.GUI_TEXTURED, widget.texture(), imageX, getY(),
                0.0f, 0.0f, widget.width(), widget.height(), widget.width(), widget.height());
        if (caption != null) {
            int captionWidth = Minecraft.getInstance().font.width(caption);
            guiGraphics.drawString(Minecraft.getInstance().font, caption,
                    getX() + Math.max(0, (getWidth() - captionWidth) / 2),
                    getY() + widget.height() + CAPTION_GAP, COLOR_CAPTION, false);
        }
        renderFocusOutline(guiGraphics);
    }

    @Override
    protected boolean isValidClickButton(MouseButtonInfo buttonInfo) {
        return false;
    }
}
