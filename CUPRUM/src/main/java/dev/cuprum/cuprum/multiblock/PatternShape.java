package dev.cuprum.cuprum.multiblock;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Pure-Java shape validation for the §3.1 pattern schema (multiblock.md §2) — no Minecraft or
 * DFU imports so the same rules run under {@code Codec.validate} AND plain JUnit (plan D9).
 * {@link #analyze} either returns the computed shape or throws {@link IllegalArgumentException}
 * with the precise frozen error message; {@code MultiblockPattern.CODEC} maps that message into
 * a {@code DataResult} error.
 *
 * <p><b>Coordinates (frozen):</b> {@code layers[y]} bottom→top; row index = z (north→south);
 * codepoint index within a row = x (west→east). {@code "."} is the ignored cell (matches
 * anything, not a member). Keys are single codepoints; every non-{@code .} char must be
 * defined, unused key entries error and the controller char occurs exactly once.
 */
public final class PatternShape {
    public static final int MAX_DIMENSION = 16;
    public static final int MAX_CELLS = 512;
    public static final int MAX_KEY_ENTRIES = 64;
    /** The ignored-cell char (single codepoint {@code '.'}). */
    public static final String IGNORED_CELL = ".";
    private static final int IGNORED_CODEPOINT = '.';

    /** One non-ignored pattern cell at local (x, y, z) whose matcher is keyed by {@code key}. */
    public record Cell(int x, int y, int z, String key) {
    }

    private final int sizeX;
    private final int sizeY;
    private final int sizeZ;
    private final Cell controllerCell;
    private final List<Cell> memberCells;

    private PatternShape(int sizeX, int sizeY, int sizeZ, Cell controllerCell, List<Cell> memberCells) {
        this.sizeX = sizeX;
        this.sizeY = sizeY;
        this.sizeZ = sizeZ;
        this.controllerCell = controllerCell;
        this.memberCells = List.copyOf(memberCells);
    }

    /**
     * Validates layers/key/controller against the frozen §3.1 rules and computes the shape.
     *
     * @param layers       {@code layers[y]} = list of row strings, row index = z, codepoint = x
     * @param definedKeys  the key chars defined by the pattern's {@code key} map (iteration
     *                     order preserved for deterministic "unused entry" reporting)
     * @param controllerKey the {@code controller} char
     * @throws IllegalArgumentException with a precise message on any rule violation
     */
    public static PatternShape analyze(List<List<String>> layers, Set<String> definedKeys, String controllerKey) {
        if (definedKeys.size() > MAX_KEY_ENTRIES) {
            throw new IllegalArgumentException("key defines " + definedKeys.size() + " entries; max " + MAX_KEY_ENTRIES);
        }
        for (String key : definedKeys) {
            if (key.codePointCount(0, key.length()) != 1) {
                throw new IllegalArgumentException("key entry '" + key + "' must be a single codepoint");
            }
            if (IGNORED_CELL.equals(key)) {
                throw new IllegalArgumentException("key entry '.' collides with the ignored-cell char");
            }
        }
        if (controllerKey.codePointCount(0, controllerKey.length()) != 1) {
            throw new IllegalArgumentException("controller '" + controllerKey + "' must be a single codepoint");
        }
        if (!definedKeys.contains(controllerKey)) {
            throw new IllegalArgumentException("controller '" + controllerKey + "' is not defined in key");
        }

        if (layers.isEmpty()) {
            throw new IllegalArgumentException("layers must not be empty");
        }
        int sizeY = layers.size();
        if (sizeY > MAX_DIMENSION) {
            throw new IllegalArgumentException("sizeY " + sizeY + " exceeds max dimension " + MAX_DIMENSION);
        }
        List<String> firstLayer = layers.get(0);
        if (firstLayer.isEmpty()) {
            throw new IllegalArgumentException("layer 0 must not be empty");
        }
        int sizeZ = firstLayer.size();
        if (sizeZ > MAX_DIMENSION) {
            throw new IllegalArgumentException("sizeZ " + sizeZ + " exceeds max dimension " + MAX_DIMENSION);
        }
        int sizeX = firstLayer.get(0).codePointCount(0, firstLayer.get(0).length());
        if (sizeX == 0) {
            throw new IllegalArgumentException("layer 0 row 0 must not be empty");
        }
        if (sizeX > MAX_DIMENSION) {
            throw new IllegalArgumentException("sizeX " + sizeX + " exceeds max dimension " + MAX_DIMENSION);
        }

        List<Cell> members = new ArrayList<>();
        Set<String> usedKeys = new LinkedHashSet<>();
        Cell controllerCell = null;
        int controllerOccurrences = 0;
        for (int y = 0; y < sizeY; y++) {
            List<String> layer = layers.get(y);
            if (layer.size() != sizeZ) {
                throw new IllegalArgumentException("layer " + y + " row count " + layer.size()
                        + " != layer 0 row count " + sizeZ);
            }
            for (int z = 0; z < sizeZ; z++) {
                String row = layer.get(z);
                int[] codepoints = row.codePoints().toArray();
                if (codepoints.length != sizeX) {
                    throw new IllegalArgumentException("layer " + y + " row " + z + " length "
                            + codepoints.length + " != expected " + sizeX);
                }
                for (int x = 0; x < sizeX; x++) {
                    int codepoint = codepoints[x];
                    if (codepoint == IGNORED_CODEPOINT) {
                        continue;
                    }
                    String key = new String(Character.toChars(codepoint));
                    if (!definedKeys.contains(key)) {
                        throw new IllegalArgumentException("undefined pattern char '" + key
                                + "' at (x=" + x + ", y=" + y + ", z=" + z + ")");
                    }
                    usedKeys.add(key);
                    Cell cell = new Cell(x, y, z, key);
                    members.add(cell);
                    if (key.equals(controllerKey)) {
                        controllerOccurrences++;
                        controllerCell = cell;
                    }
                }
            }
        }

        if (members.size() > MAX_CELLS) {
            throw new IllegalArgumentException("pattern has " + members.size() + " member cells; max " + MAX_CELLS);
        }
        if (controllerOccurrences != 1) {
            throw new IllegalArgumentException("controller '" + controllerKey + "' occurs "
                    + controllerOccurrences + " times; expected exactly once");
        }
        for (String key : definedKeys) {
            if (!usedKeys.contains(key)) {
                throw new IllegalArgumentException("unused key entry '" + key + "'");
            }
        }
        return new PatternShape(sizeX, sizeY, sizeZ, controllerCell, members);
    }

    public int sizeX() {
        return sizeX;
    }

    public int sizeY() {
        return sizeY;
    }

    public int sizeZ() {
        return sizeZ;
    }

    /** The unique controller cell. */
    public Cell controllerCell() {
        return controllerCell;
    }

    /** Non-ignored cells in canonical order (y, then z, then x) — the frozen matching order. */
    public List<Cell> memberCells() {
        return memberCells;
    }

    public int memberCount() {
        return memberCells.size();
    }
}
