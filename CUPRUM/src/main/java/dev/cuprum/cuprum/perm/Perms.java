package dev.cuprum.cuprum.perm;

import java.util.Objects;
import net.minecraft.server.level.ServerPlayer;

/**
 * Permission checks (plan D10): W1 is vanilla-fallback only — no optional
 * fabric-permissions-api dependency yet (unverifiable offline; no jar in loom-cache). The node
 * name is threaded through every call site so a later external-provider bridge is a drop-in
 * change to this single method.
 */
public final class Perms {
    private Perms() {
    }

    /**
     * @param node            permission node an external provider would evaluate (kept for the
     *                        future bridge; unused by the vanilla fallback)
     * @param fallbackOpLevel vanilla OP level that grants the node in W1
     */
    public static boolean check(ServerPlayer player, String node, int fallbackOpLevel) {
        Objects.requireNonNull(player, "player");
        Objects.requireNonNull(node, "node");
        return player.hasPermissions(fallbackOpLevel);
    }
}
