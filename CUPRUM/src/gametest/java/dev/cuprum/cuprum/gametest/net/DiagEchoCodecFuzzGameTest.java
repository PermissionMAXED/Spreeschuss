package dev.cuprum.cuprum.gametest.net;

import dev.cuprum.cuprum.config.ConfigSyncPayload;
import dev.cuprum.cuprum.config.CuprumCommonConfig;
import dev.cuprum.cuprum.net.payload.DiagEchoPayload;
import dev.cuprum.cuprum.net.payload.DiagEchoReplyPayload;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.handler.codec.DecoderException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;
import java.util.function.Consumer;
import java.util.function.Function;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.RegistryAccess;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.codec.StreamCodec;

/**
 * Wire-robustness suite for <b>every</b> W1A payload stream codec — the C2S diag-echo request
 * plus the S2C reply and config snapshot (GameTests because {@code RegistryFriendlyByteBuf}
 * needs a live {@code RegistryAccess}). Three layers per codec, all fixed-seed deterministic:
 *
 * <ol>
 *   <li><b>Clean round trips</b> (separately named {@code *RoundTripsCleanCorpus} tests):
 *       explicit numeric/Unicode edge payloads (int/long extrema, empty/max-length strings,
 *       C0/C1 controls, U+2028/U+2029, astral pairs, NFC-growing text) plus seeded payloads —
 *       {@code decode(encode(x)) == x} for 512 buffers per codec, with zero trailing bytes.</li>
 *   <li><b>Mutation fuzz</b> ({@code *SurvivesSeededMutationFuzz} tests): 512 <b>genuinely
 *       mutated</b> buffers per codec (every buffer differs from its clean encoding, asserted
 *       byte-for-byte) across four seeded mutation kinds — byte flips, strict truncation,
 *       trailing-garbage append and varint-structure stomps. Every decode must either succeed
 *       with all invariants holding or throw one of the <b>whitelisted decode rejections</b>
 *       (DecoderException / IllegalArgumentException / IndexOutOfBoundsException / the bare
 *       {@code RuntimeException("VarInt too big"/"VarLong too big")} thrown by vanilla
 *       {@code VarInt/VarLong.read}); any other exception fails the test. Invariants run
 *       <b>outside</b> every catch block, so a failed invariant can never be miscounted as an
 *       expected rejection. Append mutations must additionally decode to the identical
 *       original record (the untouched prefix is authoritative).</li>
 *   <li><b>Crafted hostile buffers</b> ({@code stringCodecsRejectCraftedHostileWire}):
 *       deterministic length-prefix attacks (oversized, negative, longer-than-buffer,
 *       expansion past the UTF-16 cap), varint/varlong overlong encodings, and malformed
 *       UTF-8 content (which vanilla decodes via U+FFFD replacement, still inside bounds).</li>
 * </ol>
 *
 * The full 10,000-buffer corpus is staged for later waves (plan D10).
 */
public class DiagEchoCodecFuzzGameTest {
    private static final long SEED = 0x5EEDED_CAFEL;
    /** Genuinely mutated buffers per codec (plan D10 floor: ≥512 mutated cases). */
    private static final int MUTATED_BUFFERS = 512;
    /** Clean round-trip buffers per codec (edge corpus + seeded fill). */
    private static final int CLEAN_BUFFERS = 512;

    /** Per-codec invariant on any successfully decoded value (mutated buffers included). */
    @FunctionalInterface
    private interface DecodedInvariant<T> {
        void check(GameTestHelper helper, T decoded, int bufferIndex);
    }

    /** A mutated buffer plus the mutation kind that produced it (kinds carry extra invariants). */
    private record Mutation(byte[] bytes, MutationKind kind) {
    }

    private enum MutationKind {
        /** XOR 1..4 bytes with non-zero masks (covers malformed UTF-8 / corrupt varints). */
        FLIP,
        /** Strictly shorter prefix (truncated packet). */
        TRUNCATE,
        /** 1..8 trailing garbage bytes (decode must still yield the original record). */
        APPEND,
        /** Force a continuation-bit change early in the buffer (varint length/structure attack). */
        VARINT_STOMP
    }

    // ---------------------------------------------------------------------------------------
    // Clean round trips (separately named, per codec)
    // ---------------------------------------------------------------------------------------

