package dev.cuprum.cuprum.state;

import com.mojang.serialization.Codec;
import java.util.Optional;
import java.util.function.Supplier;
import net.minecraft.core.Registry;
import net.minecraft.core.component.DataComponentType;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;

/**
 * Compile-time signature probe for the 1.21.9 persistence stack (net-state.md §10, frozen
 * {@code RenderApiProbe} rules). Pins the D1-mandated {@code SavedDataType<>(…, null)} shape,
 * the ValueInput/ValueOutput BE-envelope members (plan §3.1) and the data-component builder for
 * the future item-state wiring. Attachment-API pins live in {@link CuprumAttachments} (the
 * single-caller rule, plan D5).
 *
 * <p>Nothing here is ever invoked: all members are private, the class is never instantiated and
 * no static initializer performs work. See docs/API_PROBES.md ("Networking & state").
 */
public final class StateApiProbe {
    private StateApiProbe() {
    }

    private static final class ProbeSavedData extends SavedData {
    }

    /** Probe 1 (plan D1): SavedDataType with a null DataFixTypes + storage access. */
    private static ProbeSavedData probeSavedDataType(ServerLevel level, Supplier<ProbeSavedData> supplier,
            Codec<ProbeSavedData> codec) {
        SavedDataType<ProbeSavedData> type = new SavedDataType<>("cuprum_probe", supplier, codec, null);
        return level.getDataStorage().computeIfAbsent(type);
    }

    /** Probe 2 (plan §3.1): the BE state-envelope writers. */
    private static void probeValueOutput(ValueOutput output, CompoundTag quarantined) {
        ValueOutput child = output.child("cuprum_state");
        child.putInt(CuprumSchema.KEY, CuprumSchema.BLOCK_ENTITY);
        child.putLong("charge", 0L);
        child.store("cuprum_quarantine", CompoundTag.CODEC, quarantined);
        NbtUtils.addCurrentDataVersion(output);
    }

    /** Probe 3 (plan §3.1): the BE state-envelope readers. */
    private static void probeValueInput(ValueInput input) {
        Optional<ValueInput> child = input.child("cuprum_state");
        int schema = input.getIntOr(CuprumSchema.KEY, 0);
        Optional<CompoundTag> quarantined = input.read("cuprum_quarantine", CompoundTag.CODEC);
        ValueInput orEmpty = input.childOrEmpty("cuprum_state");
    }

    /** Probe 4: data-component registration for future item-borne state (no components in W1). */
    private static <T> DataComponentType<T> probeDataComponent(ResourceLocation id, Codec<T> codec,
            StreamCodec<? super RegistryFriendlyByteBuf, T> streamCodec, Item.Properties properties, T defaultValue) {
        DataComponentType<T> type = DataComponentType.<T>builder()
                .persistent(codec)
                .networkSynchronized(streamCodec)
                .cacheEncoding()
                .build();
        Registry.register(BuiltInRegistries.DATA_COMPONENT_TYPE, id, type);
        properties.component(type, defaultValue);
        return type;
    }
}
