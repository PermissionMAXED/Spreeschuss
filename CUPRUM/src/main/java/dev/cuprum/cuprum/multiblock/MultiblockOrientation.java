package dev.cuprum.cuprum.multiblock;

import java.util.List;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.Vec3i;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;

/**
 * One of the eight supported horizontal orientations (multiblock.md §3.2, frozen): a vanilla
 * {@link Rotation} plus an optional LEFT_RIGHT {@link Mirror}. Transform order is mirror FIRST,
 * then rotate — the exact {@code StructureTemplate.transform} order; the integer math lives in
 * the JUnit-safe {@link PatternGeometry}.
 */
public record MultiblockOrientation(Rotation rotation, Mirror mirror) {
    /** The four unmirrored orientations in canonical search order: NONE, CW90, CW180, CCW90. */
    public static final List<MultiblockOrientation> HORIZONTAL_UNMIRRORED = List.of(
            new MultiblockOrientation(Rotation.NONE, Mirror.NONE),
            new MultiblockOrientation(Rotation.CLOCKWISE_90, Mirror.NONE),
            new MultiblockOrientation(Rotation.CLOCKWISE_180, Mirror.NONE),
            new MultiblockOrientation(Rotation.COUNTERCLOCKWISE_90, Mirror.NONE));

    /** All eight orientations, unmirrored first (canonical search order, frozen). */
    public static final List<MultiblockOrientation> HORIZONTAL_ALL = List.of(
            new MultiblockOrientation(Rotation.NONE, Mirror.NONE),
            new MultiblockOrientation(Rotation.CLOCKWISE_90, Mirror.NONE),
            new MultiblockOrientation(Rotation.CLOCKWISE_180, Mirror.NONE),
            new MultiblockOrientation(Rotation.COUNTERCLOCKWISE_90, Mirror.NONE),
            new MultiblockOrientation(Rotation.NONE, Mirror.LEFT_RIGHT),
            new MultiblockOrientation(Rotation.CLOCKWISE_90, Mirror.LEFT_RIGHT),
            new MultiblockOrientation(Rotation.CLOCKWISE_180, Mirror.LEFT_RIGHT),
            new MultiblockOrientation(Rotation.COUNTERCLOCKWISE_90, Mirror.LEFT_RIGHT));

    public MultiblockOrientation {
        if (mirror == Mirror.FRONT_BACK) {
            // FRONT_BACK is redundant (== LEFT_RIGHT + CLOCKWISE_180) and stays unsupported.
            throw new IllegalArgumentException("FRONT_BACK mirror is not supported; use LEFT_RIGHT + rotation");
        }
    }

    /** Transforms a pattern-local offset (relative to the controller cell) into a world offset. */
    public BlockPos transformOffset(Vec3i patternLocalOffset) {
        boolean mirrored = mirror == Mirror.LEFT_RIGHT;
        int steps = rotationSteps(rotation);
        return new BlockPos(
                PatternGeometry.transformX(patternLocalOffset.getX(), patternLocalOffset.getZ(), steps, mirrored),
                patternLocalOffset.getY(),
                PatternGeometry.transformZ(patternLocalOffset.getX(), patternLocalOffset.getZ(), steps, mirrored));
    }

    /** Transforms a pattern-local facing: vanilla mirror first, then rotation. */
    public Direction transformFacing(Direction patternLocal) {
        return rotation.rotate(mirror.mirror(patternLocal));
    }

    /** Vanilla {@link Rotation} → {@link PatternGeometry} step index (same order as the enum). */
    public static int rotationSteps(Rotation rotation) {
        return switch (rotation) {
            case NONE -> PatternGeometry.ROT_NONE;
            case CLOCKWISE_90 -> PatternGeometry.ROT_CLOCKWISE_90;
            case CLOCKWISE_180 -> PatternGeometry.ROT_CLOCKWISE_180;
            case COUNTERCLOCKWISE_90 -> PatternGeometry.ROT_COUNTERCLOCKWISE_90;
        };
    }
}
