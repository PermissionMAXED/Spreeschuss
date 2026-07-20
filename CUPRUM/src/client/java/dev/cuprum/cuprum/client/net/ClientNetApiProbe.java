package dev.cuprum.cuprum.client.net;

import net.fabricmc.fabric.api.client.networking.v1.ClientConfigurationNetworking;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/**
 * Compile-time signature probe for the client half of the Fabric networking stack (net-state.md
 * §10; same frozen rules as {@code RenderApiProbe}): every member below type-checks the exact
 * 1.21.9 / Fabric API 0.134.1+1.21.9 client entry point W1 client code relies on, so upstream
 * drift fails this source set's compilation immediately.
 *
 * <p>Nothing here is ever invoked: all members are private, the class is never instantiated and
 * no static initializer performs work. See docs/API_PROBES.md "Networking &amp; state".
 */
public final class ClientNetApiProbe {
    private ClientNetApiProbe() {
    }

    /** Probe 1: play receiver registration + the play {@code Context} members. */
    private static <T extends CustomPacketPayload> boolean probePlayReceiver(CustomPacketPayload.Type<T> type) {
        return ClientPlayNetworking.registerGlobalReceiver(type, (payload, context) -> {
            Minecraft client = context.client();
            LocalPlayer player = context.player();
            client.execute(() -> player.getClass());
        });
    }

    /** Probe 2: client → server send + capability check. */
    private static boolean probePlaySend(CustomPacketPayload payload, CustomPacketPayload.Type<?> type) {
        if (ClientPlayNetworking.canSend(type)) {
            ClientPlayNetworking.send(payload);
            return true;
        }
        return false;
    }

    /** Probe 3: configuration-phase receiver + send (W1 registers none; hook pinned for later). */
    private static <T extends CustomPacketPayload> boolean probeConfigurationNetworking(
            CustomPacketPayload.Type<T> type, CustomPacketPayload payload) {
        boolean registered = ClientConfigurationNetworking.registerGlobalReceiver(type,
                (received, context) -> context.client().execute(() -> context.responseSender().getClass()));
        ClientConfigurationNetworking.send(payload);
        return registered;
    }

    /** Probe 4: connection lifecycle events (JOIN handler/sender/client; DISCONNECT handler/client). */
    private static void probeConnectionEvents() {
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> client.getClass());
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> client.getClass());
    }
}
