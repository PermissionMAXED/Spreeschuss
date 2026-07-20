package dev.cuprum.cuprum.ownership;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import dev.cuprum.cuprum.net.NetBounds;
import io.netty.buffer.ByteBuf;
import java.util.Objects;
import java.util.UUID;
import net.minecraft.core.UUIDUtil;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.server.level.ServerPlayer;

/**
 * A claim owner (net-state.md §6): the UUID is authoritative; {@code cachedName} is display-only
 * (refreshed when the owner interacts) and also the scoreboard-team lookup key when the owner is
 * offline. W1 ships the model + codecs only — no BE/item wiring (plan D5).
 */
public record Owner(UUID uuid, String cachedName) {
    /** Vanilla player-name bound (also the codec caps). */
    public static final int MAX_NAME_LENGTH = 16;

    public static final Codec<Owner> CODEC = RecordCodecBuilder.create(instance -> instance.group(
            UUIDUtil.CODEC.fieldOf("uuid").forGetter(Owner::uuid),
            Codec.string(0, MAX_NAME_LENGTH).fieldOf("cached_name").forGetter(Owner::cachedName)
    ).apply(instance, Owner::new));

    public static final StreamCodec<ByteBuf, Owner> STREAM_CODEC = StreamCodec.composite(
            UUIDUtil.STREAM_CODEC, Owner::uuid,
            ByteBufCodecs.stringUtf8(MAX_NAME_LENGTH), Owner::cachedName,
            Owner::new);

    public Owner {
        Objects.requireNonNull(uuid, "uuid");
        cachedName = NetBounds.requireBounded(cachedName, MAX_NAME_LENGTH, "cachedName");
    }

    public static Owner of(ServerPlayer player) {
        return new Owner(player.getUUID(), player.getGameProfile().name());
    }
}
