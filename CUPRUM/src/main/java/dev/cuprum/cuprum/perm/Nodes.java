package dev.cuprum.cuprum.perm;

/**
 * The permission nodes Cuprum declares in W1 (plan §3.4/D10) — speculative nodes were trimmed;
 * later waves declare their own when they first need them.
 */
public final class Nodes {
    /** Gates diagnostics surfaces (diag echo, future QOL-10 overlay); fallback OP 2. */
    public static final String DIAGNOSTICS = "cuprum.diagnostics";
    /** Sole ownership bypass ({@link dev.cuprum.cuprum.ownership.OwnershipService}); fallback OP 2. */
    public static final String ADMIN_OVERRIDE = "cuprum.admin.override";

    private Nodes() {
    }
}
