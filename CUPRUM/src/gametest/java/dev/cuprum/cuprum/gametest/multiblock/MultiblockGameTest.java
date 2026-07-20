package dev.cuprum.cuprum.gametest.multiblock;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.block.DiagnosticCoilCoreBlockEntity;
import dev.cuprum.cuprum.charge.blockentity.AbstractChargeStorageBlockEntity;
import dev.cuprum.cuprum.machine.MachineContent;
import dev.cuprum.cuprum.multiblock.FaultCode;
import dev.cuprum.cuprum.multiblock.FormationState;
import dev.cuprum.cuprum.multiblock.MultiblockFault;
import dev.cuprum.cuprum.multiblock.MultiblockLevelIndex;
import dev.cuprum.cuprum.multiblock.MultiblockOrientation;
import dev.cuprum.cuprum.multiblock.MultiblockPattern;
import dev.cuprum.cuprum.multiblock.MultiblockPatterns;
import dev.cuprum.cuprum.state.CuprumSchema;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Vec3i;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.util.ProblemReporter;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplate;
import net.minecraft.world.level.storage.TagValueInput;
import net.minecraft.world.level.storage.TagValueOutput;

/**
 * Real-server GameTests for the W1C multiblock foundation (plan §4-W1C): reload delivery,
 * vanilla-rotation parity, formation in rotated/mirrored builds (the coil's L-asymmetry makes
 * all 8 orientations distinguishable), fast-path and poll-path fault detection, repair,
 * claim conflicts and the §3.1 persistence envelope. Every structure fits the default 8×8×8
 * empty template; {@code maxTicks = 100} covers the 20-tick revalidation poll.
 */
public class MultiblockGameTest {
    /** The coil core anchor: the 3×3 ring then spans structure-relative (1,1,1)..(3,1,3). */
    private static final BlockPos CORE = new BlockPos(2, 1, 2);
    private static final MultiblockOrientation UNROTATED =
            new MultiblockOrientation(Rotation.NONE, Mirror.NONE);

    /** The committed diagnostic_coil.json arrived through the reloader with the §3.1 shape. */
    @GameTest(maxTicks = 100)
    public void multiblockPatternJsonLoaded(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper,
                DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        helper.assertValueEqual(DiagnosticCoilCoreBlockEntity.PATTERN_ID, pattern.id(),
                Component.literal("reloader-bound id"));
        helper.assertValueEqual(3, pattern.sizeX(), Component.literal("sizeX"));
        helper.assertValueEqual(1, pattern.sizeY(), Component.literal("sizeY"));
        helper.assertValueEqual(3, pattern.sizeZ(), Component.literal("sizeZ"));
        helper.assertValueEqual(9, pattern.memberCount(), Component.literal("memberCount"));
        helper.assertValueEqual(new Vec3i(1, 0, 1), pattern.controllerCell(),
                Component.literal("controller cell"));
        helper.assertTrue(MultiblockPatterns.reloadGeneration() >= 1,
                Component.literal("reload generation must have advanced at least once"));
        helper.succeed();
    }

    /** PatternGeometry parity with the REAL {@code BlockPos.rotate} and the full
     * mirror-then-rotate {@code StructureTemplate.transform} (pivot 0,0,0). */
    @GameTest(maxTicks = 100)
    public void patternGeometryMatchesVanillaRotation(GameTestHelper helper) {
        for (Rotation rotation : Rotation.values()) {
            MultiblockOrientation orientation = new MultiblockOrientation(rotation, Mirror.NONE);
            for (int x = -2; x <= 2; x++) {
                for (int z = -2; z <= 2; z++) {
                    helper.assertValueEqual(new BlockPos(x, 0, z).rotate(rotation),
                            orientation.transformOffset(new Vec3i(x, 0, z)),
                            Component.literal("BlockPos.rotate parity at (" + x + ", " + z + ") " + rotation));
                }
            }
        }
        for (MultiblockOrientation orientation : MultiblockOrientation.HORIZONTAL_ALL) {
            for (int x = -2; x <= 2; x++) {
                for (int z = -2; z <= 2; z++) {
                    helper.assertValueEqual(
                            StructureTemplate.transform(new BlockPos(x, 0, z), orientation.mirror(),
                                    orientation.rotation(), BlockPos.ZERO),
                            orientation.transformOffset(new Vec3i(x, 0, z)),
                            Component.literal("StructureTemplate parity at (" + x + ", " + z + ") "
                                    + orientation));
                }
            }
        }
        helper.succeed();
    }

