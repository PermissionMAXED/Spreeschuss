package dev.cuprum.cuprum.ownership;

import com.mojang.serialization.Codec;
import com.mojang.serialization.DataResult;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import io.netty.buffer.ByteBuf;
import java.util.Objects;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.server.level.ServerPlayer;

/**
 * A claim: owner + access policy (net-state.md §6). Destined for the BE state envelope and the
 * {@code cuprum:claim} item component in the first consumer wave — W1 ships model, codecs and
 * truth-table tests only (plan D5; W1 has zero mutating C2S interactions).
 */
public record Claim(Owner owner, AccessPolicy policy) {
    /** String-named policy codec for NBT (unknown names are a parse error, never a default). */
    public static final Codec<AccessPolicy> POLICY_CODEC = Codec.STRING.comapFlatMap(
            name -> {
                AccessPolicy policy = AccessPolicy.byName(name);
                return policy != null
                        ? DataResult.success(policy)
                        : DataResult.error(() -> "unknown access policy: " + name);
            },
            AccessPolicy::serializedName);

    private static final AccessPolicy[] POLICY_BY_ID = AccessPolicy.values();

    /** Total id-mapped policy stream codec (hostile ordinals throw at decode). */
    public static final StreamCodec<ByteBuf, AccessPolicy> POLICY_STREAM_CODEC =
            ByteBufCodecs.idMapper(id -> POLICY_BY_ID[id], AccessPolicy::ordinal);

    public static final Codec<Claim> CODEC = RecordCodecBuilder.create(instance -> instance.group(
            Owner.CODEC.fieldOf("owner").forGetter(Claim::owner),
            POLICY_CODEC.fieldOf("policy").forGetter(Claim::policy)
    ).apply(instance, Claim::new));

    public static final StreamCodec<ByteBuf, Claim> STREAM_CODEC = StreamCodec.composite(
            Owner.STREAM_CODEC, Claim::owner,
            POLICY_STREAM_CODEC, Claim::policy,
            Claim::new);

    public Claim {
        Objects.requireNonNull(owner, "owner");
        Objects.requireNonNull(policy, "policy");
    }

    /** Claim created at placement: the placer owns it, private by default. */
    public static Claim ofPlacer(ServerPlayer placer) {
        return new Claim(Owner.of(placer), AccessPolicy.OWNER_ONLY);
    }
}
