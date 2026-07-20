package dev.cuprum.cuprum.ownership;

/**
 * The four access kinds the ownership service arbitrates (net-state.md §6). Minecraft-free
 * (plan D9). DESTROY (including future wrench pickup) always follows CONFIGURE; policy changes
 * and ownership transfers are additionally owner-only at the feature layer.
 */
public enum ClaimAccess {
    VIEW,
    USE,
    CONFIGURE,
    DESTROY
}
