package dev.cuprum.cuprum.fx;

import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;

/**
 * The FX module's payload registration hook (plan D3: modules own their payloads; net-state
 * owns the infrastructure). One S2C event type only — {@code client.fx} never sends C2S nor
 * mutates game state (outcome neutrality, client-fx.md §6), so there is no guarded receiver
 * here. Fabric requires type-before-receiver per type; the client receiver registers later in
 * {@code FxClientModule.init()}.
 */
public final class FxPayloads {
    private FxPayloads() {
    }

    public static void register() {
        PayloadTypeRegistry.playS2C().register(FxRipplePayload.TYPE, FxRipplePayload.STREAM_CODEC);
    }
}
