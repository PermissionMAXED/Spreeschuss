package dev.cuprum.cuprum.gametest.multiblock;

import com.google.gson.JsonParseException;
import com.mojang.serialization.DataResult;
import com.mojang.serialization.JsonOps;
import dev.cuprum.cuprum.block.DiagnosticCoilCoreBlockEntity;
import dev.cuprum.cuprum.machine.MachineContent;
import dev.cuprum.cuprum.multiblock.FaultCode;
import dev.cuprum.cuprum.multiblock.FormationState;
import dev.cuprum.cuprum.multiblock.MultiblockLevelIndex;
import dev.cuprum.cuprum.multiblock.MultiblockMatchResult;
import dev.cuprum.cuprum.multiblock.MultiblockOrientation;
import dev.cuprum.cuprum.multiblock.MultiblockPattern;
import dev.cuprum.cuprum.multiblock.MultiblockPatternTestAccess;
import dev.cuprum.cuprum.multiblock.MultiblockPatterns;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerChunkCache;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.packs.PackLocationInfo;
import net.minecraft.server.packs.PackResources;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.metadata.MetadataSectionType;
import net.minecraft.server.packs.repository.KnownPack;
import net.minecraft.server.packs.repository.PackSource;
import net.minecraft.server.packs.resources.IoSupplier;
import net.minecraft.server.packs.resources.MultiPackResourceManager;
import net.minecraft.server.packs.resources.PreparableReloadListener;
import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.util.StrictJsonParser;

