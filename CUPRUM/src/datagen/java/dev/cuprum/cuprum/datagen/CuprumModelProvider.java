package dev.cuprum.cuprum.datagen;

import dev.cuprum.cuprum.CuprumBlocks;
import dev.cuprum.cuprum.machine.MachineContent;
import net.fabricmc.fabric.api.client.datagen.v1.provider.FabricModelProvider;
import net.fabricmc.fabric.api.datagen.v1.FabricDataOutput;
import net.minecraft.client.data.models.BlockModelGenerators;
import net.minecraft.client.data.models.ItemModelGenerators;

public final class CuprumModelProvider extends FabricModelProvider {
    public CuprumModelProvider(FabricDataOutput output) {
        super(output);
    }

    @Override
    public void generateBlockStateModels(BlockModelGenerators blockStateModelGenerator) {
        // Emits blockstate + cube_all block model and the delegating item model.
        blockStateModelGenerator.createTrivialCube(CuprumBlocks.CHARGE_PROBE);
        blockStateModelGenerator.createTrivialCube(MachineContent.DIAGNOSTIC_COIL_CORE);
        blockStateModelGenerator.createTrivialCube(MachineContent.DIAGNOSTIC_COIL_FRAME);
    }

    @Override
    public void generateItemModels(ItemModelGenerators itemModelGenerator) {
        // Charge probe item model is emitted alongside the block model.
    }
}
