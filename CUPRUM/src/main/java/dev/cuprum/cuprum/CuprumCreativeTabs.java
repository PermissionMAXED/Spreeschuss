package dev.cuprum.cuprum;

import net.fabricmc.fabric.api.itemgroup.v1.FabricItemGroup;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.ItemStack;

public final class CuprumCreativeTabs {
    public static final ResourceKey<CreativeModeTab> CUPRUM_TAB_KEY =
            ResourceKey.create(Registries.CREATIVE_MODE_TAB, ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "cuprum"));

    public static final CreativeModeTab CUPRUM_TAB = FabricItemGroup.builder()
            .title(Component.translatable("itemGroup.cuprum"))
            .icon(() -> new ItemStack(CuprumItems.CHARGE_PROBE))
            .displayItems((parameters, output) -> output.accept(CuprumItems.CHARGE_PROBE))
            .build();

    private CuprumCreativeTabs() {
    }

    public static void init() {
        Registry.register(BuiltInRegistries.CREATIVE_MODE_TAB, CUPRUM_TAB_KEY, CUPRUM_TAB);
    }
}
