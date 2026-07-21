package dev.cuprum.cuprum.client.handbook;

import dev.cuprum.cuprum.handbook.HandbookCategory;
import dev.cuprum.cuprum.handbook.HandbookPage;
import dev.cuprum.cuprum.handbook.net.HandbookRecipesPayload;
import dev.cuprum.cuprum.handbook.net.HandbookSyncPayload;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.crafting.display.RecipeDisplay;

/**
 * The client's only source of handbook content (handbook-config.md §4): rebuilt wholesale
 * from each {@code cuprum:s2c/handbook/sync} + {@code /recipes} payload pair and cleared on
 * DISCONNECT — the client never reads handbook JSON from disk, so client and server can
 * never disagree on content. Immutable {@link Snapshot} swaps keep reads (render thread)
 * trivially safe; writes happen only on the client thread via {@code HandbookClientModule}'s
 * session-guarded receivers.
 *
 * <p>{@link Snapshot#generation()} increments per applied sync so the open screen can detect
 * a reload underneath it (late-join/reload/missing-page behavior: the screen re-resolves its
 * current page and shows the localized missing-page notice when the page vanished).
 */
public final class HandbookClientCache {
    /** One immutable synced content set; {@code EMPTY} between sessions. */
    public record Snapshot(
            int generation,
            List<HandbookCategory> categories,
            Map<ResourceLocation, HandbookPage> pages,
            Map<ResourceLocation, RecipeDisplay> recipes) {

        public Optional<HandbookPage> page(ResourceLocation id) {
            return Optional.ofNullable(pages.get(id));
        }

        public List<HandbookPage> pagesIn(ResourceLocation categoryId) {
            return pages.values().stream()
                    .filter(page -> page.category().equals(categoryId))
                    .toList();
        }

        public Optional<RecipeDisplay> recipe(ResourceLocation recipeId) {
            return Optional.ofNullable(recipes.get(recipeId));
        }
    }

    public static final Snapshot EMPTY = new Snapshot(0, List.of(), Map.of(), Map.of());

    private static volatile Snapshot snapshot = EMPTY;

    private HandbookClientCache() {
    }

    public static Snapshot snapshot() {
        return snapshot;
    }

    /** Applies a full sync snapshot (client thread; payload decode already re-validated bounds). */
    public static void applySync(HandbookSyncPayload payload) {
        Snapshot current = snapshot;
        Map<ResourceLocation, HandbookPage> pages = new LinkedHashMap<>();
        payload.pages().forEach(page -> pages.put(page.id(), page));
        snapshot = new Snapshot(
                current.generation() + 1,
                List.copyOf(payload.categories()),
                java.util.Collections.unmodifiableMap(pages),
                current.recipes());
    }

    /** Applies the recipe-display map sent beside each sync (client thread). */
    public static void applyRecipes(HandbookRecipesPayload payload) {
        Snapshot current = snapshot;
        snapshot = new Snapshot(
                current.generation(),
                current.categories(),
                current.pages(),
                payload.displays());
    }

    /** Session teardown: back to the empty pre-join state (DISCONNECT, any thread). */
    public static void clear() {
        snapshot = EMPTY;
    }
}