    @GameTest
    public void diagEchoCodecRoundTripsCleanCorpus(GameTestHelper helper) {
        List<DiagEchoPayload> edges = new ArrayList<>();
        int[] nonces = {Integer.MIN_VALUE, -1, 0, 1, Integer.MAX_VALUE};
        String[] notes = {
                "",
                "a".repeat(DiagEchoPayload.MAX_NOTE_LENGTH),
                "\u0000\u001F\u007F\u0085\u009F", // C0/C1 controls: wire-legal, guard-rejected
                "\u2028\u2029",                   // line/paragraph separators
                "\uD83D\uDE00".repeat(DiagEchoPayload.MAX_NOTE_LENGTH / 2), // astral pairs at cap
                "\u0958".repeat(40),              // NFC-growing text (wire-legal at 40 units)
        };
        for (int nonce : nonces) {
            for (String note : notes) {
                edges.add(new DiagEchoPayload(nonce, note));
            }
        }
        runCleanRoundTrips(helper, DiagEchoPayload.STREAM_CODEC, edges,
                random -> new DiagEchoPayload(random.nextInt(), randomNote(random)));
    }

    @GameTest
    public void diagEchoReplyCodecRoundTripsCleanCorpus(GameTestHelper helper) {
        List<DiagEchoReplyPayload> edges = new ArrayList<>();
        long[] gameTimes = {Long.MIN_VALUE, -1L, 0L, Long.MAX_VALUE};
        String[] shas = {"", "f".repeat(DiagEchoReplyPayload.MAX_SHA_LENGTH)};
        for (int nonce : new int[] {Integer.MIN_VALUE, 0, Integer.MAX_VALUE}) {
            for (long gameTime : gameTimes) {
                for (String sha : shas) {
                    edges.add(new DiagEchoReplyPayload(nonce, gameTime, sha));
                }
            }
        }
        runCleanRoundTrips(helper, DiagEchoReplyPayload.STREAM_CODEC, edges,
                random -> new DiagEchoReplyPayload(random.nextInt(), random.nextLong(), randomSha(random)));
    }

    @GameTest
    public void configSyncCodecRoundTripsCleanCorpus(GameTestHelper helper) {
        List<ConfigSyncPayload> edges = new ArrayList<>();
        edges.add(allBoundsMin());
        edges.add(allBoundsMax());
        edges.add(ConfigSyncPayload.of(new CuprumCommonConfig())); // the INDEX defaults
        runCleanRoundTrips(helper, ConfigSyncPayload.STREAM_CODEC, edges,
                DiagEchoCodecFuzzGameTest::randomConfigSync);
    }

    private <T> void runCleanRoundTrips(GameTestHelper helper, StreamCodec<RegistryFriendlyByteBuf, T> codec,
            List<T> edgeCorpus, Function<Random, T> generator) {
        RegistryAccess registryAccess = helper.getLevel().registryAccess();
        Random random = new Random(SEED);
        List<T> corpus = new ArrayList<>(edgeCorpus);
        while (corpus.size() < CLEAN_BUFFERS) {
            corpus.add(generator.apply(random));
        }
        int roundTrips = 0;
        for (int i = 0; i < corpus.size(); i++) {
            T payload = corpus.get(i);
            byte[] encoded = encode(codec, payload, registryAccess);
            Decoded<T> decoded = decode(codec, encoded, registryAccess);
            helper.assertValueEqual(payload, decoded.value(),
                    Component.literal("clean round trip " + i));
            helper.assertValueEqual(0, decoded.trailingBytes(),
                    Component.literal("trailing bytes after clean decode " + i));
            roundTrips++;
        }
        helper.assertValueEqual(CLEAN_BUFFERS, roundTrips,
                Component.literal("clean corpus size"));
        helper.succeed();
    }

    // ---------------------------------------------------------------------------------------
    // Seeded mutation fuzz (512 genuinely mutated buffers per codec)
    // ---------------------------------------------------------------------------------------

    @GameTest
    public void diagEchoCodecSurvivesSeededMutationFuzz(GameTestHelper helper) {
        runSeededMutationFuzz(helper, DiagEchoPayload.STREAM_CODEC,
                random -> new DiagEchoPayload(random.nextInt(), randomNote(random)),
                (h, decoded, i) -> h.assertTrue(decoded.note().length() <= DiagEchoPayload.MAX_NOTE_LENGTH,
                        Component.literal("decoded note exceeds bound at buffer " + i
                                + " (length " + decoded.note().length() + ")")));
    }

