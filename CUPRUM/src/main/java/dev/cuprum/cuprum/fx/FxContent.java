package dev.cuprum.cuprum.fx;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.block.FxProbeBlock;
import dev.cuprum.cuprum.blockentity.FxProbeBlockEntity;
import net.fabricmc.fabric.api.object.builder.v1.block.entity.FabricBlockEntityTypeBuilder;
import net.fabricmc.fabric.api.particle.v1.FabricParticleTypes;
import net.minecraft.core.Registry;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;

import java.util.function.Function;

/**
 * FX-module registry content (plan D4: module-owned {@code *Content} classes; the frozen
 * {@code CuprumBlocks}/{@code CuprumItems} stay charge_probe-only). Ids per the §3.4 ledger:
 * block/item/BE type {@code cuprum:fx_probe}, particle {@code cuprum:copper_mote}. Block/item
 * conventions mirror the Charge Probe ({@code setId} before construction,
 * {@code useBlockDescriptionPrefix}, orange copper properties).
 */
public final class FxContent {
    public static final Block FX_PROBE = registerBlock("fx_probe", FxProbeBlock::new,
            BlockBehaviour.Properties.of()
                    .mapColor(MapColor.COLOR_ORANGE)
                    .strength(1.5F)
                    .sound(SoundType.COPPER));

    public static final Item FX_PROBE_ITEM = registerBlockItem("fx_probe", FX_PROBE);

    public static final BlockEntityType<FxProbeBlockEntity> FX_PROBE_BLOCK_ENTITY =
            Registry.register(BuiltInRegistries.BLOCK_ENTITY_TYPE,
                    ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "fx_probe"),
                    FabricBlockEntityTypeBuilder.create(FxProbeBlockEntity::new, FX_PROBE).build());

    /** Sprite-based mote for the T2/T3 fallbacks; the factory registers client-side (§7). */
    public static final SimpleParticleType COPPER_MOTE = Registry.register(
            BuiltInRegistries.PARTICLE_TYPE,
            ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "copper_mote"),
            FabricParticleTypes.simple());

    private FxContent() {
    }

    private static Block registerBlock(String name, Function<BlockBehaviour.Properties, Block> factory,
            BlockBehaviour.Properties properties) {
        ResourceKey<Block> key = ResourceKey.create(Registries.BLOCK,
                ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, name));
        // Since 1.21.2 the block id must be set on the properties before construction.
        Block block = factory.apply(properties.setId(key));
        return Registry.register(BuiltInRegistries.BLOCK, key, block);
    }

    private static Item registerBlockItem(String name, Block block) {
        ResourceKey<Item> key = ResourceKey.create(Registries.ITEM,
                ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, name));
        Item item = new BlockItem(block, new Item.Properties().setId(key).useBlockDescriptionPrefix());
        return Registry.register(BuiltInRegistries.ITEM, key, item);
    }

    public static void init() {
        // Static initializers above perform the registration.
    }
}
