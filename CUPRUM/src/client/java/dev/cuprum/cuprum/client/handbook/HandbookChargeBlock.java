package dev.cuprum.cuprum.client.handbook;

import dev.cuprum.cuprum.client.config.CuprumClientConfigs;
import dev.cuprum.cuprum.config.ConfigValueRefs;
import dev.cuprum.cuprum.handbook.HandbookWidget;
import java.util.Locale;
import java.util.OptionalInt;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.network.chat.Component;

/**
 * The {@code charge} widget: a config-bound number rendered live from
 * {@link CuprumClientConfigs#effectiveCommon()} (the server overlay while connected — plan
 * §3.3), resolved through the typed {@link ConfigValueRefs} map. Handbook numbers therefore
 * never drift from the balance config the server is actually running. Value text is
 * ROOT-locale formatted; the unit suffix is the frozen {@code ChargeUnit} literal
 * (e.g. {@code 5 Cg/t}).
 */
final class HandbookChargeBlock extends HandbookContentBlock {
    private static final int COLOR_VALUE = 0xFFE8A33C;
    private static final int COLOR_BAR = 0xFF4A3628;

    private final HandbookWidget.Charge widget;

    HandbookChargeBlock(HandbookScreen screen, int width, HandbookWidget.Charge widget) {
        super(screen, 0, 0, width, Minecraft.getInstance().font.lineHeight + 10,
                Component.literal(valueText(widget)));
        this.widget = widget;
    }

    /** The rendered literal, e.g. {@code "5 Cg/t"} (client GameTest asserts it verbatim). */
    static String valueText(HandbookWidget.Charge widget) {
        OptionalInt value = ConfigValueRefs.resolve(widget.valueRef(),
                CuprumClientConfigs.effectiveCommon());
        if (value.isEmpty()) {
            return "?";
        }
        return String.format(Locale.ROOT, "%,d %s", value.getAsInt(), widget.unit().label());
    }

    @Override
    protected void renderWidget(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
        // Live re-read every frame: a config resync while the page is open updates the text.
        Component text = Component.literal(valueText(widget));
        setMessage(text);
        guiGraphics.fill(getX(), getY() + 2, getX() + 3, getY() + getHeight() - 2, COLOR_BAR);
        guiGraphics.drawString(Minecraft.getInstance().font, text, getX() + 8, getY() + 5,
                COLOR_VALUE, false);
        renderFocusOutline(guiGraphics);
    }

    /** The bound ref path (client GameTest assertion hook). */
    HandbookWidget.Charge chargeWidget() {
        return widget;
    }

    @Override
    protected boolean isValidClickButton(MouseButtonInfo buttonInfo) {
        return false;
    }
}
