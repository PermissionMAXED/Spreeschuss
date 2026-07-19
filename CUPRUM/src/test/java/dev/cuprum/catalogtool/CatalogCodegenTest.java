package dev.cuprum.catalogtool;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CatalogCodegenTest {
    private static final Path CATALOG_DIR = Path.of(System.getProperty("cuprum.catalogDir", "catalog"));

    @Test
    void canonicalizationIsOrderInsensitive() {
        JsonObject a = JsonParser.parseString("{\"b\":1,\"a\":[{\"y\":2,\"x\":3}]}").getAsJsonObject();
        JsonObject b = JsonParser.parseString("{\"a\":[{\"x\":3,\"y\":2}],\"b\":1}").getAsJsonObject();
        assertEquals(CanonicalJson.canonicalize(a), CanonicalJson.canonicalize(b));
        assertEquals("{\"a\":[{\"x\":3,\"y\":2}],\"b\":1}", CanonicalJson.canonicalize(a));
        assertEquals(CanonicalJson.sha256(a), CanonicalJson.sha256(b));
    }

    @Test
    void generatedSourceIsDeterministic() throws Exception {
        JsonObject catalog = CatalogValidator.parseObject(CATALOG_DIR.resolve("catalog.json"));
        String first = CatalogCodegen.generateSource(catalog, "dev.cuprum.cuprum");
        String second = CatalogCodegen.generateSource(catalog, "dev.cuprum.cuprum");
        assertEquals(first, second);
        assertTrue(first.contains("CATALOG_SHA256"));
        assertTrue(first.contains("\"U01\""));
        assertTrue(first.contains("\"U22\""));
        assertTrue(first.contains("\"PWR-01\""));
        assertTrue(first.contains("\"QOL-12\""));
        assertTrue(first.contains("ENTRY_COUNT = 272"));
    }

    @Test
    void shaChangesWhenCatalogChanges() throws Exception {
        JsonObject catalog = CatalogValidator.parseObject(CATALOG_DIR.resolve("catalog.json"));
        String originalSha = CanonicalJson.sha256(catalog);
        catalog.getAsJsonArray("entries").get(0).getAsJsonObject().addProperty("summary", "changed");
        assertTrue(!originalSha.equals(CanonicalJson.sha256(catalog)));
    }

    @Test
    void writeSourceRoundTrips(@TempDir Path tempDir) throws Exception {
        Path written = CatalogCodegen.writeSource(CATALOG_DIR.resolve("catalog.json"), "dev.cuprum.cuprum", tempDir);
        assertEquals(tempDir.resolve("dev/cuprum/cuprum/CuprumCatalog.java"), written);
        String content = Files.readString(written);
        JsonObject catalog = CatalogValidator.parseObject(CATALOG_DIR.resolve("catalog.json"));
        assertTrue(content.contains(CanonicalJson.sha256(catalog)));

        // Second write must be byte-identical and keep the same mtime-relevant content.
        Path writtenAgain = CatalogCodegen.writeSource(CATALOG_DIR.resolve("catalog.json"), "dev.cuprum.cuprum", tempDir);
        assertEquals(content, Files.readString(writtenAgain));
    }
}
