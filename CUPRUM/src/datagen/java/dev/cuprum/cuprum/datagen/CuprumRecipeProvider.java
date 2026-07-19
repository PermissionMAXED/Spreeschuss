package dev.cuprum.cuprum.datagen;

import dev.cuprum.cuprum.CuprumItems;
import net.fabricmc.fabric.api.datagen.v1.FabricDataOutput;
import net.fabricmc.fabric.api.datagen.v1.provider.FabricRecipeProvider;
import net.minecraft.core.HolderLookup;
import net.minecraft.data.recipes.RecipeCategory;
import net.minecraft.data.recipes.RecipeOutput;
import net.minecraft.data.recipes.RecipeProvider;
import net.minecraft.world.item.Items;

import java.util.concurrent.CompletableFuture;

public final class CuprumRecipeProvider extends FabricRecipeProvider {
    public CuprumRecipeProvider(FabricDataOutput output, CompletableFuture<HolderLookup.Provider> registriesFuture) {
        super(output, registriesFuture);
    }

    @Override
    protected RecipeProvider createRecipeProvider(HolderLookup.Provider registryLookup, RecipeOutput exporter) {
        return new RecipeProvider(registryLookup, exporter) {
            @Override
            public void buildRecipes() {
                shaped(RecipeCategory.REDSTONE, CuprumItems.CHARGE_PROBE)
                        .pattern("cCc")
                        .pattern("CrC")
                        .pattern("cCc")
                        .define('C', Items.COPPER_INGOT)
                        .define('c', Items.COPPER_NUGGET)
                        .define('r', Items.REDSTONE)
                        .unlockedBy(getHasName(Items.COPPER_INGOT), has(Items.COPPER_INGOT))
                        .save(this.output);
            }
        };
    }

    @Override
    public String getName() {
        return "CuprumRecipeProvider";
    }
}