    @GameTest
    public void diagEchoReplyCodecSurvivesSeededMutationFuzz(GameTestHelper helper) {
        runSeededMutationFuzz(helper, DiagEchoReplyPayload.STREAM_CODEC,
                random -> new DiagEchoReplyPayload(random.nextInt(), random.nextLong(), randomSha(random)),
                (h, decoded, i) -> h.assertTrue(
                        decoded.catalogSha().length() <= DiagEchoReplyPayload.MAX_SHA_LENGTH,
                        Component.literal("decoded sha exceeds bound at buffer " + i
                                + " (length " + decoded.catalogSha().length() + ")")));
    }

    @GameTest
    public void configSyncCodecSurvivesSeededMutationFuzz(GameTestHelper helper) {
        runSeededMutationFuzz(helper, ConfigSyncPayload.STREAM_CODEC,
                DiagEchoCodecFuzzGameTest::randomConfigSync,
                (h, decoded, i) -> {
                    // A successful decode implies the canonical constructor accepted every
                    // field; re-assert every bound end-to-end so nothing is assumed.
                    h.assertTrue(decoded.netVersion() >= 1,
                            Component.literal("decoded netVersion out of bounds at buffer " + i));
                    assertInRange(h, i, "passiveBaselineCgPerTick", decoded.passiveBaselineCgPerTick(),
                            CuprumCommonConfig.Bounds.PASSIVE_BASELINE_CG_PER_TICK);
                    assertInRange(h, i, "leydenJarCapacityCg", decoded.leydenJarCapacityCg(),
                            CuprumCommonConfig.Bounds.LEYDEN_JAR_CAPACITY_CG);
                    assertInRange(h, i, "strikeDepositCg", decoded.strikeDepositCg(),
                            CuprumCommonConfig.Bounds.STRIKE_DEPOSIT_CG);
                    assertInRange(h, i, "wireLossPpTenthsPerSpanBare", decoded.wireLossPpTenthsPerSpanBare(),
                            CuprumCommonConfig.Bounds.WIRE_LOSS_PP_TENTHS_PER_SPAN_BARE);
                    assertInRange(h, i, "wireLossPpTenthsPerSpanHv", decoded.wireLossPpTenthsPerSpanHv(),
                            CuprumCommonConfig.Bounds.WIRE_LOSS_PP_TENTHS_PER_SPAN_HV);
                    assertInRange(h, i, "ratePerSecDefault", decoded.ratePerSecDefault(),
                            CuprumCommonConfig.Bounds.RATE_PER_SEC_DEFAULT);
                    assertInRange(h, i, "burstDefault", decoded.burstDefault(),
                            CuprumCommonConfig.Bounds.BURST_DEFAULT);
                    assertInRange(h, i, "rateGlobalPerSec", decoded.rateGlobalPerSec(),
                            CuprumCommonConfig.Bounds.RATE_GLOBAL_PER_SEC);
                    assertInRange(h, i, "violationKickThreshold", decoded.violationKickThreshold(),
                            CuprumCommonConfig.Bounds.VIOLATION_KICK_THRESHOLD);
                    assertInRange(h, i, "violationWindowTicks", decoded.violationWindowTicks(),
                            CuprumCommonConfig.Bounds.VIOLATION_WINDOW_TICKS);
                });
    }

