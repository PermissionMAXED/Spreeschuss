package dev.cuprum.cuprum.handbook;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.resources.ResourceLocation;

/**
 * One handbook page (handbook-config.md §3.2): immutable record, strict JSON codec (unknown
 * keys rejected), bounded {@link #STREAM_CODEC}. {@code subject} lists the registry ids this
 * page documents — the completeness gate iterates the {@code cuprum} registries against the
 * union of all subjects. Prose lives only in lang keys ({@code title_key} + widget keys) so
 * the EN/DE parity gates cover every handbook string. The JSON {@code "id"} must equal the
 * file-derived id ({@link HandbookManager} link check).
 */
public record HandbookPage(
        ResourceLocation id,
        ResourceLocation category,
        String titleKey,
        List<ResourceLocation> subjects,
        HandbookUnlock unlock,
        List<String> searchExtraKeys,
        List<HandbookWidget> widgets) {

    public static final int MAX_SUBJECTS = 16;
    public static final int MAX_SEARCH_EXTRA_KEYS = 16;
    public static final int MAX_SEARCH_EXTRA_KEY_CHARS = 64;
    public static final int MAX_WIDGETS = 24;

    private static final Set<String> KEYS =
            Set.of("id", "category", "title_key", "subject", "unlock", "search_extra_keys", "widgets");

    public static final Codec<HandbookPage> CODEC = HandbookCodecs.strictKeys(
            RecordCodecBuilder.create(instance -> instance.group(
                    ResourceLocation.CODEC.fieldOf("id").forGetter(HandbookPage::id),
                    ResourceLocation.CODEC.fieldOf("category").forGetter(HandbookPage::category),
                    Codec.STRING.fieldOf("title_key").forGetter(HandbookPage::titleKey),
                    ResourceLocation.CODEC.listOf().optionalFieldOf("subject", List.of())
                            .forGetter(HandbookPage::subjects),
                    HandbookUnlock.CODEC.optionalFieldOf("unlock", HandbookUnlock.Always.INSTANCE)
                            .forGetter(HandbookPage::unlock),
                    Codec.STRING.listOf().optionalFieldOf("search_extra_keys", List.of())
                            .forGetter(HandbookPage::searchExtraKeys),
                    HandbookWidget.CODEC.listOf().fieldOf("widgets").forGetter(HandbookPage::widgets)
            ).apply(instance, HandbookPage::new)),
            KEYS, "page");

    public static final StreamCodec<RegistryFriendlyByteBuf, HandbookPage> STREAM_CODEC = StreamCodec.of(
            (buf, page) -> {
                HandbookWire.ID_STRING.encode(buf, page.id.toString());
                HandbookWire.ID_STRING.encode(buf, page.category.toString());
                HandbookWire.KEY_STRING.encode(buf, page.titleKey);
                buf.writeVarInt(page.subjects.size());
                for (ResourceLocation subject : page.subjects) {
                    HandbookWire.ID_STRING.encode(buf, subject.toString());
                }
                HandbookUnlock.STREAM_CODEC.encode(buf, page.unlock);
                buf.writeVarInt(page.searchExtraKeys.size());
                for (String extra : page.searchExtraKeys) {
                    ByteBufCodecs.stringUtf8(MAX_SEARCH_EXTRA_KEY_CHARS).encode(buf, extra);
                }
                buf.writeVarInt(page.widgets.size());
                for (HandbookWidget widget : page.widgets) {
                    HandbookWidget.STREAM_CODEC.encode(buf, widget);
                }
            },
            buf -> {
                ResourceLocation id = ResourceLocation.parse(HandbookWire.ID_STRING.decode(buf));
                ResourceLocation category = ResourceLocation.parse(HandbookWire.ID_STRING.decode(buf));
                String titleKey = HandbookWire.KEY_STRING.decode(buf);
                int subjectCount = HandbookCodecs.requireRange(buf.readVarInt(), 0, MAX_SUBJECTS, "subject count");
                List<ResourceLocation> subjects = new java.util.ArrayList<>(subjectCount);
                for (int i = 0; i < subjectCount; i++) {
                    subjects.add(ResourceLocation.parse(HandbookWire.ID_STRING.decode(buf)));
                }
                HandbookUnlock unlock = HandbookUnlock.STREAM_CODEC.decode(buf);
                int extraCount = HandbookCodecs.requireRange(buf.readVarInt(), 0, MAX_SEARCH_EXTRA_KEYS,
                        "search_extra_keys count");
                List<String> extras = new java.util.ArrayList<>(extraCount);
                for (int i = 0; i < extraCount; i++) {
                    extras.add(ByteBufCodecs.stringUtf8(MAX_SEARCH_EXTRA_KEY_CHARS).decode(buf));
                }
                int widgetCount = HandbookCodecs.requireRange(buf.readVarInt(), 1, MAX_WIDGETS, "widget count");
                List<HandbookWidget> widgets = new java.util.ArrayList<>(widgetCount);
                for (int i = 0; i < widgetCount; i++) {
                    widgets.add(HandbookWidget.STREAM_CODEC.decode(buf));
                }
                return new HandbookPage(id, category, titleKey, subjects, unlock, extras, widgets);
            });

    public HandbookPage {
        if (id == null || id.toString().length() > HandbookWire.MAX_ID_CHARS) {
            throw new IllegalArgumentException("page.id missing or longer than " + HandbookWire.MAX_ID_CHARS);
        }
        if (category == null || category.toString().length() > HandbookWire.MAX_ID_CHARS) {
            throw new IllegalArgumentException("page.category missing or longer than " + HandbookWire.MAX_ID_CHARS);
        }
        titleKey = HandbookCodecs.requireKeyString(titleKey, HandbookWidget.MAX_KEY_CHARS, "page.title_key");
        subjects = HandbookCodecs.requireMaxSize(subjects, MAX_SUBJECTS, "page.subject");
        for (ResourceLocation subject : subjects) {
            if (subject == null || subject.toString().length() > HandbookWire.MAX_ID_CHARS) {
                throw new IllegalArgumentException("page.subject entry missing or too long");
            }
        }
        if (unlock == null) {
            throw new IllegalArgumentException("page.unlock must be present");
        }
        searchExtraKeys = HandbookCodecs.requireMaxSize(searchExtraKeys, MAX_SEARCH_EXTRA_KEYS,
                "page.search_extra_keys");
        for (String extra : searchExtraKeys) {
            HandbookCodecs.requireKeyString(extra, MAX_SEARCH_EXTRA_KEY_CHARS, "page.search_extra_keys entry");
        }
        widgets = HandbookCodecs.requireMaxSize(widgets, MAX_WIDGETS, "page.widgets");
        if (widgets.isEmpty()) {
            throw new IllegalArgumentException("page.widgets must not be empty");
        }
    }

    /** All recipe ids referenced by {@code recipe} widgets, in widget order. */
    public List<ResourceLocation> recipeIds() {
        return widgets.stream()
                .filter(widget -> widget instanceof HandbookWidget.Recipe)
                .map(widget -> ((HandbookWidget.Recipe) widget).recipe())
                .toList();
    }

    /** The first {@code text} widget key, if any (used by search snippets). */
    public Optional<String> firstTextKey() {
        return widgets.stream()
                .filter(widget -> widget instanceof HandbookWidget.Text)
                .map(widget -> ((HandbookWidget.Text) widget).key())
                .findFirst();
    }
}
