package dev.cuprum.cuprum.net;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.CuprumCatalog;
import dev.cuprum.cuprum.net.payload.DiagEchoPayload;
import dev.cuprum.cuprum.net.payload.DiagEchoReplyPayload;
import dev.cuprum.cuprum.net.server.GuardSpec;
import dev.cuprum.cuprum.net.server.RateKey;
import dev.cuprum.cuprum.perm.Nodes;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;

/**
 * The net module's own registration hook (plan D3): registers the W1A diagnostics payload types
 * (type-before-receiver, module-local) and wires the guarded diag-echo receiver. The echo is the
 * pipeline exerciser — CP0-style infrastructure with no catalog entry, gated by
 * {@code cuprum.diagnostics} (fallback OP 2) and the DEFAULT rate bucket (charged at the arrival
 * gate, before the payload-only spec factory runs).
 */
public final class CuprumPayloads {
    private CuprumPayloads() {
    }

    public static void register() {
        PayloadTypeRegistry.playC2S().register(DiagEchoPayload.TYPE, DiagEchoPayload.STREAM_CODEC);
        PayloadTypeRegistry.playS2C().register(DiagEchoReplyPayload.TYPE, DiagEchoReplyPayload.STREAM_CODEC);
        registerDiagEchoReceiver();
    }

    private static void registerDiagEchoReceiver() {
        CuprumNet.registerGuardedC2S(
                DiagEchoPayload.TYPE,
                RateKey.DEFAULT,
                payload -> GuardSpec.builder()
                        .permission(Nodes.DIAGNOSTICS, 2)
                        .value(() -> DiagEchoPayload.isValidNote(payload.note()))
                        .build(),
                (payload, player) -> {
                    String note = NetBounds.toNfc(payload.note());
                    DiagEchoReplyPayload reply = new DiagEchoReplyPayload(
                            payload.nonce(), player.level().getGameTime(), CuprumCatalog.CATALOG_SHA256);
                    ServerPlayNetworking.send(player, reply);
                    // The VALUE step already rejected control characters; escapeForLog is
                    // defense-in-depth so remote text can never mangle a log line.
                    Cuprum.LOGGER.info("[net] diag echo from {}: nonce={} note=\"{}\"",
                            player.getGameProfile().name(), payload.nonce(), NetBounds.escapeForLog(note));
                });
    }
}
