package dev.cuprum.cuprum.net.server;

/**
 * Outcome of the mandatory C2S guard pipeline (plan §3.2). Minecraft-free by design so the
 * decision-order core is unit-testable from {@code src/test} (plan D9).
 */
public enum GuardResult {
    /** Every configured check passed; the handler body may run. */
    PASS,
    /** Rate-limited: legitimate under lag, dropped without logging (counted only). */
    DROP_SILENT,
    /** Honest race (death, movement, menu close, permission/claim change): dropped and logged. */
    DROP_LOG,
    /** Impossible-for-honest-client input: recorded by {@link NetViolations}, may lead to a kick. */
    VIOLATION
}
