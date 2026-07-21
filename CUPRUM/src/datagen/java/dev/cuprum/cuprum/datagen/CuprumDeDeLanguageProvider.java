package dev.cuprum.cuprum.datagen;

import dev.cuprum.cuprum.CuprumBlocks;
import dev.cuprum.cuprum.fx.FxContent;
import dev.cuprum.cuprum.machine.MachineContent;
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
        translationBuilder.add(MachineContent.DIAGNOSTIC_COIL_CORE, "Diagnosespulenkern");
        translationBuilder.add(MachineContent.DIAGNOSTIC_COIL_FRAME, "Diagnosespulenrahmen");
        translationBuilder.add("container.cuprum.charge_machine", "Lademaschine");
        translationBuilder.add("cuprum.formation.formed", "Geformt");
        translationBuilder.add("cuprum.formation.unformed", "Ungeformt");
        translationBuilder.add("cuprum.formation.fault", "Störung");
        translationBuilder.add("cuprum.charge.readout", "%s / %s Cg");
        translationBuilder.add(FxContent.FX_PROBE, "FX-Sonde");
    }
}
