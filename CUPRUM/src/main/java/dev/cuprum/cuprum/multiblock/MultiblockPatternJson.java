package dev.cuprum.cuprum.multiblock;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.mojang.serialization.DataResult;
import java.util.Set;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;

/**
 * Raw JSON gate for multiblock resources. This runs before any collection codec so malformed
 * packs cannot make DFU materialize unbounded lists/maps or silently ignore future fields.
 */
final class MultiblockPatternJson {
    static final int MAX_STATE_ENTRIES = 32;
    static final int MAX_RESOURCE_ID_LENGTH = 256;
    static final int MAX_PROPERTY_NAME_LENGTH = 64;
    static final int MAX_PROPERTY_VALUE_LENGTH = 64;

    private static final Set<String> TOP_LEVEL_FIELDS = Set.of(
            "format_version", "orientation_mode", "allow_mirror", "layers", "key", "controller");
    private static final Set<String> MATCHER_FIELDS = Set.of("block", "tag", "state", "facing");

    private MultiblockPatternJson() {
    }

    static DataResult<JsonElement> validate(JsonElement input) {
        try {
            validateOrThrow(input);
            return DataResult.success(input);
        } catch (IllegalArgumentException e) {
            return DataResult.error(e::getMessage);
        }
    }

    private static void validateOrThrow(JsonElement input) {
        JsonObject root = requireObject(input, "pattern");
        requireExactFields(root, TOP_LEVEL_FIELDS, "pattern");
        requireIntegralNumber(root, "format_version");
        requireString(root, "orientation_mode", MAX_PROPERTY_VALUE_LENGTH);
        requireBoolean(root, "allow_mirror");

        JsonArray layers = requireArray(root, "layers");
        requireSize(layers.size(), 1, MultiblockPattern.MAX_DIMENSION, "layers");
        int memberCells = 0;
        for (int y = 0; y < layers.size(); y++) {
            JsonArray rows = requireArray(layers.get(y), "layers[" + y + "]");
            requireSize(rows.size(), 1, MultiblockPattern.MAX_DIMENSION, "layers[" + y + "]");
            for (int z = 0; z < rows.size(); z++) {
                String row = requireString(rows.get(z), "layers[" + y + "][" + z + "]",
                        2 * MultiblockPattern.MAX_DIMENSION);
                int codepoints = row.codePointCount(0, row.length());
                requireSize(codepoints, 1, MultiblockPattern.MAX_DIMENSION,
                        "layers[" + y + "][" + z + "] codepoints");
                memberCells += (int) row.codePoints().filter(value -> value != '.').count();
                if (memberCells > MultiblockPattern.MAX_CELLS) {
                    throw fail("pattern has more than " + MultiblockPattern.MAX_CELLS + " member cells");
                }
            }
        }

        JsonObject key = requireObject(root, "key");
        requireSize(key.size(), 1, MultiblockPattern.MAX_KEY_ENTRIES, "key entries");
        for (var entry : key.entrySet()) {
            String paletteKey = entry.getKey();
            if (paletteKey.codePointCount(0, paletteKey.length()) != 1) {
                throw fail("key entry '" + boundedForMessage(paletteKey) + "' must be a single codepoint");
            }
            validateMatcher(paletteKey, entry.getValue());
        }

        String controller = requireString(root, "controller", 2);
        if (controller.codePointCount(0, controller.length()) != 1) {
            throw fail("controller must be a single codepoint");
        }
    }

    private static void validateMatcher(String paletteKey, JsonElement input) {
        String path = "key['" + boundedForMessage(paletteKey) + "']";
        JsonObject matcher = requireObject(input, path);
        rejectUnknownFields(matcher, MATCHER_FIELDS, path);

        boolean hasBlock = matcher.has("block");
        boolean hasTag = matcher.has("tag");
        if (hasBlock == hasTag) {
            throw fail(path + " must define exactly one of 'block' or 'tag'");
        }
        if (hasBlock) {
            String blockName = requireString(matcher, "block", MAX_RESOURCE_ID_LENGTH);
            ResourceLocation blockId = ResourceLocation.tryParse(blockName);
            if (blockId == null || !BuiltInRegistries.BLOCK.containsKey(blockId)) {
                throw fail(path + ".block is not a registered block: '" + boundedForMessage(blockName) + "'");
            }
        } else {
            String tagName = requireString(matcher, "tag", MAX_RESOURCE_ID_LENGTH);
            if (ResourceLocation.tryParse(tagName) == null) {
                throw fail(path + ".tag is not a valid resource location: '" + boundedForMessage(tagName) + "'");
            }
        }

        if (matcher.has("state")) {
            JsonObject state = requireObject(matcher, "state");
            if (state.size() > MAX_STATE_ENTRIES) {
                throw fail(path + ".state defines " + state.size() + " entries; max " + MAX_STATE_ENTRIES);
            }
            for (var entry : state.entrySet()) {
                requireBoundedMapKey(entry.getKey(), path + ".state property");
                requireString(entry.getValue(), path + ".state['" + boundedForMessage(entry.getKey()) + "']",
                        MAX_PROPERTY_VALUE_LENGTH);
            }
        }
        if (matcher.has("facing")) {
            requireString(matcher, "facing", MAX_PROPERTY_VALUE_LENGTH);
        }
        if (hasTag && (matcher.has("state") || matcher.has("facing"))) {
            throw fail(path + " uses a tag with state/facing constraints; that combination is unsupported");
        }
    }

