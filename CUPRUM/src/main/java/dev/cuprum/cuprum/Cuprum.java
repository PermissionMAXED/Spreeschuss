package dev.cuprum.cuprum;

import dev.cuprum.cuprum.config.CuprumConfigs;
import dev.cuprum.cuprum.net.CuprumNet;
import dev.cuprum.cuprum.state.StateProbe;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class Cuprum implements ModInitializer {
    public static final String MOD_ID = "cuprum";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        // Bootstrap order is binding (FOUNDATION_PLAN §5.1); each W1 phase appends its line(s).
        CuprumConfigs.init();
        CuprumNet.init();
        CuprumBlocks.init();
        CuprumItems.init();
        CuprumCreativeTabs.init();
        StateProbe.init();
        LOGGER.info("Cuprum {} initialized; catalog {} entries, sha256={}", version(), CuprumCatalog.ENTRY_COUNT, CuprumCatalog.CATALOG_SHA256);
    }

    public static String version() {
        return FabricLoader.getInstance()
                .getModContainer(MOD_ID)
                .map(container -> container.getMetadata().getVersion().getFriendlyString())
                .orElse("unknown");
    }
}
