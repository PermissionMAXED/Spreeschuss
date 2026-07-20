package dev.cuprum.cuprum.ownership;

import java.util.Locale;

/**
 * Claim access policy (net-state.md §6). Minecraft-free on purpose (plan D9) so the
 * {@link OwnershipCore} truth table is unit-testable; the DFU/stream codecs live on
 * {@link Claim}. Openness order: OWNER_ONLY ⊂ TEAM ⊂ PUBLIC.
 */
public enum AccessPolicy {
    OWNER_ONLY,
    TEAM,
    PUBLIC;

    private final String serializedName = name().toLowerCase(Locale.ROOT);

    /** Stable serialized form ({@code owner_only}, {@code team}, {@code public}). */
    public String serializedName() {
        return serializedName;
    }

    /** Reverse lookup for codecs; returns {@code null} for unknown names (codec rejects). */
    public static AccessPolicy byName(String name) {
        for (AccessPolicy policy : values()) {
            if (policy.serializedName.equals(name)) {
                return policy;
            }
        }
        return null;
    }
}
