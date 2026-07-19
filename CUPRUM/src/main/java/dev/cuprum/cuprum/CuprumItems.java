package dev.cuprum.cuprum;

import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;

public final class CuprumItems {
    public static final Item CHARGE_PROBE = registerBlockItem("charge_probe", CuprumBlocks.CHARGE_PROBE);

    private CuprumItems() {
    }

    private static Item registerBlockItem(String name, Block block) {
        ResourceKey<Item> key = ResourceKey.create(Registries.ITEM, ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, name));
        // Since 1.21.2 the item id must be set on the properties; useBlockDescriptionPrefix()
        // gives the BlockItem its block.<ns>.<path> translation key.
        Item item = new BlockItem(block, new Item.Properties().setId(key).useBlockDescriptionPrefix());
        return Registry.register(BuiltInRegistries.ITEM, key, item);
    }

    public static void init() {
        // Static initializers above perform the registration.
    }
}