    private <T> void runSeededMutationFuzz(GameTestHelper helper, StreamCodec<RegistryFriendlyByteBuf, T> codec,
            Function<Random, T> generator, DecodedInvariant<T> invariant) {
        RegistryAccess registryAccess = helper.getLevel().registryAccess();
        Random random = new Random(SEED);
        int mutatedDecoded = 0;
        int mutatedRejected = 0;

        for (int i = 0; i < MUTATED_BUFFERS; i++) {
            T payload = generator.apply(random);
            byte[] encoded = encode(codec, payload, registryAccess);
            Mutation mutation = mutate(encoded, random);
            if (Arrays.equals(mutation.bytes(), encoded)) {
                throw new IllegalStateException(
                        "mutation " + i + " (" + mutation.kind() + ") produced identical bytes");
            }

            // ONLY decode lives inside the try: nothing an invariant throws can be swallowed.
            Decoded<T> decoded = null;
            RuntimeException rejection = null;
            try {
                decoded = decode(codec, mutation.bytes(), registryAccess);
            } catch (RuntimeException e) {
                rejection = e;
            }

            if (rejection != null) {
                if (!isExpectedDecodeRejection(rejection)) {
                    throw new IllegalStateException("unexpected decode failure kind at buffer " + i
                            + " (" + mutation.kind() + ")", rejection);
                }
                mutatedRejected++;
                continue;
            }
            mutatedDecoded++;
            invariant.check(helper, decoded.value(), i);
            if (mutation.kind() == MutationKind.APPEND) {
                // The untouched prefix is authoritative: trailing garbage must never change
                // what decodes, only remain unread.
                helper.assertValueEqual(payload, decoded.value(),
                        Component.literal("append mutation altered the decoded record at buffer " + i));
                helper.assertTrue(decoded.trailingBytes() > 0,
                        Component.literal("append mutation left no trailing bytes at buffer " + i));
            }
        }

        helper.assertValueEqual(MUTATED_BUFFERS, mutatedDecoded + mutatedRejected,
                Component.literal("every mutated buffer must be accounted for"));
        helper.assertTrue(mutatedRejected > 0,
                Component.literal("seeded corpus must exercise rejected mutations"));
        helper.assertTrue(mutatedDecoded > 0,
                Component.literal("seeded corpus must exercise surviving mutations"));
        helper.succeed();
    }

    // ---------------------------------------------------------------------------------------
    // Crafted hostile wire buffers (deterministic length/structure attacks)
    // ---------------------------------------------------------------------------------------

    @GameTest
    public void stringCodecsRejectCraftedHostileWire(GameTestHelper helper) {
        RegistryAccess registryAccess = helper.getLevel().registryAccess();
        int utf8Cap = DiagEchoPayload.MAX_NOTE_LENGTH * 3; // ByteBufUtil.utf8MaxBytes(64) = 192

        // Echo note: length prefix beyond the UTF-8 byte cap (bytes actually present).
        assertRejects(helper, "note length prefix > UTF-8 cap",
                craft(out -> {
                    out.writeVarInt(7);
                    out.writeVarInt(utf8Cap + 1);
                    out.writeBytes(new byte[utf8Cap + 1]);
                }, registryAccess));
        // Echo note: negative length prefix.
        assertRejects(helper, "negative note length prefix",
                craft(out -> {
                    out.writeVarInt(7);
                    out.writeVarInt(-1);
                }, registryAccess));
        // Echo note: length prefix longer than the remaining buffer.
        assertRejects(helper, "note length prefix > readable bytes",
                craft(out -> {
                    out.writeVarInt(7);
                    out.writeVarInt(100);
                    out.writeBytes(new byte[10]);
                }, registryAccess));
        // Echo note: byte length within the UTF-8 cap but decoding past the UTF-16 cap.
        assertRejects(helper, "note decodes past the UTF-16 length cap",
                craft(out -> {
                    out.writeVarInt(7);
                    out.writeVarInt(DiagEchoPayload.MAX_NOTE_LENGTH + 1);
                    byte[] ascii = new byte[DiagEchoPayload.MAX_NOTE_LENGTH + 1];
                    Arrays.fill(ascii, (byte) 'a');
                    out.writeBytes(ascii);
                }, registryAccess));
        // Echo nonce: overlong varint (6 continuation bytes) — vanilla VarInt.read throws the
        // bare RuntimeException("VarInt too big"), pinned by the rejection whitelist.
        byte[] overlongVarInt = new byte[6];
        Arrays.fill(overlongVarInt, (byte) 0xFF);
        assertRejects(helper, "overlong nonce varint",
                craft(out -> out.writeBytes(overlongVarInt), registryAccess));
        // Reply gameTime: overlong varlong (11 continuation bytes) → "VarLong too big".
        byte[] overlongVarLong = new byte[11];
        Arrays.fill(overlongVarLong, (byte) 0xFF);
        assertRejectsReply(helper, "overlong gameTime varlong",
                craft(out -> {
                    out.writeVarInt(1);
                    out.writeBytes(overlongVarLong);
                }, registryAccess));
        // Reply sha: oversized length prefix.
        assertRejectsReply(helper, "sha length prefix > UTF-8 cap",
                craft(out -> {
                    out.writeVarInt(1);
                    out.writeVarLong(2L);
                    out.writeVarInt(DiagEchoReplyPayload.MAX_SHA_LENGTH * 3 + 1);
                    out.writeBytes(new byte[DiagEchoReplyPayload.MAX_SHA_LENGTH * 3 + 1]);
                }, registryAccess));

        // Malformed UTF-8 note content: vanilla decodes it with U+FFFD replacement (never an
        // exception) and the result must still respect every bound.
        byte[] malformed = {(byte) 0xC3, (byte) 0x28, (byte) 0xF0, (byte) 0x28};
        Decoded<DiagEchoPayload> replaced = decode(DiagEchoPayload.STREAM_CODEC,
                craft(out -> {
                    out.writeVarInt(7);
                    out.writeVarInt(malformed.length);
                    out.writeBytes(malformed);
                }, registryAccess), registryAccess);
        helper.assertValueEqual(7, replaced.value().nonce(),
                Component.literal("nonce survives malformed-UTF-8 note decode"));
        helper.assertTrue(replaced.value().note().length() <= DiagEchoPayload.MAX_NOTE_LENGTH,
                Component.literal("replacement-decoded note stays inside the bound"));
        helper.assertTrue(replaced.value().note().contains("\uFFFD"),
                Component.literal("malformed UTF-8 must surface as U+FFFD replacement"));
        helper.assertValueEqual(0, replaced.trailingBytes(),
                Component.literal("no trailing bytes after malformed-UTF-8 decode"));
        helper.succeed();
    }

