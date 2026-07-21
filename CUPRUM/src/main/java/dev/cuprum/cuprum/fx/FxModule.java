package dev.cuprum.cuprum.fx;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.CuprumCreativeTabs;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;

/**
 * FX-module bootstrap (plan §5.1): called exactly once from {@code Cuprum.onInitialize()},
 * after {@code MachineModule.init()}. Registers the module content ({@link FxContent}), the
 * one S2C payload type ({@link FxPayloads}), appends the probe item to the Cuprum creative tab
 * via the D4 event hook, and wires the {@link FxRippleBroadcaster} per-connection window
 * lifecycle (mirroring the net module's session identity: created on JOIN, conditionally
 * dropped on serialized DISCONNECT, swept on SERVER_STOPPED).
 *
 * <p>No client classes anywhere in {@code main/.../fx} (plan D5): renderers, particles,
 * receivers and tier policy live in {@code client/.../fx} behind {@code FxClientModule}.
 */
public final class FxModule {
    private FxModule() {
    }

    public static void init() {
        FxContent.init();
        FxPayloads.register();

        ItemGroupEvents.modifyEntriesEvent(CuprumCreativeTabs.CUPRUM_TAB_KEY)
                .register(entries -> entries.accept(FxContent.FX_PROBE_ITEM));

        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) ->
                FxRippleBroadcaster.handleJoin(handler));
        ServerPlayConnectionEvents.DISCONNECT.register(FxRippleBroadcaster::handleDisconnect);
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> FxRippleBroadcaster.handleServerStopped());

        Cuprum.LOGGER.info("[fx] client FX foundation (common side) initialized");
    }
}
