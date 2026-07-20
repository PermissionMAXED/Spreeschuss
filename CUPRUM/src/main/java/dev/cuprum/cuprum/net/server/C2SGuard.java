package dev.cuprum.cuprum.net.server;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.net.NetBounds;
import dev.cuprum.cuprum.ownership.OwnershipService;
import dev.cuprum.cuprum.perm.Perms;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.phys.Vec3;

/**
 * The mandatory server-side C2S guard (plan §3.2). Handlers run on the server thread (verified),
 * so checks may read world state. The binding canonical order — liveness → rate → range → menu →
 * ownership (permission node, then claim) → state → value — is evaluated via the Minecraft-free
 * {@link GuardCore} in two stages:
 *
 * <ol>
 *   <li>{@link #checkArrival}: liveness + rate token (registration-owned {@link RateKey}),
 *       run by {@code CuprumNet.dispatch} <b>before</b> the payload's guard-spec factory is even
 *       invoked — a dead/rate-limited sender can never trigger feature/world-derived spec
 *       construction, and the token charge happens exactly once per dispatch.</li>
 *   <li>{@link #check}: the remaining spec-declared steps. World-derived inputs (claim) are
 *       resolved lazily at their own step, so a range/menu rejection never resolves a claim.</li>
 * </ol>
 *
 * <p>A failing step short-circuits and later predicates never run. Numeric/semantic value
 * failures are rejected as violations, never clamped.
 */
public final class C2SGuard {
    private C2SGuard() {
    }

    /**
     * Stage 1 — the arrival gate: liveness (unconditional for every guarded C2S payload) and the
     * rate-token charge. Called by {@code CuprumNet.dispatch} before spec construction; the rate
     * check consumes one token from the sender's {@code rateKey} + GLOBAL buckets if and only if
     * it passes (a liveness failure short-circuits and charges nothing).
     */
    public static GuardResult checkArrival(ServerPlayer player, ResourceLocation payloadId, RateKey rateKey) {
        List<GuardCore.Check> checks = new ArrayList<>(2);
        checks.add(new GuardCore.Check(GuardStep.LIVENESS,
                () -> !player.isRemoved() && player.isAlive() && !player.isSpectator(),
                GuardResult.DROP_LOG));
        checks.add(new GuardCore.Check(GuardStep.RATE,
                () -> NetRateLimiter.tryAcquire(player, rateKey),
                GuardResult.DROP_SILENT));
        return report(GuardCore.evaluate(checks), player, payloadId);
    }

    /** Stage 2 — the spec-declared steps; performs DROP_LOG logging and VIOLATION recording. */
    public static GuardResult check(ServerPlayer player, ResourceLocation payloadId, GuardSpec spec) {
        List<GuardCore.Check> checks = new ArrayList<>(6);
        if (spec.range() != null) {
            checks.add(new GuardCore.Check(GuardStep.RANGE,
                    () -> checkRange(player, spec.range()),
                    GuardResult.DROP_LOG));
        }
        if (spec.menu() != null) {
            checks.add(new GuardCore.Check(GuardStep.MENU,
                    () -> checkMenu(player, spec.menu()),
                    GuardResult.DROP_LOG));
        }
        if (spec.permission() != null) {
            checks.add(new GuardCore.Check(GuardStep.OWNERSHIP,
                    () -> Perms.check(player, spec.permission().node(), spec.permission().fallbackOpLevel()),
                    GuardResult.DROP_LOG));
        }
        if (spec.claim() != null) {
            // The claim resolver (world/block-entity derived) runs lazily HERE, only after every
            // earlier step passed — never for range/menu-rejected payloads.
            checks.add(new GuardCore.Check(GuardStep.OWNERSHIP,
                    () -> OwnershipService.allows(player, spec.claim().claimResolver().get(), spec.claim().access()),
                    GuardResult.DROP_LOG));
        }
        if (spec.state() != null) {
            checks.add(new GuardCore.Check(GuardStep.STATE, spec.state(), GuardResult.DROP_LOG));
        }
        if (spec.value() != null) {
            checks.add(new GuardCore.Check(GuardStep.VALUE, spec.value(), GuardResult.VIOLATION));
        }
        return report(GuardCore.evaluate(checks), player, payloadId);
    }

    private static GuardResult report(GuardCore.Decision decision, ServerPlayer player, ResourceLocation payloadId) {
        switch (decision.result()) {
            case DROP_LOG -> Cuprum.LOGGER.info("[net] dropped {} from {} ({}): {} check failed",
                    payloadId, player.getGameProfile().name(), player.getUUID(), decision.failedStep());
            case VIOLATION -> NetViolations.record(player, payloadId,
                    decision.failedStep() + " validation failed");
            default -> {
            }
        }
        return decision.result();
    }

    /**
     * Target chunk loaded in the sender's own level (checked before any block-entity read and
     * without chunk-load side effects — {@code Level.isLoaded} only queries the chunk source) and
     * eye distance within the spec's bound. Fails closed if the bound is somehow not a valid
     * range distance (the {@code RangeCheck} constructor already rejects such values).
     */
    private static boolean checkRange(ServerPlayer player, GuardSpec.RangeCheck range) {
        double maxDistance = range.maxDistance();
        if (!NetBounds.isValidRangeDistance(maxDistance)) {
            return false;
        }
        if (!player.level().isLoaded(range.pos())) {
            return false;
        }
        return player.getEyePosition().distanceToSqr(Vec3.atCenterOf(range.pos())) <= maxDistance * maxDistance;
    }

    /** Payload container id matches the open menu, expected class, and {@code stillValid}. */
    private static boolean checkMenu(ServerPlayer player, GuardSpec.MenuCheck menu) {
        AbstractContainerMenu open = player.containerMenu;
        return open != null
                && open.containerId == menu.containerId()
                && menu.menuClass().isInstance(open)
                && open.stillValid(player);
    }
}