    @GameTest(maxTicks = 100)
    public void diagnosticCoilFormsNone(GameTestHelper helper) {
        assertFormsExactly(helper, UNROTATED);
    }

    @GameTest(maxTicks = 100)
    public void diagnosticCoilFormsRotated90(GameTestHelper helper) {
        assertFormsExactly(helper, new MultiblockOrientation(Rotation.CLOCKWISE_90, Mirror.NONE));
    }

    @GameTest(maxTicks = 100)
    public void diagnosticCoilFormsMirrored(GameTestHelper helper) {
        assertFormsExactly(helper, new MultiblockOrientation(Rotation.NONE, Mirror.LEFT_RIGHT));
    }

    /** Builds under {@code buildOrientation}, awaits FORMED and pins the EXACT matched
     * orientation (the W/O L-asymmetry rules out every other candidate) plus the claims. */
    private static void assertFormsExactly(GameTestHelper helper, MultiblockOrientation buildOrientation) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper,
                DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, CORE, buildOrientation);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, CORE);
            helper.assertValueEqual(buildOrientation,
                    coil.multiblockBehavior().orientation().orElseThrow(
                            () -> helper.assertionException(Component.literal("FORMED without orientation"))),
                    Component.literal("matched orientation"));
            MultiblockLevelIndex index = MultiblockLevelIndex.get(helper.getLevel());
            BlockPos frameRel = MultiblockTestHelper.memberRel(pattern, CORE, buildOrientation, 2, 0, 2);
            helper.assertValueEqual(helper.absolutePos(CORE),
                    index.controllerAt(helper.absolutePos(frameRel)),
                    Component.literal("frame member claimed by the core"));
            helper.assertValueEqual(helper.absolutePos(CORE),
                    index.controllerAt(helper.absolutePos(CORE)),
                    Component.literal("controller claims its own cell"));
            helper.succeed();
        });
    }

    /** Breaking a frame (a MultiblockMemberBlock) faults through the O(1) fast path within
     * 2 ticks, naming the broken position. */
    @GameTest(maxTicks = 100)
    public void diagnosticCoilFaultOnMemberBreak(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper,
                DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, CORE, UNROTATED);
        BlockPos frameRel = MultiblockTestHelper.memberRel(pattern, CORE, UNROTATED, 2, 0, 2);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            helper.destroyBlock(frameRel);
            helper.startSequence().thenExecuteAfter(2, () -> {
                DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, CORE);
                helper.assertValueEqual(FormationState.FAULT, coil.multiblockBehavior().state(),
                        Component.literal("FAULT within 2 ticks of the member break"));
                MultiblockFault fault = coil.multiblockBehavior().fault().orElseThrow(
                        () -> helper.assertionException(Component.literal("FAULT without fault detail")));
                helper.assertValueEqual(FaultCode.MISMATCH, fault.code(), Component.literal("fault code"));
                helper.assertValueEqual(helper.absolutePos(frameRel), fault.pos().orElse(null),
                        Component.literal("fault names the broken member position"));
                helper.succeed();
            });
        });
    }

    /** Replacing a VANILLA member (oxidized copper → stone, no mod hook) is caught by the
     * 20-tick revalidation poll — bounded at 40 ticks. */
    @GameTest(maxTicks = 100)
    public void diagnosticCoilFaultOnVanillaMemberChange(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper,
                DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, CORE, UNROTATED);
        BlockPos oxidizedRel = MultiblockTestHelper.memberRel(pattern, CORE, UNROTATED, 1, 0, 0);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            long changedAt = helper.getLevel().getGameTime();
            helper.setBlock(oxidizedRel, Blocks.STONE);
            MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FAULT, () -> {
                long elapsed = helper.getLevel().getGameTime() - changedAt;
                helper.assertTrue(elapsed <= 40,
                        Component.literal("poll caught the vanilla change after " + elapsed + " ticks (max 40)"));
                MultiblockFault fault = MultiblockTestHelper.coilCore(helper, CORE)
                        .multiblockBehavior().fault().orElseThrow(
                                () -> helper.assertionException(Component.literal("FAULT without fault detail")));
                helper.assertValueEqual(FaultCode.MISMATCH, fault.code(), Component.literal("fault code"));
                helper.assertValueEqual(helper.absolutePos(oxidizedRel), fault.pos().orElse(null),
                        Component.literal("fault names the changed member position"));
                helper.succeed();
            });
        });
    }

    /** FAULT → FORMED after repair (claims were retained in FAULT), and self-charging resumes
     * on the exact 5 Cg/t line. */
    @GameTest(maxTicks = 100)
    public void diagnosticCoilReformsAfterRepair(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper,
                DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, CORE, UNROTATED);
        BlockPos frameRel = MultiblockTestHelper.memberRel(pattern, CORE, UNROTATED, 2, 0, 2);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            helper.destroyBlock(frameRel);
            MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FAULT, () -> {
                helper.setBlock(frameRel, MachineContent.DIAGNOSTIC_COIL_FRAME);
                MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
                    DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, CORE);
                    long anchorStored = coil.chargeBuffer().stored();
                    long anchorTime = helper.getLevel().getGameTime();
                    helper.startSequence().thenIdle(4).thenExecute(() -> {
                        long ticks = helper.getLevel().getGameTime() - anchorTime;
                        helper.assertTrue(ticks > 0, Component.literal("charging window must advance"));
                        helper.assertValueEqual(
                                anchorStored + ticks * DiagnosticCoilCoreBlockEntity.CHARGE_PER_TICK_CG,
                                coil.chargeBuffer().stored(),
                                Component.literal("charging resumed at exactly 5 Cg/t after reform"));
                        helper.succeed();
                    });
                });
            });
        });
    }

    /** A second core whose (geometrically valid) match overlaps a FORMED coil's claims goes
     * FAULT/CONFLICT; the first controller keeps its claims and stays FORMED. */
    @GameTest(maxTicks = 100)
    public void diagnosticCoilConflictSecondController(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper,
                DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, CORE, UNROTATED);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            // Second coil, core two south of A: under CLOCKWISE_180 its ring reuses A's south
            // frame row (1..3, 1, 3) — every block matches, but three members are A's claims.
            BlockPos coreB = new BlockPos(2, 1, 4);
            helper.setBlock(new BlockPos(1, 1, 4), MachineContent.DIAGNOSTIC_COIL_FRAME);
            helper.setBlock(new BlockPos(3, 1, 4), MachineContent.DIAGNOSTIC_COIL_FRAME);
            helper.setBlock(new BlockPos(1, 1, 5), MachineContent.DIAGNOSTIC_COIL_FRAME);
            helper.setBlock(new BlockPos(2, 1, 5), Blocks.OXIDIZED_COPPER);
            helper.setBlock(new BlockPos(3, 1, 5), Blocks.WAXED_COPPER_BLOCK);
            helper.setBlock(coreB, MachineContent.DIAGNOSTIC_COIL_CORE);
            MultiblockTestHelper.awaitFormation(helper, coreB, FormationState.FAULT, () -> {
                MultiblockFault fault = MultiblockTestHelper.coilCore(helper, coreB)
                        .multiblockBehavior().fault().orElseThrow(
                                () -> helper.assertionException(Component.literal("FAULT without fault detail")));
                helper.assertValueEqual(FaultCode.CONFLICT, fault.code(), Component.literal("fault code"));
                MultiblockLevelIndex index = MultiblockLevelIndex.get(helper.getLevel());
                BlockPos conflictPos = fault.pos().orElseThrow(
                        () -> helper.assertionException(Component.literal("CONFLICT without position")));
                helper.assertValueEqual(helper.absolutePos(CORE), index.controllerAt(conflictPos),
                        Component.literal("conflicting member is owned by the first controller"));
                helper.assertValueEqual(FormationState.FORMED,
                        MultiblockTestHelper.coilCore(helper, CORE).multiblockBehavior().state(),
                        Component.literal("first controller stays FORMED"));
                helper.assertValueEqual(helper.absolutePos(CORE),
                        index.controllerAt(helper.absolutePos(new BlockPos(3, 1, 3))),
                        Component.literal("first controller keeps its shared-row claim"));
                helper.succeed();
            });
        });
    }

    /** The FULL §3.1 envelope round-trips through the real Value I/O: {@code cuprum_state}
     * keeps the frozen W1B schema/charge keys and gains the {@code multiblock} child; a fresh
     * BE reloads charge, FORMED state and orientation. */
    @GameTest(maxTicks = 100)
    public void diagnosticCoilPersistenceRoundTrip(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper,
                DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, CORE, UNROTATED);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, CORE);
            long stored = coil.chargeBuffer().stored();
            try (ProblemReporter.ScopedCollector reporter = new ProblemReporter.ScopedCollector(Cuprum.LOGGER)) {
                TagValueOutput output = TagValueOutput.createWithContext(reporter,
                        helper.getLevel().registryAccess());
                coil.saveCustomOnly(output);
                CompoundTag saved = output.buildResult();
                CompoundTag envelope = saved.getCompoundOrEmpty(AbstractChargeStorageBlockEntity.STATE_KEY);
                helper.assertValueEqual(CuprumSchema.BLOCK_ENTITY,
                        envelope.getIntOr(CuprumSchema.KEY, -1),
                        Component.literal("frozen W1B schema key survives the machine envelope rewrite"));
                helper.assertValueEqual(stored,
                        envelope.getLongOr(AbstractChargeStorageBlockEntity.CHARGE_KEY, -1L),
                        Component.literal("frozen W1B charge key survives the machine envelope rewrite"));
                CompoundTag multiblock = envelope.getCompoundOrEmpty("multiblock");
                helper.assertValueEqual(true, multiblock.getBooleanOr("formed", false),
                        Component.literal("multiblock.formed"));
                helper.assertValueEqual("none", multiblock.getStringOr("rotation", "absent"),
                        Component.literal("multiblock.rotation (vanilla Rotation codec)"));
                helper.assertValueEqual("none", multiblock.getStringOr("mirror", "absent"),
                        Component.literal("multiblock.mirror (vanilla Mirror codec)"));

                DiagnosticCoilCoreBlockEntity reloaded = new DiagnosticCoilCoreBlockEntity(
                        helper.absolutePos(CORE), coil.getBlockState());
                reloaded.loadCustomOnly(TagValueInput.create(reporter,
                        helper.getLevel().registryAccess(), saved));
                helper.assertValueEqual(stored, reloaded.chargeBuffer().stored(),
                        Component.literal("round-tripped stored Cg"));
                helper.assertValueEqual(FormationState.FORMED, reloaded.multiblockBehavior().state(),
                        Component.literal("round-tripped formation state"));
                helper.assertValueEqual(UNROTATED,
                        reloaded.multiblockBehavior().orientation().orElseThrow(
                                () -> helper.assertionException(Component.literal("reloaded without orientation"))),
                        Component.literal("round-tripped orientation"));
            }
            helper.succeed();
        });
    }
}
