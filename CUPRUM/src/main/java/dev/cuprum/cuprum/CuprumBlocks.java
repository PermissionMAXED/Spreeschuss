package dev.cuprum.cuprum;

import dev.cuprum.cuprum.block.ChargeProbeBlock;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;

import java.util.function.Function;

public final class CuprumBlocks {
    public static final Block CHARGE_PROBE = register("charge_probe", ChargeProbeBlock::new,
            BlockBehaviour.Properties.of()
                    .mapColor(MapColor.COLOR_ORANGE)
                    .strength(1.5F)
                    .sound(SoundType.COPPER));

    private CuprumBlocks() {
    }

    private static Block register(String name, Function<BlockBehaviour.Properties, Block> factory, BlockBehaviour.Properties properties) {
        ResourceKey<Block> key = ResourceKey.create(Registries.BLOCK, ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, name));
        // Since 1.21.2 the block id must be set on the properties before construction.
        Block block = factory.apply(properties.setId(key));
        return Registry.register(BuiltInRegistries.BLOCK, key, block);
    }

    public static void init() {
        // Static initializers above perform the registration.
    }
}
