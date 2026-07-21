package dev.cuprum.cuprum.gametest.handbook;

import com.mojang.serialization.DataResult;
import com.mojang.serialization.JsonOps;
import dev.cuprum.cuprum.handbook.HandbookCategory;
import dev.cuprum.cuprum.handbook.HandbookPage;
import dev.cuprum.cuprum.handbook.HandbookUnlock;
import dev.cuprum.cuprum.handbook.HandbookWidget;
import dev.cuprum.cuprum.handbook.HandbookWire;
import io.netty.buffer.Unpooled;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Consumer;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.StrictJsonParser;

/**
 * {@code handbook_codec_roundtrip} (handbook-config.md §10; a server GameTest, not JUnit, per
 * plan D9 — codecs need MC classes): decode∘encode is the identity for every widget type and
 * the page/category/unlock records over BOTH codecs (JSON {@code Codec} + wire
 * {@code StreamCodec}), the strict decoders reject unknown keys/types, and hostile wire
 * counts fail decode before any allocation-scale work (bounded-networking security floor).
 */
public class HandbookCodecGameTest {
    private static final List<HandbookWidget> ONE_OF_EACH_WIDGET = List.of(
            new HandbookWidget.Text("handbook.cuprum.page.charge_probe.intro",
                    HandbookWidget.TextStyle.HEADING),
            new HandbookWidget.Image(ResourceLocation.parse("cuprum:textures/block/charge_probe.png"),
                    64, 48, Optional.of("handbook.cuprum.page.charge_probe.image_caption")),
            new HandbookWidget.Image(ResourceLocation.parse("cuprum:textures/block/fx_probe.png"),
                    32, 32, Optional.empty()),
            new HandbookWidget.Recipe(ResourceLocation.parse("cuprum:charge_probe")),
            new HandbookWidget.Multiblock(
                    Map.of("C", ResourceLocation.parse("cuprum:diagnostic_coil_core"),
                            "F", ResourceLocation.parse("cuprum:diagnostic_coil_frame")),
                    List.of(List.of("FFF", "FCF", "FFF"), List.of("   ", " F ", "   "))),
            new HandbookWidget.Charge("charge.passiveBaselineCgPerTick",
                    HandbookWidget.ChargeUnit.CG_PER_TICK));

    @GameTest
    public void widgetCodecsRoundTripEveryType(GameTestHelper helper) {
        for (HandbookWidget widget : ONE_OF_EACH_WIDGET) {
            var json = HandbookWidget.CODEC.encodeStart(JsonOps.INSTANCE, widget).getOrThrow();
            HandbookWidget decoded = HandbookWidget.CODEC.parse(JsonOps.INSTANCE, json).getOrThrow();
            helper.assertValueEqual(widget, decoded,
                    Component.literal("JSON round-trip for widget " + widget.typeName()));

            RegistryFriendlyByteBuf buf =
                    new RegistryFriendlyByteBuf(Unpooled.buffer(), helper.getLevel().registryAccess());
            try {
                HandbookWidget.STREAM_CODEC.encode(buf, widget);
                HandbookWidget wireDecoded = HandbookWidget.STREAM_CODEC.decode(buf);
                helper.assertValueEqual(widget, wireDecoded,
                        Component.literal("wire round-trip for widget " + widget.typeName()));
                helper.assertValueEqual(0, buf.readableBytes(),
                        Component.literal("wire decode consumes exactly the encoding of " + widget.typeName()));
            } finally {
                buf.release();
            }
        }
        helper.succeed();
    }

    @GameTest
    public void pageCategoryAndUnlockRoundTripBothCodecs(GameTestHelper helper) {
        HandbookCategory category = new HandbookCategory(
                ResourceLocation.parse("cuprum:diagnostics"),
                "handbook.cuprum.category.diagnostics",
                ResourceLocation.parse("cuprum:charge_probe"), 900);
        HandbookPage page = new HandbookPage(
                ResourceLocation.parse("cuprum:diagnostics/charge_probe"),
                ResourceLocation.parse("cuprum:diagnostics"),
                "handbook.cuprum.page.charge_probe.title",
                List.of(ResourceLocation.parse("cuprum:charge_probe")),
                new HandbookUnlock.Key(ResourceLocation.parse("cuprum:unlock/probe")),
                List.of("diagnostics"),
                ONE_OF_EACH_WIDGET);

        helper.assertValueEqual(category,
                HandbookCategory.CODEC.parse(JsonOps.INSTANCE,
                        HandbookCategory.CODEC.encodeStart(JsonOps.INSTANCE, category).getOrThrow()).getOrThrow(),
                Component.literal("category JSON round-trip"));
        helper.assertValueEqual(page,
                HandbookPage.CODEC.parse(JsonOps.INSTANCE,
                        HandbookPage.CODEC.encodeStart(JsonOps.INSTANCE, page).getOrThrow()).getOrThrow(),
                Component.literal("page JSON round-trip (all widget types + key unlock)"));

        RegistryFriendlyByteBuf buf =
                new RegistryFriendlyByteBuf(Unpooled.buffer(), helper.getLevel().registryAccess());
        try {
            HandbookCategory.STREAM_CODEC.encode(buf, category);
            HandbookPage.STREAM_CODEC.encode(buf, page);
            HandbookUnlock.STREAM_CODEC.encode(buf, HandbookUnlock.Always.INSTANCE);
            helper.assertValueEqual(category, HandbookCategory.STREAM_CODEC.decode(buf),
                    Component.literal("category wire round-trip"));
            helper.assertValueEqual(page, HandbookPage.STREAM_CODEC.decode(buf),
                    Component.literal("page wire round-trip"));
            helper.assertValueEqual(HandbookUnlock.Always.INSTANCE, HandbookUnlock.STREAM_CODEC.decode(buf),
                    Component.literal("always-unlock wire round-trip"));
            helper.assertValueEqual(0, buf.readableBytes(), Component.literal("no trailing wire bytes"));
        } finally {
            buf.release();
        }
        helper.succeed();
    }

