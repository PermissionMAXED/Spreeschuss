package dev.cuprum.cuprum.handbook;

import com.google.gson.JsonElement;
import com.mojang.serialization.JsonOps;
import dev.cuprum.cuprum.Cuprum;
import java.io.Reader;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import net.minecraft.resources.FileToIdConverter;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.server.packs.resources.SimpleJsonResourceReloadListener;
import net.minecraft.server.packs.resources.SimplePreparableReloadListener;
import net.minecraft.util.StrictJsonParser;
import net.minecraft.util.profiling.ProfilerFiller;

/**
 * The single handbook server-data reloader + static store (id ledger {@code cuprum:handbook},
 * SERVER_DATA only). One reloader covers both directories — categories
 * ({@code data/cuprum/handbook/categories/}) and pages ({@code data/cuprum/handbook/pages/})
 * — plus the reviewed {@code handbook/exempt.json} completeness exemption list (asserted
 * empty in W1, plan D6).
 *
 * <p>Parsing reuses the vanilla {@code SimpleJsonResourceReloadListener.scanDirectory}
 * per-file isolation: a malformed file is logged and skipped, the server never crashes.
 * {@link #link} then applies the cross-file validation (JSON id = file id, category refs
 * resolve) with the same skip-and-log policy, and produces the deterministic registry order
 * (category sort/id, then page id — never filesystem or parse order). {@code /reload}
 * re-parses; {@code HandbookModule} re-syncs after the reload completes.
 *
 * <p>The JVM-scoped static store mirrors {@code MultiblockPatterns} (one server per JVM in
 * production and tests, documented there).
 */
