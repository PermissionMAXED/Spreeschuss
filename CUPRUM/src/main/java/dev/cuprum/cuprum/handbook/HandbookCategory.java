package dev.cuprum.cuprum.handbook;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import java.util.Comparator;
import java.util.Set;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.resources.ResourceLocation;

/**
 * One handbook category (handbook-config.md §3.2): landing-grid entry, icon item and the
 * deterministic sort key. The JSON {@code "id"} must equal the file-derived id (checked at
 * {@link HandbookManager} link time — a mismatched file is skipped + logged, never trusted).
 * Registry order is {@link #ORDER}: {@code sort} ascending, then id ascending — stable across
 * reloads and identical on server and client (the sync payload preserves it).
 */
public record HandbookCategory(ResourceLocation id, String titleKey, ResourceLocation icon, int sort) {

    public static final int MAX_SORT = 65_535;

    /** Deterministic registry order: sort ascending, id ascending (never parse order). */
    public static final Comparator<HandbookCategory> ORDER =
            Comparator.comparingInt(HandbookCategory::sort).thenComparing(HandbookCategory::id);

    private static final Set<String> KEYS = Set.of("id", "title_key", "icon", "sort");

    public static final Codec<HandbookCategory> CODEC = HandbookCodecs.strictKeys(
            RecordCodecBuilder.create(instance -> instance.group(
                    ResourceLocation.CODEC.fieldOf("id").forGetter(HandbookCategory::id),
                    Codec.STRING.fieldOf("title_key").forGetter(HandbookCategory::titleKey),
                    ResourceLocation.CODEC.fieldOf("icon").forGetter(HandbookCategory::icon),
                    Codec.INT.fieldOf("sort").forGetter(HandbookCategory::sort)
            ).apply(instance, HandbookCategory::new)),
            KEYS, "category");

    public static final StreamCodec<RegistryFriendlyByteBuf, HandbookCategory> STREAM_CODEC =
            StreamCodec.composite(
                    HandbookWire.ID_STRING.map(ResourceLocation::parse, ResourceLocation::toString),
                    HandbookCategory::id,
                    HandbookWire.KEY_STRING, HandbookCategory::titleKey,
                    HandbookWire.ID_STRING.map(ResourceLocation::parse, ResourceLocation::toString),
                    HandbookCategory::icon,
                    ByteBufCodecs.VAR_INT, HandbookCategory::sort,
                    HandbookCategory::new);

    public HandbookCategory {
        if (id == null || id.toString().length() > HandbookWire.MAX_ID_CHARS) {
            throw new IllegalArgumentException("category.id missing or longer than " + HandbookWire.MAX_ID_CHARS);
        }
        titleKey = HandbookCodecs.requireKeyString(titleKey, HandbookWidget.MAX_KEY_CHARS, "category.title_key");
        if (icon == null || icon.toString().length() > HandbookWire.MAX_ID_CHARS) {
            throw new IllegalArgumentException("category.icon missing or longer than " + HandbookWire.MAX_ID_CHARS);
        }
        sort = HandbookCodecs.requireRange(sort, 0, MAX_SORT, "category.sort");
    }
}
