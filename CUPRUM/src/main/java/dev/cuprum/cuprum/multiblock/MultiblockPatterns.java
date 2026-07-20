package dev.cuprum.cuprum.multiblock;

import dev.cuprum.cuprum.Cuprum;
import java.util.Map;
import java.util.Optional;
import net.minecraft.resources.FileToIdConverter;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.server.packs.resources.SimpleJsonResourceReloadListener;
import net.minecraft.util.profiling.ProfilerFiller;

/**
 * The multiblock pattern reloader + static lookup (multiblock.md §4, id ledger
 * {@code cuprum:multiblock_patterns}). Registered on {@code PackType.SERVER_DATA} only — the
 * client never loads patterns; it renders synced BE state. Parsing runs off-thread (vanilla
 * prepare/apply split); {@link #apply} swaps one immutable map and bumps the generation so
 * controllers revalidate after {@code /reload}. The JVM-scoped static map is acceptable for W1
 * (one server per JVM in production and tests) and documented here.
 */
public final class MultiblockPatterns extends SimpleJsonResourceReloadListener<MultiblockPattern> {
    public static final ResourceLocation RELOADER_ID =
            ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "multiblock_patterns");
    public static final FileToIdConverter LISTER = FileToIdConverter.json("cuprum_multiblock");

    private static volatile Map<ResourceLocation, MultiblockPattern> loaded = Map.of();
    private static volatile int reloadGeneration;

    public MultiblockPatterns() {
        super(MultiblockPattern.CODEC, LISTER);
    }

    @Override
    protected void apply(Map<ResourceLocation, MultiblockPattern> patterns, ResourceManager resourceManager,
            ProfilerFiller profiler) {
        patterns.forEach((id, pattern) -> pattern.bindId(id));
        loaded = Map.copyOf(patterns);
        reloadGeneration++;
        Cuprum.LOGGER.info("[multiblock] loaded {} pattern(s), reload generation {}",
                loaded.size(), reloadGeneration);
    }

    public static Optional<MultiblockPattern> get(ResourceLocation id) {
        return Optional.ofNullable(loaded.get(id));
    }

    /** Bumped on every {@link #apply}; controllers revalidate when it changes. */
    public static int reloadGeneration() {
        return reloadGeneration;
    }

    public static int loadedCount() {
        return loaded.size();
    }
}
