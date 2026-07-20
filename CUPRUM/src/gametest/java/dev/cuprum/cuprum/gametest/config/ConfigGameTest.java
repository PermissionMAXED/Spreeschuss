package dev.cuprum.cuprum.gametest.config;

import dev.cuprum.cuprum.config.ConfigSyncPayload;
import dev.cuprum.cuprum.config.CuprumCommonConfig;
import dev.cuprum.cuprum.config.CuprumConfigs;
import dev.cuprum.cuprum.gametest.net.MockServerPlayers;
import dev.cuprum.cuprum.net.CuprumNetVersion;
import io.netty.buffer.Unpooled;
import java.util.ArrayList;
import java.util.List;
import me.shedaniel.cloth.clothconfig.shadowed.blue.endless.jankson.Jankson;
import me.shedaniel.cloth.clothconfig.shadowed.blue.endless.jankson.JsonElement;
import me.shedaniel.cloth.clothconfig.shadowed.blue.endless.jankson.JsonObject;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;

/**
 * Real-server GameTests (plan §4-W1A) for the single config authority: the frozen json5 schema
 * (exact sorted key set, pinned literals per plan §3.3), a defaults round-trip through the same
 * shadowed Jankson that AutoConfig serializes with, and the sync-on-join payload count.
 */
public class ConfigGameTest {
    /** The frozen cuprum-common.json5 key set (plan §3.3) — additions require a plan edit. */
    private static final List<String> FROZEN_COMMON_KEYS = List.of(
            "charge.leydenJarCapacityCg",
            "charge.passiveBaselineCgPerTick",
            "charge.strikeDepositCg",
            "charge.wireLossPpTenthsPerSpanBare",
            "charge.wireLossPpTenthsPerSpanHv",
            "net.burstDefault",
            "net.rateGlobalPerSec",
            "net.ratePerSecDefault",
            "net.violationKickThreshold",
            "net.violationWindowTicks");

    @GameTest
    public void configSchemaFreeze(GameTestHelper helper) {
        JsonObject root = (JsonObject) Jankson.builder().build().toJson(new CuprumCommonConfig());
        List<String> keys = new ArrayList<>();
        flattenKeys("", root, keys);
        keys.sort(String::compareTo);
        helper.assertValueEqual(FROZEN_COMMON_KEYS, keys,
                Component.literal("cuprum-common.json5 sorted key set"));
        helper.succeed();
    }

    @GameTest
    public void configDefaultsRoundtrip(GameTestHelper helper) {
        Jankson jankson = Jankson.builder().build();
        CuprumCommonConfig defaults = new CuprumCommonConfig();
        JsonObject serialized = (JsonObject) jankson.toJson(defaults);
        CuprumCommonConfig deserialized = jankson.fromJson(serialized, CuprumCommonConfig.class);
        deserialized.validatePostLoad();
        // Field-by-field equality via the sync snapshot record (covers every synced value).
        helper.assertValueEqual(ConfigSyncPayload.of(defaults), ConfigSyncPayload.of(deserialized),
                Component.literal("defaults after Jankson round-trip"));
        // Defaults are already in range: validatePostLoad must not have changed anything either.
        helper.assertValueEqual(5, deserialized.charge.passiveBaselineCgPerTick,
                Component.literal("passiveBaselineCgPerTick INDEX literal"));
        helper.assertValueEqual(100_000, deserialized.charge.leydenJarCapacityCg,
                Component.literal("leydenJarCapacityCg INDEX literal"));
        helper.assertValueEqual(270_000, deserialized.charge.strikeDepositCg,
                Component.literal("strikeDepositCg INDEX literal"));
        helper.succeed();
    }

    @GameTest
    public void configSyncRoundTripsThroughItsCodec(GameTestHelper helper) {
        ConfigSyncPayload snapshot = ConfigSyncPayload.of(CuprumConfigs.common());
        RegistryFriendlyByteBuf buf = new RegistryFriendlyByteBuf(
                Unpooled.buffer(), helper.getLevel().registryAccess());
        try {
            ConfigSyncPayload.STREAM_CODEC.encode(buf, snapshot);
            ConfigSyncPayload decoded = ConfigSyncPayload.STREAM_CODEC.decode(buf);
            helper.assertValueEqual(snapshot, decoded, Component.literal("codec round trip"));
            helper.assertValueEqual(0, buf.readableBytes(), Component.literal("no trailing bytes"));
        } finally {
            buf.release();
        }
        helper.succeed();
    }

    @GameTest
    public void configSyncRejectsOutOfRangeWireValues(GameTestHelper helper) {
        // The canonical constructor must reject wire values outside the shared Bounds — the
        // overlay never relies on toOverlayConfig clamping. Field order mirrors the codec.
        int[] valid = {1, 5, 100_000, 270_000, 20, 5, 4, 8, 16, 8, 6000};
        // For each field: one below-min and (where min > Integer.MIN_VALUE semantics allow)
        // one absurd negative — every case must throw at decode.
        int[][] hostileCases = {
                {0, 0}, {1, -1}, {2, 0}, {3, -1}, {4, -1}, {5, 1001},
                {6, 0}, {7, 0}, {8, 10_001}, {9, 0}, {10, 19},
        };
        for (int[] hostile : hostileCases) {
            int[] wire = valid.clone();
            wire[hostile[0]] = hostile[1];
            RegistryFriendlyByteBuf buf = new RegistryFriendlyByteBuf(
                    Unpooled.buffer(), helper.getLevel().registryAccess());
            try {
                for (int value : wire) {
                    buf.writeVarInt(value);
                }
                try {
                    ConfigSyncPayload decoded = ConfigSyncPayload.STREAM_CODEC.decode(buf);
                    helper.fail(Component.literal("decoded out-of-range field " + hostile[0]
                            + " = " + hostile[1] + " as " + decoded));
                } catch (IllegalArgumentException expected) {
                    // rejected at the canonical constructor, as required
                }
            } finally {
                buf.release();
            }
        }
        // Direct construction is rejected identically (no clamping path exists).
        try {
            new ConfigSyncPayload(1, 5, 0, 270_000, 20, 5, 4, 8, 16, 8, 6000);
            helper.fail(Component.literal("constructor accepted leydenJarCapacityCg = 0"));
        } catch (IllegalArgumentException expected) {
            // rejected as required
        }
        helper.succeed();
    }

    @GameTest
    public void configSyncOnJoinSendsExactlyOneSnapshot(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_cfg")) {
            List<ConfigSyncPayload> snapshots = mock.sentPayloads(ConfigSyncPayload.class);
            helper.assertValueEqual(1, snapshots.size(),
                    Component.literal("config snapshots sent on join"));
            helper.assertValueEqual(ConfigSyncPayload.of(CuprumConfigs.common()), snapshots.get(0),
                    Component.literal("join snapshot mirrors the authoritative config"));
            helper.assertValueEqual(CuprumNetVersion.NET_VERSION, snapshots.get(0).netVersion(),
                    Component.literal("snapshot carries net version 1"));
        }
        helper.succeed();
    }

    private static void flattenKeys(String prefix, JsonObject object, List<String> sink) {
        for (String key : object.keySet()) {
            JsonElement value = object.get((Object) key);
            if (value instanceof JsonObject nested) {
                flattenKeys(prefix + key + ".", nested, sink);
            } else {
                sink.add(prefix + key);
            }
        }
    }
}
