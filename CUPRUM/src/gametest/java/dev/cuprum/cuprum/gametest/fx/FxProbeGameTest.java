package dev.cuprum.cuprum.gametest.fx;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.blockentity.FxProbeBlockEntity;
import dev.cuprum.cuprum.fx.FxContent;
import dev.cuprum.cuprum.fx.FxRipplePayload;
import dev.cuprum.cuprum.fx.core.FxBudgets;
import dev.cuprum.cuprum.state.CuprumSchema;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import java.util.List;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.BlockPos;
import net.minecraft.core.RegistryAccess;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.util.ProblemReporter;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.storage.TagValueOutput;

/**
 * Server GameTests for the FX probe (client-fx.md §12: dispatch/state only — render
 * assertions live in the client GameTest per the parity scope rules).
 */
public class FxProbeGameTest {
    private static final BlockPos PROBE_POS = new BlockPos(1, 1, 1);

    @GameTest
    public void fxProbeUsePulses(GameTestHelper helper) {
        helper.setBlock(PROBE_POS, FxContent.FX_PROBE);
        helper.assertBlockPresent(FxContent.FX_PROBE, PROBE_POS);

        FxProbeBlockEntity probe = helper.getBlockEntity(PROBE_POS, FxProbeBlockEntity.class);
        helper.assertValueEqual(0L, probe.pulses(), Component.literal("fresh probe pulse counter"));

        // Server-side use records the pulse and dispatches the ripple payload to tracking
        // players (none in a GameTest — dispatch must be a no-op, never an error: the visual
        // is presentation-only and outcome-neutral).
        helper.useBlock(PROBE_POS, helper.makeMockPlayer(GameType.SURVIVAL));
        helper.assertValueEqual(1L, probe.pulses(), Component.literal("pulse counter after first use"));
        helper.useBlock(PROBE_POS, helper.makeMockPlayer(GameType.SURVIVAL));
        helper.assertValueEqual(2L, probe.pulses(), Component.literal("pulse counter after second use"));

        // Envelope proof (plan §3.1): cuprum_state child carries schema + pulses.
        try (ProblemReporter.ScopedCollector reporter = new ProblemReporter.ScopedCollector(Cuprum.LOGGER)) {
            TagValueOutput output = TagValueOutput.createWithContext(reporter, helper.getLevel().registryAccess());
            probe.saveCustomOnly(output);
            CompoundTag envelope = output.buildResult().getCompoundOrEmpty(FxProbeBlockEntity.STATE_KEY);
            helper.assertValueEqual(CuprumSchema.BLOCK_ENTITY,
                    envelope.getIntOr(CuprumSchema.KEY, -1),
                    Component.literal("cuprum_schema in the fx_probe envelope"));
            helper.assertValueEqual(2L,
                    envelope.getLongOr(FxProbeBlockEntity.PULSES_KEY, -1L),
                    Component.literal("pulses persisted in the fx_probe envelope"));
        }

        // Break-drop parity with the charge probe test.
        helper.getLevel().destroyBlock(helper.absolutePos(PROBE_POS), true);
        helper.assertBlockPresent(Blocks.AIR, PROBE_POS);
        helper.assertItemEntityPresent(FxContent.FX_PROBE_ITEM, PROBE_POS, 2.0);

        helper.succeed();
    }

    @GameTest
    public void fxRipplePayloadCodecContract(GameTestHelper helper) {
        RegistryAccess registryAccess = helper.getLevel().registryAccess();

        // Clean round trips across the radius/color/time envelope (S2C event, plan §3.2).
        List<FxRipplePayload> corpus = List.of(
                new FxRipplePayload(new BlockPos(0, 0, 0), 1, 0, 0L),
                new FxRipplePayload(new BlockPos(1, -60, 4), 768, 0xFFE77C56, 1234567L),
                new FxRipplePayload(new BlockPos(-30000000, -64, 29999999), FxBudgets.MAX_RADIUS_Q8,
                        0xFFFFFFFF, Long.MAX_VALUE));
        for (FxRipplePayload payload : corpus) {
            byte[] encoded = encode(registryAccess, payload);
            helper.assertValueEqual(true, encoded.length <= FxBudgets.RIPPLE_PAYLOAD_MAX_BYTES,
                    Component.literal("wire budget ★ ≤" + FxBudgets.RIPPLE_PAYLOAD_MAX_BYTES
                            + " bytes (actual " + encoded.length + ")"));
            FxRipplePayload decoded = decode(registryAccess, encoded);
            helper.assertValueEqual(payload, decoded, Component.literal("decode(encode(x)) == x"));
        }

        // Bounds are rejected (never clamped) at construction AND on hostile decode.
        assertRejected(helper, () -> new FxRipplePayload(BlockPos.ZERO, 0, 0, 0L), "radiusQ8 = 0");
        assertRejected(helper, () -> new FxRipplePayload(BlockPos.ZERO, -768, 0, 0L), "radiusQ8 < 0");
        assertRejected(helper, () -> new FxRipplePayload(BlockPos.ZERO, FxBudgets.MAX_RADIUS_Q8 + 1, 0, 0L),
                "radiusQ8 > max");
        byte[] hostile = encode(registryAccess, new FxRipplePayload(BlockPos.ZERO, 1, 0, 0L));
        hostile[8] = 0; // radius VAR_INT position: BlockPos long (8 bytes) then radius
        assertRejected(helper, () -> decode(registryAccess, hostile), "hostile wire radius 0");

        helper.succeed();
    }

    private static void assertRejected(GameTestHelper helper, Runnable action, String label) {
        try {
            action.run();
        } catch (IllegalArgumentException e) {
            return; // canonical-constructor rejection — the payload contract
        }
        helper.fail(Component.literal("expected IllegalArgumentException: " + label));
    }

    private static byte[] encode(RegistryAccess registryAccess, FxRipplePayload payload) {
        ByteBuf buf = Unpooled.buffer();
        try {
            RegistryFriendlyByteBuf out = new RegistryFriendlyByteBuf(buf, registryAccess);
            FxRipplePayload.STREAM_CODEC.encode(out, payload);
            byte[] bytes = new byte[out.readableBytes()];
            out.readBytes(bytes);
            return bytes;
        } finally {
            buf.release();
        }
    }

    private static FxRipplePayload decode(RegistryAccess registryAccess, byte[] bytes) {
        ByteBuf buf = Unpooled.wrappedBuffer(bytes);
        try {
            return FxRipplePayload.STREAM_CODEC.decode(new RegistryFriendlyByteBuf(buf, registryAccess));
        } finally {
            buf.release();
        }
    }
}
