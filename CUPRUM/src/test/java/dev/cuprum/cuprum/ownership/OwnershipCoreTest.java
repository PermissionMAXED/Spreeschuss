package dev.cuprum.cuprum.ownership;

import dev.cuprum.cuprum.ownership.OwnershipCore.Relation;
import java.util.Set;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MC-free unit tests (plan D9) for the single ownership truth table (net-state.md §6):
 * relation × policy × access, plus the admin override and the unclaimed-target rule. The
 * expected table is written out literally — any change to the semantics must edit this test.
 */
class OwnershipCoreTest {
    /** The full expected truth table without override: {relation, policy, access} → allowed. */
    private static boolean expected(Relation relation, AccessPolicy policy, ClaimAccess access) {
        boolean viewUse = access == ClaimAccess.VIEW || access == ClaimAccess.USE;
        return switch (relation) {
            case OWNER -> true; // owners may do everything on their own claim
            case TEAM_MATE -> switch (policy) {
                case OWNER_ONLY -> false;
                case TEAM, PUBLIC -> true; // VIEW/USE by openness; CONFIGURE/DESTROY owner-or-team
            };
            case STRANGER -> viewUse && policy == AccessPolicy.PUBLIC;
        };
    }

    @Test
    void truthTableWithoutOverrideMatchesTheSpecExactly() {
        for (Relation relation : Relation.values()) {
            for (AccessPolicy policy : AccessPolicy.values()) {
                for (ClaimAccess access : ClaimAccess.values()) {
                    assertEquals(expected(relation, policy, access),
                            OwnershipCore.allows(relation, policy, access, false),
                            relation + " × " + policy + " × " + access);
                }
            }
        }
    }

    @Test
    void adminOverrideAllowsEveryCombination() {
        for (Relation relation : Relation.values()) {
            for (AccessPolicy policy : AccessPolicy.values()) {
                for (ClaimAccess access : ClaimAccess.values()) {
                    assertTrue(OwnershipCore.allows(relation, policy, access, true),
                            "override must bypass " + relation + " × " + policy + " × " + access);
                }
            }
        }
    }

    @Test
    void strangersNeverConfigureOrDestroyEvenOnPublicClaims() {
        // The spec's sharpest edge: PUBLIC opens VIEW/USE to everyone but never CONFIGURE/DESTROY.
        assertTrue(OwnershipCore.allows(Relation.STRANGER, AccessPolicy.PUBLIC, ClaimAccess.VIEW, false));
        assertTrue(OwnershipCore.allows(Relation.STRANGER, AccessPolicy.PUBLIC, ClaimAccess.USE, false));
        assertEquals(false, OwnershipCore.allows(Relation.STRANGER, AccessPolicy.PUBLIC, ClaimAccess.CONFIGURE, false));
        assertEquals(false, OwnershipCore.allows(Relation.STRANGER, AccessPolicy.PUBLIC, ClaimAccess.DESTROY, false));
    }

    @Test
    void destroyAlwaysFollowsConfigure() {
        for (Relation relation : Relation.values()) {
            for (AccessPolicy policy : AccessPolicy.values()) {
                assertEquals(OwnershipCore.allows(relation, policy, ClaimAccess.CONFIGURE, false),
                        OwnershipCore.allows(relation, policy, ClaimAccess.DESTROY, false),
                        relation + " × " + policy);
            }
        }
    }

    @Test
    void unclaimedTargetsBehaveAsPublicForEveryAccess() {
        for (ClaimAccess access : ClaimAccess.values()) {
            assertTrue(OwnershipCore.allowsUnclaimed(access), access.name());
        }
        assertThrows(NullPointerException.class, () -> OwnershipCore.allowsUnclaimed(null));
    }

    @Test
    void allowsRejectsNullArguments() {
        assertThrows(NullPointerException.class,
                () -> OwnershipCore.allows(null, AccessPolicy.PUBLIC, ClaimAccess.VIEW, false));
        assertThrows(NullPointerException.class,
                () -> OwnershipCore.allows(Relation.OWNER, null, ClaimAccess.VIEW, false));
        assertThrows(NullPointerException.class,
                () -> OwnershipCore.allows(Relation.OWNER, AccessPolicy.PUBLIC, null, false));
    }

    @Test
    void accessPolicySerializedNamesAreStableAndBijective() {
        assertEquals("owner_only", AccessPolicy.OWNER_ONLY.serializedName());
        assertEquals("team", AccessPolicy.TEAM.serializedName());
        assertEquals("public", AccessPolicy.PUBLIC.serializedName());
        assertEquals(3, Set.of(
                AccessPolicy.OWNER_ONLY.serializedName(),
                AccessPolicy.TEAM.serializedName(),
                AccessPolicy.PUBLIC.serializedName()).size());
        for (AccessPolicy policy : AccessPolicy.values()) {
            assertEquals(policy, AccessPolicy.byName(policy.serializedName()));
        }
    }

    @Test
    void accessPolicyByNameRejectsUnknownAndCaseMismatchedNames() {
        assertNull(AccessPolicy.byName("OWNER_ONLY"));
        assertNull(AccessPolicy.byName("Public"));
        assertNull(AccessPolicy.byName("everyone"));
        assertNull(AccessPolicy.byName(""));
    }
}
