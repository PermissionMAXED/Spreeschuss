package dev.cuprum.cuprum.gametest.state;

import dev.cuprum.cuprum.state.CuprumSchema;
import dev.cuprum.cuprum.state.StateProbe;
import dev.cuprum.cuprum.state.StateProbeSavedData;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.NbtOps;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.storage.LevelResource;

/**
 * Real-server GameTests (plan §4-W1A) for the state module. Each layer proves something the
 * others cannot, so all of them stay:
 *
 * <ul>
 *   <li><b>Codec round-trip</b> ({@code savedDataRoundTripsThroughDataStorage}): the versioned
 *       envelope's exact NBT shape (schema_version stamping, body preservation) — pure codec
 *       semantics no disk test pins down field-by-field.</li>
 *   <li><b>Real disk write path</b> ({@code savedDataWritesThroughRealDiskSavePath}):
 *       {@code setDirty} + {@code DimensionDataStorage.saveAndJoin()} + reading the raw
 *       {@code data/cuprum_state_probe.dat} back with {@code NbtIo} — proves the vanilla save
 *       pipeline (with Fabric's null-DataFixTypes passthrough) actually persists our envelope.
 *       Public APIs cannot evict the in-memory cache, so a same-JVM re-read is not provable
 *       here.</li>
 *   <li><b>Fresh-JVM re-read</b> ({@code scripts/server_restart_probe.sh}): boots the dedicated
 *       server twice against the same world (then once fresh again) and asserts boots=1 → 2 —
 *       the only layer that proves the on-disk file is re-read through
 *       {@code readTagFromDisk} in a new process.</li>
 *   <li><b>Forward-version behavior</b> ({@code versionedEnvelopeReadsForwardVersionsBestEffort}):
 *       warn-once + best-effort read for files written by a newer Cuprum.</li>
 * </ul>
 */
public class StateProbeGameTest {
    @GameTest
    public void savedDataRoundTripsThroughDataStorage(GameTestHelper helper) {
        StateProbeSavedData data = helper.getLevel().getDataStorage().computeIfAbsent(StateProbeSavedData.TYPE);
        int before = data.boots();
        data.incrementBoots();

        // getDataStorage() caching: the same instance comes back, with the mutation visible.
        StateProbeSavedData again = helper.getLevel().getDataStorage().computeIfAbsent(StateProbeSavedData.TYPE);
        helper.assertTrue(data == again, Component.literal("data storage must cache the instance"));
        helper.assertValueEqual(before + 1, again.boots(), Component.literal("boots after increment"));

        // Codec round-trip: the envelope stamps schema_version and preserves the body.
        CompoundTag encoded = (CompoundTag) StateProbeSavedData.CODEC
                .encodeStart(NbtOps.INSTANCE, data)
                .getOrThrow();
        helper.assertValueEqual(CuprumSchema.WORLD,
                encoded.getIntOr(CuprumSchema.SAVED_DATA_VERSION_KEY, -1),
                Component.literal("schema_version in encoded envelope"));
        StateProbeSavedData decoded = StateProbeSavedData.CODEC
                .parse(NbtOps.INSTANCE, encoded)
                .getOrThrow();
        helper.assertValueEqual(data.boots(), decoded.boots(), Component.literal("boots after round-trip"));
        helper.succeed();
    }

    @GameTest
    public void bootCounterIncrementsPersistsAndMarksDirty(GameTestHelper helper) {
        MinecraftServer server = helper.getLevel().getServer();
        int first = StateProbe.recordBoot(server);
        int second = StateProbe.recordBoot(server);
        helper.assertValueEqual(first + 1, second, Component.literal("consecutive boot counts"));

        StateProbeSavedData data = server.overworld().getDataStorage().computeIfAbsent(StateProbeSavedData.TYPE);
        helper.assertValueEqual(second, data.boots(), Component.literal("persisted boots value"));
        helper.assertTrue(data.isDirty(), Component.literal("increment must mark the SavedData dirty"));
        helper.succeed();
    }

    @GameTest
    public void savedDataWritesThroughRealDiskSavePath(GameTestHelper helper) {
        StateProbeSavedData data = helper.getLevel().getDataStorage().computeIfAbsent(StateProbeSavedData.TYPE);
        int boots = data.incrementBoots(); // marks dirty
        helper.assertTrue(data.isDirty(), Component.literal("dirty before save"));

        // The REAL write path: DimensionDataStorage collects dirty SavedData, encodes through
        // the SavedDataType codec (Fabric's null-DataFixTypes passthrough) and writes
        // <world>/data/<id>.dat. saveAndJoin() blocks until the IO future completes.
        helper.getLevel().getDataStorage().saveAndJoin();

        Path file = helper.getLevel().getServer().getWorldPath(LevelResource.ROOT)
                .resolve("data").resolve(StateProbeSavedData.ID + ".dat");
        helper.assertTrue(Files.isRegularFile(file),
                Component.literal("SavedData file missing on disk: " + file));
        CompoundTag onDisk;
        try {
            onDisk = NbtIo.readCompressed(file, NbtAccounter.unlimitedHeap());
        } catch (IOException e) {
            throw new UncheckedIOException("reading " + file, e);
        }
        CompoundTag payload = onDisk.getCompoundOrEmpty("data");
        helper.assertValueEqual(boots, payload.getIntOr("boots", -1),
                Component.literal("boots value in the on-disk envelope"));
        helper.assertValueEqual(CuprumSchema.WORLD,
                payload.getIntOr(CuprumSchema.SAVED_DATA_VERSION_KEY, -1),
                Component.literal("schema_version in the on-disk envelope"));
        helper.succeed();
    }

    @GameTest
    public void versionedEnvelopeReadsForwardVersionsBestEffort(GameTestHelper helper) {
        // A file written by a NEWER Cuprum (schema_version > current) must warn + read
        // best-effort — never crash, never migrate downwards (plan §3.1/D10 staging).
        StateProbeSavedData data = helper.getLevel().getDataStorage().computeIfAbsent(StateProbeSavedData.TYPE);
        data.incrementBoots();
        CompoundTag encoded = (CompoundTag) StateProbeSavedData.CODEC
                .encodeStart(NbtOps.INSTANCE, data)
                .getOrThrow();
        encoded.putInt(CuprumSchema.SAVED_DATA_VERSION_KEY, CuprumSchema.WORLD + 99);
        StateProbeSavedData decoded = StateProbeSavedData.CODEC
                .parse(NbtOps.INSTANCE, encoded)
                .getOrThrow();
        helper.assertValueEqual(data.boots(), decoded.boots(),
                Component.literal("boots read best-effort from a forward version"));
        helper.succeed();
    }
}