    private void assertRejects(GameTestHelper helper, String label, byte[] wire) {
        assertRejectsWith(helper, label, () ->
                decode(DiagEchoPayload.STREAM_CODEC, wire, helper.getLevel().registryAccess()));
    }

    private void assertRejectsReply(GameTestHelper helper, String label, byte[] wire) {
        assertRejectsWith(helper, label, () ->
                decode(DiagEchoReplyPayload.STREAM_CODEC, wire, helper.getLevel().registryAccess()));
    }

    private static void assertRejectsWith(GameTestHelper helper, String label, Runnable decodeCall) {
        try {
            decodeCall.run();
        } catch (RuntimeException e) {
            if (!isExpectedDecodeRejection(e)) {
                throw new IllegalStateException("crafted case '" + label
                        + "' failed with an unexpected exception kind", e);
            }
            return; // rejected with a whitelisted decode exception, as required
        }
        helper.fail(Component.literal("crafted case '" + label + "' decoded instead of rejecting"));
    }

    // ---------------------------------------------------------------------------------------
    // Shared plumbing
    // ---------------------------------------------------------------------------------------

    /**
     * The exhaustive whitelist of decode-time rejections the wire contract allows for hostile
     * bytes: Netty's {@link DecoderException} (string length/expansion caps), Netty index
     * bounds (truncated buffers), {@link IllegalArgumentException} (canonical-constructor
     * bounds) and the <b>bare</b> {@code RuntimeException("VarInt too big"/"VarLong too big")}
     * thrown by vanilla {@code VarInt/VarLong.read} (verified 1.21.9 sources). Everything else
     * — including any {@code GameTestException} — is a test failure, never an expected
     * rejection.
     */
    private static boolean isExpectedDecodeRejection(RuntimeException e) {
        if (e instanceof DecoderException || e instanceof IndexOutOfBoundsException
                || e instanceof IllegalArgumentException) {
            return true;
        }
        return e.getClass() == RuntimeException.class
                && ("VarInt too big".equals(e.getMessage()) || "VarLong too big".equals(e.getMessage()));
    }

    private static void assertInRange(GameTestHelper helper, int bufferIndex, String field, int value,
            CuprumCommonConfig.IntRange range) {
        helper.assertTrue(range.contains(value),
                Component.literal("decoded " + field + " out of bounds at buffer " + bufferIndex));
    }

