package dev.cuprum.cuprum.machine;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.CuprumCreativeTabs;
import dev.cuprum.cuprum.multiblock.MultiblockLevelIndex;
import dev.cuprum.cuprum.multiblock.MultiblockPatterns;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerBlockEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerChunkEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerWorldEvents;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.fabricmc.fabric.api.resource.v1.ResourceLoader;
import net.minecraft.server.packs.PackType;

/**
 * Machine-module bootstrap (plan §5.1): called exactly once from {@code Cuprum.onInitialize()},
 * after {@code ChargeModule.init()}. Registers the module content ({@link MachineContent}),
 * appends the coil items to the Cuprum creative tab via the D4 event hook (the frozen
 * {@code CuprumCreativeTabs} is never edited), registers the {@code cuprum:multiblock_patterns}
 * SERVER_DATA reloader and wires the multiblock {@link MultiblockLevelIndex} lifecycle events
 * (multiblock.md §5.1).
 */
public final class MachineModule {
    private MachineModule() {
    }

    public static void init() {
        MachineContent.init();

        ItemGroupEvents.modifyEntriesEvent(CuprumCreativeTabs.CUPRUM_TAB_KEY).register(entries -> {
            entries.accept(MachineContent.DIAGNOSTIC_COIL_CORE_ITEM);
            entries.accept(MachineContent.DIAGNOSTIC_COIL_FRAME_ITEM);
        });

        ResourceLoader.get(PackType.SERVER_DATA)
                .registerReloader(MultiblockPatterns.RELOADER_ID, new MultiblockPatterns());

        ServerChunkEvents.CHUNK_LOAD.register(MultiblockLevelIndex::onChunkLoad);
        ServerChunkEvents.CHUNK_UNLOAD.register(MultiblockLevelIndex::onChunkUnload);
        ServerWorldEvents.UNLOAD.register(MultiblockLevelIndex::onWorldUnload);
        ServerLifecycleEvents.SERVER_STOPPED.register(MultiblockLevelIndex::onServerStopped);
        ServerBlockEntityEvents.BLOCK_ENTITY_LOAD.register(MultiblockLevelIndex::onBlockEntityLoad);
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.register(MultiblockLevelIndex::onBlockEntityUnload);

        Cuprum.LOGGER.info("[machine] multiblock and charge-machine layer initialized");
    }
}
