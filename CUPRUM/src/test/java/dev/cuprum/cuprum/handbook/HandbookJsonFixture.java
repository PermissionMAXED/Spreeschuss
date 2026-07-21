package dev.cuprum.cuprum.handbook;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.io.Reader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Stream;

/**
 * Shared gson access to the committed handbook data tree (plan D9: structural JSON checks
 * stay MC-free JUnit via {@code cuprum.mainResourcesDir}). Files are returned sorted by path
 * so every suite iterates deterministically.
 */
final class HandbookJsonFixture {
    static final Gson GSON = new Gson();

    private HandbookJsonFixture() {
    }

    static Path handbookRoot() {
        Path root = Path.of(System.getProperty("cuprum.mainResourcesDir", "src/main/resources"))
                .resolve("data/cuprum/handbook");
        assertTrue(Files.isDirectory(root), "committed handbook data dir missing: " + root);
        return root;
    }

    static Path generatedDataRoot() {
        Path root = Path.of(System.getProperty("cuprum.generatedDataDir", "src/main/generated/data"));
        assertTrue(Files.isDirectory(root), "generated data dir missing: " + root);
        return root;
    }

    /** file-path-sorted {@code <relative id path> -> parsed object} for one handbook subdir. */
    static Map<String, JsonObject> loadAll(String subdir) throws IOException {
        Path dir = handbookRoot().resolve(subdir);
        assertTrue(Files.isDirectory(dir), "handbook data subdir missing: " + dir);
        TreeMap<String, JsonObject> out = new TreeMap<>();
        try (Stream<Path> files = Files.walk(dir)) {
            files.filter(path -> path.getFileName().toString().endsWith(".json"))
                    .sorted()
                    .forEach(path -> {
                        String relative = dir.relativize(path).toString()
                                .replace('\\', '/')
                                .replaceAll("\\.json$", "");
                        out.put(relative, parseObject(path));
                    });
        }
        return out;
    }

    static JsonObject parseObject(Path file) {
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            return GSON.fromJson(reader, JsonObject.class);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read " + file, e);
        }
    }

    static List<String> stringList(JsonObject json, String key) {
        if (!json.has(key)) {
            return List.of();
        }
        return json.getAsJsonArray(key).asList().stream()
                .map(element -> element.getAsString())
                .toList();
    }
}
