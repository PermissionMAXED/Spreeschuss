package dev.cuprum.cuprum.gametest.multiblock;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.block.DiagnosticCoilCoreBlockEntity;
import dev.cuprum.cuprum.machine.MachineContent;
import dev.cuprum.cuprum.multiblock.FormationState;
import dev.cuprum.cuprum.multiblock.MultiblockOrientation;
import dev.cuprum.cuprum.multiblock.MultiblockPattern;
import dev.cuprum.cuprum.multiblock.MultiblockPatterns;
import dev.cuprum.cuprum.multiblock.PatternShape;
import java.util.Optional;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Vec3i;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.ProblemReporter;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.storage.TagValueInput;
import net.minecraft.world.level.storage.TagValueOutput;

/**
 * Multiblock construction helpers for GameTests (multiblock.md §8). Structures are built from
 * the pattern's own display states so the physical build can never drift from the committed
 * JSON; tag-only matchers have no display state and fail the test. All coordinates are
 * structure-relative; {@code awaitFormation} polls via a {@code GameTestSequence} (20-tick
 * revalidation cadence fits the {@code maxTicks = 100} budget).
 */
public final class MultiblockTestHelper {
    private MultiblockTestHelper() {
    }

    /** The loaded pattern, failing the test when the reloader has not delivered it. */
    public static MultiblockPattern requirePattern(GameTestHelper helper, ResourceLocation id) {
        Optional<MultiblockPattern> pattern = MultiblockPatterns.get(id);
        if (pattern.isEmpty()) {
            throw helper.assertionException(Component.literal("pattern " + id + " is not loaded"));
        }
        return pattern.get();
    }

    /**
     * Places every non-ignored cell of {@code pattern} (controller included) using the
     * matchers' display states, anchored at {@code controllerRel} under {@code orientation}.
     */
    public static void buildPattern(GameTestHelper helper, MultiblockPattern pattern, BlockPos controllerRel,
            MultiblockOrientation orientation) {
        for (int y = 0; y < pattern.sizeY(); y++) {
            for (int z = 0; z < pattern.sizeZ(); z++) {
                for (int x = 0; x < pattern.sizeX(); x++) {
                    String key = pattern.cellKey(x, y, z);
                    if (PatternShape.IGNORED_CELL.equals(key)) {
                        continue;
                    }
                    BlockState state = pattern.displayState(key.charAt(0)).orElseThrow(
                            () -> helper.assertionException(Component.literal(
                                    "key '" + key + "' is a tag matcher; buildPattern needs exact blocks")));
                    helper.setBlock(memberRel(pattern, controllerRel, orientation, x, y, z), state);
                }
            }
        }
    }

    /** The structure-relative position of pattern-local cell (lx, ly, lz) under {@code orientation}. */
    public static BlockPos memberRel(MultiblockPattern pattern, BlockPos controllerRel,
            MultiblockOrientation orientation, int lx, int ly, int lz) {
        Vec3i controllerCell = pattern.controllerCell();
        return controllerRel.offset(orientation.transformOffset(new Vec3i(
                lx - controllerCell.getX(), ly - controllerCell.getY(), lz - controllerCell.getZ())));
    }

    /** The Diagnostic Coil core BE at {@code rel}; fails the test when absent. */
    public static DiagnosticCoilCoreBlockEntity coilCore(GameTestHelper helper, BlockPos rel) {
        return helper.getBlockEntity(rel, DiagnosticCoilCoreBlockEntity.class);
    }

    /** Saves the exact custom BE payload through the real ValueOutput path. */
    public static CompoundTag saveCoil(GameTestHelper helper, DiagnosticCoilCoreBlockEntity coil) {
        try (ProblemReporter.ScopedCollector reporter = new ProblemReporter.ScopedCollector(Cuprum.LOGGER)) {
            TagValueOutput output = TagValueOutput.createWithContext(reporter, helper.getLevel().registryAccess());
            coil.saveCustomOnly(output);
            return output.buildResult();
        }
    }

    /** Loads the exact custom BE payload through the real ValueInput path. */
    public static void loadCoil(GameTestHelper helper, DiagnosticCoilCoreBlockEntity coil, CompoundTag saved) {
        try (ProblemReporter.ScopedCollector reporter = new ProblemReporter.ScopedCollector(Cuprum.LOGGER)) {
            coil.loadCustomOnly(TagValueInput.create(reporter, helper.getLevel().registryAccess(), saved));
        }
    }

    /**
     * Replaces the placeholder BE at {@code rel} with a payload-loaded instance and registers it
     * through {@link LevelChunk#addAndRegisterBlockEntity}; this is the real
     * {@code BLOCK_ENTITY_LOAD} path with data loaded before the event.
     */
    public static DiagnosticCoilCoreBlockEntity replaceWithLoadedCoil(
            GameTestHelper helper, BlockPos rel, CompoundTag saved) {
        BlockPos absolute = helper.absolutePos(rel);
        if (!helper.getLevel().getBlockState(absolute).is(MachineContent.DIAGNOSTIC_COIL_CORE)) {
            helper.setBlock(rel, MachineContent.DIAGNOSTIC_COIL_CORE);
        }
        LevelChunk chunk = helper.getLevel().getChunkAt(absolute);
        chunk.removeBlockEntity(absolute);
        DiagnosticCoilCoreBlockEntity loaded = new DiagnosticCoilCoreBlockEntity(
                absolute, helper.getLevel().getBlockState(absolute));
        loadCoil(helper, loaded, saved);
        chunk.addAndRegisterBlockEntity(loaded);
        return loaded;
    }

    /**
     * Waits (sequence poll) until the core at {@code rel} reaches {@code expected}, then runs
     * {@code then}. {@code then} must finish the test (assert + {@code helper.succeed()}) or
     * chain another wait; an unmet expectation fails at the test's {@code maxTicks}.
     */
    public static void awaitFormation(GameTestHelper helper, BlockPos rel, FormationState expected,
            Runnable then) {
        helper.startSequence()
                .thenWaitUntil(() -> {
                    FormationState actual = coilCore(helper, rel).multiblockBehavior().state();
                    if (actual != expected) {
                        throw helper.assertionException(Component.literal(
                                "formation state is " + actual + "; awaiting " + expected));
                    }
                })
                .thenExecute(then);
    }
}
