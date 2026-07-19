package dev.cuprum.cuprum.datagen;

import dev.cuprum.cuprum.Cuprum;
import net.fabricmc.fabric.api.datagen.v1.DataGeneratorEntrypoint;
import net.fabricmc.fabric.api.datagen.v1.FabricDataGenerator;

public final class CuprumDatagen implements DataGeneratorEntrypoint {
    @Override
    public String getEffectiveModId() {
        // Emit assets/data into the cuprum namespace instead of cuprum-datagen.
        return Cuprum.MOD_ID;
    }

    @Override
    public void onInitializeDataGenerator(FabricDataGenerator generator) {
        FabricDataGenerator.Pack pack = generator.createPack();
        pack.addProvider(CuprumModelProvider::new);
        pack.addProvider(CuprumBlockLootTableProvider::new);
        pack.addProvider(CuprumRecipeProvider::new);
        pack.addProvider(CuprumBlockTagProvider::new);
        pack.addProvider(CuprumEnUsLanguageProvider::new);
        pack.addProvider(CuprumDeDeLanguageProvider::new);
    }
}