    @GameTest
    public void strictDecodersRejectUnknownKeysAndTypes(GameTestHelper helper) {
        assertParseFails(helper, "unknown widget type",
                "{\"type\":\"video\",\"key\":\"x\"}", "unknown widget type");
        assertParseFails(helper, "unknown widget key",
                "{\"type\":\"text\",\"key\":\"handbook.cuprum.x\",\"stlye\":\"body\"}", "unknown field");
        assertParseFails(helper, "missing type",
                "{\"key\":\"handbook.cuprum.x\"}", "missing required field 'type'");
        assertParseFails(helper, "unknown unit vocabulary",
                "{\"type\":\"charge\",\"value_ref\":\"charge.passiveBaselineCgPerTick\",\"unit\":\"kW\"}",
                null);
        assertParseFails(helper, "unknown config ref",
                "{\"type\":\"charge\",\"value_ref\":\"charge.notARealKey\"}", null);
        assertParseFails(helper, "oversized multiblock row",
                "{\"type\":\"multiblock\",\"palette\":{\"C\":\"minecraft:stone\"},"
                        + "\"layers\":[[\"" + "C".repeat(17) + "\"]]}", null);
        helper.succeed();
    }

    @GameTest
    public void hostileWireCountsFailDecode(GameTestHelper helper) {
        // A hostile/skewed server writing an out-of-bounds count must fail decode immediately.
        assertWireDecodeFails(helper, "widget count 25 (> 24)", buf -> {
            // Page wire prefix: id, category, title, 0 subjects, always unlock, 0 extras, then count.
            HandbookWire.ID_STRING.encode(buf, "cuprum:diagnostics/x");
            HandbookWire.ID_STRING.encode(buf, "cuprum:diagnostics");
            HandbookWire.KEY_STRING.encode(buf, "handbook.cuprum.x");
            buf.writeVarInt(0);
            buf.writeVarInt(0); // unlock type index: always
            buf.writeVarInt(0);
            buf.writeVarInt(HandbookPage.MAX_WIDGETS + 1);
        }, b -> HandbookPage.STREAM_CODEC.decode(b));
        assertWireDecodeFails(helper, "unlock type index 7", buf -> buf.writeVarInt(7),
                b -> HandbookUnlock.STREAM_CODEC.decode(b));
        assertWireDecodeFails(helper, "widget type index -1", buf -> buf.writeVarInt(-1),
                b -> HandbookWidget.STREAM_CODEC.decode(b));
        assertWireDecodeFails(helper, "multiblock palette count 65", buf -> {
            buf.writeVarInt(3); // widget type index: multiblock
            buf.writeVarInt(HandbookWidget.MAX_PALETTE_ENTRIES + 1);
        }, b -> HandbookWidget.STREAM_CODEC.decode(b));
        helper.succeed();
    }

    /**
     * Rejection has two legitimate shapes, both of which the real reloader path survives:
     * a {@code DataResult} error from the strict decoders, or an {@link IllegalArgumentException}
     * from a canonical constructor bound (vanilla {@code scanDirectory} catches exactly that
     * and skips the file). Anything decoded successfully fails this gate.
     */
    private void assertParseFails(GameTestHelper helper, String what, String json, String expectedFragment) {
        String message;
        try {
            DataResult<HandbookWidget> result =
                    HandbookWidget.CODEC.parse(JsonOps.INSTANCE, StrictJsonParser.parse(json));
            helper.assertTrue(result.error().isPresent(),
                    Component.literal(what + " was unexpectedly accepted"));
            message = result.error().orElseThrow().message();
        } catch (IllegalArgumentException constructorBound) {
            message = String.valueOf(constructorBound.getMessage());
        }
        if (expectedFragment != null) {
            helper.assertTrue(message.contains(expectedFragment),
                    Component.literal(what + " failed with unexpected message: " + message));
        }
    }

    private void assertWireDecodeFails(GameTestHelper helper, String what,
            Consumer<RegistryFriendlyByteBuf> writer, Consumer<RegistryFriendlyByteBuf> decoder) {
        RegistryFriendlyByteBuf buf =
                new RegistryFriendlyByteBuf(Unpooled.buffer(), helper.getLevel().registryAccess());
        try {
            writer.accept(buf);
            decoder.accept(buf);
            helper.fail(Component.literal(what + " was unexpectedly decoded"));
        } catch (IllegalArgumentException | IndexOutOfBoundsException expected) {
            // bounded decode rejected the hostile buffer — exactly the contract
        } finally {
            buf.release();
        }
    }
}
