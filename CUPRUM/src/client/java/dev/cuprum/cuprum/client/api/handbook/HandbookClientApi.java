package dev.cuprum.cuprum.client.api.handbook;

import dev.cuprum.cuprum.client.handbook.HandbookScreen;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.ResourceLocation;

/**
 * FROZEN CLIENT API (plan D5 freeze surface): the handbook deep-link entry points QOL-01
 * ("?" buttons) and ADV chains call in later waves. W1 keeps the surface minimal — open a
 * page (lock/missing behavior handled inside the screen: a locked page shows the lock
 * notice, a missing page the missing notice) or the landing view. Chat click-events, the
 * client command and page anchors are staged to W4 with the rest of U22 (plan D10) and will
 * route through these same methods.
 */
public final class HandbookClientApi {
    private HandbookClientApi() {
    }

    /** Opens the handbook directly on {@code pageId} (landing view underneath, Esc pops). */
    public static void open(ResourceLocation pageId) {
        Minecraft.getInstance().setScreen(new HandbookScreen(pageId));
    }

    /** Opens the handbook landing view (categories + search + bookmark rail). */
    public static void openLanding() {
        Minecraft.getInstance().setScreen(new HandbookScreen());
    }
}
