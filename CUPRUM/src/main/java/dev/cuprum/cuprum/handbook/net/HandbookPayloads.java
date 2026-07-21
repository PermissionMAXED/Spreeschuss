package dev.cuprum.cuprum.handbook.net;

import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;

/**
 * The handbook module's payload registration hook (plan D3: modules own their payloads;
 * net-state owns the infrastructure). S2C only — the handbook is read-only in W1
 * (handbook-config.md §4: zero C2S validation surface), so there is no guarded receiver.
 * Client receivers register later in {@code HandbookClientModule.init()} (Fabric requires
 * type-before-receiver per type; module-local ordering satisfies this).
 */
public final class HandbookPayloads {
    private HandbookPayloads() {
    }

    public static void register() {
        PayloadTypeRegistry.playS2C().register(HandbookSyncPayload.TYPE, HandbookSyncPayload.STREAM_CODEC);
        PayloadTypeRegistry.playS2C().register(HandbookRecipesPayload.TYPE, HandbookRecipesPayload.STREAM_CODEC);
    }
}
