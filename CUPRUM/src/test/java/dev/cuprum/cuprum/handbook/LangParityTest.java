package dev.cuprum.cuprum.handbook;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * {@code lang_parity_en_de} (handbook-config.md §8): the committed generated EN/DE lang files
 * (path via {@code cuprum.generatedAssetsDir}, plan §2 build.gradle delta) must have exactly
 * equal key sets, no empty values, no TODO/FIXME markers, and per-key format-placeholder
 * parity — a DE string with a different {@code %s}/{@code %d} shape than its EN twin would
 * crash or garble at {@code Component.translatable} format time. Objective: missing keys = 0
 * in each direction.
 */
final class LangParityTest {
    private static final Pattern PLACEHOLDER = Pattern.compile("%(?:\\d+\\$)?[sd%]");

    @Test
    void keySetsAreExactlyEqualBothWays() throws IOException {
        Map<String, String> en = loadLang("en_us");
        Map<String, String> de = loadLang("de_de");
        TreeSet<String> onlyEn = new TreeSet<>(en.keySet());
        onlyEn.removeAll(de.keySet());
        TreeSet<String> onlyDe = new TreeSet<>(de.keySet());
        onlyDe.removeAll(en.keySet());
        assertEquals(new TreeSet<String>(), onlyEn, "keys missing from de_de.json");
        assertEquals(new TreeSet<String>(), onlyDe, "keys missing from en_us.json");
    }

    @Test
    void noEmptyValuesOrTodoMarkers() throws IOException {
        for (String lang : List.of("en_us", "de_de")) {
            for (Map.Entry<String, String> entry : loadLang(lang).entrySet()) {
                assertFalse(entry.getValue().isBlank(), lang + " value for " + entry.getKey() + " is blank");
                String upper = entry.getValue().toUpperCase(Locale.ROOT);
                assertFalse(upper.contains("TODO") || upper.contains("FIXME") || upper.contains("XXX"),
                        lang + " value for " + entry.getKey() + " carries a placeholder marker: "
                                + entry.getValue());
            }
        }
    }

    @Test
    void formatPlaceholdersMatchPerKey() throws IOException {
        Map<String, String> en = loadLang("en_us");
        Map<String, String> de = loadLang("de_de");
        for (String key : en.keySet()) {
            if (!de.containsKey(key)) {
                continue; // covered by the key-set assertion
            }
            assertEquals(placeholders(en.get(key)), placeholders(de.get(key)),
                    "format placeholders differ between EN and DE for " + key
                            + " (EN '" + en.get(key) + "' vs DE '" + de.get(key) + "')");
        }
    }

    @Test
    void handbookKeysUseTheReservedPrefix() throws IOException {
        // §3.4 lang-prefix ledger: handbook strings live under handbook.cuprum.* only.
        Map<String, String> en = loadLang("en_us");
        assertTrue(en.keySet().stream().anyMatch(key -> key.startsWith("handbook.cuprum.")),
                "expected handbook.cuprum.* keys in the shipped lang files");
        assertTrue(en.keySet().stream().noneMatch(key -> key.startsWith("handbook.")
                        && !key.startsWith("handbook.cuprum.")),
                "handbook lang keys outside the handbook.cuprum.* prefix");
    }

    /** Sorted placeholder multiset; unindexed and indexed forms are kept distinct on purpose. */
    private static List<String> placeholders(String value) {
        List<String> found = new ArrayList<>();
        Matcher matcher = PLACEHOLDER.matcher(value);
        while (matcher.find()) {
            if (!"%%".equals(matcher.group())) {
                found.add(matcher.group());
            }
        }
        found.sort(String::compareTo);
        return found;
    }

    static Map<String, String> loadLang(String lang) throws IOException {
        Path file = Path.of(System.getProperty("cuprum.generatedAssetsDir", "src/main/generated/assets"))
                .resolve("cuprum/lang/" + lang + ".json");
        assertTrue(Files.isRegularFile(file), "generated lang file missing: " + file);
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            JsonObject json = new Gson().fromJson(reader, JsonObject.class);
            Map<String, String> out = new LinkedHashMap<>();
            for (Map.Entry<String, JsonElement> entry : json.entrySet()) {
                out.put(entry.getKey(), entry.getValue().getAsString());
            }
            return out;
        }
    }
}
