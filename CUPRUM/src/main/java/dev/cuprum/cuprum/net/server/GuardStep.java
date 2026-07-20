package dev.cuprum.cuprum.net.server;

/**
 * The binding C2S guard order (plan §3.2): liveness → rate → range → menu → ownership
 * (permission node + claim) → state → value. Enum ordinal <b>is</b> the canonical position;
 * {@link GuardCore} rejects check lists that violate it. Minecraft-free (plan D9).
 */
public enum GuardStep {
    LIVENESS,
    RATE,
    RANGE,
    MENU,
    OWNERSHIP,
    STATE,
    VALUE
}
