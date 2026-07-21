package dev.cuprum.cuprum.datagen;

import dev.cuprum.cuprum.CuprumBlocks;
import dev.cuprum.cuprum.fx.FxContent;
import dev.cuprum.cuprum.machine.MachineContent;
import net.fabricmc.fabric.api.datagen.v1.FabricDataOutput;
import net.fabricmc.fabric.api.datagen.v1.provider.FabricBlockLootTableProvider;
import net.minecraft.core.HolderLookup;

import java.util.concurrent.CompletableFuture;

public final class CuprumBlockLootTableProvider extends FabricBlockLootTableProvider {
    public CuprumBlockLootTableProvider(FabricDataOutput dataOutput, CompletableFuture<HolderLookup.Provider> registryLookup) {
        super(dataOutput, registryLookup);
    }

    @Override
    public void generate() {
        dropSelf(CuprumBlocks.CHARGE_PROBE);
        dropSelf(MachineContent.DIAGNOSTIC_COIL_CORE);
        dropSelf(MachineContent.DIAGNOSTIC_COIL_FRAME);
        dropSelf(FxContent.FX_PROBE);
    }
}
