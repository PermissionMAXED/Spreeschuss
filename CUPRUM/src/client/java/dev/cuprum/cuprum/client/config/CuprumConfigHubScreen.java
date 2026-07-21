package dev.cuprum.cuprum.client.config;

import dev.cuprum.cuprum.config.CuprumCommonConfig;
import me.shedaniel.autoconfig.AutoConfig;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;

/**
 * The W1E config hub (handbook-config.md §6): one screen with a button per config file —
 * client ({@code cuprum-client.json5}) and common ({@code cuprum-common.json5}) — each
 * opening the AutoConfig-generated Cloth screen for that class. A hub (instead of one
 * merged screen) keeps the D2 authority boundary visible: the common screen edits the
 * LOCAL file only; while connected, the server's synced snapshot stays authoritative
 * (overlay, plan §3.3) — the note under the buttons says exactly that when an overlay is
 * active. Layout is recomputed from the window size in {@link #init()} (GUI-scale safe).
 */
public final class CuprumConfigHubScreen extends Screen {
    public static final String TITLE_KEY = "text.autoconfig.cuprum.hub.title";
    static final String CLIENT_BUTTON_KEY = "text.autoconfig.cuprum.hub.client";
    static final String COMMON_BUTTON_KEY = "text.autoconfig.cuprum.hub.common";
    static final String OVERLAY_NOTE_KEY = "text.autoconfig.cuprum.hub.overlay_note";

    private static final int COLOR_NOTE = 0xFFE8A33C;

    private final Screen parent;

    public CuprumConfigHubScreen(Screen parent) {
        super(Component.translatable(TITLE_KEY));
        this.parent = parent;
    }

    @Override
    protected void init() {
        int buttonWidth = Math.min(width - 40, 220);
        int x = (width - buttonWidth) / 2;
        int y = height / 4 + 12;
        addRenderableWidget(Button.builder(Component.translatable(CLIENT_BUTTON_KEY),
                        button -> minecraft.setScreen(
                                AutoConfig.getConfigScreen(CuprumClientConfig.class, this).get()))
                .bounds(x, y, buttonWidth, 20).build());
        addRenderableWidget(Button.builder(Component.translatable(COMMON_BUTTON_KEY),
                        button -> minecraft.setScreen(
                                AutoConfig.getConfigScreen(CuprumCommonConfig.class, this).get()))
                .bounds(x, y + 26, buttonWidth, 20).build());
        addRenderableWidget(Button.builder(CommonComponents.GUI_DONE, button -> onClose())
                .bounds(x, y + 62, buttonWidth, 20).build());
    }

    @Override
    public void render(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
        super.render(guiGraphics, mouseX, mouseY, partialTick);
        guiGraphics.drawCenteredString(font, title, width / 2, height / 4 - 16, 0xFFFFFFFF);
        if (CuprumClientConfigs.hasCommonOverlay()) {
            guiGraphics.drawCenteredString(font, Component.translatable(OVERLAY_NOTE_KEY),
                    width / 2, height / 4 + 98, COLOR_NOTE);
        }
    }

    @Override
    public void onClose() {
        minecraft.setScreen(parent);
    }
}
