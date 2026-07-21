package dev.cuprum.cuprum.api.handbook;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.state.CuprumAttachments;
import java.util.Set;
import java.util.TreeSet;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;

/**
 * FROZEN API (plan D5: {@code api.handbook} is part of the W1 freeze surface; changes are a
 * reviewed two-file diff against {@code api/cuprum-api.lock}).
 *
 * <p>Server-truth handbook unlock grants (handbook-config.md §4): feature code calls
 * {@link #grant} when a player earns a handbook key; the state lives in the
 * {@code cuprum:handbook_unlocks} player attachment (persistent, copy-on-death, synced to the
 * owning client only — plan D10 permanently rejected a separate unlock payload; Fabric's
 * attachment sync is the one mechanism). No per-tick polling: evaluation happens on grant and
 * client-side against the synced set.
 *
 * <p>Bounds (Cuprum 16 KiB synced-attachment policy, plan §3.1): at most {@link #MAX_KEYS}
 * keys of at most {@link #MAX_KEY_CHARS} chars — worst case stays far below the cap, asserted
 * by the {@code handbookUnlockEncodingStaysUnderSyncCap} GameTest. A grant beyond the bound
 * is refused with a WARN (never a crash, never partial state).
 */
public final class HandbookUnlocks {
    /** Maximum unlock keys per player (W1 ships 0 granted-by-default keys; U04+ add few). */
    public static final int MAX_KEYS = 64;
    /** Maximum unlock key length in characters. */
    public static final int MAX_KEY_CHARS = 224;

    private HandbookUnlocks() {
    }

    /**
     * Grants {@code key} to {@code player}. Returns {@code true} when the key was newly added
     * (attachment replaced + auto-synced to the owning client); {@code false} for duplicates
     * (zero state changes, zero payloads) and refused out-of-bounds grants (one WARN).
     */
    public static boolean grant(ServerPlayer player, ResourceLocation key) {
        if (key == null || key.toString().length() > MAX_KEY_CHARS) {
            Cuprum.LOGGER.warn("[handbook] refused unlock grant: key missing or longer than {}", MAX_KEY_CHARS);
            return false;
        }
        Set<ResourceLocation> current = player.getAttachedOrCreate(CuprumAttachments.HANDBOOK_UNLOCKS);
        if (current.contains(key)) {
            return false;
        }
        if (current.size() >= MAX_KEYS) {
            Cuprum.LOGGER.warn("[handbook] refused unlock grant of {} for {}: {} keys already stored",
                    key, player.getGameProfile().name(), current.size());
            return false;
        }
        TreeSet<ResourceLocation> next = new TreeSet<>(current);
        next.add(key);
        player.setAttached(CuprumAttachments.HANDBOOK_UNLOCKS, Set.copyOf(next));
        return true;
    }

    /** The player's unlocked key set (immutable snapshot; empty when nothing was granted). */
    public static Set<ResourceLocation> unlockedKeys(ServerPlayer player) {
        return Set.copyOf(player.getAttachedOrCreate(CuprumAttachments.HANDBOOK_UNLOCKS));
    }
}
