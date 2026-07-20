package dev.cuprum.cuprum.multiblock;

import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MC-free tests pinning the frozen orientation semantics (multiblock.md §3.2): vanilla
 * {@code BlockPos.rotate} rotation indices, LEFT_RIGHT mirror = z negation, and the
 * {@code StructureTemplate} mirror-BEFORE-rotate composition order. The gametest
 * {@code patternGeometryMatchesVanillaRotation} additionally pins parity against the real
 * {@code BlockPos.rotate(Rotation)} at runtime.
 */
class PatternGeometryTest {
    private static int[] transform(int x, int z, int rot, boolean mirrored) {
        return new int[] {
                PatternGeometry.transformX(x, z, rot, mirrored),
                PatternGeometry.transformZ(x, z, rot, mirrored),
        };
    }

    @Test
    void unmirroredRotationTablePinnedByLiterals() {
        // Sample point (2, 3); expectations follow BlockPos.rotate exactly.
        assertArray(2, 3, transform(2, 3, PatternGeometry.ROT_NONE, false));
        assertArray(-3, 2, transform(2, 3, PatternGeometry.ROT_CLOCKWISE_90, false));
        assertArray(-2, -3, transform(2, 3, PatternGeometry.ROT_CLOCKWISE_180, false));
        assertArray(3, -2, transform(2, 3, PatternGeometry.ROT_COUNTERCLOCKWISE_90, false));
    }

    @Test
    void mirroredRotationTablePinnedByLiterals() {
        // Mirror first negates z: (2, 3) -> (2, -3); then the rotation table applies.
        assertArray(2, -3, transform(2, 3, PatternGeometry.ROT_NONE, true));
        assertArray(3, 2, transform(2, 3, PatternGeometry.ROT_CLOCKWISE_90, true));
        assertArray(-2, 3, transform(2, 3, PatternGeometry.ROT_CLOCKWISE_180, true));
        assertArray(-3, -2, transform(2, 3, PatternGeometry.ROT_COUNTERCLOCKWISE_90, true));
    }

    @Test
    void allEightOrientationsDistinguishAsymmetricPoint() {
        // (1, 2) has no rotational or mirror symmetry, so the 8 orientation images are distinct.
        Set<Long> images = new HashSet<>();
        for (int rot = 0; rot < PatternGeometry.ROTATION_COUNT; rot++) {
            for (boolean mirrored : new boolean[] {false, true}) {
                int[] out = transform(1, 2, rot, mirrored);
                images.add(((long) out[0] << 32) | (out[1] & 0xFFFFFFFFL));
            }
        }
        assertEquals(8, images.size());
    }

    @Test
    void mirrorAppliesBeforeRotation() {
        // mirror-then-rotate90 of (1, 2): mirror -> (1, -2), rotate90 -> (2, 1).
        // rotate90-then-mirror would give (-2, 1) -> (-2, -1); the orders genuinely differ.
        assertArray(2, 1, transform(1, 2, PatternGeometry.ROT_CLOCKWISE_90, true));
        int[] rotateFirst = transform(1, 2, PatternGeometry.ROT_CLOCKWISE_90, false);
        int[] wrongOrder = new int[] {rotateFirst[0], -rotateFirst[1]};
        assertArray(-2, -1, wrongOrder);
    }

    @Test
    void mirrorAloneNegatesOnlyZ() {
        for (int x = -3; x <= 3; x++) {
            for (int z = -3; z <= 3; z++) {
                assertEquals(x, PatternGeometry.transformX(x, z, PatternGeometry.ROT_NONE, true));
                assertEquals(-z, PatternGeometry.transformZ(x, z, PatternGeometry.ROT_NONE, true));
            }
        }
    }

    @Test
    void rotationStepsWrapWithFloorMod() {
        for (int x = -2; x <= 2; x++) {
            for (int z = -2; z <= 2; z++) {
                assertArray(PatternGeometry.transformX(x, z, 0, false),
                        PatternGeometry.transformZ(x, z, 0, false), transform(x, z, 4, false));
                assertArray(PatternGeometry.transformX(x, z, 3, false),
                        PatternGeometry.transformZ(x, z, 3, false), transform(x, z, -1, false));
            }
        }
    }

    @Test
    void rotationsComposeAdditively() {
        for (int a = 0; a < 4; a++) {
            for (int b = 0; b < 4; b++) {
                for (int x = -2; x <= 2; x++) {
                    for (int z = -2; z <= 2; z++) {
                        int midX = PatternGeometry.transformX(x, z, a, false);
                        int midZ = PatternGeometry.transformZ(x, z, a, false);
                        assertArray(PatternGeometry.transformX(midX, midZ, b, false),
                                PatternGeometry.transformZ(midX, midZ, b, false),
                                transform(x, z, a + b, false));
                    }
                }
            }
        }
    }

    @Test
    void everyOrientationIsBijectiveOnGrid() {
        for (int rot = 0; rot < PatternGeometry.ROTATION_COUNT; rot++) {
            for (boolean mirrored : new boolean[] {false, true}) {
                Set<Long> images = new HashSet<>();
                for (int x = -4; x <= 4; x++) {
                    for (int z = -4; z <= 4; z++) {
                        int[] out = transform(x, z, rot, mirrored);
                        assertTrue(images.add(((long) out[0] << 32) | (out[1] & 0xFFFFFFFFL)),
                                "collision at rot=" + rot + " mirrored=" + mirrored);
                    }
                }
                assertEquals(81, images.size());
            }
        }
    }

    @Test
    void mirroredOrientationsSelfInvert() {
        // mirror+rot composed with itself in reverse (inverse rotation applied to the mirrored
        // frame) returns the original point: transform is undone by mirroring, rotating back.
        for (int rot = 0; rot < PatternGeometry.ROTATION_COUNT; rot++) {
            for (int x = -2; x <= 2; x++) {
                for (int z = -2; z <= 2; z++) {
                    int wx = PatternGeometry.transformX(x, z, rot, true);
                    int wz = PatternGeometry.transformZ(x, z, rot, true);
                    // invert: rotate back by (4 - rot), then un-mirror (negate z again).
                    int bx = PatternGeometry.transformX(wx, wz, 4 - rot, false);
                    int bz = -PatternGeometry.transformZ(wx, wz, 4 - rot, false);
                    assertArray(x, z, new int[] {bx, bz});
                }
            }
        }
    }

    @Test
    void originIsFixedPointOfAllOrientations() {
        for (int rot = 0; rot < PatternGeometry.ROTATION_COUNT; rot++) {
            for (boolean mirrored : new boolean[] {false, true}) {
                assertArray(0, 0, transform(0, 0, rot, mirrored));
            }
        }
    }

    private static void assertArray(int expectedX, int expectedZ, int[] actual) {
        assertEquals(expectedX, actual[0], "x");
        assertEquals(expectedZ, actual[1], "z");
    }
}
