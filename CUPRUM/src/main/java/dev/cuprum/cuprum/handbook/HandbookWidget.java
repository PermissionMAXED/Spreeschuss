package dev.cuprum.cuprum.handbook;

import com.mojang.serialization.Codec;
import com.mojang.serialization.DataResult;
import com.mojang.serialization.MapCodec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import dev.cuprum.cuprum.config.ConfigValueRefs;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Function;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.StringRepresentable;

/**
 * The W1 handbook widget union (handbook-config.md §3.2 with plan D10 overrides): {@code text},
 * {@code image}, {@code recipe}, {@code charge} (config-bound via {@link ConfigValueRefs}) and
 * {@code multiblock} (flat item-grid floor — the PiP isometric preview is staged to W4/TOOL-11,
 * plan D10). Records are immutable, canonical constructors bounds-check and throw (never
 * clamp), the JSON {@link #CODEC} rejects unknown keys per type, and {@link #STREAM_CODEC}
 * uses only bounded primitives (plan §3.2). Prose lives ONLY in lang keys so the EN/DE parity
 * gate covers every handbook string.
 */
public sealed interface HandbookWidget
        permits HandbookWidget.Text, HandbookWidget.Image, HandbookWidget.Recipe,
        HandbookWidget.Multiblock, HandbookWidget.Charge {

    int MAX_KEY_CHARS = 128;
    int MAX_TEXTURE_CHARS = 224;
    int MAX_IMAGE_DIMENSION = 512;
    int MAX_PALETTE_ENTRIES = 64;
    int MAX_STRUCTURE_EDGE = 16;

    String typeName();

    /** Text style ladder for the flat renderer; body is the default. */
    enum TextStyle implements StringRepresentable {
        BODY("body"), HEADING("heading"), CAPTION("caption");

        public static final Codec<TextStyle> CODEC = StringRepresentable.fromEnum(TextStyle::values);
        private final String name;

        TextStyle(String name) {
            this.name = name;
        }

        @Override
        public String getSerializedName() {
            return name;
        }
    }

    /** Unit suffix vocabulary for {@code charge} widgets (scientific notation, locale-stable). */
    enum ChargeUnit implements StringRepresentable {
        CG("Cg"), CG_PER_TICK("Cg/t"), TICKS("ticks");

        public static final Codec<ChargeUnit> CODEC = StringRepresentable.fromEnum(ChargeUnit::values);
        private final String label;

        ChargeUnit(String label) {
            this.label = label;
        }

        /** The literal suffix rendered after the value (e.g. {@code 5 Cg/t}). */
        public String label() {
            return label;
        }

        @Override
        public String getSerializedName() {
            return label;
        }
    }

    /** Localized prose paragraph; the key must exist in BOTH lang files (JUnit gate). */
    record Text(String key, TextStyle style) implements HandbookWidget {
        static final MapCodec<Text> MAP_CODEC = RecordCodecBuilder.mapCodec(instance -> instance.group(
                Codec.STRING.fieldOf("key").forGetter(Text::key),
                TextStyle.CODEC.optionalFieldOf("style", TextStyle.BODY).forGetter(Text::style)
        ).apply(instance, Text::new));
        static final Set<String> KEYS = Set.of("type", "key", "style");

        public Text {
            key = HandbookCodecs.requireKeyString(key, MAX_KEY_CHARS, "text.key");
            if (style == null) {
                throw new IllegalArgumentException("text.style must be present");
            }
        }

        @Override
        public String typeName() {
            return "text";
        }
    }

    /** Static texture; the client GameTest asserts the shipped textures resolve. */
    record Image(ResourceLocation texture, int width, int height, Optional<String> captionKey)
            implements HandbookWidget {
        static final MapCodec<Image> MAP_CODEC = RecordCodecBuilder.mapCodec(instance -> instance.group(
                ResourceLocation.CODEC.fieldOf("texture").forGetter(Image::texture),
                Codec.INT.fieldOf("width").forGetter(Image::width),
                Codec.INT.fieldOf("height").forGetter(Image::height),
                Codec.STRING.optionalFieldOf("caption_key").forGetter(Image::captionKey)
        ).apply(instance, Image::new));
        static final Set<String> KEYS = Set.of("type", "texture", "width", "height", "caption_key");

        public Image {
            if (texture == null || texture.toString().length() > MAX_TEXTURE_CHARS) {
                throw new IllegalArgumentException("image.texture missing or longer than " + MAX_TEXTURE_CHARS);
            }
            width = HandbookCodecs.requireRange(width, 1, MAX_IMAGE_DIMENSION, "image.width");
            height = HandbookCodecs.requireRange(height, 1, MAX_IMAGE_DIMENSION, "image.height");
            if (captionKey == null) {
                throw new IllegalArgumentException("image.caption_key optional must be present");
            }
            captionKey.ifPresent(key -> HandbookCodecs.requireKeyString(key, MAX_KEY_CHARS, "image.caption_key"));
        }

        @Override
        public String typeName() {
            return "image";
        }
    }

    /** Rendered from the server-resolved {@code RecipeDisplay} synced beside the pages (§5). */
    record Recipe(ResourceLocation recipe) implements HandbookWidget {
        static final MapCodec<Recipe> MAP_CODEC = RecordCodecBuilder.mapCodec(instance -> instance.group(
                ResourceLocation.CODEC.fieldOf("recipe").forGetter(Recipe::recipe)
        ).apply(instance, Recipe::new));
        static final Set<String> KEYS = Set.of("type", "recipe");

        public Recipe {
            if (recipe == null || recipe.toString().length() > MAX_TEXTURE_CHARS) {
                throw new IllegalArgumentException("recipe id missing or longer than " + MAX_TEXTURE_CHARS);
            }
        }

        @Override
        public String typeName() {
            return "recipe";
        }
    }

    /**
     * Flat per-layer item-grid structure preview (the pinned T3 floor, plan D10). Palette maps
     * single characters to block ids; layers are bottom-up lists of north-to-south row strings;
     * a space is an empty cell. Everything is capped at {@value #MAX_STRUCTURE_EDGE}³.
     */
    record Multiblock(Map<String, ResourceLocation> palette, List<List<String>> layers)
            implements HandbookWidget {
        static final MapCodec<Multiblock> MAP_CODEC = RecordCodecBuilder.mapCodec(instance -> instance.group(
                Codec.unboundedMap(Codec.STRING, ResourceLocation.CODEC).fieldOf("palette")
                        .forGetter(Multiblock::palette),
                Codec.STRING.listOf().listOf().fieldOf("layers").forGetter(Multiblock::layers)
        ).apply(instance, Multiblock::new));
        static final Set<String> KEYS = Set.of("type", "palette", "layers");

        public Multiblock {
            if (palette == null || palette.isEmpty() || palette.size() > MAX_PALETTE_ENTRIES) {
                throw new IllegalArgumentException("multiblock.palette must have 1.."
                        + MAX_PALETTE_ENTRIES + " entries");
            }
            // Deterministic iteration for encode + rendering, independent of parse order.
            TreeMap<String, ResourceLocation> sorted = new TreeMap<>();
            for (Map.Entry<String, ResourceLocation> entry : palette.entrySet()) {
                if (entry.getKey() == null || entry.getKey().length() != 1 || entry.getKey().isBlank()) {
                    throw new IllegalArgumentException(
                            "multiblock.palette key '" + entry.getKey() + "' must be one non-space character");
                }
                if (entry.getValue() == null) {
                    throw new IllegalArgumentException("multiblock.palette value missing for " + entry.getKey());
                }
                sorted.put(entry.getKey(), entry.getValue());
            }
            palette = java.util.Collections.unmodifiableMap(sorted);
            layers = HandbookCodecs.requireMaxSize(layers, MAX_STRUCTURE_EDGE, "multiblock.layers");
            if (layers.isEmpty()) {
                throw new IllegalArgumentException("multiblock.layers must not be empty");
            }
            for (List<String> layer : layers) {
                List<String> rows = HandbookCodecs.requireMaxSize(layer, MAX_STRUCTURE_EDGE, "multiblock layer rows");
                if (rows.isEmpty()) {
                    throw new IllegalArgumentException("multiblock layer must have at least one row");
                }
                for (String row : rows) {
                    if (row == null || row.isEmpty() || row.length() > MAX_STRUCTURE_EDGE) {
                        throw new IllegalArgumentException(
                                "multiblock row must be 1.." + MAX_STRUCTURE_EDGE + " characters");
                    }
                    for (int i = 0; i < row.length(); i++) {
                        String cell = String.valueOf(row.charAt(i));
                        if (!" ".equals(cell) && !palette.containsKey(cell)) {
                            throw new IllegalArgumentException(
                                    "multiblock row references unknown palette key '" + cell + "'");
                        }
                    }
                }
            }
            layers = layers.stream().map(List::copyOf).toList();
        }

        @Override
        public String typeName() {
            return "multiblock";
        }
    }

    /**
     * Config-bound number (plan §3.3): {@code value_ref} must be an allowed
     * {@link ConfigValueRefs} path, so handbook numbers can never drift from the live balance
     * config; the client renders the server-synced effective value.
     */
    record Charge(String valueRef, ChargeUnit unit) implements HandbookWidget {
        static final MapCodec<Charge> MAP_CODEC = RecordCodecBuilder.mapCodec(instance -> instance.group(
                Codec.STRING.fieldOf("value_ref").forGetter(Charge::valueRef),
                ChargeUnit.CODEC.optionalFieldOf("unit", ChargeUnit.CG).forGetter(Charge::unit)
        ).apply(instance, Charge::new));
        static final Set<String> KEYS = Set.of("type", "value_ref", "unit");

        public Charge {
            if (!ConfigValueRefs.isValid(valueRef)) {
                throw new IllegalArgumentException("charge.value_ref '" + valueRef
                        + "' is not an allowed config ref " + ConfigValueRefs.allowedPaths());
            }
            if (unit == null) {
                throw new IllegalArgumentException("charge.unit must be present");
            }
        }

        @Override
        public String typeName() {
            return "charge";
        }
    }

    /** Per-type map codecs, dispatch order = wire order (append-only). */
    List<String> TYPE_ORDER = List.of("text", "image", "recipe", "multiblock", "charge");

    private static MapCodec<? extends HandbookWidget> mapCodecFor(String typeName) {
        return switch (typeName) {
            case "text" -> Text.MAP_CODEC;
            case "image" -> Image.MAP_CODEC;
            case "recipe" -> Recipe.MAP_CODEC;
            case "multiblock" -> Multiblock.MAP_CODEC;
            case "charge" -> Charge.MAP_CODEC;
            default -> null;
        };
    }

    private static Set<String> allowedKeysFor(String typeName) {
        return switch (typeName) {
            case "text" -> Text.KEYS;
            case "image" -> Image.KEYS;
            case "recipe" -> Recipe.KEYS;
            case "multiblock" -> Multiblock.KEYS;
            case "charge" -> Charge.KEYS;
            default -> Set.of();
        };
    }

    Codec<HandbookWidget> DISPATCH_CODEC = Codec.STRING.partialDispatch("type",
            widget -> DataResult.success(widget.typeName()),
            typeName -> {
                MapCodec<? extends HandbookWidget> codec = mapCodecFor(typeName);
                return codec != null ? DataResult.success(codec)
                        : DataResult.error(() -> "unknown handbook widget type '" + typeName + "'");
            });

    /**
     * The strict widget codec: resolves {@code "type"} first, verifies the input's key set
     * against that type's allowed keys, then delegates to the dispatch codec. Unknown types and
     * unknown keys both fail decode (page skipped + logged by the reloader, never crash).
     */
    Codec<HandbookWidget> CODEC = Codec.of(DISPATCH_CODEC,
            HandbookCodecs.strictDispatchDecoder(DISPATCH_CODEC,
                    typeName -> mapCodecFor(typeName) == null ? null : allowedKeysFor(typeName),
                    "widget"));

    /** Bounded wire form: VAR_INT type index (TYPE_ORDER) + per-type bounded fields. */
    StreamCodec<RegistryFriendlyByteBuf, HandbookWidget> STREAM_CODEC = StreamCodec.of(
            HandbookWidgetWire::encode, HandbookWidgetWire::decode);

    /** Wire helpers, package-private on purpose (the union stays the only public surface). */
    final class HandbookWidgetWire {
        private static final StreamCodec<io.netty.buffer.ByteBuf, String> KEY_STRING =
                ByteBufCodecs.stringUtf8(MAX_KEY_CHARS);
        private static final StreamCodec<io.netty.buffer.ByteBuf, String> ID_STRING =
                ByteBufCodecs.stringUtf8(MAX_TEXTURE_CHARS);

        private HandbookWidgetWire() {
        }

        static void encode(RegistryFriendlyByteBuf buf, HandbookWidget widget) {
            buf.writeVarInt(TYPE_ORDER.indexOf(widget.typeName()));
            switch (widget) {
                case Text text -> {
                    KEY_STRING.encode(buf, text.key());
                    buf.writeVarInt(text.style().ordinal());
                }
                case Image image -> {
                    ID_STRING.encode(buf, image.texture().toString());
                    buf.writeVarInt(image.width());
                    buf.writeVarInt(image.height());
                    buf.writeBoolean(image.captionKey().isPresent());
                    if (image.captionKey().isPresent()) {
                        KEY_STRING.encode(buf, image.captionKey().orElseThrow());
                    }
                }
                case Recipe recipe -> ID_STRING.encode(buf, recipe.recipe().toString());
                case Multiblock multiblock -> {
                    buf.writeVarInt(multiblock.palette().size());
                    for (Map.Entry<String, ResourceLocation> entry : multiblock.palette().entrySet()) {
                        KEY_STRING.encode(buf, entry.getKey());
                        ID_STRING.encode(buf, entry.getValue().toString());
                    }
                    buf.writeVarInt(multiblock.layers().size());
                    for (List<String> layer : multiblock.layers()) {
                        buf.writeVarInt(layer.size());
                        for (String row : layer) {
                            KEY_STRING.encode(buf, row);
                        }
                    }
                }
                case Charge charge -> {
                    KEY_STRING.encode(buf, charge.valueRef());
                    buf.writeVarInt(charge.unit().ordinal());
                }
            }
        }

        static HandbookWidget decode(RegistryFriendlyByteBuf buf) {
            int typeIndex = buf.readVarInt();
            if (typeIndex < 0 || typeIndex >= TYPE_ORDER.size()) {
                throw new IllegalArgumentException("unknown widget wire type index " + typeIndex);
            }
            return switch (TYPE_ORDER.get(typeIndex)) {
                case "text" -> new Text(KEY_STRING.decode(buf), enumAt(TextStyle.values(), buf.readVarInt()));
                case "image" -> {
                    ResourceLocation texture = ResourceLocation.parse(ID_STRING.decode(buf));
                    int width = buf.readVarInt();
                    int height = buf.readVarInt();
                    Optional<String> caption = buf.readBoolean()
                            ? Optional.of(KEY_STRING.decode(buf)) : Optional.empty();
                    yield new Image(texture, width, height, caption);
                }
                case "recipe" -> new Recipe(ResourceLocation.parse(ID_STRING.decode(buf)));
                case "multiblock" -> {
                    int paletteSize = buf.readVarInt();
                    HandbookCodecs.requireRange(paletteSize, 1, MAX_PALETTE_ENTRIES, "palette size");
                    Map<String, ResourceLocation> palette = new TreeMap<>();
                    for (int i = 0; i < paletteSize; i++) {
                        palette.put(KEY_STRING.decode(buf), ResourceLocation.parse(ID_STRING.decode(buf)));
                    }
                    int layerCount = buf.readVarInt();
                    HandbookCodecs.requireRange(layerCount, 1, MAX_STRUCTURE_EDGE, "layer count");
                    List<List<String>> layers = new java.util.ArrayList<>(layerCount);
                    for (int i = 0; i < layerCount; i++) {
                        int rowCount = buf.readVarInt();
                        HandbookCodecs.requireRange(rowCount, 1, MAX_STRUCTURE_EDGE, "row count");
                        List<String> rows = new java.util.ArrayList<>(rowCount);
                        for (int j = 0; j < rowCount; j++) {
                            rows.add(KEY_STRING.decode(buf));
                        }
                        layers.add(rows);
                    }
                    yield new Multiblock(palette, layers);
                }
                case "charge" -> new Charge(KEY_STRING.decode(buf), enumAt(ChargeUnit.values(), buf.readVarInt()));
                default -> throw new IllegalArgumentException("unreachable widget type index " + typeIndex);
            };
        }

        private static <E extends Enum<E>> E enumAt(E[] values, int ordinal) {
            if (ordinal < 0 || ordinal >= values.length) {
                throw new IllegalArgumentException("enum ordinal " + ordinal + " out of range");
            }
            return values[ordinal];
        }

        @SuppressWarnings("unused") // reserves the helper for future widget types (append-only)
        private static Function<Integer, String> typeNameLookup() {
            return TYPE_ORDER::get;
        }
    }
}
