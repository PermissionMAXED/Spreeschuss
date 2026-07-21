package dev.cuprum.cuprum.client.handbook;

import dev.cuprum.cuprum.handbook.HandbookPage;
import dev.cuprum.cuprum.handbook.HandbookSearchCore;
import dev.cuprum.cuprum.handbook.HandbookWidget;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.resources.language.I18n;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;

/**
 * The client search index (handbook-config.md §5): localized docs (title, {@code subject}
 * item names, {@code text} widget strings, {@code search_extra_keys}) over the synced page
 * cache; ranking/folding/tokenizing live in the MC-free {@link HandbookSearchCore} (JUnit-
 * pinned). Rebuilt on every applied sync payload and after the {@code minecraft:languages}
 * client reload ({@code cuprum:handbook_search} reloader) — language switches re-localize
 * every doc. W1 builds synchronously on the client thread (3 tiny pages); the off-thread
 * build is staged to W4 with the rest of U22 (plan D10).
 */
public final class HandbookSearchIndex {
    private static volatile List<HandbookSearchCore.Doc> docs = List.of();

    private HandbookSearchIndex() {
    }

    /** Rebuilds all docs from the current cache snapshot + current language (client thread). */
    public static void rebuild() {
        HandbookClientCache.Snapshot snapshot = HandbookClientCache.snapshot();
        List<HandbookSearchCore.Doc> built = new ArrayList<>(snapshot.pages().size());
        for (HandbookPage page : snapshot.pages().values()) {
            built.add(new HandbookSearchCore.Doc(
                    page.id().toString(),
                    I18n.get(page.titleKey()),
                    subjectNames(page),
                    bodyStrings(page)));
        }
        docs = List.copyOf(built);
    }

    public static void clear() {
        docs = List.of();
    }

    /** Ranked page-id hits for {@code query}; empty for blank queries (UI shows full listing). */
    public static List<ResourceLocation> search(String query) {
        List<ResourceLocation> ids = new ArrayList<>();
        for (HandbookSearchCore.Hit hit : HandbookSearchCore.search(docs, query)) {
            ResourceLocation id = ResourceLocation.tryParse(hit.id());
            if (id != null) {
                ids.add(id);
            }
        }
        return List.copyOf(ids);
    }

    /** Localized display names of the page's documented registry ids (items win over raw paths). */
    private static List<String> subjectNames(HandbookPage page) {
        List<String> names = new ArrayList<>(page.subjects().size());
        for (ResourceLocation subject : page.subjects()) {
            names.add(BuiltInRegistries.ITEM.getOptional(subject)
                    .map(Item::getDefaultInstance)
                    .map(stack -> stack.getHoverName().getString())
                    .orElse(subject.getPath()));
        }
        return names;
    }

    private static List<String> bodyStrings(HandbookPage page) {
        List<String> body = new ArrayList<>();
        for (HandbookWidget widget : page.widgets()) {
            if (widget instanceof HandbookWidget.Text text) {
                body.add(I18n.get(text.key()));
            }
        }
        body.addAll(page.searchExtraKeys());
        return body;
    }
}
