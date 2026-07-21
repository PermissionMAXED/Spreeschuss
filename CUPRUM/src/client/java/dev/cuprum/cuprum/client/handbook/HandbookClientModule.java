package dev.cuprum.cuprum.client.handbook;

import com.mojang.blaze3d.platform.InputConstants;
import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.handbook.net.HandbookRecipesPayload;
import dev.cuprum.cuprum.handbook.net.HandbookSyncPayload;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.resource.v1.ResourceLoader;
import net.fabricmc.fabric.api.resource.v1.reloader.ResourceReloaderKeys;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.server.packs.resources.ResourceManagerReloadListener;
import org.lwjgl.glfw.GLFW;

/**
 * Client handbook bootstrap (plan §5.1: last {@code CuprumClient.onInitializeClient()}
 * line). Owns:
 *
 * <ul>
 *   <li>the S2C sync/recipes receivers feeding {@link HandbookClientCache} (session-identity
 *       guarded like every Cuprum client module: a late payload from a dead connection can
 *       never resurrect cache state),</li>
 *   <li>the {@code key.cuprum.handbook} keybind (H, {@code KeyMapping.Category} — 1.21.9
 *       replaced string categories; the category must be registered before any mapping uses
 *       it) opening the last-read page, else the landing view,</li>
 *   <li>the {@code cuprum:handbook_search} CLIENT_RESOURCES reloader ordered after
 *       {@code minecraft:languages} (ledger §3.4) so a language/pack switch re-localizes the
 *       search index,</li>
 *   <li>DISCONNECT teardown: cache, search index and last-page cleared (bookmarks are
 *       per-world files and survive by design).</li>
 * </ul>
 */
public final class HandbookClientModule {
    public static final ResourceLocation SEARCH_RELOADER_ID =
            ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "handbook_search");

    /** Guards the active session identity + cache/index writes (same pattern as net/fx). */
    private static final Object HB_SESSION_LOCK = new Object();

    private static ClientPacketListener activeSession;
    private static volatile ResourceLocation lastPage;
    private static KeyMapping openHandbookKey;

    private HandbookClientModule() {
    }

    public static void init() {
        KeyMapping.Category category = KeyMapping.Category.register(
                ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, Cuprum.MOD_ID));
        openHandbookKey = KeyBindingHelper.registerKeyBinding(new KeyMapping(
                "key.cuprum.handbook", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_H, category));
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (openHandbookKey.consumeClick()) {
                if (client.player != null && client.screen == null) {
                    ResourceLocation target = lastPage;
                    client.setScreen(target != null && HandbookClientCache.snapshot()
                            .page(target).isPresent()
                            ? new HandbookScreen(target) : new HandbookScreen());
                }
            }
        });

        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            synchronized (HB_SESSION_LOCK) {
                clearSessionState();
                activeSession = handler;
            }
        });
        ClientPlayNetworking.registerGlobalReceiver(HandbookSyncPayload.TYPE, (payload, context) -> {
            synchronized (HB_SESSION_LOCK) {
                if (activeSession == null) {
                    return; // post-disconnect delivery; never resurrect a dead session's cache
                }
                HandbookClientCache.applySync(payload);
                HandbookSearchIndex.rebuild();
            }
            Cuprum.LOGGER.info("[handbook] client cache rebuilt: {} categories, {} pages (generation {})",
                    payload.categories().size(), payload.pages().size(),
                    HandbookClientCache.snapshot().generation());
        });
        ClientPlayNetworking.registerGlobalReceiver(HandbookRecipesPayload.TYPE, (payload, context) -> {
            synchronized (HB_SESSION_LOCK) {
                if (activeSession == null) {
                    return;
                }
                HandbookClientCache.applyRecipes(payload);
            }
        });
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
            // May run on a Netty event-loop thread; touches only mod-owned state (see
            // CuprumClientNet javadoc for why this must never defer via Minecraft.execute).
            synchronized (HB_SESSION_LOCK) {
                if (activeSession != null && activeSession != handler) {
                    return; // stale disconnect of an older connection
                }
                clearSessionState();
                activeSession = null;
            }
        });

        ResourceLoader resourceLoader = ResourceLoader.get(PackType.CLIENT_RESOURCES);
        resourceLoader.registerReloader(SEARCH_RELOADER_ID, new SearchReloadListener());
        resourceLoader.addReloaderOrdering(ResourceReloaderKeys.Client.LANGUAGES, SEARCH_RELOADER_ID);

        Cuprum.LOGGER.info("[handbook] client initialized (keybind {}, reloader {})",
                "key.cuprum.handbook", SEARCH_RELOADER_ID);
    }

    /** Caller must hold {@link #HB_SESSION_LOCK}; mod-owned state only (any-thread safe). */
    private static void clearSessionState() {
        HandbookClientCache.clear();
        HandbookSearchIndex.clear();
        lastPage = null;
    }

    /** The keybind reopens the last-read page (handbook-config.md §5). */
    static void rememberLastPage(ResourceLocation pageId) {
        lastPage = pageId;
    }

    /** Language or resource-pack switch ⇒ re-localize the search docs (runs after languages). */
    static final class SearchReloadListener implements ResourceManagerReloadListener {
        @Override
        public void onResourceManagerReload(ResourceManager resourceManager) {
            HandbookSearchIndex.rebuild();
        }
    }
}
