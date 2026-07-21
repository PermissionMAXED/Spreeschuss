package dev.cuprum.cuprum.handbook;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.handbook.net.HandbookPayloads;
import dev.cuprum.cuprum.handbook.net.HandbookRecipesPayload;
import dev.cuprum.cuprum.handbook.net.HandbookSyncPayload;
import io.netty.buffer.Unpooled;
import java.util.List;
import java.util.Optional;
import java.util.TreeMap;
import java.util.TreeSet;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.networking.v1.PlayerLookup;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.resource.v1.ResourceLoader;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.packs.PackType;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.item.crafting.display.RecipeDisplay;

/**
 * Handbook module bootstrap (plan §5.1: last {@code Cuprum.onInitialize()} line). Owns the
 * {@code cuprum:handbook} SERVER_DATA reloader registration and the two sync triggers —
 * JOIN (per player) and datapack reload (re-parse via the reloader, then broadcast) — exactly
 * mirroring the {@code CuprumConfigs} sync contract. Late joiners therefore always receive
 * the post-reload content; clients never read handbook JSON from disk (handbook-config.md
 * §4), so server and client can never disagree on content.
 *
 * <p>Every resync logs the encoded payload sizes (QOL packet-budget culture: data from day
 * one; the sync GameTest asserts the W1 snapshot stays under the 8 KiB S2C default budget).
 */
public final class HandbookModule {
    /** Plan §3.2: S2C default budget; W1 content must stay under it (GameTest-asserted). */
    public static final int S2C_DEFAULT_BUDGET_BYTES = 8 * 1024;

    private HandbookModule() {
    }

    public static void init() {
        HandbookPayloads.register();
        ResourceLoader.get(PackType.SERVER_DATA).registerReloader(HandbookManager.RELOADER_ID, new HandbookManager());
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
            HandbookSyncPayload sync = HandbookSyncPayload.of(HandbookManager.loaded());
            HandbookRecipesPayload recipes = buildRecipesPayload(server);
            sender.sendPacket(sync);
            sender.sendPacket(recipes);
            logSizes(server, sync, recipes, "join " + handler.player.getGameProfile().name());
        });
        ServerLifecycleEvents.END_DATA_PACK_RELOAD.register((server, resourceManager, success) ->
                resyncAll(server));
        Cuprum.LOGGER.info("[handbook] initialized (reloader {})", HandbookManager.RELOADER_ID);
    }

    /**
     * Broadcasts a fresh snapshot to every connected player — the {@code /reload} half of the
     * sync contract. Public so the reload GameTest can drive the resync path directly without
     * a full (suite-hostile) datapack reload.
     */
    public static void resyncAll(MinecraftServer server) {
        HandbookSyncPayload sync = HandbookSyncPayload.of(HandbookManager.loaded());
        HandbookRecipesPayload recipes = buildRecipesPayload(server);
        for (ServerPlayer player : PlayerLookup.all(server)) {
            ServerPlayNetworking.send(player, sync);
            ServerPlayNetworking.send(player, recipes);
        }
        logSizes(server, sync, recipes,
                "resync to " + PlayerLookup.all(server).size() + " player(s), generation "
                        + HandbookManager.reloadGeneration());
    }

    /**
     * Resolves every {@code recipe} widget id in the current store to its first
     * {@code RecipeDisplay}. Unknown ids get one WARN and are omitted (client shows the
     * localized unavailable body); CI asserts the warning is absent for shipped content.
     */
    public static HandbookRecipesPayload buildRecipesPayload(MinecraftServer server) {
        TreeMap<ResourceLocation, RecipeDisplay> displays = new TreeMap<>();
        TreeSet<ResourceLocation> wanted = new TreeSet<>();
        HandbookManager.loaded().pages().values().forEach(page -> wanted.addAll(page.recipeIds()));
        for (ResourceLocation recipeId : wanted) {
            Optional<RecipeHolder<?>> holder =
                    server.getRecipeManager().byKey(ResourceKey.create(Registries.RECIPE, recipeId));
            List<RecipeDisplay> recipeDisplays =
                    holder.map(RecipeHolder::value).map(Recipe::display).orElse(List.of());
            if (recipeDisplays.isEmpty()) {
                Cuprum.LOGGER.warn("[handbook] recipe widget id {} does not resolve to a displayable recipe",
                        recipeId);
                continue;
            }
            displays.put(recipeId, recipeDisplays.get(0));
        }
        return new HandbookRecipesPayload(displays);
    }

    /** Exact encoded size of one payload (bytes), used for the day-one size log + GameTests. */
    public static <T extends CustomPacketPayload> int encodedSize(
            MinecraftServer server, T payload,
            net.minecraft.network.codec.StreamCodec<RegistryFriendlyByteBuf, T> codec) {
        RegistryFriendlyByteBuf buf = new RegistryFriendlyByteBuf(Unpooled.buffer(), server.registryAccess());
        try {
            codec.encode(buf, payload);
            return buf.readableBytes();
        } finally {
            buf.release();
        }
    }

    private static void logSizes(MinecraftServer server, HandbookSyncPayload sync,
            HandbookRecipesPayload recipes, String reason) {
        int syncBytes = encodedSize(server, sync, HandbookSyncPayload.STREAM_CODEC);
        int recipeBytes = encodedSize(server, recipes, HandbookRecipesPayload.STREAM_CODEC);
        Cuprum.LOGGER.info("[handbook] sync ({}): {} categories, {} pages, {} recipes; {} B + {} B encoded",
                reason, sync.categories().size(), sync.pages().size(), recipes.displays().size(),
                syncBytes, recipeBytes);
        if (syncBytes > S2C_DEFAULT_BUDGET_BYTES || recipeBytes > S2C_DEFAULT_BUDGET_BYTES) {
            Cuprum.LOGGER.warn("[handbook] sync payload exceeds the {} B S2C default budget; paginate before W5",
                    S2C_DEFAULT_BUDGET_BYTES);
        }
    }
}
