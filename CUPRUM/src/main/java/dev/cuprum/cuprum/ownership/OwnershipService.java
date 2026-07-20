package dev.cuprum.cuprum.ownership;

import dev.cuprum.cuprum.ownership.OwnershipCore.Relation;
import dev.cuprum.cuprum.perm.Nodes;
import dev.cuprum.cuprum.perm.Perms;
import java.util.Objects;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.scores.PlayerTeam;
import net.minecraft.world.scores.Scoreboard;

/**
 * Server-side ownership arbiter (net-state.md §6): derives the player↔owner {@link Relation}
 * (teams are vanilla scoreboard teams) and delegates the decision to the Minecraft-free
 * {@link OwnershipCore} truth table. The sole bypass is {@code cuprum.admin.override}
 * (fallback OP 2). Runs on the server thread only (called from guarded C2S handlers).
 */
public final class OwnershipService {
    private OwnershipService() {
    }

    /**
     * @param claim the target's claim, or {@code null} for unclaimed targets (treated as PUBLIC;
     *              the first CONFIGURE-capable interactor claims it at the feature layer)
     */
    public static boolean allows(ServerPlayer player, Claim claim, ClaimAccess access) {
        Objects.requireNonNull(player, "player");
        Objects.requireNonNull(access, "access");
        boolean adminOverride = Perms.check(player, Nodes.ADMIN_OVERRIDE, 2);
        if (claim == null) {
            return adminOverride || OwnershipCore.allowsUnclaimed(access);
        }
        Relation relation = relationOf(player, claim.owner());
        AccessPolicy policy = effectivePolicy(player, claim);
        return OwnershipCore.allows(relation, policy, access, adminOverride);
    }

    private static Relation relationOf(ServerPlayer player, Owner owner) {
        if (player.getUUID().equals(owner.uuid())) {
            return Relation.OWNER;
        }
        PlayerTeam playerTeam = player.getTeam();
        PlayerTeam ownerTeam = resolveOwnerTeam(player, owner);
        if (playerTeam != null && ownerTeam != null && playerTeam.getName().equals(ownerTeam.getName())) {
            return Relation.TEAM_MATE;
        }
        return Relation.STRANGER;
    }

    /** An unresolvable owner team degrades TEAM to OWNER_ONLY (net-state.md §6). */
    private static AccessPolicy effectivePolicy(ServerPlayer player, Claim claim) {
        if (claim.policy() == AccessPolicy.TEAM && resolveOwnerTeam(player, claim.owner()) == null) {
            return AccessPolicy.OWNER_ONLY;
        }
        return claim.policy();
    }

    private static PlayerTeam resolveOwnerTeam(ServerPlayer player, Owner owner) {
        Scoreboard scoreboard = player.level().getScoreboard();
        ServerPlayer ownerOnline = player.level().getServer().getPlayerList().getPlayer(owner.uuid());
        String scoreboardName = ownerOnline != null ? ownerOnline.getScoreboardName() : owner.cachedName();
        return scoreboard.getPlayersTeam(scoreboardName);
    }
}
