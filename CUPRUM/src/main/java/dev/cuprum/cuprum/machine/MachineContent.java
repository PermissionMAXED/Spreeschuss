package dev.cuprum.cuprum.machine;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.block.DiagnosticCoilCoreBlock;
import dev.cuprum.cuprum.block.DiagnosticCoilCoreBlockEntity;
import dev.cuprum.cuprum.block.DiagnosticCoilFrameBlock;
import dev.cuprum.cuprum.charge.ChargeApi;
import net.fabricmc.fabric.api.object.builder.v1.block.entity.FabricBlockEntityTypeBuilder;
import net.fabricmc.fabric.api.screenhandler.v1.ExtendedScreenHandlerType;
import net.minecraft.core.Registry;
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
 * Machine-module registry content (plan D4: module-owned {@code *Content} classes; the frozen
 * {@code CuprumBlocks}/{@code CuprumItems} stay charge_probe-only). Ids per the §3.4 ledger:
 * blocks/items {@code cuprum:diagnostic_coil_core} + {@code cuprum:diagnostic_coil_frame}, BE
 * type {@code cuprum:diagnostic_coil_core}, menu {@code cuprum:charge_machine}. Block/item
 * conventions mirror the Charge Probe ({@code setId} before construction,
 * {@code useBlockDescriptionPrefix}, orange copper properties).
 */
public final class MachineContent {
    public static final Block DIAGNOSTIC_COIL_CORE = registerBlock("diagnostic_coil_core",
            DiagnosticCoilCoreBlock::new, coilProperties());
    public static final Block DIAGNOSTIC_COIL_FRAME = registerBlock("diagnostic_coil_frame",
            DiagnosticCoilFrameBlock::new, coilProperties());

    public static final Item DIAGNOSTIC_COIL_CORE_ITEM =
            registerBlockItem("diagnostic_coil_core", DIAGNOSTIC_COIL_CORE);
    public static final Item DIAGNOSTIC_COIL_FRAME_ITEM =
            registerBlockItem("diagnostic_coil_frame", DIAGNOSTIC_COIL_FRAME);

    public static final BlockEntityType<DiagnosticCoilCoreBlockEntity> DIAGNOSTIC_COIL_CORE_BLOCK_ENTITY =
            Registry.register(BuiltInRegistries.BLOCK_ENTITY_TYPE,
                    ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "diagnostic_coil_core"),
                    FabricBlockEntityTypeBuilder.create(DiagnosticCoilCoreBlockEntity::new,
                            DIAGNOSTIC_COIL_CORE).build());

    public static final ExtendedScreenHandlerType<ChargeMachineMenu, ChargeMachineOpenData> CHARGE_MACHINE_MENU =
            Registry.register(BuiltInRegistries.MENU,
                    ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "charge_machine"),
                    new ExtendedScreenHandlerType<>(ChargeMachineMenu::new, ChargeMachineOpenData.STREAM_CODEC));

    private MachineContent() {
    }

    private static BlockBehaviour.Properties coilProperties() {
        return BlockBehaviour.Properties.of()
                .mapColor(MapColor.COLOR_ORANGE)
                .strength(1.5F)
                .sound(SoundType.COPPER);
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
        // Static initializers above perform the registration. D7 cross-module proof: the coil
        // core registers as a ChargeApi.NODE storage so the Charge Probe reports it.
        ChargeApi.NODE.registerForBlockEntity(
                (blockEntity, side) -> blockEntity.canConnect(side) ? blockEntity : null,
                DIAGNOSTIC_COIL_CORE_BLOCK_ENTITY);
    }
}