/** Permanent regressions for exhaustive match ranking and the real JSON-reloader boundary. */
public class MultiblockPatternReloadGameTest {
    private static final String MALFORMED_RELOAD =
            "cuprum-gametest:multiblock_malformed_reload";
    private static final String MISSING_RELOAD =
            "cuprum-gametest:multiblock_missing_reload";
    private static final String CHUNK_LIFECYCLE =
            "cuprum-gametest:multiblock_chunk_lifecycle";
    private static final ResourceLocation RANK_PATTERN =
            ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "rank_probe");
    private static final ResourceLocation TAG_PATTERN =
            ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "matcher_tag_probe");
    private static final ResourceLocation LITERAL_STATE_PATTERN =
            ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "literal_state_probe");
    private static final ResourceLocation TRANSFORMED_FACING_PATTERN =
            ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "transformed_facing_probe");
    private static final ResourceLocation CONTROLLER_FACING_PATTERN =
            ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "controller_facing_probe");
    private static final ResourceLocation UNLOAD_RANK_PATTERN =
            ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "unload_rank_probe");
    private static final BlockPosPair RANK_ANCHOR =
            new BlockPosPair(new net.minecraft.core.BlockPos(1, 1, 1), new net.minecraft.core.BlockPos(3, 1, 1));
    private static final MultiblockOrientation UNROTATED =
            new MultiblockOrientation(Rotation.NONE, Mirror.NONE);

    @GameTest(maxTicks = 100)
    public void patternRanksEverySafelyLoadedCellAndPreservesFirstMismatch(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper, RANK_PATTERN);
        net.minecraft.core.BlockPos anchor = RANK_ANCHOR.anchor();

        // NONE: C A <wrong> B B => first mismatch at cell 3, but 4/5 total matches.
        helper.setBlock(anchor, Blocks.IRON_BLOCK);
        helper.setBlock(anchor.offset(1, 0, 0), Blocks.POLISHED_ANDESITE);
        helper.setBlock(anchor.offset(2, 0, 0), Blocks.DIRT);
        helper.setBlock(anchor.offset(3, 0, 0), Blocks.STONE_BRICKS);
        helper.setBlock(anchor.offset(4, 0, 0), Blocks.STONE_BRICKS);
        // CW90: C A B <air> <air> => longer matching prefix, but only 3/5 total.
        helper.setBlock(anchor.offset(0, 0, 1), Blocks.POLISHED_ANDESITE);
        helper.setBlock(anchor.offset(0, 0, 2), Blocks.STONE_BRICKS);

        MultiblockMatchResult result = pattern.tryMatch(helper.getLevel(), helper.absolutePos(anchor));
        helper.assertTrue(result.match().isEmpty(), Component.literal("no orientation fully matches"));
        helper.assertValueEqual(helper.absolutePos(RANK_ANCHOR.firstNoneMismatch()),
                result.bestFault().orElseThrow().pos().orElseThrow(),
                Component.literal("4/5 total-match orientation wins while retaining its first mismatch"));
        helper.succeed();
    }

    @GameTest(maxTicks = 100)
    public void patternTotalMatchTieUsesCanonicalOrientationOrder(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper, RANK_PATTERN);
        net.minecraft.core.BlockPos anchor = new net.minecraft.core.BlockPos(1, 1, 1);
        helper.setBlock(anchor, Blocks.IRON_BLOCK);

        MultiblockMatchResult result = pattern.tryMatch(helper.getLevel(), helper.absolutePos(anchor));
        helper.assertValueEqual(helper.absolutePos(anchor.offset(1, 0, 0)),
                result.bestFault().orElseThrow().pos().orElseThrow(),
                Component.literal("equal total scores retain the first canonical orientation (NONE)"));
        helper.succeed();
    }

    @GameTest(maxTicks = 100)
    public void tagMatcherAcceptsTaggedBlocksAndRejectsOthers(GameTestHelper helper) {
        ServerLevel level = helper.getLevel();
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper, TAG_PATTERN);

        BlockPos oak = new BlockPos(2, 1, 2);
        helper.setBlock(oak, Blocks.IRON_BLOCK);
        helper.setBlock(oak.east(), Blocks.OAK_LOG);
        helper.assertTrue(pattern.tryMatch(level, helper.absolutePos(oak)).match().isPresent(),
                Component.literal("tag matcher accepts oak_log from #minecraft:logs"));

        BlockPos spruce = new BlockPos(2, 3, 2);
        helper.setBlock(spruce, Blocks.IRON_BLOCK);
        helper.setBlock(spruce.east(), Blocks.SPRUCE_LOG);
        helper.assertTrue(pattern.tryMatch(level, helper.absolutePos(spruce)).match().isPresent(),
                Component.literal("tag matcher accepts spruce_log from #minecraft:logs"));

        BlockPos stone = new BlockPos(2, 5, 2);
        helper.setBlock(stone, Blocks.IRON_BLOCK);
        helper.setBlock(stone.east(), Blocks.STONE);
        MultiblockMatchResult rejected = pattern.tryMatch(level, helper.absolutePos(stone));
        helper.assertTrue(rejected.match().isEmpty(), Component.literal("tag matcher rejects untagged stone"));
        helper.assertValueEqual(helper.absolutePos(stone.east()),
                rejected.bestFault().orElseThrow().pos().orElseThrow(),
                Component.literal("tag mismatch names its member"));
        helper.succeed();
    }

    @GameTest(maxTicks = 100)
    public void stateMatcherValuesRemainLiteralAcrossOrientation(GameTestHelper helper) {
        ServerLevel level = helper.getLevel();
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper, LITERAL_STATE_PATTERN);
        BlockState axisX = Blocks.OAK_LOG.defaultBlockState()
                .setValue(BlockStateProperties.AXIS, Direction.Axis.X);
        BlockState axisZ = Blocks.OAK_LOG.defaultBlockState()
                .setValue(BlockStateProperties.AXIS, Direction.Axis.Z);

        BlockPos none = new BlockPos(2, 1, 2);
        helper.setBlock(none, Blocks.IRON_BLOCK);
        helper.setBlock(none.east(), axisX);
        helper.assertValueEqual(UNROTATED,
                pattern.tryMatch(level, helper.absolutePos(none)).match().orElseThrow().orientation(),
                Component.literal("literal axis=x state matches under NONE"));

        BlockPos rotated = new BlockPos(2, 3, 2);
        helper.setBlock(rotated, Blocks.IRON_BLOCK);
        helper.setBlock(rotated.south(), axisX);
        helper.assertValueEqual(new MultiblockOrientation(Rotation.CLOCKWISE_90, Mirror.NONE),
                pattern.tryMatch(level, helper.absolutePos(rotated)).match().orElseThrow().orientation(),
                Component.literal("axis=x remains literal while the member position rotates"));

        BlockPos transformedValue = new BlockPos(2, 5, 2);
        helper.setBlock(transformedValue, Blocks.IRON_BLOCK);
        helper.setBlock(transformedValue.south(), axisZ);
        MultiblockMatchResult rejected = pattern.tryMatch(level, helper.absolutePos(transformedValue));
        helper.assertTrue(rejected.match().isEmpty(),
                Component.literal("state axis is not transformed from x to z"));
        helper.assertValueEqual(FaultCode.MISMATCH, rejected.bestFault().orElseThrow().code(),
                Component.literal("literal state mismatch reports MISMATCH"));
        helper.succeed();
    }

    @GameTest(maxTicks = 100)
    public void facingMatcherValueTransformsWithRotationAndMirror(GameTestHelper helper) {
        ServerLevel level = helper.getLevel();
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper, TRANSFORMED_FACING_PATTERN);

        BlockPos none = new BlockPos(2, 1, 2);
        helper.setBlock(none, Blocks.IRON_BLOCK);
        helper.setBlock(none.east(), furnaceFacing(Direction.NORTH));
        helper.assertValueEqual(UNROTATED,
                pattern.tryMatch(level, helper.absolutePos(none)).match().orElseThrow().orientation(),
                Component.literal("facing=north matches under NONE"));

        BlockPos rotated = new BlockPos(2, 2, 2);
        helper.setBlock(rotated, Blocks.IRON_BLOCK);
        helper.setBlock(rotated.south(), furnaceFacing(Direction.EAST));
        helper.assertValueEqual(new MultiblockOrientation(Rotation.CLOCKWISE_90, Mirror.NONE),
                pattern.tryMatch(level, helper.absolutePos(rotated)).match().orElseThrow().orientation(),
                Component.literal("facing north transforms to east under CW90"));

        BlockPos mirrored = new BlockPos(2, 3, 2);
        helper.setBlock(mirrored, Blocks.IRON_BLOCK);
        helper.setBlock(mirrored.east(), furnaceFacing(Direction.SOUTH));
        helper.assertValueEqual(new MultiblockOrientation(Rotation.NONE, Mirror.LEFT_RIGHT),
                pattern.tryMatch(level, helper.absolutePos(mirrored)).match().orElseThrow().orientation(),
                Component.literal("facing north transforms to south under LEFT_RIGHT"));

        BlockPos rejected = new BlockPos(2, 4, 2);
        helper.setBlock(rejected, Blocks.IRON_BLOCK);
        helper.setBlock(rejected.east(), furnaceFacing(Direction.WEST));
        MultiblockMatchResult result = pattern.tryMatch(level, helper.absolutePos(rejected));
        helper.assertTrue(result.match().isEmpty(),
                Component.literal("west-facing furnace satisfies no candidate"));
        helper.assertValueEqual(FaultCode.MISMATCH, result.bestFault().orElseThrow().code(),
                Component.literal("facing mismatch reports MISMATCH"));
        helper.succeed();
    }

    @GameTest(maxTicks = 100)
    public void controllerFacingSelectsOnlyTheControllerDerivedRotation(GameTestHelper helper) {
        ServerLevel level = helper.getLevel();
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper, CONTROLLER_FACING_PATTERN);

        BlockPos east = new BlockPos(2, 1, 2);
        helper.setBlock(east, furnaceFacing(Direction.EAST));
        helper.setBlock(east.east(), Blocks.STONE_BRICKS);
        helper.assertValueEqual(new MultiblockOrientation(Rotation.CLOCKWISE_90, Mirror.NONE),
                pattern.tryMatch(level, helper.absolutePos(east)).match().orElseThrow().orientation(),
                Component.literal("east-facing controller selects exactly CW90"));

        BlockPos wrongMember = new BlockPos(2, 3, 2);
        helper.setBlock(wrongMember, furnaceFacing(Direction.EAST));
        helper.setBlock(wrongMember.north(), Blocks.STONE_BRICKS);
        MultiblockMatchResult rejected = pattern.tryMatch(level, helper.absolutePos(wrongMember));
        helper.assertTrue(rejected.match().isEmpty(),
                Component.literal("controller_facing does not search alternate rotations"));
        helper.assertValueEqual(helper.absolutePos(wrongMember.east()),
                rejected.bestFault().orElseThrow().pos().orElseThrow(),
                Component.literal("fault names the controller-transformed member"));

        BlockPos north = new BlockPos(2, 5, 2);
        helper.setBlock(north, furnaceFacing(Direction.NORTH));
        helper.setBlock(north.north(), Blocks.STONE_BRICKS);
        helper.assertValueEqual(UNROTATED,
                pattern.tryMatch(level, helper.absolutePos(north)).match().orElseThrow().orientation(),
                Component.literal("north-facing controller selects NONE"));

        BlockPos noFacing = new BlockPos(5, 1, 5);
        helper.setBlock(noFacing, Blocks.IRON_BLOCK);
        MultiblockMatchResult noFacingResult = pattern.tryMatch(level, helper.absolutePos(noFacing));
        helper.assertTrue(noFacingResult.match().isEmpty(),
                Component.literal("controller without horizontal facing cannot match"));
        helper.assertTrue(noFacingResult.bestFault().orElseThrow().detail().contains("no horizontal"),
                Component.literal("controller-facing fault explains the missing property"));
        helper.succeed();
    }

    @GameTest(environment = CHUNK_LIFECYCLE, maxTicks = 600)
    public void unloadedCellShortCircuitsReadsAndRankingUsesMatchedBeforeFailure(GameTestHelper helper) {
        ServerLevel level = helper.getLevel();
        ServerChunkCache chunks = level.getChunkSource();
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper, UNLOAD_RANK_PATTERN);
        MultiblockPattern controllerFacingPattern =
                MultiblockTestHelper.requirePattern(helper, CONTROLLER_FACING_PATTERN);
        BlockPos base = helper.absolutePos(new BlockPos(-64 * 16, 1, -64 * 16));
        ChunkPos anchorChunk = new ChunkPos(base);
        BlockPos anchor = new BlockPos(anchorChunk.getMinBlockX(), base.getY(),
                anchorChunk.getMinBlockZ() + 8);
        BlockPos facingAnchor = new BlockPos(anchorChunk.getMinBlockX(), base.getY(),
                anchorChunk.getMinBlockZ() + 12);
        ChunkPos westChunk = new ChunkPos(anchorChunk.x - 1, anchorChunk.z);
        ChunkPos anchorTicket = new ChunkPos(anchorChunk.x + 2, anchorChunk.z);

        helper.assertTrue(level.setChunkForced(anchorChunk.x, anchorChunk.z, true),
                Component.literal("anchor chunk force-loaded for setup"));
        level.setBlockAndUpdate(anchor, Blocks.IRON_BLOCK.defaultBlockState());
        level.setBlockAndUpdate(anchor.east(), Blocks.STONE_BRICKS.defaultBlockState());
        level.setBlockAndUpdate(anchor.east(2), Blocks.STONE_BRICKS.defaultBlockState());
        level.setBlockAndUpdate(anchor.east(3), Blocks.STONE_BRICKS.defaultBlockState());
        level.setBlockAndUpdate(facingAnchor, furnaceFacing(Direction.WEST));
        helper.assertTrue(level.setChunkForced(anchorTicket.x, anchorTicket.z, true),
                Component.literal("border ticket keeps only the anchor chunk loaded"));

        helper.startSequence().thenExecuteAfter(5, () ->
                helper.assertTrue(level.setChunkForced(anchorChunk.x, anchorChunk.z, false),
                        Component.literal("setup ticket removed"))
        ).thenWaitUntil(() -> {
            if (chunks.getChunkNow(westChunk.x, westChunk.z) != null) {
                throw helper.assertionException(Component.literal("awaiting west chunk unload"));
            }
            if (chunks.getChunkNow(anchorChunk.x, anchorChunk.z) == null) {
                throw helper.assertionException(Component.literal("anchor chunk must remain loaded"));
            }
        }).thenExecute(() -> {
            MultiblockPatternTestAccess.MatchTrace mixed =
                    MultiblockPatternTestAccess.tryMatch(pattern, level, anchor);
            helper.assertTrue(mixed.result().match().isEmpty(),
                    Component.literal("mixed unloaded/mismatch layout has no match"));
            helper.assertValueEqual(FaultCode.MISMATCH,
                    mixed.result().bestFault().orElseThrow().code(),
                    Component.literal("higher matched-before-failure loaded orientation wins"));
            helper.assertValueEqual(anchor.north(),
                    mixed.result().bestFault().orElseThrow().pos().orElseThrow(),
                    Component.literal("equal score keeps earlier CW90 orientation"));
            assertShortCircuitReadCounts(helper, mixed);

            MultiblockPatternTestAccess.MatchTrace singleOrientation =
                    MultiblockPatternTestAccess.tryMatch(controllerFacingPattern, level, facingAnchor);
            helper.assertValueEqual(FaultCode.UNLOADED,
                    singleOrientation.result().bestFault().orElseThrow().code(),
                    Component.literal("controller-derived orientation reports its unloaded first cell"));
            helper.assertValueEqual(facingAnchor.west(),
                    singleOrientation.result().bestFault().orElseThrow().pos().orElseThrow(),
                    Component.literal("fault is the deterministic first unloaded cell"));
            helper.assertValueEqual(0,
                    singleOrientation.reads(new MultiblockOrientation(
                            Rotation.COUNTERCLOCKWISE_90, Mirror.NONE)),
                    Component.literal("single orientation performs no member read after unload"));
            helper.assertTrue(chunks.getChunkNow(westChunk.x, westChunk.z) == null,
                    Component.literal("matching never force-loads the unloaded chunk"));
            level.setChunkForced(anchorTicket.x, anchorTicket.z, false);
            helper.succeed();
        });
    }

    @GameTest(environment = MALFORMED_RELOAD, maxTicks = 100)
    public void realReloaderRejectsMalformedAndAbusiveResourcesBeforeApply(GameTestHelper helper) {
        List<InvalidResource> cases = List.of(
                new InvalidResource("unknown_top", base("\"unknown\":{}"), "unknown field 'unknown'"),
                new InvalidResource("unknown_matcher",
                        baseWithMatcher("{\"block\":\"minecraft:stone\",\"unknown\":true}"),
                        "unknown field 'unknown'"),
                new InvalidResource("nested_state",
                        baseWithMatcher("{\"block\":\"minecraft:stone\",\"state\":{\"axis\":{\"nested\":[]}}}"),
                        "state['axis'] must be a string"),
                new InvalidResource("invalid_block",
                        baseWithMatcher("{\"block\":\"missing:not_a_block\"}"),
                        "is not a registered block"),
                new InvalidResource("invalid_property",
                        baseWithMatcher("{\"block\":\"minecraft:stone\",\"state\":{\"missing\":\"x\"}}"),
                        "has no state property 'missing'"),
                new InvalidResource("invalid_value",
                        baseWithMatcher("{\"block\":\"minecraft:oak_log\",\"state\":{\"axis\":\"diagonal\"}}"),
                        "has no value 'diagonal'"),
                new InvalidResource("tag_state",
                        baseWithMatcher("{\"tag\":\"minecraft:logs\",\"state\":{\"axis\":\"x\"}}"),
                        "tag with state/facing constraints"),
                new InvalidResource("too_many_layers", tooManyLayers(), "layers count 17"),
                new InvalidResource("too_many_palette_entries", tooManyPaletteEntries(), "key entries count 65"),
                new InvalidResource("too_many_state_entries", tooManyStateEntries(), "state defines 33 entries"),
                new InvalidResource("long_property", longProperty(), "state property length 65"),
                new InvalidResource("broken_syntax", "{", "Failed to parse"));

        ResourceManager productionResources = helper.getLevel().getServer().getResourceManager();
        try {
            for (InvalidResource testCase : cases) {
                String failure = codecFailure(testCase.json());
                helper.assertTrue(failure.contains(testCase.expectedMessage()),
                        Component.literal(testCase.id() + " failure was '" + failure + "'"));

                ResourceLocation controlFile = ResourceLocation.fromNamespaceAndPath(
                        "cuprum-control", "cuprum_multiblock/control_" + testCase.id() + ".json");
                ResourceLocation malformedFile = ResourceLocation.fromNamespaceAndPath(
                        "cuprum-malformed", "cuprum_multiblock/" + testCase.id() + ".json");
                try (MultiPackResourceManager resources = new MultiPackResourceManager(
                        PackType.SERVER_DATA, List.of(new JsonPack(Map.of(
                                controlFile, baseWithMatcher("{\"block\":\"minecraft:stone\"}"),
                                malformedFile, testCase.json()))))) {
                    reloadPatterns(resources);
                }
                helper.assertTrue(MultiblockPatterns.get(
                                ResourceLocation.fromNamespaceAndPath(
                                        "cuprum-control", "control_" + testCase.id())).isPresent(),
                        Component.literal("real reloader applied the valid control beside " + testCase.id()));
                helper.assertTrue(MultiblockPatterns.get(
                                ResourceLocation.fromNamespaceAndPath(
                                        "cuprum-malformed", testCase.id())).isEmpty(),
                        Component.literal("real reloader rejected malformed resource " + testCase.id()));
            }
        } finally {
            reloadPatterns(productionResources);
        }
        helper.succeed();
    }

    @GameTest(environment = MISSING_RELOAD, maxTicks = 100)
    public void realReloadMissingPatternRetainsClaimsThenRestoredPatternRejectsConflict(GameTestHelper helper) {
        BlockPos coreA = new BlockPos(2, 1, 2);
        BlockPos coreB = new BlockPos(2, 1, 4);
        BlockPos shared = new BlockPos(1, 1, 3);
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(
                helper, DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, coreA,
                new MultiblockOrientation(Rotation.NONE, Mirror.NONE));
        MultiblockTestHelper.awaitFormation(helper, coreA, FormationState.FORMED, () -> {
            DiagnosticCoilCoreBlockEntity coilA = MultiblockTestHelper.coilCore(helper, coreA);
            ResourceManager productionResources = helper.getLevel().getServer().getResourceManager();
            boolean restored = false;
            try {
                try (MultiPackResourceManager empty =
                             new MultiPackResourceManager(PackType.SERVER_DATA, List.of())) {
                    reloadPatterns(empty);
                }
                coilA.multiblockBehavior().serverTick(helper.getLevel());
                helper.assertValueEqual(FormationState.FAULT, coilA.multiblockBehavior().state(),
                        Component.literal("missing pattern reload faults the formed controller"));
                helper.assertValueEqual(FaultCode.PATTERN_MISSING,
                        coilA.multiblockBehavior().fault().orElseThrow().code(),
                        Component.literal("missing pattern reports PATTERN_MISSING"));
                helper.assertValueEqual(helper.absolutePos(coreA),
                        MultiblockLevelIndex.get(helper.getLevel()).controllerAt(helper.absolutePos(shared)),
                        Component.literal("claims survive a missing-pattern reload"));

                // A second physical match appears while the pattern is absent.
                helper.setBlock(new BlockPos(1, 1, 4), MachineContent.DIAGNOSTIC_COIL_FRAME);
                helper.setBlock(new BlockPos(3, 1, 4), MachineContent.DIAGNOSTIC_COIL_FRAME);
                helper.setBlock(new BlockPos(1, 1, 5), MachineContent.DIAGNOSTIC_COIL_FRAME);
                helper.setBlock(new BlockPos(2, 1, 5), Blocks.OXIDIZED_COPPER);
                helper.setBlock(new BlockPos(3, 1, 5), Blocks.WAXED_COPPER_BLOCK);
                helper.setBlock(coreB, MachineContent.DIAGNOSTIC_COIL_CORE);

                reloadPatterns(productionResources);
                restored = true;
                coilA.multiblockBehavior().serverTick(helper.getLevel());
                DiagnosticCoilCoreBlockEntity coilB = MultiblockTestHelper.coilCore(helper, coreB);
                coilB.multiblockBehavior().serverTick(helper.getLevel());
                helper.assertValueEqual(FormationState.FORMED, coilA.multiblockBehavior().state(),
                        Component.literal("restored pattern reforms original owner"));
                helper.assertValueEqual(FormationState.FAULT, coilB.multiblockBehavior().state(),
                        Component.literal("restored pattern detects the overlapping challenger"));
                helper.assertValueEqual(FaultCode.CONFLICT,
                        coilB.multiblockBehavior().fault().orElseThrow().code(),
                        Component.literal("post-reload overlap reports conflict"));
                helper.assertValueEqual(helper.absolutePos(coreA),
                        MultiblockLevelIndex.get(helper.getLevel()).controllerAt(helper.absolutePos(shared)),
                        Component.literal("reload conflict preserves original claims"));
            } finally {
                if (!restored) {
                    reloadPatterns(productionResources);
                }
            }
            helper.succeed();
        });
    }

    private static BlockState furnaceFacing(Direction facing) {
        return Blocks.FURNACE.defaultBlockState()
                .setValue(BlockStateProperties.HORIZONTAL_FACING, facing);
    }

    private static void assertShortCircuitReadCounts(
            GameTestHelper helper, MultiblockPatternTestAccess.MatchTrace trace) {
        List<MultiblockOrientation> orientations = MultiblockOrientation.HORIZONTAL_UNMIRRORED;
        helper.assertValueEqual(0, trace.reads(orientations.get(0)),
                Component.literal("NONE performs zero reads after its first unloaded cell"));
        helper.assertValueEqual(5, trace.reads(orientations.get(1)),
                Component.literal("CW90 reads all five loaded cells"));
        helper.assertValueEqual(2, trace.reads(orientations.get(2)),
                Component.literal("CW180 stops after two reads at its unloaded third cell"));
        helper.assertValueEqual(5, trace.reads(orientations.get(3)),
                Component.literal("CCW90 reads all five loaded cells"));
        int totalReads = trace.readsByOrientation().values().stream().mapToInt(Integer::intValue).sum();
        helper.assertValueEqual(12, totalReads,
                Component.literal("exact total guarded member-state reads"));
    }

    private static void reloadPatterns(ResourceManager resources) {
        PreparableReloadListener.SharedState state = new PreparableReloadListener.SharedState(resources);
        new MultiblockPatterns().reload(
                state,
                Runnable::run,
                new PreparableReloadListener.PreparationBarrier() {
                    @Override
                    public <T> java.util.concurrent.CompletableFuture<T> wait(T value) {
                        return java.util.concurrent.CompletableFuture.completedFuture(value);
                    }
                },
                Runnable::run).join();
    }

    private static String codecFailure(String json) {
        try {
            DataResult<MultiblockPattern> result =
                    MultiblockPattern.CODEC.parse(JsonOps.INSTANCE, StrictJsonParser.parse(json));
            return result.error().map(DataResult.Error::message).orElse("codec unexpectedly accepted resource");
        } catch (JsonParseException | IllegalArgumentException e) {
            return "Failed to parse: " + e.getMessage();
        }
    }

    private static String base(String extraField) {
        return """
                {
                  "format_version":1,
                  "orientation_mode":"any_horizontal",
                  "allow_mirror":false,
                  "layers":[["C"]],
                  "key":{"C":{"block":"minecraft:stone"}},
                  "controller":"C",
                  %s
                }
                """.formatted(extraField);
    }

    private static String baseWithMatcher(String matcher) {
        return """
                {
                  "format_version":1,
                  "orientation_mode":"any_horizontal",
                  "allow_mirror":false,
                  "layers":[["C"]],
                  "key":{"C":%s},
                  "controller":"C"
                }
                """.formatted(matcher);
    }

    private static String tooManyLayers() {
        return baseWithLayers("\"C\"," .repeat(16) + "\"C\"");
    }

    private static String baseWithLayers(String layers) {
        return """
                {
                  "format_version":1,
                  "orientation_mode":"any_horizontal",
                  "allow_mirror":false,
                  "layers":[%s],
                  "key":{"C":{"block":"minecraft:stone"}},
                  "controller":"C"
                }
                """.formatted(layers.replace("\"C\"", "[\"C\"]"));
    }

    private static String tooManyPaletteEntries() {
        StringBuilder key = new StringBuilder();
        for (int i = 0; i < 65; i++) {
            if (i > 0) {
                key.append(',');
            }
            key.append('"').append((char) (0x100 + i)).append("\":{\"block\":\"minecraft:stone\"}");
        }
        return """
                {
                  "format_version":1,
                  "orientation_mode":"any_horizontal",
                  "allow_mirror":false,
                  "layers":[["Ā"]],
                  "key":{%s},
                  "controller":"Ā"
                }
                """.formatted(key);
    }

    private static String tooManyStateEntries() {
        StringBuilder state = new StringBuilder();
        for (int i = 0; i < 33; i++) {
            if (i > 0) {
                state.append(',');
            }
            state.append("\"p").append(i).append("\":\"v\"");
        }
        return baseWithMatcher("{\"block\":\"minecraft:stone\",\"state\":{" + state + "}}");
    }

    private static String longProperty() {
        return baseWithMatcher("{\"block\":\"minecraft:stone\",\"state\":{\""
                + "p".repeat(65) + "\":\"v\"}}");
    }

    private record InvalidResource(String id, String json, String expectedMessage) {
    }

    private record BlockPosPair(net.minecraft.core.BlockPos anchor,
                                net.minecraft.core.BlockPos firstNoneMismatch) {
    }

    private static final class JsonPack implements PackResources {
        private final Map<ResourceLocation, byte[]> data;
        private final PackLocationInfo location;

        private JsonPack(Map<ResourceLocation, String> jsonByFile) {
            this.data = jsonByFile.entrySet().stream().collect(java.util.stream.Collectors.toUnmodifiableMap(
                    Map.Entry::getKey, entry -> entry.getValue().getBytes(StandardCharsets.UTF_8)));
            this.location = new PackLocationInfo("cuprum-pattern-reload-regression",
                    Component.literal("Cuprum malformed-resource regression"),
                    PackSource.BUILT_IN, Optional.<KnownPack>empty());
        }

        @Override
        public IoSupplier<InputStream> getRootResource(String... path) {
            return null;
        }

        @Override
        public IoSupplier<InputStream> getResource(PackType type, ResourceLocation id) {
            byte[] bytes = type == PackType.SERVER_DATA ? data.get(id) : null;
            return bytes == null ? null : () -> new ByteArrayInputStream(bytes);
        }

        @Override
        public void listResources(PackType type, String namespace, String path, ResourceOutput output) {
            if (type != PackType.SERVER_DATA) {
                return;
            }
            for (Map.Entry<ResourceLocation, byte[]> entry : data.entrySet()) {
                ResourceLocation file = entry.getKey();
                if (file.getNamespace().equals(namespace) && file.getPath().startsWith(path + "/")) {
                    byte[] bytes = entry.getValue();
                    output.accept(file, () -> new ByteArrayInputStream(bytes));
                }
            }
        }

        @Override
        public Set<String> getNamespaces(PackType type) {
            return type == PackType.SERVER_DATA
                    ? data.keySet().stream().map(ResourceLocation::getNamespace)
                            .collect(java.util.stream.Collectors.toUnmodifiableSet())
                    : Set.of();
        }

        @Override
        public <T> T getMetadataSection(MetadataSectionType<T> type) throws IOException {
            return null;
        }

        @Override
        public PackLocationInfo location() {
            return location;
        }

        @Override
        public void close() {
        }
    }
}
