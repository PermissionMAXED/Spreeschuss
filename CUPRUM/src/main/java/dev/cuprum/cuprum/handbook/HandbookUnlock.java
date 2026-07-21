package dev.cuprum.cuprum.handbook;

import com.mojang.serialization.Codec;
import com.mojang.serialization.DataResult;
import com.mojang.serialization.MapCodec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import java.util.List;
import java.util.Set;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.resources.ResourceLocation;

/**
 * W1 unlock condition union (handbook-config.md §4): {@code always} and {@code key}. Later
 * waves add {@code advancement}/{@code stat} evaluators behind this same sealed interface —
 * append-only, so the wire indices below never shift. Evaluation is server truth: the client
 * only re-evaluates against its own attachment-synced key set for display locking.
 */
public sealed interface HandbookUnlock permits HandbookUnlock.Always, HandbookUnlock.Key {

    int MAX_KEY_CHARS = 224;

    String typeName();

    /** True when this condition is satisfied by {@code unlockedKeys} (sorted attachment set). */
    boolean test(Set<ResourceLocation> unlockedKeys);

    /** Unconditionally unlocked (the W1 default for the three diagnostics pages). */
    record Always() implements HandbookUnlock {
        public static final Always INSTANCE = new Always();
        static final MapCodec<Always> MAP_CODEC = MapCodec.unit(INSTANCE);
        static final Set<String> KEYS = Set.of("type");

        @Override
        public String typeName() {
            return "always";
        }

        @Override
        public boolean test(Set<ResourceLocation> unlockedKeys) {
            return true;
        }
    }

    /** Unlocked once {@code HandbookUnlocks.grant(player, key)} added the key (attachment). */
    record Key(ResourceLocation key) implements HandbookUnlock {
        static final MapCodec<Key> MAP_CODEC = RecordCodecBuilder.mapCodec(instance -> instance.group(
                ResourceLocation.CODEC.fieldOf("key").forGetter(Key::key)
        ).apply(instance, Key::new));
        static final Set<String> KEYS = Set.of("type", "key");

        public Key {
            if (key == null || key.toString().length() > MAX_KEY_CHARS) {
                throw new IllegalArgumentException("unlock.key missing or longer than " + MAX_KEY_CHARS);
            }
        }

        @Override
        public String typeName() {
            return "key";
        }

        @Override
        public boolean test(Set<ResourceLocation> unlockedKeys) {
            return unlockedKeys.contains(key);
        }
    }

    /** Wire order (append-only). */
    List<String> TYPE_ORDER = List.of("always", "key");

    Codec<HandbookUnlock> DISPATCH_CODEC = Codec.STRING.partialDispatch("type",
            unlock -> DataResult.success(unlock.typeName()),
            typeName -> switch (typeName) {
                case "always" -> DataResult.success(Always.MAP_CODEC);
                case "key" -> DataResult.success(Key.MAP_CODEC);
                default -> DataResult.error(() -> "unknown handbook unlock type '" + typeName + "'");
            });

    /** Strict JSON codec: unknown keys per type are rejected (same policy as widgets). */
    Codec<HandbookUnlock> CODEC = Codec.of(DISPATCH_CODEC,
            HandbookCodecs.strictDispatchDecoder(DISPATCH_CODEC, typeName -> switch (typeName) {
                case "always" -> Always.KEYS;
                case "key" -> Key.KEYS;
                default -> null;
            }, "unlock"));

    StreamCodec<RegistryFriendlyByteBuf, HandbookUnlock> STREAM_CODEC = StreamCodec.of(
            (buf, unlock) -> {
                buf.writeVarInt(TYPE_ORDER.indexOf(unlock.typeName()));
                if (unlock instanceof Key keyUnlock) {
                    ByteBufCodecs.stringUtf8(MAX_KEY_CHARS).encode(buf, keyUnlock.key().toString());
                }
            },
            buf -> {
                int typeIndex = buf.readVarInt();
                return switch (typeIndex) {
                    case 0 -> Always.INSTANCE;
                    case 1 -> new Key(ResourceLocation.parse(
                            ByteBufCodecs.stringUtf8(MAX_KEY_CHARS).decode(buf)));
                    default -> throw new IllegalArgumentException(
                            "unknown unlock wire type index " + typeIndex);
                };
            });
}
