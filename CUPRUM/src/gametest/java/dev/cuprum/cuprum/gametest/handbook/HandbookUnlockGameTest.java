package dev.cuprum.cuprum.gametest.handbook;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.api.handbook.HandbookUnlocks;
import dev.cuprum.cuprum.gametest.net.MockServerPlayers;
import dev.cuprum.cuprum.state.CuprumAttachments;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Set;
import net.fabricmc.fabric.api.attachment.v1.AttachmentTarget;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.ProblemReporter;
import net.minecraft.world.level.storage.TagValueInput;
import net.minecraft.world.level.storage.TagValueOutput;

/**
 * {@code handbook_unlock_grant_persist} (plan §4-W1E): the frozen
 * {@code HandbookUnlocks.grant} contract on a real connected player — grant mutates the
 * attachment, the player NBT round-trip retains it (the {@code persistent} half of the plan
 * §3.1 attachment spec; restart persistence itself rides the W1A-proven SavedData/player-data
 * path), duplicates are total no-ops (zero state changes, zero payloads), bounds are refused
 * with a WARN, and the worst-case persisted encoding stays under the 16 KiB Cuprum sync cap.
 *
 * <p>Note on sync capture: Fabric only sends {@code fabric:attachment_sync_v1} to connections
 * that negotiated attachment support during the configuration phase; embedded-channel mocks
 * skip configuration, so the POSITIVE sync delivery is not observable here (it is Fabric's
 * own tested behavior, wired via {@code syncWith(..., targetOnly())} in
 * {@code CuprumAttachments}). The zero-payload assertions below are exact regardless — no
 * custom payload of any kind may leave the server for a duplicate or refused grant.
 */
public class HandbookUnlockGameTest {
    private static final ResourceLocation KEY = ResourceLocation.parse("cuprum:unlock/gametest_probe");

