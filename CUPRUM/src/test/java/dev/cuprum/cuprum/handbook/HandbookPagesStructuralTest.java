package dev.cuprum.cuprum.handbook;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;

/**
 * {@code handbook_pages_structural} (plan §4-W1E, D9): gson-level structural gate over the
 * committed {@code data/cuprum/handbook/**} tree, mirroring the strict codecs without MC
 * classes — ids match file paths, category refs resolve, key sets are exactly the allowed
 * sets, widget payloads are complete, recipe-widget ids exist in the committed generated
 * recipe tree, image textures resolve to committed PNGs, and {@code exempt.json} is present
 * and empty (plan D6). The runtime half (strict-codec parse + registry resolution) is the
 * {@code handbook_pages_valid} server GameTest.
 */
final class HandbookPagesStructuralTest {
    private static final Set<String> CATEGORY_KEYS = Set.of("id", "title_key", "icon", "sort");
    private static final Set<String> PAGE_KEYS =
            Set.of("id", "category", "title_key", "subject", "unlock", "search_extra_keys", "widgets");
    private static final Map<String, Set<String>> WIDGET_KEYS = Map.of(
            "text", Set.of("type", "key", "style"),
            "image", Set.of("type", "texture", "width", "height", "caption_key"),
            "recipe", Set.of("type", "recipe"),
            "multiblock", Set.of("type", "palette", "layers"),
            "charge", Set.of("type", "value_ref", "unit"));

    @Test
    void exemptListIsPresentAndEmpty() {
        Path exempt = HandbookJsonFixture.handbookRoot().resolve("exempt.json");
        assertTrue(Files.isRegularFile(exempt), "handbook/exempt.json must be committed (plan D6)");
        JsonArray array = HandbookJsonFixture.GSON.fromJson(
                readString(exempt), JsonArray.class);
        assertEquals(0, array.size(), "exempt.json must be EMPTY in W1 (plan D6; reviewed diff to change)");
    }

    @Test
    void categoriesAreStructurallyValid() throws IOException {
        Map<String, JsonObject> categories = HandbookJsonFixture.loadAll("categories");
        assertEquals(1, categories.size(), "W1 ships exactly one category (plan D6)");
        for (Map.Entry<String, JsonObject> entry : categories.entrySet()) {
            JsonObject category = entry.getValue();
            assertEquals(CATEGORY_KEYS, category.keySet(),
                    "category " + entry.getKey() + " keys must be exactly " + CATEGORY_KEYS);
            assertEquals("cuprum:" + entry.getKey(), category.get("id").getAsString(),
                    "category id must equal its file-derived id");
            assertTrue(category.get("title_key").getAsString().startsWith("handbook.cuprum.category."),
                    "category title_key must use the reserved prefix");
            assertTrue(category.get("sort").getAsInt() >= 0, "category sort must be non-negative");
        }
        assertTrue(categories.containsKey("diagnostics"), "plan D6: category cuprum:diagnostics");
    }

    @Test
    void pageIdsMatchFilePathsAndCategoriesResolve() throws IOException {
        Map<String, JsonObject> categories = HandbookJsonFixture.loadAll("categories");
        Map<String, JsonObject> pages = HandbookJsonFixture.loadAll("pages");
        assertEquals(3, pages.size(), "W1 ships exactly three pages (plan D6)");
        for (Map.Entry<String, JsonObject> entry : pages.entrySet()) {
            JsonObject page = entry.getValue();
            assertTrue(PAGE_KEYS.containsAll(page.keySet()),
                    "page " + entry.getKey() + " has unknown keys: " + page.keySet());
            assertEquals("cuprum:" + entry.getKey(), page.get("id").getAsString(),
                    "page id must equal its file-derived id (reloader link check)");
            String category = page.get("category").getAsString();
            assertTrue(category.startsWith("cuprum:")
                            && categories.containsKey(category.substring("cuprum:".length())),
                    "page " + entry.getKey() + " references unknown category " + category);
            assertTrue(entry.getKey().startsWith(category.substring("cuprum:".length()) + "/"),
                    "page file must live under its category directory");
            assertTrue(page.get("title_key").getAsString().startsWith("handbook.cuprum.page."),
                    "page title_key must use the reserved prefix");
            JsonObject unlock = page.getAsJsonObject("unlock");
            String unlockType = unlock.get("type").getAsString();
            assertTrue(Set.of("always", "key").contains(unlockType),
                    "W1 unlock types are always|key, got " + unlockType);
            if ("key".equals(unlockType)) {
                assertTrue(unlock.has("key"), "unlock type key requires a key field");
            }
        }
    }

