package dev.cuprum.cuprum.state;

import com.mojang.datafixers.util.Pair;
import com.mojang.serialization.Codec;
import com.mojang.serialization.DataResult;
import com.mojang.serialization.Dynamic;
import com.mojang.serialization.DynamicOps;
import dev.cuprum.cuprum.Cuprum;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.IntFunction;
import java.util.function.UnaryOperator;

/**
 * Schema-version envelope codec (plan D5/§3.1): decode reads {@code schema_version} (default 1),
 * applies the domain's append-only n → n+1 {@code Dynamic} steps up to the current version, then
 * parses with the current codec; encode stamps the current version. Forward versions (stored >
 * current, W1 floor) WARN once per domain and read best-effort with the current codec — never a
 * crash, never a downward migration. Full quarantine/state-lock is staged (plan D10).
 */
public final class Versioned {
    private static final Set<String> FORWARD_VERSION_WARNED = ConcurrentHashMap.newKeySet();

    private Versioned() {
    }

    public static <T> Codec<T> codec(String domain, int currentVersion, Codec<T> currentCodec,
            IntFunction<UnaryOperator<Dynamic<?>>> steps) {
        Objects.requireNonNull(domain, "domain");
        Objects.requireNonNull(currentCodec, "currentCodec");
        Objects.requireNonNull(steps, "steps");
        if (currentVersion < 1) {
            throw new IllegalArgumentException("currentVersion must be >= 1: " + currentVersion);
        }
        return new VersionedCodec<>(domain, currentVersion, currentCodec, steps);
    }

    private static final class VersionedCodec<T> implements Codec<T> {
        private final String domain;
        private final int currentVersion;
        private final Codec<T> currentCodec;
        private final IntFunction<UnaryOperator<Dynamic<?>>> steps;

        VersionedCodec(String domain, int currentVersion, Codec<T> currentCodec,
                IntFunction<UnaryOperator<Dynamic<?>>> steps) {
            this.domain = domain;
            this.currentVersion = currentVersion;
            this.currentCodec = currentCodec;
            this.steps = steps;
        }

        @Override
        public <U> DataResult<Pair<T, U>> decode(DynamicOps<U> ops, U input) {
            Dynamic<U> dynamic = new Dynamic<>(ops, input);
            int stored = Math.max(0,
                    dynamic.get(CuprumSchema.SAVED_DATA_VERSION_KEY).asInt(1));
            if (stored > currentVersion) {
                if (FORWARD_VERSION_WARNED.add(domain)) {
                    Cuprum.LOGGER.warn(
                            "[state] {} stored schema_version {} is newer than supported {}; reading best-effort",
                            domain, stored, currentVersion);
                }
                stored = currentVersion;
            }
            int migrationStart = stored;
            Dynamic<?> migrated = dynamic;
            try {
                for (int version = stored; version < currentVersion; version++) {
                    migrated = steps.apply(version).apply(migrated);
                }
            } catch (RuntimeException exception) {
                return DataResult.error(() -> "Failed to migrate " + domain + " schema "
                        + migrationStart + " to " + currentVersion + ": " + exception.getMessage());
            }
            // Steps keep the DynamicOps they were handed (pure value rewrites), so the value is
            // still a U; Dynamic erases that link, hence the localized cast.
            @SuppressWarnings("unchecked")
            U migratedValue = (U) migrated.getValue();
            return currentCodec.decode(ops, migratedValue);
        }

        @Override
        public <U> DataResult<U> encode(T value, DynamicOps<U> ops, U prefix) {
            return currentCodec.encode(value, ops, prefix).flatMap(encoded -> ops.mergeToMap(
                    encoded,
                    ops.createString(CuprumSchema.SAVED_DATA_VERSION_KEY),
                    ops.createInt(currentVersion)));
        }

        @Override
        public String toString() {
            return "Versioned[" + domain + " v" + currentVersion + "]";
        }
    }
}
