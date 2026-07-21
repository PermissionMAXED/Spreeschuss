package dev.cuprum.cuprum.handbook;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * MC-free bookmark list logic (plan D9): pure string page-ids, insertion-ordered, capped at
 * {@link #MAX_BOOKMARKS} (handbook-config.md §4). The client wrapper
 * ({@code HandbookBookmarks}) owns file IO and the per-world keying; this core owns the
 * semantics so {@code src/test} pins them without Minecraft classes. All methods return new
 * immutable lists — never mutate inputs.
 */
public final class HandbookBookmarksCore {
    public static final int MAX_BOOKMARKS = 64;
    public static final int MAX_ID_CHARS = 224;

    private HandbookBookmarksCore() {
    }

    /**
     * Toggles {@code pageId}: removes it when present, appends it when absent (refused —
     * list unchanged — when full or the id is invalid). Insertion order is preserved.
     */
    public static List<String> toggle(List<String> current, String pageId) {
        List<String> sane = sanitize(current);
        if (pageId == null || pageId.isBlank() || pageId.length() > MAX_ID_CHARS) {
            return sane;
        }
        if (sane.contains(pageId)) {
            List<String> out = new ArrayList<>(sane);
            out.remove(pageId);
            return List.copyOf(out);
        }
        if (sane.size() >= MAX_BOOKMARKS) {
            return sane;
        }
        List<String> out = new ArrayList<>(sane);
        out.add(pageId);
        return List.copyOf(out);
    }

    /**
     * Repairs an untrusted (disk-loaded) list: drops nulls/blanks/oversized entries and
     * duplicates (first occurrence wins), truncates to {@link #MAX_BOOKMARKS}. Never throws —
     * the corrupt-file path resets rather than crashes.
     */
    public static List<String> sanitize(List<String> raw) {
        if (raw == null) {
            return List.of();
        }
        LinkedHashSet<String> unique = new LinkedHashSet<>();
        for (String entry : raw) {
            if (entry == null || entry.isBlank() || entry.length() > MAX_ID_CHARS) {
                continue;
            }
            if (unique.size() >= MAX_BOOKMARKS) {
                break;
            }
            unique.add(entry);
        }
        return List.copyOf(unique);
    }
}
