package dev.cuprum.cuprum.gametest;

import dev.cuprum.cuprum.gametest.net.GuardProbeCounters;
import dev.cuprum.cuprum.gametest.net.GuardProbePayload;
import dev.cuprum.cuprum.net.CuprumNet;
import dev.cuprum.cuprum.net.NetBounds;
import dev.cuprum.cuprum.net.server.GuardSpec;
import dev.cuprum.cuprum.net.server.RateKey;
import dev.cuprum.cuprum.ownership.ClaimAccess;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;

/**
 * Test-mod bootstrap for the {@code cuprum-gametest} mod: registers the {@link GuardProbePayload}
 * through the exact production path ({@code PayloadTypeRegistry} then
 * {@code CuprumNet.registerGuardedC2S}, type-before-receiver) with counting hooks at every lazy
 * stage. {@code GuardLazinessGameTest} resets {@link GuardProbeCounters}, forges dispatches and
 * asserts which stages ran. Runs after Cuprum's own initializer ({@code depends: cuprum}).
 */
public final class CuprumGametestInit implements ModInitializer {
    @Override
    public void onInitialize() {
        PayloadTypeRegistry.playC2S().register(GuardProbePayload.TYPE, GuardProbePayload.STREAM_CODEC);
        CuprumNet.registerGuardedC2S(
                GuardProbePayload.TYPE,
                RateKey.DEFAULT,
                payload -> {
                    GuardProbeCounters.SPEC_FACTORY_CALLS.incrementAndGet();
                    return GuardSpec.builder()
                            .range(payload.pos(), NetBounds.MAX_RANGE_DISTANCE)
                            .claim(() -> {
                                // Stand-in for a world/block-entity-derived claim lookup: must
                                // only ever run at the OWNERSHIP step. Null = unclaimed (PUBLIC).
                                GuardProbeCounters.CLAIM_RESOLUTIONS.incrementAndGet();
                                return null;
                            }, ClaimAccess.USE)
                            .state(() -> {
                                GuardProbeCounters.STATE_CHECKS.incrementAndGet();
                                return true;
                            })
                            .value(() -> payload.marker() >= 0)
                            .build();
                },
                (payload, player) -> GuardProbeCounters.HANDLER_RUNS.incrementAndGet());
    }
}
