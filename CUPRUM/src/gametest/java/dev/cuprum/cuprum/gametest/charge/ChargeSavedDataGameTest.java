package dev.cuprum.cuprum.gametest.charge;

import com.mojang.serialization.DataResult;
import dev.cuprum.cuprum.charge.core.ChargePriority;
import dev.cuprum.cuprum.charge.core.Roles;
import dev.cuprum.cuprum.charge.persist.ChargeGraphSavedData;
import dev.cuprum.cuprum.state.CuprumSchema;
import java.util.List;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtOps;
import net.minecraft.network.chat.Component;

/** Real-codec regressions for charge-graph SavedData normalization and version handling. */
public class ChargeSavedDataGameTest {
    @GameTest
    public void cgSavedDataNonEmptyCodecRoundtrip(GameTestHelper helper) {
        ChargeGraphSavedData data = new ChargeGraphSavedData();
        data.replaceSnapshot(List.of(
                new ChargeGraphSavedData.NodeRecord(12L, Roles.STORAGE, ChargePriority.DEFENSE.ordinal(), 345L),
                new ChargeGraphSavedData.NodeRecord(-7L, Roles.RELAY, ChargePriority.MISC.ordinal(), 0L)
        ), 678L);

        CompoundTag encoded = (CompoundTag) ChargeGraphSavedData.CODEC
                .encodeStart(NbtOps.INSTANCE, data)
                .getOrThrow();
        helper.assertValueEqual(CuprumSchema.WORLD,
                encoded.getIntOr(CuprumSchema.SAVED_DATA_VERSION_KEY, -1),
                Component.literal("current schema stamped"));

        ChargeGraphSavedData decoded = ChargeGraphSavedData.CODEC
                .parse(NbtOps.INSTANCE, encoded)
                .getOrThrow();
        helper.assertValueEqual(2, decoded.nodes().size(), Component.literal("non-empty node count"));
        assertRecord(helper, decoded.nodes().get(0), -7L, Roles.RELAY, ChargePriority.MISC.ordinal(), 0L);
        assertRecord(helper, decoded.nodes().get(1), 12L, Roles.STORAGE, ChargePriority.DEFENSE.ordinal(), 345L);
        helper.assertValueEqual(678L, decoded.ventedTotal(), Component.literal("vented total roundtrip"));
        helper.succeed();
    }

    @GameTest
    public void cgSavedDataNormalizesMalformedValuesAndDuplicatePositions(GameTestHelper helper) {
        CompoundTag input = envelope(CuprumSchema.WORLD);
        ListTag nodes = new ListTag();
        nodes.add(node(9L, 0xFFFF, 99, -12_345L));
        nodes.add(node(-5L, -1, -7, Long.MIN_VALUE));
        nodes.add(node(9L, Roles.STORAGE, ChargePriority.DEFENSE.ordinal(), 7L));
        input.put("nodes", nodes);
        input.putLong("vented_total", -1L);

        ChargeGraphSavedData decoded = ChargeGraphSavedData.CODEC
                .parse(NbtOps.INSTANCE, input)
                .getOrThrow();

        helper.assertValueEqual(2, decoded.nodes().size(),
                Component.literal("duplicate pos uses one deterministic record"));
        assertRecord(helper, decoded.nodes().get(0), -5L, Roles.ALL,
                ChargePriority.MISC.ordinal(), 0L);
        assertRecord(helper, decoded.nodes().get(1), 9L, Roles.STORAGE,
                ChargePriority.DEFENSE.ordinal(), 7L);
        helper.assertValueEqual(0L, decoded.ventedTotal(), Component.literal("negative vent clamps"));
        helper.succeed();
    }

