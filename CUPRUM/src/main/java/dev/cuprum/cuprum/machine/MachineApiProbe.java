package dev.cuprum.cuprum.machine;

import com.mojang.serialization.Codec;
import com.mojang.serialization.DataResult;
import dev.cuprum.cuprum.block.DiagnosticCoilCoreBlockEntity;
import dev.cuprum.cuprum.multiblock.MultiblockPattern;
import dev.cuprum.cuprum.multiblock.MultiblockPatterns;
import java.util.Map;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerBlockEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerChunkEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerWorldEvents;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.fabricmc.fabric.api.object.builder.v1.block.entity.FabricBlockEntityTypeBuilder;
import net.fabricmc.fabric.api.resource.v1.ResourceLoader;
import net.fabricmc.fabric.api.screenhandler.v1.ExtendedScreenHandlerFactory;
import net.fabricmc.fabric.api.screenhandler.v1.ExtendedScreenHandlerType;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.protocol.game.ClientboundBlockEntityDataPacket;
import net.minecraft.resources.FileToIdConverter;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.PackType;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ContainerLevelAccess;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplate;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;

/**
 * Compile-time signature probe for the W1C multiblock/machine stack (multiblock.md §12, frozen
 * {@code RenderApiProbe} rules): every member below is a typed reference to the exact 1.21.9 /
 * Fabric API this module uses, so an upstream signature change fails compilation immediately.
 *
 * <p>Nothing here is ever invoked: all members are private, the class is never instantiated and
 * no static initializer performs work. See docs/API_PROBES.md ("Multiblock & charge machine").
 */
public final class MachineApiProbe {
    private MachineApiProbe() {
    }

    /** Probe 1 (§12.1): the generic {@code SimpleJsonResourceReloadListener<T>(Codec,
     * FileToIdConverter)} subclass shape — the real reloader is the proof; the fallback
     * ({@code PreparableReloadListener} + {@code scanDirectory}) stays unused. */
    private static void probeReloaderGenerics() {
        MultiblockPatterns reloader = new MultiblockPatterns();
        FileToIdConverter lister = FileToIdConverter.json("cuprum_multiblock");
        Codec<MultiblockPattern> codec = MultiblockPattern.CODEC;
    }

    /** Probe 2 (§12.2): the Fabric v1 resource-loader reloader registration used by
     * {@code MachineModule} resolves from the fat fabric-api compile classpath. */
    private static void probeResourceLoaderRegistration() {
        ResourceLoader.get(PackType.SERVER_DATA)
                .registerReloader(MultiblockPatterns.RELOADER_ID, new MultiblockPatterns());
    }

    /** Probe 3 (§12.3): {@code ExtendedScreenHandlerType} lambda inference
     * {@code (syncId, inventory, data)} and its registration into {@code BuiltInRegistries.MENU}. */
    private static void probeExtendedScreenHandlerType() {
        ExtendedScreenHandlerType<ChargeMachineMenu, ChargeMachineOpenData> type =
                new ExtendedScreenHandlerType<>(ChargeMachineMenu::new, ChargeMachineOpenData.STREAM_CODEC);
        net.minecraft.core.Registry.register(BuiltInRegistries.MENU,
                ResourceLocation.fromNamespaceAndPath("cuprum", "probe_menu"), type);
    }

    /** Probe 4 (§12.7): {@code Codec.validate} exists on the shipped DFU (the pattern codec
     * routes every §3.1 schema rule through it). */
    private static void probeCodecValidate() {
        Codec<Integer> validated = Codec.INT.validate(value ->
                value >= 0 ? DataResult.success(value) : DataResult.error(() -> "negative"));
    }

    /** Probe 5 (§6.3): vanilla menu opening with Fabric S2C open data ({@code player.openMenu}
     * takes the BE through {@code ExtendedScreenHandlerFactory}) + range enforcement members. */
    private static void probeMenuOpening(Player player, DiagnosticCoilCoreBlockEntity coil,
            Level level, BlockPos pos, Block block) {
        ExtendedScreenHandlerFactory<ChargeMachineOpenData> factory = coil;
        player.openMenu(coil);
        ContainerLevelAccess access = ContainerLevelAccess.create(level, pos);
    }

    /** Probe 6 (§5.1): the exact Fabric lifecycle event + creative-tab signatures wired by
     * {@code MachineModule}. */
    private static void probeLifecycleEvents(ResourceKey<net.minecraft.world.item.CreativeModeTab> tabKey) {
        ServerChunkEvents.CHUNK_LOAD.register((level, chunk) -> {
        });
        ServerChunkEvents.CHUNK_UNLOAD.register((level, chunk) -> {
        });
        ServerWorldEvents.UNLOAD.register((server, level) -> {
        });
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.register((blockEntity, level) -> {
        });
        ItemGroupEvents.modifyEntriesEvent(tabKey).register(entries ->
                entries.accept(MachineContent.DIAGNOSTIC_COIL_CORE_ITEM));
    }

    /** Probe 7 (§6.2): the two vanilla-mandated wire methods + throttled update-packet path. */
    private static void probeUpdatePacketPlumbing(ChargeMachineBlockEntity machine, Level level,
            BlockPos pos, HolderLookup.Provider registries) {
        ClientboundBlockEntityDataPacket packet = ClientboundBlockEntityDataPacket.create(machine);
        CompoundTag updateTag = machine.getUpdateTag(registries);
        level.sendBlockUpdated(pos, level.getBlockState(pos), level.getBlockState(pos),
                Block.UPDATE_CLIENTS);
    }

    /** Probe 8 (§3.2): the vanilla geometry anchors the JUnit-safe {@code PatternGeometry}
     * mirrors — {@code BlockPos.rotate}, mirror-then-rotate {@code StructureTemplate.transform}. */
    private static void probeVanillaGeometry(BlockPos pos) {
        BlockPos rotated = pos.rotate(Rotation.CLOCKWISE_90);
        BlockPos transformed = StructureTemplate.transform(pos, Mirror.LEFT_RIGHT,
                Rotation.COUNTERCLOCKWISE_90, BlockPos.ZERO);
        net.minecraft.core.Direction mirrored = Mirror.LEFT_RIGHT.mirror(net.minecraft.core.Direction.NORTH);
    }

    /** Probe 9 (§6.2): Value I/O members the machine envelope rewrite depends on —
     * {@code child} REPLACES an existing child (the documented rewrite rationale). */
    private static void probeValueIo(ValueOutput output, ValueInput input) {
        ValueOutput child = output.child("cuprum_state");
        child.store("rotation", Rotation.CODEC, Rotation.NONE);
        ValueInput childIn = input.childOrEmpty("cuprum_state");
        Rotation rotation = childIn.read("rotation", Rotation.CODEC).orElse(Rotation.NONE);
        byte raw = childIn.getByteOr("formation_state", (byte) -1);
        java.util.Optional<int[]> intArray = childIn.getIntArray("fault_pos");
    }

    /** Probe 10 (§7): the BE-type builder + map-codec block members the coil registers with. */
    private static void probeCoilRegistration(BlockPos pos,
            net.minecraft.world.level.block.state.BlockState state) {
        FabricBlockEntityTypeBuilder<DiagnosticCoilCoreBlockEntity> builder =
                FabricBlockEntityTypeBuilder.create(DiagnosticCoilCoreBlockEntity::new,
                        MachineContent.DIAGNOSTIC_COIL_CORE);
        BlockEntity be = new DiagnosticCoilCoreBlockEntity(pos, state);
        Map<ResourceLocation, MultiblockPattern> ignored = Map.of();
    }
}
