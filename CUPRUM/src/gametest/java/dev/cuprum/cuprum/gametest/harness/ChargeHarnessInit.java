package dev.cuprum.cuprum.gametest.harness;

import dev.cuprum.cuprum.charge.ChargeApi;
import dev.cuprum.cuprum.charge.core.ChargePriority;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.object.builder.v1.block.entity.FabricBlockEntityTypeBuilder;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockBehaviour;

/**
 * Charge-graph gametest harness (plan §4-W1B): registers the settable
 * source/cell/sink/relay node blocks + block entities in the {@code cuprum-gametest} namespace
 * — never shipped, no assets/items/recipes — and exposes them to the graph through the exact
 * production pattern: {@code ChargeApi.NODE.registerForBlockEntity((be, side) ->
 * be.canConnect(side) ? be : null, TYPE)} (charge.md §2b [PROBE-1]).
 */
public final class ChargeHarnessInit implements ModInitializer {
    public static final String NAMESPACE = "cuprum-gametest";

    public static Block CELL_BLOCK;
    public static Block SOURCE_BLOCK;
    public static Block SINK_DEFENSE_BLOCK;
    public static Block SINK_MISC_BLOCK;
    public static Block RELAY_BLOCK;

    public static BlockEntityType<HarnessCellBlockEntity> CELL_BLOCK_ENTITY;
    public static BlockEntityType<HarnessSourceBlockEntity> SOURCE_BLOCK_ENTITY;
    public static BlockEntityType<HarnessSinkBlockEntity> SINK_BLOCK_ENTITY;
    public static BlockEntityType<HarnessRelayBlockEntity> RELAY_BLOCK_ENTITY;

    @Override
    public void onInitialize() {
        CELL_BLOCK = registerBlock("harness_cell", HarnessCellBlockEntity::new);
        SOURCE_BLOCK = registerBlock("harness_source", HarnessSourceBlockEntity::new);
        SINK_DEFENSE_BLOCK = registerBlock("harness_sink_defense",
                (pos, state) -> new HarnessSinkBlockEntity(pos, state, ChargePriority.DEFENSE));
        SINK_MISC_BLOCK = registerBlock("harness_sink_misc",
                (pos, state) -> new HarnessSinkBlockEntity(pos, state, ChargePriority.MISC));
        RELAY_BLOCK = registerBlock("harness_relay", HarnessRelayBlockEntity::new);

        CELL_BLOCK_ENTITY = registerBlockEntity("harness_cell",
                FabricBlockEntityTypeBuilder.create(HarnessCellBlockEntity::new, CELL_BLOCK).build());
        SOURCE_BLOCK_ENTITY = registerBlockEntity("harness_source",
                FabricBlockEntityTypeBuilder.create(HarnessSourceBlockEntity::new, SOURCE_BLOCK).build());
        SINK_BLOCK_ENTITY = registerBlockEntity("harness_sink",
                FabricBlockEntityTypeBuilder.create(
                        (pos, state) -> new HarnessSinkBlockEntity(pos, state, ChargePriority.MISC),
                        SINK_DEFENSE_BLOCK, SINK_MISC_BLOCK).build());
        RELAY_BLOCK_ENTITY = registerBlockEntity("harness_relay",
                FabricBlockEntityTypeBuilder.create(HarnessRelayBlockEntity::new, RELAY_BLOCK).build());

        // The production node-registration pattern (charge.md §2b): side-gated self provider.
        ChargeApi.NODE.registerForBlockEntity(
                (blockEntity, side) -> blockEntity.canConnect(side) ? blockEntity : null, CELL_BLOCK_ENTITY);
        ChargeApi.NODE.registerForBlockEntity(
                (blockEntity, side) -> blockEntity.canConnect(side) ? blockEntity : null, SOURCE_BLOCK_ENTITY);
        ChargeApi.NODE.registerForBlockEntity(
                (blockEntity, side) -> blockEntity.canConnect(side) ? blockEntity : null, SINK_BLOCK_ENTITY);
        ChargeApi.NODE.registerForBlockEntity(
                (blockEntity, side) -> blockEntity.canConnect(side) ? blockEntity : null, RELAY_BLOCK_ENTITY);
    }

    private static Block registerBlock(String name, HarnessNodeBlock.Factory factory) {
        ResourceKey<Block> key = ResourceKey.create(Registries.BLOCK,
                ResourceLocation.fromNamespaceAndPath(NAMESPACE, name));
        Block block = new HarnessNodeBlock(
                BlockBehaviour.Properties.of().strength(0.5F).setId(key), factory);
        return Registry.register(BuiltInRegistries.BLOCK, key, block);
    }

    private static <T extends BlockEntityType<?>> T registerBlockEntity(String name, T type) {
        return Registry.register(BuiltInRegistries.BLOCK_ENTITY_TYPE,
                ResourceLocation.fromNamespaceAndPath(NAMESPACE, name), type);
    }
}
