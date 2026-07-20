package dev.cuprum.cuprum.state;

import com.mojang.serialization.Codec;
import net.fabricmc.fabric.api.attachment.v1.AttachmentRegistry;
import net.fabricmc.fabric.api.attachment.v1.AttachmentSyncPredicate;
import net.fabricmc.fabric.api.attachment.v1.AttachmentTarget;
import net.fabricmc.fabric.api.attachment.v1.AttachmentType;
import net.fabricmc.fabric.api.event.Event;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.resources.ResourceLocation;

/**
 * The ONLY class allowed to touch the experimental Fabric data-attachment API (plan D5): every
 * attachment constant lives here, append-only, so an upstream API break is a one-file fix. W1A
 * deliberately ships <b>no</b> attachment constants — the first one ({@code HANDBOOK_UNLOCKS})
 * is appended by W1E. Synced attachment encodings are capped at 16 KiB by Cuprum policy
 * (asserted when the first synced constant lands).
 *
 * <p>The private members below are the compile-time signature pins for the attachment API
 * (net-state.md §10) — never invoked, mirroring the frozen {@code RenderApiProbe} rules; they
 * live here rather than in {@code StateApiProbe} because of the single-caller rule above.
 */
public final class CuprumAttachments {
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
