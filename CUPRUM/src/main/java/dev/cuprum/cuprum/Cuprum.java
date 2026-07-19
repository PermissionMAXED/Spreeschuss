package dev.cuprum.cuprum;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class Cuprum implements ModInitializer {
    public static final String MOD_ID = "cuprum";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        CuprumBlocks.init();
        CuprumItems.init();
        CuprumCreativeTabs.init();
        LOGGER.info("Cuprum {} initialized; catalog {} entries, sha256={}", version(), CuprumCatalog.ENTRY_COUNT, CuprumCatalog.CATALOG_SHA256);
    }

    public static String version() {
        return FabricLoader.getInstance()
                .getModContainer(MOD_ID)
                .map(container -> container.getMetadata().getVersion().getFriendlyString())
                .orElse("unknown");
    }
}
