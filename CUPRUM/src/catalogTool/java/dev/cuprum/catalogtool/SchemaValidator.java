package dev.cuprum.catalogtool;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Deliberately small, deterministic interpreter for the JSON-Schema subset used by
 * {@code catalog/schema.json}: type, const, required, properties,
 * additionalProperties:false, items, enum, pattern, minLength, minimum, maximum,
 * uniqueItems. Unknown schema keywords cause a hard error so the schema stays strict.
 */
public final class SchemaValidator {
    private static final Set<String> KNOWN_KEYWORDS = Set.of(
            "$schema", "title", "description", "type", "const", "required", "properties",
            "additionalProperties", "items", "enum", "pattern", "minLength", "minimum",
            "maximum", "uniqueItems");

    private SchemaValidator() {
    }

    public static List<String> validate(JsonObject schema, JsonElement instance) {
        List<String> errors = new ArrayList<>();
        validateNode(schema, instance, "$", errors);
        return errors;
    }

    private static void validateNode(JsonObject schema, JsonElement instance, String path, List<String> errors) {
        for (String keyword : schema.keySet()) {
            if (!KNOWN_KEYWORDS.contains(keyword)) {
                errors.add(path + ": schema uses unsupported keyword '" + keyword + "'");
            }
        }

        if (schema.has("type") && !checkType(schema.get("type").getAsString(), instance, path, errors)) {
            return;
        }

        if (schema.has("const")) {
            JsonElement expected = schema.get("const");
            if (!expected.equals(instance)) {
                errors.add(path + ": expected const " + expected + " but was " + instance);
            }
        }

        if (schema.has("enum")) {
            JsonArray allowed = schema.getAsJsonArray("enum");
            boolean match = false;
            for (JsonElement candidate : allowed) {
                if (candidate.equals(instance)) {
                    match = true;
                    break;
                }
            }
            if (!match) {
                errors.add(path + ": value " + instance + " not in enum " + allowed);
            }
        }

        if (instance.isJsonObject()) {
            validateObject(schema, instance.getAsJsonObject(), path, errors);
        } else if (instance.isJsonArray()) {
            validateArray(schema, instance.getAsJsonArray(), path, errors);
        } else if (instance.isJsonPrimitive()) {
            validatePrimitive(schema, instance.getAsJsonPrimitive(), path, errors);
        }
    }

    private static boolean checkType(String type, JsonElement instance, String path, List<String> errors) {
        boolean ok = switch (type) {
            case "object" -> instance.isJsonObject();
            case "array" -> instance.isJsonArray();
            case "string" -> instance.isJsonPrimitive() && instance.getAsJsonPrimitive().isString();
            case "integer" -> instance.isJsonPrimitive() && instance.getAsJsonPrimitive().isNumber()
                    && instance.getAsJsonPrimitive().getAsNumber().toString().matches("-?\\d+");
            case "boolean" -> instance.isJsonPrimitive() && instance.getAsJsonPrimitive().isBoolean();
            default -> {
                errors.add(path + ": schema declares unsupported type '" + type + "'");
                yield false;
            }
        };
        if (!ok) {
            errors.add(path + ": expected type '" + type + "' but was " + instance);
        }
        return ok;
    }

    private static void validateObject(JsonObject schema, JsonObject instance, String path, List<String> errors) {
        if (schema.has("required")) {
            for (JsonElement required : schema.getAsJsonArray("required")) {
                if (!instance.has(required.getAsString())) {
                    errors.add(path + ": missing required field '" + required.getAsString() + "'");
                }
            }
        }

        JsonObject properties = schema.has("properties") ? schema.getAsJsonObject("properties") : new JsonObject();
        boolean additionalAllowed = !schema.has("additionalProperties")
                || !schema.get("additionalProperties").isJsonPrimitive()
                || schema.get("additionalProperties").getAsBoolean();

        for (String key : instance.keySet()) {
            if (properties.has(key)) {
                validateNode(properties.getAsJsonObject(key), instance.get(key), path + "." + key, errors);
            } else if (!additionalAllowed) {
                errors.add(path + ": unexpected additional field '" + key + "'");
            }
        }
    }

    private static void validateArray(JsonObject schema, JsonArray instance, String path, List<String> errors) {
        if (schema.has("items")) {
            JsonObject itemSchema = schema.getAsJsonObject("items");
            for (int i = 0; i < instance.size(); i++) {
                validateNode(itemSchema, instance.get(i), path + "[" + i + "]", errors);
            }
        }
        if (schema.has("uniqueItems") && schema.get("uniqueItems").getAsBoolean()) {
            Set<String> seen = new HashSet<>();
            for (int i = 0; i < instance.size(); i++) {
                if (!seen.add(CanonicalJson.canonicalize(instance.get(i)))) {
                    errors.add(path + "[" + i + "]: duplicate array element " + instance.get(i));
                }
            }
        }
    }

    private static void validatePrimitive(JsonObject schema, JsonPrimitive instance, String path, List<String> errors) {
        if (instance.isString()) {
            String value = instance.getAsString();
            if (schema.has("minLength") && value.length() < schema.get("minLength").getAsInt()) {
                errors.add(path + ": string shorter than minLength " + schema.get("minLength"));
            }
            if (schema.has("pattern") && !Pattern.compile(schema.get("pattern").getAsString()).matcher(value).matches()) {
                errors.add(path + ": value '" + value + "' does not match pattern " + schema.get("pattern"));
            }
        } else if (instance.isNumber()) {
            long value = instance.getAsLong();
            if (schema.has("minimum") && value < schema.get("minimum").getAsLong()) {
                errors.add(path + ": value " + value + " below minimum " + schema.get("minimum"));
            }
            if (schema.has("maximum") && value > schema.get("maximum").getAsLong()) {
                errors.add(path + ": value " + value + " above maximum " + schema.get("maximum"));
            }
        }
    }
}
