package dev.cuprum.cuprum.datagen;

import dev.cuprum.cuprum.CuprumBlocks;
import net.fabricmc.fabric.api.datagen.v1.FabricDataOutput;
import net.fabricmc.fabric.api.datagen.v1.provider.FabricLanguageProvider;
import net.minecraft.core.HolderLookup;

import java.util.concurrent.CompletableFuture;

public final class CuprumDeDeLanguageProvider extends FabricLanguageProvider {
    public CuprumDeDeLanguageProvider(FabricDataOutput dataOutput, CompletableFuture<HolderLookup.Provider> registryLookup) {
        super(dataOutput, "de_de", registryLookup);
    }

    @Override
    public void generateTranslations(HolderLookup.Provider registryLookup, TranslationBuilder translationBuilder) {
        translationBuilder.add(CuprumBlocks.CHARGE_PROBE, "Ladungssonde");
        translationBuilder.add("itemGroup.cuprum", "Cuprum");
    }
}
