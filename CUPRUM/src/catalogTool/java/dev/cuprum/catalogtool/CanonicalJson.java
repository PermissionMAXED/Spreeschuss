package dev.cuprum.catalogtool;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;

import java.math.BigDecimal;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.TreeMap;

/**
 * Deterministic, canonical JSON serialization: object keys sorted lexicographically,
 * compact separators, integers rendered without fraction, strings escaped the same way
 * on every platform. The canonical form is the input for the catalog SHA-256.
 */
public final class CanonicalJson {
    private CanonicalJson() {
    }

    public static String canonicalize(JsonElement element) {
        StringBuilder sb = new StringBuilder();
        write(element, sb);
        return sb.toString();
    }

    public static String sha256(JsonElement element) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(canonicalize(element).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static void write(JsonElement element, StringBuilder sb) {
        if (element == null || element.isJsonNull()) {
            sb.append("null");
        } else if (element.isJsonObject()) {
            writeObject(element.getAsJsonObject(), sb);
        } else if (element.isJsonArray()) {
            writeArray(element.getAsJsonArray(), sb);
        } else {
            writePrimitive(element.getAsJsonPrimitive(), sb);
        }
    }

    private static void writeObject(JsonObject object, StringBuilder sb) {
        TreeMap<String, JsonElement> sorted = new TreeMap<>();
        for (Map.Entry<String, JsonElement> entry : object.entrySet()) {
            sorted.put(entry.getKey(), entry.getValue());
        }
        sb.append('{');
        boolean first = true;
        for (Map.Entry<String, JsonElement> entry : sorted.entrySet()) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            writeString(entry.getKey(), sb);
            sb.append(':');
            write(entry.getValue(), sb);
        }
        sb.append('}');
    }

    private static void writeArray(JsonArray array, StringBuilder sb) {
        sb.append('[');
        boolean first = true;
        for (JsonElement element : array) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            write(element, sb);
        }
        sb.append(']');
    }

    private static void writePrimitive(JsonPrimitive primitive, StringBuilder sb) {
        if (primitive.isString()) {
            writeString(primitive.getAsString(), sb);
        } else if (primitive.isBoolean()) {
            sb.append(primitive.getAsBoolean());
        } else {
            BigDecimal number = new BigDecimal(primitive.getAsNumber().toString());
            if (number.scale() <= 0 || number.stripTrailingZeros().scale() <= 0) {
                sb.append(number.toBigIntegerExact());
            } else {
                sb.append(number.stripTrailingZeros().toPlainString());
            }
        }
    }

    private static void writeString(String value, StringBuilder sb) {
        sb.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        sb.append('"');
    }
}
