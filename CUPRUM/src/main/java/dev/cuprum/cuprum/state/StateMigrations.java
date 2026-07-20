package dev.cuprum.cuprum.state;

import com.mojang.serialization.Dynamic;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.function.IntFunction;
import java.util.function.UnaryOperator;

/**
 * Per-domain registry of append-only, strictly n → n+1 {@code Dynamic} migration steps
 * (plan D5): applied inside codecs via {@link Versioned}, never through DataFixers. Steps must be
 * pure and total — no step may throw on any version-n output (property-tested by the wave that
 * adds the first step). W1 ships the skeleton: no domain has migrations yet.
 */
public final class StateMigrations {
    private static final Map<String, Map<Integer, UnaryOperator<Dynamic<?>>>> STEPS = new HashMap<>();

    private StateMigrations() {
    }

    /**
     * Registers the {@code fromVersion} → {@code fromVersion + 1} step for {@code domain}.
     * Registration happens at mod init (single-threaded); re-registering a step is a hard error
     * (append-only discipline).
     */
    public static synchronized void register(String domain, int fromVersion, UnaryOperator<Dynamic<?>> step) {
        Objects.requireNonNull(domain, "domain");
        Objects.requireNonNull(step, "step");
        if (fromVersion < 1) {
            throw new IllegalArgumentException("fromVersion must be >= 1: " + fromVersion);
        }
        Map<Integer, UnaryOperator<Dynamic<?>>> domainSteps =
                STEPS.computeIfAbsent(domain, key -> new HashMap<>());
        if (domainSteps.putIfAbsent(fromVersion, step) != null) {
            throw new IllegalStateException(
                    "duplicate migration step " + domain + " " + fromVersion + " -> " + (fromVersion + 1));
        }
    }

    /**
     * The step chain for {@code domain} as the {@link Versioned} codec consumes it. A missing
     * step for a version that stored data actually reaches is a build bug: it throws
     * {@link IllegalStateException}, which the SavedData/BE readers catch and log (world falls
     * back to domain defaults — loud, never a crash).
     */
    public static synchronized IntFunction<UnaryOperator<Dynamic<?>>> steps(String domain) {
        Objects.requireNonNull(domain, "domain");
        return fromVersion -> {
            UnaryOperator<Dynamic<?>> step;
            synchronized (StateMigrations.class) {
                step = STEPS.getOrDefault(domain, Map.of()).get(fromVersion);
            }
            if (step == null) {
                throw new IllegalStateException(
                        "missing migration step " + domain + " " + fromVersion + " -> " + (fromVersion + 1));
            }
            return step;
        };
    }
}
