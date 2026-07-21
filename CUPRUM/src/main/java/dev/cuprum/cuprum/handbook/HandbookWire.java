package dev.cuprum.cuprum.handbook;

import io.netty.buffer.ByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;

/**
 * Shared bounded wire primitives for handbook payloads (plan §3.2: only bounded primitives on
 * the wire; strings are length-capped at encode AND decode). One place so every handbook
 * codec agrees on the same bounds.
 */
public final class HandbookWire {
    /** Bound for lang keys and other short strings. */
    public static final int MAX_KEY_CHARS = HandbookWidget.MAX_KEY_CHARS;
    /** Bound for resource-location strings (ids, textures, recipe ids). */
    public static final int MAX_ID_CHARS = HandbookWidget.MAX_TEXTURE_CHARS;

    public static final StreamCodec<ByteBuf, String> KEY_STRING = ByteBufCodecs.stringUtf8(MAX_KEY_CHARS);
    public static final StreamCodec<ByteBuf, String> ID_STRING = ByteBufCodecs.stringUtf8(MAX_ID_CHARS);

    private HandbookWire() {
    }
}
