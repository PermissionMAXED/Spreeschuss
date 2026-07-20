package dev.cuprum.cuprum;

import dev.cuprum.catalogtool.CanonicalJson;
import dev.cuprum.catalogtool.CatalogValidator;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Verifies the generated CuprumCatalog constant class matches the source catalog. */
class CuprumCatalogGeneratedTest {
    private static final Path CATALOG_DIR = Path.of(System.getProperty("cuprum.catalogDir", "catalog"));

    @Test
    void generatedConstantsMatchCatalogFile() throws Exception {
        JsonObject catalog = CatalogValidator.parseObject(CATALOG_DIR.resolve("catalog.json"));
        assertEquals(CanonicalJson.sha256(catalog), CuprumCatalog.CATALOG_SHA256);
        assertEquals(catalog.getAsJsonArray("entries").size(), CuprumCatalog.ENTRY_COUNT);
        assertEquals(300, CuprumCatalog.IDS.size());
        for (int i = 0; i < 22; i++) {
            assertEquals(String.format("U%02d", i + 1), CuprumCatalog.IDS.get(i), "id order must match sequence");
        }
        // The CP0B additional entries follow in concept order (PWR first, QOL last),
        // then U23 at sequence 273 and the CP0C VFX family at 274..300.
        assertEquals("PWR-01", CuprumCatalog.IDS.get(22));
        assertEquals("QOL-12", CuprumCatalog.IDS.get(271));
        assertEquals("U23", CuprumCatalog.IDS.get(272));
        assertEquals("VFX-01", CuprumCatalog.IDS.get(273));
        assertEquals("VFX-27", CuprumCatalog.IDS.get(299));
        assertTrue(CuprumCatalog.IDS.contains("U01") && CuprumCatalog.IDS.contains("U22"));
        assertEquals(64, CuprumCatalog.CATALOG_SHA256.length());
    }
}