    /**
     * Mixed note corpus: mostly printable ASCII with seeded C0/C1 controls, U+2028/U+2029 and
     * astral surrogate pairs, so the wire layer is proven to carry them intact (their rejection
     * is the guard's VALUE step, never the codec's).
     */
    private static String randomNote(Random random) {
        int length = random.nextInt(DiagEchoPayload.MAX_NOTE_LENGTH + 1);
        StringBuilder note = new StringBuilder(length);
        while (note.length() < length) {
            int kind = random.nextInt(10);
            if (kind == 0) {
                char[] controls = {'\n', '\r', '\t', '\u0000', '\u001F', '\u007F', '\u0085',
                        '\u009F', '\u2028', '\u2029'};
                note.append(controls[random.nextInt(controls.length)]);
            } else if (kind == 1 && length - note.length() >= 2) {
                note.appendCodePoint(0x1F600 + random.nextInt(16)); // astral: two UTF-16 units
            } else {
                note.append((char) (' ' + random.nextInt(95))); // printable ASCII
            }
        }
        return note.toString();
    }

    private static String randomSha(Random random) {
        int length = random.nextInt(DiagEchoReplyPayload.MAX_SHA_LENGTH + 1);
        StringBuilder sha = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            sha.append("0123456789abcdef".charAt(random.nextInt(16)));
        }
        return sha.toString();
    }

    /** A valid snapshot: every field drawn uniformly from its shared {@code Bounds} range. */
    private static ConfigSyncPayload randomConfigSync(Random random) {
        return new ConfigSyncPayload(
                1 + random.nextInt(8),
                inRange(random, CuprumCommonConfig.Bounds.PASSIVE_BASELINE_CG_PER_TICK),
                inRange(random, CuprumCommonConfig.Bounds.LEYDEN_JAR_CAPACITY_CG),
                inRange(random, CuprumCommonConfig.Bounds.STRIKE_DEPOSIT_CG),
                inRange(random, CuprumCommonConfig.Bounds.WIRE_LOSS_PP_TENTHS_PER_SPAN_BARE),
                inRange(random, CuprumCommonConfig.Bounds.WIRE_LOSS_PP_TENTHS_PER_SPAN_HV),
                inRange(random, CuprumCommonConfig.Bounds.RATE_PER_SEC_DEFAULT),
                inRange(random, CuprumCommonConfig.Bounds.BURST_DEFAULT),
                inRange(random, CuprumCommonConfig.Bounds.RATE_GLOBAL_PER_SEC),
                inRange(random, CuprumCommonConfig.Bounds.VIOLATION_KICK_THRESHOLD),
                inRange(random, CuprumCommonConfig.Bounds.VIOLATION_WINDOW_TICKS));
    }

    private static ConfigSyncPayload allBoundsMin() {
        return new ConfigSyncPayload(1,
                CuprumCommonConfig.Bounds.PASSIVE_BASELINE_CG_PER_TICK.min(),
                CuprumCommonConfig.Bounds.LEYDEN_JAR_CAPACITY_CG.min(),
                CuprumCommonConfig.Bounds.STRIKE_DEPOSIT_CG.min(),
                CuprumCommonConfig.Bounds.WIRE_LOSS_PP_TENTHS_PER_SPAN_BARE.min(),
                CuprumCommonConfig.Bounds.WIRE_LOSS_PP_TENTHS_PER_SPAN_HV.min(),
                CuprumCommonConfig.Bounds.RATE_PER_SEC_DEFAULT.min(),
                CuprumCommonConfig.Bounds.BURST_DEFAULT.min(),
                CuprumCommonConfig.Bounds.RATE_GLOBAL_PER_SEC.min(),
                CuprumCommonConfig.Bounds.VIOLATION_KICK_THRESHOLD.min(),
                CuprumCommonConfig.Bounds.VIOLATION_WINDOW_TICKS.min());
    }

    private static ConfigSyncPayload allBoundsMax() {
        return new ConfigSyncPayload(Integer.MAX_VALUE,
                CuprumCommonConfig.Bounds.PASSIVE_BASELINE_CG_PER_TICK.max(),
                CuprumCommonConfig.Bounds.LEYDEN_JAR_CAPACITY_CG.max(),
                CuprumCommonConfig.Bounds.STRIKE_DEPOSIT_CG.max(),
                CuprumCommonConfig.Bounds.WIRE_LOSS_PP_TENTHS_PER_SPAN_BARE.max(),
                CuprumCommonConfig.Bounds.WIRE_LOSS_PP_TENTHS_PER_SPAN_HV.max(),
                CuprumCommonConfig.Bounds.RATE_PER_SEC_DEFAULT.max(),
                CuprumCommonConfig.Bounds.BURST_DEFAULT.max(),
                CuprumCommonConfig.Bounds.RATE_GLOBAL_PER_SEC.max(),
                CuprumCommonConfig.Bounds.VIOLATION_KICK_THRESHOLD.max(),
                CuprumCommonConfig.Bounds.VIOLATION_WINDOW_TICKS.max());
    }

    private static int inRange(Random random, CuprumCommonConfig.IntRange range) {
        long span = (long) range.max() - range.min() + 1;
        return (int) (range.min() + Math.floorMod(random.nextLong(), span));
    }

    private static <T> byte[] encode(StreamCodec<RegistryFriendlyByteBuf, T> codec, T payload,
            RegistryAccess registryAccess) {
        ByteBuf buf = Unpooled.buffer();
        try {
            RegistryFriendlyByteBuf out = new RegistryFriendlyByteBuf(buf, registryAccess);
            codec.encode(out, payload);
            byte[] bytes = new byte[out.readableBytes()];
            out.readBytes(bytes);
            return bytes;
        } finally {
            buf.release();
        }
    }

    /** A decoded value plus the bytes the codec left unread (0 for honest encodings). */
    private record Decoded<T>(T value, int trailingBytes) {
    }

    private static <T> Decoded<T> decode(StreamCodec<RegistryFriendlyByteBuf, T> codec, byte[] bytes,
            RegistryAccess registryAccess) {
        ByteBuf buf = Unpooled.wrappedBuffer(bytes);
        try {
            RegistryFriendlyByteBuf in = new RegistryFriendlyByteBuf(buf, registryAccess);
            T value = codec.decode(in);
            return new Decoded<>(value, in.readableBytes());
        } finally {
            buf.release();
        }
    }

    /** Builds a raw wire buffer through the writer (crafted hostile cases). */
    private static byte[] craft(Consumer<RegistryFriendlyByteBuf> writer,
            RegistryAccess registryAccess) {
        ByteBuf buf = Unpooled.buffer();
        try {
            RegistryFriendlyByteBuf out = new RegistryFriendlyByteBuf(buf, registryAccess);
            writer.accept(out);
            byte[] bytes = new byte[out.readableBytes()];
            out.readBytes(bytes);
            return bytes;
        } finally {
            buf.release();
        }
    }

    /**
     * Seeded structural mutations; every kind produces bytes that provably differ from the
     * input (XOR with non-zero masks, strictly shorter prefixes, strictly longer buffers,
     * forced continuation-bit changes), asserted per buffer by the caller.
     */
    private static Mutation mutate(byte[] encoded, Random random) {
        MutationKind kind = MutationKind.values()[random.nextInt(MutationKind.values().length)];
        switch (kind) {
            case FLIP -> {
                byte[] flipped = encoded.clone();
                int flips = 1 + random.nextInt(4);
                for (int i = 0; i < flips; i++) {
                    int index = random.nextInt(flipped.length);
                    flipped[index] ^= (byte) (1 + random.nextInt(255));
                }
                if (Arrays.equals(flipped, encoded)) {
                    // Two seeded flips can cancel on the same index; force a real difference.
                    flipped[0] ^= 0x01;
                }
                return new Mutation(flipped, kind);
            }
            case TRUNCATE -> {
                // Strictly shorter (encodings are never empty: the leading varint is >= 1 byte).
                byte[] truncated = new byte[random.nextInt(encoded.length)];
                System.arraycopy(encoded, 0, truncated, 0, truncated.length);
                return new Mutation(truncated, kind);
            }
            case APPEND -> {
                byte[] extended = new byte[encoded.length + 1 + random.nextInt(8)];
                System.arraycopy(encoded, 0, extended, 0, encoded.length);
                for (int i = encoded.length; i < extended.length; i++) {
                    extended[i] = (byte) random.nextInt(256);
                }
                return new Mutation(extended, kind);
            }
            default -> { // VARINT_STOMP
                byte[] stomped = encoded.clone();
                int index = random.nextInt(Math.min(stomped.length, 10));
                // Force a different byte with the continuation bit flipped or saturated:
                // 0xFF forces "keep reading" (overlong/oversized varints); if the byte is
                // already 0xFF, clearing the continuation bit (0x7F) truncates the varint.
                stomped[index] = stomped[index] == (byte) 0xFF ? (byte) 0x7F : (byte) 0xFF;
                return new Mutation(stomped, kind);
            }
        }
    }
}
