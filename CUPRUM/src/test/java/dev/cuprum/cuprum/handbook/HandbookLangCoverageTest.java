package dev.cuprum.cuprum.handbook;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.util.Map;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;

/**
 * {@code handbook_lang_coverage} (handbook-config.md §8): every {@code title_key},
 * {@code text.key} and {@code caption_key} referenced by the committed handbook data must
 * exist in BOTH generated lang files. Objective: unresolved keys = 0. Together with the
 * parity gate this proves every handbook string ships in EN and DE.
 */
final class HandbookLangCoverageTest {
    @Test
    void everyReferencedKeyExistsInBothLangFiles() throws IOException {
        TreeSet<String> referenced = collectReferencedKeys();
        TreeSet<String> missing = new TreeSet<>();
        for (String lang : new String[] {"en_us", "de_de"}) {
            Map<String, String> table = LangParityTest.loadLang(lang);
            for (String key : referenced) {
                if (!table.containsKey(key)) {
                    missing.add(lang + ": " + key);
                }
            }
        }
        assertEquals(new TreeSet<String>(), missing, "handbook data references unresolved lang keys");
    }

    @Test
    void handbookDataReferencesAtLeastTheThreePageTitles() throws IOException {
        TreeSet<String> referenced = collectReferencedKeys();
        for (String page : new String[] {"charge_probe", "diagnostic_coil", "fx_probe"}) {
            String key = "handbook.cuprum.page." + page + ".title";
            assertEquals(true, referenced.contains(key), "expected page title key " + key);
        }
    }

    private static TreeSet<String> collectReferencedKeys() throws IOException {
        TreeSet<String> keys = new TreeSet<>();
        for (JsonObject category : HandbookJsonFixture.loadAll("categories").values()) {
            keys.add(category.get("title_key").getAsString());
        }
        for (JsonObject page : HandbookJsonFixture.loadAll("pages").values()) {
            keys.add(page.get("title_key").getAsString());
            for (JsonElement element : page.getAsJsonArray("widgets")) {
                JsonObject widget = element.getAsJsonObject();
                if (widget.has("key")) {
                    keys.add(widget.get("key").getAsString());
                }
                if (widget.has("caption_key")) {
                    keys.add(widget.get("caption_key").getAsString());
                }
            }
        }
        return keys;
    }
}
