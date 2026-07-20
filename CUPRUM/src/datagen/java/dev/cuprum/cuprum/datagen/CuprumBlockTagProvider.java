package dev.cuprum.cuprum.datagen;

import dev.cuprum.cuprum.CuprumBlocks;
import dev.cuprum.cuprum.machine.MachineContent;
import net.fabricmc.fabric.api.datagen.v1.FabricDataOutput;
import net.fabricmc.fabric.api.datagen.v1.provider.FabricTagProvider;
import net.minecraft.core.HolderLookup;
import net.minecraft.tags.BlockTags;

import java.util.concurrent.CompletableFuture;

public final class CuprumBlockTagProvider extends FabricTagProvider.BlockTagProvider {
    public CuprumBlockTagProvider(FabricDataOutput output, CompletableFuture<HolderLookup.Provider> registriesFuture) {
        super(output, registriesFuture);
    }

    @Override
    protected void addTags(HolderLookup.Provider wrapperLookup) {
        valueLookupBuilder(BlockTags.MINEABLE_WITH_PICKAXE)
                .add(CuprumBlocks.CHARGE_PROBE)
                .add(MachineContent.DIAGNOSTIC_COIL_CORE)
                .add(MachineContent.DIAGNOSTIC_COIL_FRAME);
    }
}