    @GameTest
    public void cgSavedDataMigratesSchemaZero(GameTestHelper helper) {
        CompoundTag input = envelope(0);
        ListTag nodes = new ListTag();
        nodes.add(node(44L, Roles.CONSUMER, ChargePriority.LOGISTICS.ordinal(), 55L));
        input.put("nodes", nodes);
        input.putLong("vented_total", 66L);

        ChargeGraphSavedData decoded = ChargeGraphSavedData.CODEC
                .parse(NbtOps.INSTANCE, input)
                .getOrThrow();
        assertRecord(helper, decoded.nodes().getFirst(), 44L, Roles.CONSUMER,
                ChargePriority.LOGISTICS.ordinal(), 55L);
        helper.assertValueEqual(66L, decoded.ventedTotal(), Component.literal("v0 body migrated"));

        CompoundTag reencoded = (CompoundTag) ChargeGraphSavedData.CODEC
                .encodeStart(NbtOps.INSTANCE, decoded)
                .getOrThrow();
        helper.assertValueEqual(CuprumSchema.WORLD,
                reencoded.getIntOr(CuprumSchema.SAVED_DATA_VERSION_KEY, -1),
                Component.literal("migrated data writes current schema"));

        input.putInt(CuprumSchema.SAVED_DATA_VERSION_KEY, -99);
        ChargeGraphSavedData negativeSchema = ChargeGraphSavedData.CODEC
                .parse(NbtOps.INSTANCE, input)
                .getOrThrow();
        assertRecord(helper, negativeSchema.nodes().getFirst(), 44L, Roles.CONSUMER,
                ChargePriority.LOGISTICS.ordinal(), 55L);
        helper.succeed();
    }

    @GameTest
    public void cgSavedDataFutureVersionReadsSafelyAndRewritesCurrent(GameTestHelper helper) {
        CompoundTag input = envelope(CuprumSchema.WORLD + 99);
        ListTag nodes = new ListTag();
        nodes.add(node(71L, 1 << 30, Integer.MAX_VALUE, -9L));
        input.put("nodes", nodes);
        input.putString("future_field", "ignored");

        ChargeGraphSavedData decoded = ChargeGraphSavedData.CODEC
                .parse(NbtOps.INSTANCE, input)
                .getOrThrow();
        assertRecord(helper, decoded.nodes().getFirst(), 71L, 0,
                ChargePriority.MISC.ordinal(), 0L);

        CompoundTag reencoded = (CompoundTag) ChargeGraphSavedData.CODEC
                .encodeStart(NbtOps.INSTANCE, decoded)
                .getOrThrow();
        helper.assertValueEqual(CuprumSchema.WORLD,
                reencoded.getIntOr(CuprumSchema.SAVED_DATA_VERSION_KEY, -1),
                Component.literal("best-effort future read rewrites current schema"));
        helper.succeed();
    }

    @GameTest
    public void cgSavedDataSyntacticallyMalformedPayloadReturnsCodecError(GameTestHelper helper) {
        CompoundTag input = envelope(CuprumSchema.WORLD);
        input.putString("nodes", "not-a-list");

        DataResult<ChargeGraphSavedData> result = ChargeGraphSavedData.CODEC.parse(NbtOps.INSTANCE, input);
        helper.assertTrue(result.error().isPresent(),
                Component.literal("wrong node-list type must return a codec error"));
        helper.succeed();
    }

    private static CompoundTag envelope(int schema) {
        CompoundTag tag = new CompoundTag();
        tag.putInt(CuprumSchema.SAVED_DATA_VERSION_KEY, schema);
        return tag;
    }

    private static CompoundTag node(long posKey, int roleMask, int priority, long stored) {
        CompoundTag tag = new CompoundTag();
        tag.putLong("posKey", posKey);
        tag.putInt("roleMask", roleMask);
        tag.putInt("priority", priority);
        tag.putLong("lastKnownStored", stored);
        return tag;
    }

    private static void assertRecord(GameTestHelper helper, ChargeGraphSavedData.NodeRecord actual,
            long posKey, int roleMask, int priority, long stored) {
        helper.assertValueEqual(posKey, actual.posKey(), Component.literal("record posKey"));
        helper.assertValueEqual(roleMask, actual.roleMask(), Component.literal("record roleMask"));
        helper.assertValueEqual(priority, actual.priority(), Component.literal("record priority"));
        helper.assertValueEqual(stored, actual.lastKnownStored(), Component.literal("record stored shadow"));
    }
}
