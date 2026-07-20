package dev.cuprum.cuprum.net.server;

import java.util.List;
import java.util.Objects;
import java.util.function.BooleanSupplier;

/**
 * Minecraft-free decision core of the C2S guard (plan D9): evaluates an ordered list of checks,
 * enforcing the canonical {@link GuardStep} order, short-circuiting at the first failure and
 * never evaluating later predicates once a step has failed. {@link C2SGuard} builds the checks
 * from a {@link GuardSpec} against a real player; unit tests drive this core directly.
 */
public final class GuardCore {
    private GuardCore() {
    }

    /** One guard check: the canonical step it belongs to, its predicate, and its failure result. */
    public record Check(GuardStep step, BooleanSupplier passes, GuardResult onFail) {
        public Check {
            Objects.requireNonNull(step, "step");
            Objects.requireNonNull(passes, "passes");
            Objects.requireNonNull(onFail, "onFail");
            if (onFail == GuardResult.PASS) {
                throw new IllegalArgumentException("onFail must be a failure result, not PASS");
            }
        }
    }

    /** Evaluation outcome: the result plus the step that failed ({@code null} on PASS). */
    public record Decision(GuardResult result, GuardStep failedStep) {
        public Decision {
            Objects.requireNonNull(result, "result");
            if ((result == GuardResult.PASS) != (failedStep == null)) {
                throw new IllegalArgumentException("failedStep must be present exactly when the result is a failure");
            }
        }
    }

    /**
     * Evaluates {@code checks} in order. The list must be sorted by canonical step order
     * (non-decreasing ordinals; several checks may share a step, e.g. permission + claim in
     * OWNERSHIP) or {@link IllegalArgumentException} is thrown before any predicate runs out of
     * order. Returns at the first failing check without evaluating any later predicate.
     */
    public static Decision evaluate(List<Check> checks) {
        Objects.requireNonNull(checks, "checks");
        int lastOrdinal = -1;
        for (Check check : checks) {
            int ordinal = check.step().ordinal();
            if (ordinal < lastOrdinal) {
                throw new IllegalArgumentException("guard checks out of canonical order at step " + check.step());
            }
            lastOrdinal = ordinal;
            if (!check.passes().getAsBoolean()) {
                return new Decision(check.onFail(), check.step());
            }
        }
        return new Decision(GuardResult.PASS, null);
    }
}
