package dev.cuprum.cuprum.handbook;

import com.mojang.serialization.Codec;
import com.mojang.serialization.DataResult;
import com.mojang.serialization.Decoder;
import com.mojang.serialization.DynamicOps;
import com.mojang.serialization.MapLike;
import com.mojang.datafixers.util.Pair;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/**
 * Strict-schema helpers for every handbook codec (handbook-config.md §3.2: unknown keys are
 * rejected, never silently ignored — DFU's {@code RecordCodecBuilder} alone would swallow
 * typos like {@code "titel_key"} and ship a page missing its title). The wrapper validates the
 * input's key set <i>before</i> delegating to the real codec, so the error names the exact
 * offending field. Decode-time rejection flows through the vanilla
 * {@code SimpleJsonResourceReloadListener.scanDirectory} per-file isolation: a bad page is
 * logged and skipped, the server never crashes.
 */
public final class HandbookCodecs {
    private HandbookCodecs() {
    }

    /** Wraps {@code base} so decoding fails loudly when the input map has unlisted keys. */
    public static <T> Codec<T> strictKeys(Codec<T> base, Set<String> allowedKeys, String what) {
        Set<String> allowed = Set.copyOf(allowedKeys);
        String allowedSorted = String.valueOf(new TreeSet<>(allowed));
        return Codec.of(base, new Decoder<>() {
            @Override
            public <U> DataResult<Pair<T, U>> decode(DynamicOps<U> ops, U input) {
                DataResult<List<String>> unknown = unknownKeys(ops, input, allowed);
                if (unknown.error().isPresent()) {
                    return DataResult.error(() -> what + ": " + unknown.error().get().message());
                }
                List<String> bad = unknown.result().orElse(List.of());
                if (!bad.isEmpty()) {
                    return DataResult.error(
                            () -> what + " has unknown field(s) " + bad + "; allowed keys " + allowedSorted);
                }
                return base.decode(ops, input);
            }
        }, "StrictKeys[" + what + "]");
    }

    /**
     * The strict decoder for a {@code "type"}-dispatched union: resolves the type first,
     * verifies the input's key set against that type's allowed keys
     * ({@code allowedKeysByType} returns {@code null} for unknown types), then delegates to
     * the dispatch codec. Unknown types and unknown keys both fail decode — the reloader
     * logs and skips the file, never crashes (§3.1).
     */
    public static <T> Decoder<T> strictDispatchDecoder(Codec<T> dispatchCodec,
            java.util.function.Function<String, Set<String>> allowedKeysByType, String what) {
        return new Decoder<>() {
            @Override
            public <U> DataResult<Pair<T, U>> decode(DynamicOps<U> ops, U input) {
                DataResult<String> typeName = ops.getMap(input).flatMap(map -> {
                    U typeValue = map.get("type");
                    return typeValue == null
                            ? DataResult.error(() -> what + " is missing required field 'type'")
                            : ops.getStringValue(typeValue);
                });
                if (typeName.error().isPresent()) {
                    return DataResult.error(() -> what + ": " + typeName.error().orElseThrow().message());
                }
                String name = typeName.result().orElseThrow();
                Set<String> allowed = allowedKeysByType.apply(name);
                if (allowed == null) {
                    return DataResult.error(() -> "unknown " + what + " type '" + name + "'");
                }
                DataResult<List<String>> unknown = unknownKeys(ops, input, allowed);
                List<String> bad = unknown.result().orElse(List.of());
                if (!bad.isEmpty()) {
                    return DataResult.error(() -> what + " '" + name + "' has unknown field(s) " + bad);
                }
                return dispatchCodec.decode(ops, input);
            }
        };
    }

    /**
     * The key-set half of {@link #strictKeys}, reusable by the widget dispatch (which must
     * resolve the {@code "type"} field before it knows the allowed key set). Returns the sorted
     * list of keys in {@code input} that are not in {@code allowed}, or an error result when
     * {@code input} is not a map.
     */
    public static <U> DataResult<List<String>> unknownKeys(DynamicOps<U> ops, U input, Set<String> allowed) {
        DataResult<MapLike<U>> map = ops.getMap(input);
        if (map.error().isPresent() || map.result().isEmpty()) {
            return DataResult.error(() -> "not a map: " + input);
        }
        List<String> unknown = new ArrayList<>();
        map.result().orElseThrow().entries().forEach(entry -> {
            String key = ops.getStringValue(entry.getFirst()).result().orElse(null);
            if (key == null || !allowed.contains(key)) {
                unknown.add(key == null ? String.valueOf(entry.getFirst()) : key);
            }
        });
        unknown.sort(String::compareTo);
        return DataResult.success(List.copyOf(unknown));
    }

    /** Canonical-constructor helper: non-null, non-blank, bounded lang-key style string. */
    public static String requireKeyString(String value, int maxChars, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must be a non-blank string");
        }
        if (value.length() > maxChars) {
            throw new IllegalArgumentException(
                    fieldName + " length " + value.length() + " exceeds bound " + maxChars);
        }
        return value;
    }

    /** Canonical-constructor helper: inclusive int range check (reject, never clamp — §3.2). */
    public static int requireRange(int value, int min, int max, String fieldName) {
        if (value < min || value > max) {
            throw new IllegalArgumentException(
                    fieldName + " = " + value + " outside [" + min + ", " + max + "]");
        }
        return value;
    }

    /** Canonical-constructor helper: bounded list size. */
    public static <T> List<T> requireMaxSize(List<T> list, int max, String fieldName) {
        if (list == null) {
            throw new IllegalArgumentException(fieldName + " must be present");
        }
        if (list.size() > max) {
            throw new IllegalArgumentException(
                    fieldName + " count " + list.size() + " exceeds bound " + max);
        }
        return List.copyOf(list);
    }
}
