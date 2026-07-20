package dev.cuprum.cuprum.multiblock;

/**
 * Pure-Java integer math for multiblock orientation transforms (multiblock.md §3.2) — no
 * Minecraft imports so it is JUnit-safe under plan D9. {@code MultiblockOrientation} delegates
 * its offset transforms here; the gametest {@code patternGeometryMatchesVanillaRotation} pins
 * parity with {@code BlockPos.rotate(Rotation)}.
 *
 * <p><b>Semantics (frozen):</b> mirror is applied FIRST, then rotation — the exact
 * {@code StructureTemplate.transform} order. Only the LEFT_RIGHT mirror is supported; it
 * negates the local z coordinate. Rotation steps match vanilla {@code Rotation} indices and
 * {@code BlockPos.rotate}:
 *
 * <pre>
 *   0 NONE:               (x, z) -&gt; ( x,  z)
 *   1 CLOCKWISE_90:       (x, z) -&gt; (-z,  x)
 *   2 CLOCKWISE_180:      (x, z) -&gt; (-x, -z)
 *   3 COUNTERCLOCKWISE_90:(x, z) -&gt; ( z, -x)
 * </pre>
 *
 * <p>The y coordinate is never affected (horizontal-only orientations in W1).
 */
public final class PatternGeometry {
    public static final int ROT_NONE = 0;
    public static final int ROT_CLOCKWISE_90 = 1;
    public static final int ROT_CLOCKWISE_180 = 2;
    public static final int ROT_COUNTERCLOCKWISE_90 = 3;
    public static final int ROTATION_COUNT = 4;

    private PatternGeometry() {
    }

    /** The world x of local (x, z) under {@code rotationSteps} after an optional LEFT_RIGHT mirror. */
    public static int transformX(int x, int z, int rotationSteps, boolean mirrored) {
        int mz = mirrored ? -z : z;
        return switch (Math.floorMod(rotationSteps, ROTATION_COUNT)) {
            case ROT_NONE -> x;
            case ROT_CLOCKWISE_90 -> -mz;
            case ROT_CLOCKWISE_180 -> -x;
            default -> mz; // ROT_COUNTERCLOCKWISE_90
        };
    }

    /** The world z of local (x, z) under {@code rotationSteps} after an optional LEFT_RIGHT mirror. */
    public static int transformZ(int x, int z, int rotationSteps, boolean mirrored) {
        int mz = mirrored ? -z : z;
        return switch (Math.floorMod(rotationSteps, ROTATION_COUNT)) {
            case ROT_NONE -> mz;
            case ROT_CLOCKWISE_90 -> x;
            case ROT_CLOCKWISE_180 -> -mz;
            default -> -x; // ROT_COUNTERCLOCKWISE_90
        };
    }
}
