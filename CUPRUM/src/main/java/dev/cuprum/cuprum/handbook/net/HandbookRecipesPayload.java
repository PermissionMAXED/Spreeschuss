package dev.cuprum.cuprum.handbook.net;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.handbook.HandbookCodecs;
import dev.cuprum.cuprum.handbook.HandbookWire;
import java.util.Map;
import java.util.TreeMap;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.crafting.display.RecipeDisplay;

/**
 * S2C resolved recipe displays ({@code cuprum:s2c/handbook/recipes}, plan §3.2), sent beside
 * every {@link HandbookSyncPayload}. In 1.21.9 full recipes never reach the client
 * ({@code RecipeManager} is server-side); the server resolves each {@code recipe} widget id
 * to its first {@code RecipeDisplay} via the verified {@code RecipeDisplay.STREAM_CODEC}. A
 * missing id is simply absent from the map — the client renders the localized "recipe
 * unavailable" body (and the {@code handbook_pages_valid} GameTest asserts W1 ships none).
 * Deterministic {@link TreeMap} iteration keeps the encoding byte-stable per content set.
 */
public record HandbookRecipesPayload(Map<ResourceLocation, RecipeDisplay> displays)
        implements CustomPacketPayload {

    public static final int MAX_RECIPES = 256;

    public static final CustomPacketPayload.Type<HandbookRecipesPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "s2c/handbook/recipes"));

    public static final StreamCodec<RegistryFriendlyByteBuf, HandbookRecipesPayload> STREAM_CODEC =
            StreamCodec.of(
                    (buf, payload) -> {
                        buf.writeVarInt(payload.displays.size());
                        for (Map.Entry<ResourceLocation, RecipeDisplay> entry : payload.displays.entrySet()) {
                            HandbookWire.ID_STRING.encode(buf, entry.getKey().toString());
                            RecipeDisplay.STREAM_CODEC.encode(buf, entry.getValue());
                        }
                    },
                    buf -> {
                        int count = HandbookCodecs.requireRange(buf.readVarInt(), 0, MAX_RECIPES, "recipe count");
                        Map<ResourceLocation, RecipeDisplay> displays = new TreeMap<>();
                        for (int i = 0; i < count; i++) {
                            displays.put(ResourceLocation.parse(HandbookWire.ID_STRING.decode(buf)),
                                    RecipeDisplay.STREAM_CODEC.decode(buf));
                        }
                        return new HandbookRecipesPayload(displays);
                    });

    public HandbookRecipesPayload {
        if (displays == null || displays.size() > MAX_RECIPES) {
            throw new IllegalArgumentException("recipe display map missing or larger than " + MAX_RECIPES);
        }
        TreeMap<ResourceLocation, RecipeDisplay> sorted = new TreeMap<>();
        displays.forEach((id, display) -> {
            if (id == null || id.toString().length() > HandbookWire.MAX_ID_CHARS || display == null) {
                throw new IllegalArgumentException("recipe display entry invalid for " + id);
            }
            sorted.put(id, display);
        });
        displays = java.util.Collections.unmodifiableMap(sorted);
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