    @Test
    void widgetsAreCompleteAndBounded() throws IOException {
        for (Map.Entry<String, JsonObject> entry : HandbookJsonFixture.loadAll("pages").entrySet()) {
            JsonArray widgets = entry.getValue().getAsJsonArray("widgets");
            assertTrue(widgets.size() >= 1 && widgets.size() <= 24,
                    "page " + entry.getKey() + " must have 1..24 widgets");
            for (JsonElement element : widgets) {
                JsonObject widget = element.getAsJsonObject();
                String type = widget.get("type").getAsString();
                Set<String> allowed = WIDGET_KEYS.get(type);
                assertTrue(allowed != null, "unknown widget type " + type + " in " + entry.getKey());
                assertTrue(allowed.containsAll(widget.keySet()),
                        "widget " + type + " in " + entry.getKey() + " has unknown keys " + widget.keySet());
                switch (type) {
                    case "text" -> assertTrue(widget.has("key"), "text widget requires key");
                    case "image" -> {
                        assertTrue(widget.has("texture") && widget.has("width") && widget.has("height"),
                                "image widget requires texture/width/height");
                        int width = widget.get("width").getAsInt();
                        int height = widget.get("height").getAsInt();
                        assertTrue(width >= 1 && width <= 512 && height >= 1 && height <= 512,
                                "image dimensions must be 1..512");
                    }
                    case "recipe" -> assertTrue(widget.has("recipe"), "recipe widget requires recipe");
                    case "multiblock" -> assertMultiblockBounds(entry.getKey(), widget);
                    case "charge" -> assertTrue(widget.has("value_ref"), "charge widget requires value_ref");
                    default -> throw new AssertionError("unreachable");
                }
            }
        }
    }

    @Test
    void recipeWidgetIdsExistInGeneratedRecipes() throws IOException {
        Path recipeDir = HandbookJsonFixture.generatedDataRoot().resolve("cuprum/recipe");
        for (Map.Entry<String, JsonObject> entry : HandbookJsonFixture.loadAll("pages").entrySet()) {
            for (JsonElement element : entry.getValue().getAsJsonArray("widgets")) {
                JsonObject widget = element.getAsJsonObject();
                if (!"recipe".equals(widget.get("type").getAsString())) {
                    continue;
                }
                String recipeId = widget.get("recipe").getAsString();
                assertTrue(recipeId.startsWith("cuprum:"),
                        "W1 recipe widgets reference cuprum recipes only, got " + recipeId);
                Path recipeFile = recipeDir.resolve(recipeId.substring("cuprum:".length()) + ".json");
                assertTrue(Files.isRegularFile(recipeFile),
                        "page " + entry.getKey() + " recipe widget id " + recipeId
                                + " has no committed generated recipe at " + recipeFile);
            }
        }
    }

    @Test
    void imageTexturesResolveToCommittedFiles() throws IOException {
        Path assetsRoot = Path.of(System.getProperty("cuprum.mainResourcesDir", "src/main/resources"))
                .resolve("assets");
        for (Map.Entry<String, JsonObject> entry : HandbookJsonFixture.loadAll("pages").entrySet()) {
            for (JsonElement element : entry.getValue().getAsJsonArray("widgets")) {
                JsonObject widget = element.getAsJsonObject();
                if (!"image".equals(widget.get("type").getAsString())) {
                    continue;
                }
                String texture = widget.get("texture").getAsString();
                int colon = texture.indexOf(':');
                Path file = assetsRoot.resolve(texture.substring(0, colon))
                        .resolve(texture.substring(colon + 1));
                assertTrue(Files.isRegularFile(file),
                        "page " + entry.getKey() + " image texture " + texture
                                + " has no committed file at " + file);
            }
        }
    }

    @Test
    void subjectsAreUniqueAcrossPages() throws IOException {
        TreeSet<String> seen = new TreeSet<>();
        for (Map.Entry<String, JsonObject> entry : HandbookJsonFixture.loadAll("pages").entrySet()) {
            for (String subject : HandbookJsonFixture.stringList(entry.getValue(), "subject")) {
                assertTrue(seen.add(subject),
                        "registry id " + subject + " is documented by more than one page");
            }
        }
        // Plan D6: the four shipped cuprum ids across the three pages.
        assertEquals(new TreeSet<>(List.of("cuprum:charge_probe", "cuprum:diagnostic_coil_core",
                        "cuprum:diagnostic_coil_frame", "cuprum:fx_probe")), seen,
                "W1 subject union must cover exactly the four shipped cuprum ids (plan D6)");
    }

    private static void assertMultiblockBounds(String page, JsonObject widget) {
        JsonObject palette = widget.getAsJsonObject("palette");
        assertTrue(!palette.isEmpty() && palette.size() <= 64,
                "multiblock palette must have 1..64 entries in " + page);
        JsonArray layers = widget.getAsJsonArray("layers");
        assertTrue(!layers.isEmpty() && layers.size() <= 16, "multiblock layers must be 1..16 in " + page);
        for (JsonElement layerElement : layers) {
            JsonArray rows = layerElement.getAsJsonArray();
            assertTrue(!rows.isEmpty() && rows.size() <= 16, "multiblock rows must be 1..16 in " + page);
            for (JsonElement rowElement : rows) {
                String row = rowElement.getAsString();
                assertTrue(!row.isEmpty() && row.length() <= 16,
                        "multiblock row strings must be 1..16 chars in " + page);
                for (int i = 0; i < row.length(); i++) {
                    String cell = String.valueOf(row.charAt(i));
                    assertTrue(" ".equals(cell) || palette.has(cell),
                            "multiblock row cell '" + cell + "' missing from palette in " + page);
                }
            }
        }
    }

    private static String readString(Path file) {
        try {
            return Files.readString(file);
        } catch (IOException e) {
            throw new AssertionError("cannot read " + file, e);
        }
    }
}
