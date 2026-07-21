package dev.cuprum.cuprum.client.handbook;

import dev.cuprum.cuprum.handbook.HandbookWidget;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;

/**
 * The {@code text} widget renderer plus the screen's notice blocks (lock/missing/empty):
 * word-wrapped localized prose, styled per {@link HandbookWidget.TextStyle} (heading = bold
 * copper, caption = italic gray, body = plain light). Non-interactive but focusable so
 * keyboard traversal + narration read the page in order.
 */
final class HandbookTextBlock extends HandbookContentBlock {
    private static final int COLOR_BODY = 0xFFE0D6CC;
    private static final int COLOR_HEADING = 0xFFE8A33C;
    private static final int COLOR_CAPTION = 0xFF9A8C80;

    private final int color;

    private HandbookTextBlock(HandbookScreen screen, int width, Component text, int color) {
        super(screen, 0, 0, width,
                Minecraft.getInstance().font.wordWrapHeight(text, Math.max(1, width)) + 4, text);
        this.color = color;
    }

    static HandbookTextBlock of(HandbookScreen screen, int width, HandbookWidget.Text widget) {
        MutableComponent text = Component.translatable(widget.key());
        return switch (widget.style()) {
            case HEADING -> new HandbookTextBlock(screen, width,
                    text.withStyle(ChatFormatting.BOLD), COLOR_HEADING);
            case CAPTION -> new HandbookTextBlock(screen, width,
                    text.withStyle(ChatFormatting.ITALIC), COLOR_CAPTION);
            case BODY -> new HandbookTextBlock(screen, width, text, COLOR_BODY);
        };
    }

    /** Standalone notice block (lock notice, missing page, empty search results, headings). */
    static HandbookTextBlock notice(HandbookScreen screen, int width, Component text, boolean emphasized) {
        return new HandbookTextBlock(screen, width, text, emphasized ? COLOR_HEADING : COLOR_BODY);
    }

    @Override
    protected void renderWidget(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
        Font font = Minecraft.getInstance().font;
        guiGraphics.drawWordWrap(font, getMessage(), getX(), getY() + 2, getWidth(), color, false);
        renderFocusOutline(guiGraphics);
    }

    @Override
    protected boolean isValidClickButton(MouseButtonInfo buttonInfo) {
        return false; // prose is never clickable
    }
}