public final class HandbookManager extends SimplePreparableReloadListener<HandbookManager.Prepared> {
    public static final ResourceLocation RELOADER_ID =
            ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "handbook");
    public static final FileToIdConverter CATEGORY_LISTER = FileToIdConverter.json("handbook/categories");
    public static final FileToIdConverter PAGE_LISTER = FileToIdConverter.json("handbook/pages");
    public static final ResourceLocation EXEMPT_FILE =
            ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "handbook/exempt.json");

    /** Raw per-file parse results (off-thread half of the vanilla prepare/apply split). */
    public record Prepared(
            Map<ResourceLocation, HandbookCategory> categories,
            Map<ResourceLocation, HandbookPage> pages,
            Set<ResourceLocation> exempt) {
    }

    /** The immutable linked store: deterministic order, cross-refs validated. */
    public record Loaded(
            List<HandbookCategory> categories,
            Map<ResourceLocation, HandbookPage> pages,
            Set<ResourceLocation> exempt,
            int skippedFiles) {

        public Optional<HandbookPage> page(ResourceLocation id) {
            return Optional.ofNullable(pages.get(id));
        }

        public List<HandbookPage> pagesIn(ResourceLocation categoryId) {
            return pages.values().stream()
                    .filter(page -> page.category().equals(categoryId))
                    .toList();
        }

        /** Every subject id documented by some page (completeness gate input). */
        public Set<ResourceLocation> documentedSubjects() {
            TreeSet<ResourceLocation> subjects = new TreeSet<>();
            pages.values().forEach(page -> subjects.addAll(page.subjects()));
            return subjects;
        }
    }

    public static final Loaded EMPTY = new Loaded(List.of(), Map.of(), Set.of(), 0);

    private static volatile Loaded loaded = EMPTY;
    private static volatile int reloadGeneration;

    @Override
    protected Prepared prepare(ResourceManager resourceManager, ProfilerFiller profiler) {
        Map<ResourceLocation, HandbookCategory> categories = new HashMap<>();
        SimpleJsonResourceReloadListener.scanDirectory(
                resourceManager, CATEGORY_LISTER, JsonOps.INSTANCE, HandbookCategory.CODEC, categories);
        Map<ResourceLocation, HandbookPage> pages = new HashMap<>();
        SimpleJsonResourceReloadListener.scanDirectory(
                resourceManager, PAGE_LISTER, JsonOps.INSTANCE, HandbookPage.CODEC, pages);
        return new Prepared(categories, pages, readExempt(resourceManager));
    }

    @Override
    protected void apply(Prepared prepared, ResourceManager resourceManager, ProfilerFiller profiler) {
        loaded = link(prepared.categories(), prepared.pages(), prepared.exempt());
        reloadGeneration++;
        Cuprum.LOGGER.info(
                "[handbook] loaded {} category(ies), {} page(s), {} exempt id(s), {} skipped, generation {}",
                loaded.categories().size(), loaded.pages().size(), loaded.exempt().size(),
                loaded.skippedFiles(), reloadGeneration);
    }

    /**
     * Pure link step, shared with the malformed-data GameTests: validates JSON id = file id
     * and category refs, then produces the deterministic order. Bad entries are skipped and
     * logged (never a crash), mirroring the per-file isolation of the parse step.
     */
    public static Loaded link(
            Map<ResourceLocation, HandbookCategory> rawCategories,
            Map<ResourceLocation, HandbookPage> rawPages,
            Set<ResourceLocation> exempt) {
        int skipped = 0;

        Map<ResourceLocation, HandbookCategory> categoriesById = new TreeMap<>();
        for (Map.Entry<ResourceLocation, HandbookCategory> entry : new TreeMap<>(rawCategories).entrySet()) {
            if (!entry.getKey().equals(entry.getValue().id())) {
                Cuprum.LOGGER.error("[handbook] category file {} declares mismatched id {}; skipped",
                        entry.getKey(), entry.getValue().id());
                skipped++;
                continue;
            }
            categoriesById.put(entry.getKey(), entry.getValue());
        }

        List<HandbookCategory> categories = new ArrayList<>(categoriesById.values());
        categories.sort(HandbookCategory.ORDER);

        Map<ResourceLocation, Integer> categoryOrder = new HashMap<>();
        for (int i = 0; i < categories.size(); i++) {
            categoryOrder.put(categories.get(i).id(), i);
        }

        List<HandbookPage> pages = new ArrayList<>();
        for (Map.Entry<ResourceLocation, HandbookPage> entry : new TreeMap<>(rawPages).entrySet()) {
            HandbookPage page = entry.getValue();
            if (!entry.getKey().equals(page.id())) {
                Cuprum.LOGGER.error("[handbook] page file {} declares mismatched id {}; skipped",
                        entry.getKey(), page.id());
                skipped++;
                continue;
            }
            if (!categoryOrder.containsKey(page.category())) {
                Cuprum.LOGGER.error("[handbook] page {} references unknown category {}; skipped",
                        page.id(), page.category());
                skipped++;
                continue;
            }
            pages.add(page);
        }
        pages.sort(Comparator
                .comparingInt((HandbookPage page) -> categoryOrder.get(page.category()))
                .thenComparing(HandbookPage::id));

        Map<ResourceLocation, HandbookPage> orderedPages = new LinkedHashMap<>();
        pages.forEach(page -> orderedPages.put(page.id(), page));

        return new Loaded(
                List.copyOf(categories),
                java.util.Collections.unmodifiableMap(orderedPages),
                java.util.Collections.unmodifiableSet(new TreeSet<>(exempt)),
                skipped);
    }

    /** The reviewed completeness exemption list; missing or malformed ⇒ empty + one log line. */
    private static Set<ResourceLocation> readExempt(ResourceManager resourceManager) {
        Optional<Resource> resource = resourceManager.getResource(EXEMPT_FILE);
        if (resource.isEmpty()) {
            Cuprum.LOGGER.warn("[handbook] {} is missing; completeness exemptions default to none", EXEMPT_FILE);
            return Set.of();
        }
        try (Reader reader = resource.get().openAsReader()) {
            JsonElement json = StrictJsonParser.parse(reader);
            return ResourceLocation.CODEC.listOf().parse(JsonOps.INSTANCE, json)
                    .map(list -> (Set<ResourceLocation>) new TreeSet<>(list))
                    .resultOrPartial(error -> Cuprum.LOGGER.error(
                            "[handbook] malformed {}: {}; completeness exemptions default to none",
                            EXEMPT_FILE, error))
                    .orElse(Set.of());
        } catch (Exception e) {
            Cuprum.LOGGER.error("[handbook] failed to read {}; completeness exemptions default to none",
                    EXEMPT_FILE, e);
            return Set.of();
        }
    }

    /** The current linked store (server side; clients use the synced cache instead). */
    public static Loaded loaded() {
        return loaded;
    }

    /** Bumped on every {@link #apply}; {@code HandbookModule} logs it with each resync. */
    public static int reloadGeneration() {
        return reloadGeneration;
    }
}
