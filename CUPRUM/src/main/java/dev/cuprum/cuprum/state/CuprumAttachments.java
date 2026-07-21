package dev.cuprum.cuprum.state;

import com.mojang.serialization.Codec;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import net.fabricmc.fabric.api.attachment.v1.AttachmentRegistry;
import net.fabricmc.fabric.api.attachment.v1.AttachmentSyncPredicate;
import net.fabricmc.fabric.api.attachment.v1.AttachmentTarget;
import net.fabricmc.fabric.api.attachment.v1.AttachmentType;
import net.fabricmc.fabric.api.event.Event;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.resources.ResourceLocation;

/**
 * The ONLY class allowed to touch the experimental Fabric data-attachment API (plan D5): every
 * attachment constant lives here, append-only, so an upstream API break is a one-file fix. W1A
 * deliberately shipped <b>no</b> attachment constants — the first one
 * ({@link #HANDBOOK_UNLOCKS}, W1E per plan §3.1) is below. Synced attachment encodings are
 * capped at 16 KiB by Cuprum policy (asserted by the handbook unlock GameTest at the
 * {@code HandbookUnlocks} bounds).
 *
 * <p>The private members below are the compile-time signature pins for the attachment API
 * (net-state.md §10) — never invoked, mirroring the frozen {@code RenderApiProbe} rules; they
 * live here rather than in {@code StateApiProbe} because of the single-caller rule above.
 */
public final class CuprumAttachments {
    /** Wire bound for one unlock key string (mirrors {@code HandbookUnlocks.MAX_KEY_CHARS}). */
    private static final int UNLOCK_KEY_MAX_CHARS = 224;
    /** Wire bound for the unlock key count (mirrors {@code HandbookUnlocks.MAX_KEYS}). */
    private static final int UNLOCK_KEYS_MAX = 64;

    /** Sorted-list persistence codec (plan §3.1: deterministic NBT regardless of grant order). */
    private static final Codec<Set<ResourceLocation>> UNLOCKS_CODEC =
            ResourceLocation.CODEC.listOf()
                    .xmap(list -> Set.copyOf(new TreeSet<>(list)),
                            set -> List.copyOf(new TreeSet<>(set)));

    /** Bounded wire codec: VAR_INT count (≤64) + capped id strings, sorted for determinism. */
    private static final StreamCodec<RegistryFriendlyByteBuf, Set<ResourceLocation>> UNLOCKS_STREAM_CODEC =
            StreamCodec.of(
                    (buf, set) -> {
                        TreeSet<ResourceLocation> sorted = new TreeSet<>(set);
                        buf.writeVarInt(sorted.size());
                        for (ResourceLocation key : sorted) {
                            ByteBufCodecs.stringUtf8(UNLOCK_KEY_MAX_CHARS).encode(buf, key.toString());
                        }
                    },
                    buf -> {
                        int count = buf.readVarInt();
                        if (count < 0 || count > UNLOCK_KEYS_MAX) {
                            throw new IllegalArgumentException(
                                    "handbook unlock key count " + count + " outside [0, " + UNLOCK_KEYS_MAX + "]");
                        }
                        TreeSet<ResourceLocation> keys = new TreeSet<>();
                        for (int i = 0; i < count; i++) {
                            keys.add(ResourceLocation.parse(
                                    ByteBufCodecs.stringUtf8(UNLOCK_KEY_MAX_CHARS).decode(buf)));
                        }
                        return Set.copyOf(keys);
                    });

    /**
     * W1E (plan §3.1 + ledger §3.4): the player's handbook unlock key set —
     * {@code persistent} (survives restart via the Fabric null-DFT SavedData path proven in
     * W1A), {@code copyOnDeath} (survives respawn), synced to the owning client only
     * ({@code targetOnly}); grants go exclusively through the frozen
     * {@code HandbookUnlocks.grant} (bounds + duplicate suppression live there).
     */
    public static final AttachmentType<Set<ResourceLocation>> HANDBOOK_UNLOCKS = AttachmentRegistry.create(
            ResourceLocation.fromNamespaceAndPath("cuprum", "handbook_unlocks"),
            builder -> builder
                    .persistent(UNLOCKS_CODEC)
                    .initializer(Set::of)
                    .copyOnDeath()
                    .syncWith(UNLOCKS_STREAM_CODEC, AttachmentSyncPredicate.targetOnly()));

    private CuprumAttachments() {
    }

    /** Probe: the full builder chain every future Cuprum attachment uses. */
    private static <A> AttachmentType<A> probeCreate(ResourceLocation id, Codec<A> codec,
            StreamCodec<? super RegistryFriendlyByteBuf, A> packetCodec, A initialValue) {
        return AttachmentRegistry.create(id, builder -> builder
                .persistent(codec)
                .initializer(() -> initialValue)
                .copyOnDeath()
                .syncWith(packetCodec, AttachmentSyncPredicate.targetOnly()));
    }

    /** Probe: the target accessors feature code will use through wrappers here. */
    private static <A> void probeTargetMembers(AttachmentTarget target, AttachmentType<A> type, A value) {
        A attached = target.getAttached(type);
        target.setAttached(type, value);
        A created = target.getAttachedOrCreate(type);
        target.modifyAttached(type, current -> current);
        boolean has = target.hasAttached(type);
        A removed = target.removeAttached(type);
        Event<AttachmentTarget.OnAttachedSet<A>> onSet = target.onAttachedSet(type);
    }
}
