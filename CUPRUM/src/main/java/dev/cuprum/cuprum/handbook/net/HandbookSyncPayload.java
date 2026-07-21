package dev.cuprum.cuprum.handbook.net;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.handbook.HandbookCategory;
import dev.cuprum.cuprum.handbook.HandbookCodecs;
import dev.cuprum.cuprum.handbook.HandbookManager;
import dev.cuprum.cuprum.handbook.HandbookPage;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * S2C full handbook snapshot ({@code cuprum:s2c/handbook/sync}, plan §3.2): the complete
 * post-parse category + page set in the server's deterministic order, sent on JOIN and after
 * datapack reload. Idempotent by construction — the client rebuilds its whole cache from each
 * snapshot (durable state, never a one-shot event). Decode re-runs every canonical
 * constructor, so a skewed or hostile server cannot smuggle out-of-bounds content into the
 * client cache. Encoded size is logged by {@code HandbookModule} from day one (QOL packet
 * budget culture, handbook-config.md §12).
 */
public record HandbookSyncPayload(List<HandbookCategory> categories, List<HandbookPage> pages)
        implements CustomPacketPayload {

    public static final int MAX_CATEGORIES = 64;
    public static final int MAX_PAGES = 512;

    public static final CustomPacketPayload.Type<HandbookSyncPayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "s2c/handbook/sync"));

    public static final StreamCodec<RegistryFriendlyByteBuf, HandbookSyncPayload> STREAM_CODEC =
            StreamCodec.of(
                    (buf, payload) -> {
                        buf.writeVarInt(payload.categories.size());
                        for (HandbookCategory category : payload.categories) {
                            HandbookCategory.STREAM_CODEC.encode(buf, category);
                        }
                        buf.writeVarInt(payload.pages.size());
                        for (HandbookPage page : payload.pages) {
                            HandbookPage.STREAM_CODEC.encode(buf, page);
                        }
                    },
                    buf -> {
                        int categoryCount = HandbookCodecs.requireRange(
                                buf.readVarInt(), 0, MAX_CATEGORIES, "category count");
                        List<HandbookCategory> categories = new ArrayList<>(categoryCount);
                        for (int i = 0; i < categoryCount; i++) {
                            categories.add(HandbookCategory.STREAM_CODEC.decode(buf));
                        }
                        int pageCount = HandbookCodecs.requireRange(
                                buf.readVarInt(), 0, MAX_PAGES, "page count");
                        List<HandbookPage> pages = new ArrayList<>(pageCount);
                        for (int i = 0; i < pageCount; i++) {
                            pages.add(HandbookPage.STREAM_CODEC.decode(buf));
                        }
                        return new HandbookSyncPayload(categories, pages);
                    });

    public HandbookSyncPayload {
        categories = HandbookCodecs.requireMaxSize(categories, MAX_CATEGORIES, "sync categories");
        pages = HandbookCodecs.requireMaxSize(pages, MAX_PAGES, "sync pages");
    }

    /** Snapshot of the current server store, preserving its deterministic order. */
    public static HandbookSyncPayload of(HandbookManager.Loaded loaded) {
        return new HandbookSyncPayload(
                loaded.categories(), List.copyOf(loaded.pages().values()));
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