    private static void requireExactFields(JsonObject object, Set<String> allowed, String path) {
        rejectUnknownFields(object, allowed, path);
        for (String field : allowed) {
            if (!object.has(field)) {
                throw fail(path + " is missing required field '" + field + "'");
            }
        }
    }

    private static void rejectUnknownFields(JsonObject object, Set<String> allowed, String path) {
        for (String field : object.keySet()) {
            if (!allowed.contains(field)) {
                throw fail(path + " contains unknown field '" + boundedForMessage(field) + "'");
            }
        }
    }

    private static JsonObject requireObject(JsonElement input, String path) {
        if (input == null || !input.isJsonObject()) {
            throw fail(path + " must be an object");
        }
        return input.getAsJsonObject();
    }

    private static JsonObject requireObject(JsonObject parent, String field) {
        if (!parent.has(field)) {
            throw fail("missing required field '" + field + "'");
        }
        return requireObject(parent.get(field), field);
    }

    private static JsonArray requireArray(JsonObject parent, String field) {
        if (!parent.has(field)) {
            throw fail("missing required field '" + field + "'");
        }
        return requireArray(parent.get(field), field);
    }

    private static JsonArray requireArray(JsonElement input, String path) {
        if (input == null || !input.isJsonArray()) {
            throw fail(path + " must be an array");
        }
        return input.getAsJsonArray();
    }

    private static String requireString(JsonObject parent, String field, int maxLength) {
        if (!parent.has(field)) {
            throw fail("missing required field '" + field + "'");
        }
        return requireString(parent.get(field), field, maxLength);
    }

    private static String requireString(JsonElement input, String path, int maxLength) {
        if (!(input instanceof JsonPrimitive primitive) || !primitive.isString()) {
            throw fail(path + " must be a string");
        }
        String value = primitive.getAsString();
        if (value.length() > maxLength) {
            throw fail(path + " length " + value.length() + " exceeds max " + maxLength);
        }
        return value;
    }

    private static void requireIntegralNumber(JsonObject parent, String field) {
        JsonElement input = parent.get(field);
        if (!(input instanceof JsonPrimitive primitive) || !primitive.isNumber()) {
            throw fail(field + " must be an integer");
        }
        try {
            int value = primitive.getAsInt();
            if (!primitive.getAsBigDecimal().equals(java.math.BigDecimal.valueOf(value))) {
                throw fail(field + " must be an integer");
            }
        } catch (NumberFormatException | ArithmeticException e) {
            throw fail(field + " must be an integer");
        }
    }

    private static void requireBoolean(JsonObject parent, String field) {
        JsonElement input = parent.get(field);
        if (!(input instanceof JsonPrimitive primitive) || !primitive.isBoolean()) {
            throw fail(field + " must be a boolean");
        }
    }

    private static void requireBoundedMapKey(String value, String path) {
        if (value.isEmpty()) {
            throw fail(path + " must not be empty");
        }
        if (value.length() > MAX_PROPERTY_NAME_LENGTH) {
            throw fail(path + " length " + value.length() + " exceeds max " + MAX_PROPERTY_NAME_LENGTH);
        }
    }

    private static void requireSize(int actual, int min, int max, String path) {
        if (actual < min || actual > max) {
            throw fail(path + " count " + actual + " is outside " + min + ".." + max);
        }
    }

    private static String boundedForMessage(String value) {
        int limit = Math.min(value.length(), MAX_PROPERTY_VALUE_LENGTH);
        return value.substring(0, limit) + (value.length() > limit ? "…" : "");
    }

    private static IllegalArgumentException fail(String message) {
        return new IllegalArgumentException("invalid multiblock JSON: " + message);
    }
}