    @GameTest(environment = "cuprum-gametest:handbook_unlock")
    public void handbookUnlockGrantPersist(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "hbUnlock")) {
            ServerPlayer player = mock.player();
            helper.assertValueEqual(Set.of(), HandbookUnlocks.unlockedKeys(player),
                    Component.literal("fresh player starts with zero unlocks (initializer)"));

            helper.assertTrue(HandbookUnlocks.grant(player, KEY),
                    Component.literal("first grant reports newly added"));
            helper.assertTrue(HandbookUnlocks.unlockedKeys(player).contains(KEY),
                    Component.literal("attachment contains the granted key"));

            // Duplicate grant: zero state changes, zero payloads of any kind.
            mock.connection().flushChannel();
            int payloadsBefore = customPayloadCount(mock);
            helper.assertFalse(HandbookUnlocks.grant(player, KEY),
                    Component.literal("duplicate grant reports no change"));
            helper.assertValueEqual(1, HandbookUnlocks.unlockedKeys(player).size(),
                    Component.literal("duplicate grant added zero entries"));
            mock.connection().flushChannel();
            helper.assertValueEqual(payloadsBefore, customPayloadCount(mock),
                    Component.literal("duplicate grant sent zero payloads"));

            // Player NBT round-trip: save the real player, load into a fresh instance.
            try (ProblemReporter.ScopedCollector reporter = new ProblemReporter.ScopedCollector(Cuprum.LOGGER)) {
                TagValueOutput output =
                        TagValueOutput.createWithContext(reporter, helper.getLevel().registryAccess());
                player.saveWithoutId(output);
                CompoundTag saved = output.buildResult();

                ServerPlayer reloaded = new ServerPlayer(helper.getLevel().getServer(), helper.getLevel(),
                        player.getGameProfile(), player.clientInformation());
                reloaded.load(TagValueInput.create(reporter, helper.getLevel().registryAccess(), saved));
                helper.assertTrue(HandbookUnlocks.unlockedKeys(reloaded).contains(KEY),
                        Component.literal("player NBT round-trip retains the granted key"));
            }
        }
        helper.succeed();
    }

    @GameTest(environment = "cuprum-gametest:handbook_unlock")
    public void handbookUnlockBoundsRefused(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "hbBounds")) {
            ServerPlayer player = mock.player();

            String oversizedPath = "unlock/" + "k".repeat(
                    HandbookUnlocks.MAX_KEY_CHARS - "cuprum:unlock/".length() + 1);
            helper.assertFalse(
                    HandbookUnlocks.grant(player, ResourceLocation.fromNamespaceAndPath("cuprum", oversizedPath)),
                    Component.literal("over-length key is refused"));
            helper.assertValueEqual(Set.of(), HandbookUnlocks.unlockedKeys(player),
                    Component.literal("refused grant leaves zero state"));

            for (int i = 0; i < HandbookUnlocks.MAX_KEYS; i++) {
                helper.assertTrue(HandbookUnlocks.grant(player, maxLengthKey(i)),
                        Component.literal("grant " + i + " within bounds succeeds"));
            }
            mock.connection().flushChannel();
            int payloadsBefore = customPayloadCount(mock);
            helper.assertFalse(
                    HandbookUnlocks.grant(player, ResourceLocation.parse("cuprum:unlock/one_too_many")),
                    Component.literal("grant #65 is refused at the MAX_KEYS bound"));
            helper.assertValueEqual(HandbookUnlocks.MAX_KEYS, HandbookUnlocks.unlockedKeys(player).size(),
                    Component.literal("refused grant leaves exactly MAX_KEYS entries"));
            mock.connection().flushChannel();
            helper.assertValueEqual(payloadsBefore, customPayloadCount(mock),
                    Component.literal("refused grant sent zero payloads"));
        }
        helper.succeed();
    }

    /** {@code handbookUnlockEncodingStaysUnderSyncCap} (referenced from {@code HandbookUnlocks}). */
    @GameTest(environment = "cuprum-gametest:handbook_unlock")
    public void handbookUnlockEncodingStaysUnderSyncCap(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "hbSyncCap")) {
            ServerPlayer player = mock.player();
            for (int i = 0; i < HandbookUnlocks.MAX_KEYS; i++) {
                helper.assertTrue(HandbookUnlocks.grant(player, maxLengthKey(i)),
                        Component.literal("worst-case grant " + i + " succeeds"));
            }

            try (ProblemReporter.ScopedCollector reporter = new ProblemReporter.ScopedCollector(Cuprum.LOGGER)) {
                TagValueOutput output =
                        TagValueOutput.createWithContext(reporter, helper.getLevel().registryAccess());
                player.saveWithoutId(output);
                CompoundTag saved = output.buildResult();
                CompoundTag attachments =
                        saved.getCompoundOrEmpty(AttachmentTarget.NBT_ATTACHMENT_KEY);
                Tag unlocks = attachments.get(CuprumAttachments.HANDBOOK_UNLOCKS.identifier().toString());
                helper.assertTrue(unlocks != null,
                        Component.literal("persisted player NBT carries the unlocks attachment"));

                int persistedBytes = serializedSize(unlocks);
                helper.assertTrue(persistedBytes > HandbookUnlocks.MAX_KEYS * 200,
                        Component.literal("worst case is actually near the bound (" + persistedBytes + " B)"));
                helper.assertTrue(persistedBytes <= 16 * 1024, Component.literal(
                        "worst-case persisted encoding " + persistedBytes + " B exceeds the 16 KiB cap"));
                // Wire form (varint count + length-prefixed UTF-8) is strictly smaller than
                // this NBT form (named string tags), so the synced encoding fits a fortiori.
            }
        }
        helper.succeed();
    }

    /** A key of exactly {@code MAX_KEY_CHARS} total characters, unique per {@code index}. */
    private static ResourceLocation maxLengthKey(int index) {
        String suffix = String.format("%02d", index);
        String prefix = "cuprum:unlock/";
        String path = "unlock/" + "k".repeat(HandbookUnlocks.MAX_KEY_CHARS
                - prefix.length() - suffix.length()) + suffix;
        return ResourceLocation.fromNamespaceAndPath("cuprum", path);
    }

    private static int customPayloadCount(MockServerPlayers.Mock mock) {
        int count = 0;
        for (Object message : mock.channel().outboundMessages()) {
            if (message instanceof ClientboundCustomPayloadPacket) {
                count++;
            }
        }
        return count;
    }

    private static int serializedSize(Tag tag) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (DataOutputStream out = new DataOutputStream(bytes)) {
            NbtIo.writeAnyTag(tag, out);
        } catch (IOException e) {
            throw new UncheckedIOException("serializing attachment tag", e);
        }
        return bytes.size();
    }
}
