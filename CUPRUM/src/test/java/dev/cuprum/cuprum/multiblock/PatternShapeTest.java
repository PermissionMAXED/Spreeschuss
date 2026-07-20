package dev.cuprum.cuprum.multiblock;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MC-free tests for the frozen §3.1 schema rules in {@link PatternShape} — the same analysis
 * that {@code MultiblockPattern.CODEC} routes through {@code Codec.validate} at reload time.
 * The committed {@code diagnostic_coil.json} is gson-parsed straight from
 * {@code cuprum.mainResourcesDir} so a hand-edit that violates the schema fails HERE, without
 * booting Minecraft.
 */
class PatternShapeTest {
    private static PatternShape analyze(List<List<String>> layers, Set<String> keys, String controller) {
        return PatternShape.analyze(layers, keys, controller);
    }

    private static Set<String> keys(String... entries) {
        return new LinkedHashSet<>(List.of(entries));
    }

    @Test
    void committedDiagnosticCoilJsonSatisfiesSchema() {
        Path json = Path.of(System.getProperty("cuprum.mainResourcesDir"),
                "data", "cuprum", "cuprum_multiblock", "diagnostic_coil.json");
        assertTrue(Files.isRegularFile(json), "missing committed pattern: " + json);

        JsonObject root;
        try {
            root = JsonParser.parseString(Files.readString(json)).getAsJsonObject();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        assertEquals(1, root.get("format_version").getAsInt());

        List<List<String>> layers = new ArrayList<>();
        for (JsonElement layer : root.getAsJsonArray("layers")) {
            List<String> rows = new ArrayList<>();
            for (JsonElement row : (JsonArray) layer) {
                rows.add(row.getAsString());
            }
            layers.add(rows);
        }
        Set<String> definedKeys = new LinkedHashSet<>(root.getAsJsonObject("key").keySet());
        String controller = root.get("controller").getAsString();

        PatternShape shape = analyze(layers, definedKeys, controller);
        assertEquals(3, shape.sizeX());
        assertEquals(1, shape.sizeY());
        assertEquals(3, shape.sizeZ());
        assertEquals(9, shape.memberCount());
        assertEquals(new PatternShape.Cell(1, 0, 1, "C"), shape.controllerCell());
    }

    @Test
    void memberCellsFollowCanonicalYzxOrder() {
        PatternShape shape = analyze(
                List.of(List.of("AB", "BA"), List.of("BB", "BC")),
                keys("A", "B", "C"), "C");
        assertEquals(8, shape.memberCount());
        List<PatternShape.Cell> cells = shape.memberCells();
        assertEquals(new PatternShape.Cell(0, 0, 0, "A"), cells.get(0));
        assertEquals(new PatternShape.Cell(1, 0, 0, "B"), cells.get(1));
        assertEquals(new PatternShape.Cell(0, 0, 1, "B"), cells.get(2));
        assertEquals(new PatternShape.Cell(1, 1, 1, "C"), cells.get(7));
    }

    @Test
    void ignoredCellsAreNotMembers() {
        PatternShape shape = analyze(List.of(List.of(".C.", "...")), keys("C"), "C");
        assertEquals(1, shape.memberCount());
        assertEquals(new PatternShape.Cell(1, 0, 0, "C"), shape.controllerCell());
    }

    @Test
    void rejectsNonRectangularRow() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> analyze(List.of(List.of("CC", "C")), keys("C"), "C"));
        assertTrue(e.getMessage().contains("length"), e.getMessage());
    }

    @Test
    void rejectsLayerRowCountMismatch() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> analyze(List.of(List.of("C", "A"), List.of("A")), keys("A", "C"), "C"));
        assertTrue(e.getMessage().contains("row count"), e.getMessage());
    }

    @Test
    void rejectsUndefinedPatternChar() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> analyze(List.of(List.of("CX")), keys("C"), "C"));
        assertTrue(e.getMessage().contains("undefined pattern char 'X'"), e.getMessage());
    }

    @Test
    void rejectsUnusedKeyEntry() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> analyze(List.of(List.of("C")), keys("C", "Z"), "C"));
        assertTrue(e.getMessage().contains("unused key entry 'Z'"), e.getMessage());
    }

    @Test
    void rejectsControllerNotDefinedInKey() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> analyze(List.of(List.of("A")), keys("A"), "C"));
        assertTrue(e.getMessage().contains("not defined in key"), e.getMessage());
    }

    @Test
    void rejectsControllerAbsentFromLayers() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> analyze(List.of(List.of("AC", "AA"), List.of("AA", "AA")).subList(1, 2),
                        keys("A", "C"), "C"));
        assertTrue(e.getMessage().contains("occurs 0 times"), e.getMessage());
    }

    @Test
    void rejectsDuplicateController() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> analyze(List.of(List.of("CC")), keys("C"), "C"));
        assertTrue(e.getMessage().contains("occurs 2 times"), e.getMessage());
    }

    @Test
    void rejectsIgnoredCharAsKeyEntry() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> analyze(List.of(List.of("C.")), keys("C", "."), "C"));
        assertTrue(e.getMessage().contains("collides with the ignored-cell char"), e.getMessage());
    }

    @Test
    void rejectsMultiCodepointKeyAndController() {
        assertThrows(IllegalArgumentException.class,
                () -> analyze(List.of(List.of("C")), keys("C", "AB"), "C"));
        assertThrows(IllegalArgumentException.class,
                () -> analyze(List.of(List.of("C")), keys("C"), "CC"));
    }

    @Test
    void rejectsDimensionsAboveMax() {
        // sizeX = 17
        String longRow = "C" + "A".repeat(PatternShape.MAX_DIMENSION);
        assertThrows(IllegalArgumentException.class,
                () -> analyze(List.of(List.of(longRow)), keys("A", "C"), "C"));
        // sizeZ = 17
        List<String> rows = new ArrayList<>();
        rows.add("C");
        for (int i = 0; i < PatternShape.MAX_DIMENSION; i++) {
            rows.add("A");
        }
        assertThrows(IllegalArgumentException.class,
                () -> analyze(List.of(rows), keys("A", "C"), "C"));
        // sizeY = 17
        List<List<String>> layers = new ArrayList<>();
        layers.add(List.of("C"));
        for (int i = 0; i < PatternShape.MAX_DIMENSION; i++) {
            layers.add(List.of("A"));
        }
        assertThrows(IllegalArgumentException.class, () -> analyze(layers, keys("A", "C"), "C"));
    }

    @Test
    void rejectsEmptyLayersRowsAndCells() {
        assertThrows(IllegalArgumentException.class, () -> analyze(List.of(), keys("C"), "C"));
        assertThrows(IllegalArgumentException.class, () -> analyze(List.of(List.of()), keys("C"), "C"));
        assertThrows(IllegalArgumentException.class, () -> analyze(List.of(List.of("")), keys("C"), "C"));
    }

    @Test
    void acceptsMaximumFootprintWithinCaps() {
        // 16x16x2 = 512 cells exactly at MAX_CELLS; the last cell is the controller.
        String fullRow = "A".repeat(PatternShape.MAX_DIMENSION);
        List<String> fullLayer = new ArrayList<>();
        for (int z = 0; z < PatternShape.MAX_DIMENSION; z++) {
            fullLayer.add(fullRow);
        }
        List<String> topLayer = new ArrayList<>(fullLayer);
        topLayer.set(PatternShape.MAX_DIMENSION - 1, "A".repeat(PatternShape.MAX_DIMENSION - 1) + "C");
        PatternShape shape = analyze(List.of(fullLayer, topLayer), keys("A", "C"), "C");
        assertEquals(PatternShape.MAX_CELLS, shape.memberCount());
        assertEquals(new PatternShape.Cell(15, 1, 15, "C"), shape.controllerCell());
    }
}
