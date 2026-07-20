package dev.cuprum.cuprum.datagen;

import dev.cuprum.cuprum.CuprumBlocks;
import dev.cuprum.cuprum.machine.MachineContent;
import net.fabricmc.fabric.api.datagen.v1.FabricDataOutput;
import net.fabricmc.fabric.api.datagen.v1.provider.FabricLanguageProvider;
import net.minecraft.core.HolderLookup;

import java.util.concurrent.CompletableFuture;

public final class CuprumEnUsLanguageProvider extends FabricLanguageProvider {
    public CuprumEnUsLanguageProvider(FabricDataOutput dataOutput, CompletableFuture<HolderLookup.Provider> registryLookup) {
        super(dataOutput, "en_us", registryLookup);
    }

    @Override
    public void generateTranslations(HolderLookup.Provider registryLookup, TranslationBuilder translationBuilder) {
        translationBuilder.add(CuprumBlocks.CHARGE_PROBE, "Charge Probe");
        translationBuilder.add("itemGroup.cuprum", "Cuprum");
        translationBuilder.add(MachineContent.DIAGNOSTIC_COIL_CORE, "Diagnostic Coil Core");
        translationBuilder.add(MachineContent.DIAGNOSTIC_COIL_FRAME, "Diagnostic Coil Frame");
        translationBuilder.add("container.cuprum.charge_machine", "Charge Machine");
        translationBuilder.add("cuprum.formation.formed", "Formed");
        translationBuilder.add("cuprum.formation.unformed", "Unformed");
        translationBuilder.add("cuprum.formation.fault", "Fault");
        translationBuilder.add("cuprum.charge.readout", "%s / %s Cg");
    }
}
