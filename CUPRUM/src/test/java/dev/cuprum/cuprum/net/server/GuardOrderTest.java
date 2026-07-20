package dev.cuprum.cuprum.net.server;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MC-free unit tests (plan D9) for the pure guard decision core: the canonical step order
 * (plan §3.2: liveness → rate → range → menu → ownership → state → value), short-circuit
 * semantics, and the structural invariants of {@code Check}/{@code Decision}.
 */
class GuardOrderTest {
    private static GuardCore.Check check(GuardStep step, boolean passes, GuardResult onFail) {
        return new GuardCore.Check(step, () -> passes, onFail);
    }

    @Test
    void canonicalStepOrderIsPinned() {
        // The ordinal IS the binding pipeline position (plan §3.2); reordering the enum
        // silently reorders every guard, so the exact sequence is asserted literally.
        assertEquals(List.of(
                GuardStep.LIVENESS, GuardStep.RATE, GuardStep.RANGE, GuardStep.MENU,
                GuardStep.OWNERSHIP, GuardStep.STATE, GuardStep.VALUE),
                List.of(GuardStep.values()));
    }

    @Test
    void allChecksPassingYieldsPassWithNoFailedStep() {
        GuardCore.Decision decision = GuardCore.evaluate(List.of(
                check(GuardStep.LIVENESS, true, GuardResult.DROP_LOG),
                check(GuardStep.RATE, true, GuardResult.DROP_SILENT),
                check(GuardStep.VALUE, true, GuardResult.VIOLATION)));
        assertEquals(GuardResult.PASS, decision.result());
        assertNull(decision.failedStep());
    }

    @Test
    void emptyCheckListPasses() {
        GuardCore.Decision decision = GuardCore.evaluate(List.of());
        assertEquals(GuardResult.PASS, decision.result());
    }

    @Test
    void firstFailureWinsAndReportsItsStep() {
        GuardCore.Decision decision = GuardCore.evaluate(List.of(
                check(GuardStep.LIVENESS, true, GuardResult.DROP_LOG),
                check(GuardStep.RATE, false, GuardResult.DROP_SILENT),
                check(GuardStep.VALUE, false, GuardResult.VIOLATION)));
        assertEquals(GuardResult.DROP_SILENT, decision.result());
        assertEquals(GuardStep.RATE, decision.failedStep());
    }

    @Test
    void laterPredicatesAreNotEvaluatedAfterAFailure() {
        List<GuardStep> evaluated = new ArrayList<>();
        GuardCore.Check tracked = new GuardCore.Check(GuardStep.VALUE, () -> {
            evaluated.add(GuardStep.VALUE);
            return true;
        }, GuardResult.VIOLATION);
        GuardCore.Decision decision = GuardCore.evaluate(List.of(
                check(GuardStep.RATE, false, GuardResult.DROP_SILENT),
                tracked));
        assertEquals(GuardResult.DROP_SILENT, decision.result());
        assertTrue(evaluated.isEmpty(), "VALUE predicate must not run after RATE failed");
    }

    @Test
    void severalChecksMaySharePermittedStep() {
        // e.g. permission + claim both live in OWNERSHIP; both must run when passing.
        List<String> evaluated = new ArrayList<>();
        GuardCore.Decision decision = GuardCore.evaluate(List.of(
                new GuardCore.Check(GuardStep.OWNERSHIP, () -> evaluated.add("perm"), GuardResult.DROP_LOG),
                new GuardCore.Check(GuardStep.OWNERSHIP, () -> evaluated.add("claim"), GuardResult.DROP_LOG),
                check(GuardStep.VALUE, true, GuardResult.VIOLATION)));
        assertEquals(GuardResult.PASS, decision.result());
        assertEquals(List.of("perm", "claim"), evaluated);
    }

    @Test
    void outOfOrderChecksAreRejectedBeforeAnyPredicateRuns() {
        List<String> evaluated = new ArrayList<>();
        List<GuardCore.Check> outOfOrder = List.of(
                new GuardCore.Check(GuardStep.VALUE, () -> evaluated.add("value"), GuardResult.VIOLATION),
                new GuardCore.Check(GuardStep.RATE, () -> evaluated.add("rate"), GuardResult.DROP_SILENT));
        assertThrows(IllegalArgumentException.class, () -> GuardCore.evaluate(outOfOrder));
        assertEquals(List.of("value"), evaluated,
                "the misordered RATE check must be detected before its predicate runs");
    }

    @Test
    void checkRejectsPassAsFailureResult() {
        assertThrows(IllegalArgumentException.class,
                () -> new GuardCore.Check(GuardStep.RATE, () -> true, GuardResult.PASS));
    }

    @Test
    void checkRejectsNullComponents() {
        assertThrows(NullPointerException.class,
                () -> new GuardCore.Check(null, () -> true, GuardResult.DROP_LOG));
        assertThrows(NullPointerException.class,
                () -> new GuardCore.Check(GuardStep.RATE, null, GuardResult.DROP_LOG));
        assertThrows(NullPointerException.class,
                () -> new GuardCore.Check(GuardStep.RATE, () -> true, null));
    }

    @Test
    void decisionEnforcesResultStepConsistency() {
        assertThrows(IllegalArgumentException.class,
                () -> new GuardCore.Decision(GuardResult.PASS, GuardStep.RATE));
        assertThrows(IllegalArgumentException.class,
                () -> new GuardCore.Decision(GuardResult.VIOLATION, null));
        assertEquals(GuardStep.VALUE, new GuardCore.Decision(GuardResult.VIOLATION, GuardStep.VALUE).failedStep());
    }
}
