package dev.cuprum.cuprum.ownership;

import java.util.Objects;

/**
 * Minecraft-free ownership truth logic (plan D5/D9), unit-tested exhaustively from
 * {@code src/test}. {@link OwnershipService} derives the {@link Relation} from live player/team
 * state and delegates every decision here — there is exactly one truth table.
 *
 * <p>Semantics (net-state.md §6): VIEW/USE are allowed at the claim's policy level; CONFIGURE is
 * owner-or-team per policy (never strangers, even on PUBLIC); DESTROY follows CONFIGURE; the
 * admin override ({@code cuprum.admin.override}) is the sole bypass. Unclaimed targets behave as
 * PUBLIC and become claimed by the first CONFIGURE-capable interactor (feature layer, later
 * waves), so every access on an unclaimed target is allowed.
 */
public final class OwnershipCore {
    /** The requesting player's relation to a claim's owner. */
    public enum Relation {
        OWNER,
        TEAM_MATE,
        STRANGER
    }

    private OwnershipCore() {
    }

    /** Unclaimed (worldgen/legacy) targets behave as PUBLIC for every access kind. */
    public static boolean allowsUnclaimed(ClaimAccess access) {
        Objects.requireNonNull(access, "access");
        return true;
    }

    /** The single ownership decision: relation × policy × access (+ admin override). */
    public static boolean allows(Relation relation, AccessPolicy policy, ClaimAccess access, boolean adminOverride) {
        Objects.requireNonNull(relation, "relation");
        Objects.requireNonNull(policy, "policy");
        Objects.requireNonNull(access, "access");
        if (adminOverride) {
            return true;
        }
        int rank = switch (relation) {
            case OWNER -> 2;
            case TEAM_MATE -> 1;
            case STRANGER -> 0;
        };
        int required = switch (access) {
            case VIEW, USE -> switch (policy) {
                case OWNER_ONLY -> 2;
                case TEAM -> 1;
                case PUBLIC -> 0;
            };
            // CONFIGURE is owner-or-team per policy; strangers never configure. DESTROY follows it.
            case CONFIGURE, DESTROY -> policy == AccessPolicy.OWNER_ONLY ? 2 : 1;
        };
        return rank >= required;
    }
}
