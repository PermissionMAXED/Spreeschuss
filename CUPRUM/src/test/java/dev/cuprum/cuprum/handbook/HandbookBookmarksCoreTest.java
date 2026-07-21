package dev.cuprum.cuprum.handbook;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * MC-free bookmark semantics pins (plan D9): toggle add/remove, insertion order, the 64-entry
 * cap and the never-crash sanitize path that backs the corrupt-file reset in the client
 * wrapper ({@code HandbookBookmarks}).
 */
final class HandbookBookmarksCoreTest {
    @Test
    void toggleAddsThenRemoves() {
        List<String> one = HandbookBookmarksCore.toggle(List.of(), "cuprum:diagnostics/charge_probe");
        assertEquals(List.of("cuprum:diagnostics/charge_probe"), one);
        assertEquals(List.of(), HandbookBookmarksCore.toggle(one, "cuprum:diagnostics/charge_probe"));
    }

    @Test
    void insertionOrderIsPreserved() {
        List<String> list = List.of();
        list = HandbookBookmarksCore.toggle(list, "cuprum:b");
        list = HandbookBookmarksCore.toggle(list, "cuprum:a");
        list = HandbookBookmarksCore.toggle(list, "cuprum:c");
        assertEquals(List.of("cuprum:b", "cuprum:a", "cuprum:c"), list);
        assertEquals(List.of("cuprum:b", "cuprum:c"), HandbookBookmarksCore.toggle(list, "cuprum:a"));
    }

    @Test
    void capRefusesTheSixtyFifthEntry() {
        List<String> full = new ArrayList<>();
        for (int i = 0; i < HandbookBookmarksCore.MAX_BOOKMARKS; i++) {
            full.add("cuprum:page_" + i);
        }
        List<String> unchanged = HandbookBookmarksCore.toggle(full, "cuprum:one_too_many");
        assertEquals(full, unchanged);
        // Removal still works at the cap.
        assertEquals(HandbookBookmarksCore.MAX_BOOKMARKS - 1,
                HandbookBookmarksCore.toggle(full, "cuprum:page_0").size());
    }

    @Test
    void invalidTogglesAreRefusedWithoutChanges() {
        List<String> current = List.of("cuprum:a");
        assertEquals(current, HandbookBookmarksCore.toggle(current, null));
        assertEquals(current, HandbookBookmarksCore.toggle(current, "  "));
        assertEquals(current, HandbookBookmarksCore.toggle(current,
                "x".repeat(HandbookBookmarksCore.MAX_ID_CHARS + 1)));
    }

    @Test
    void sanitizeDropsGarbageAndDuplicatesNeverThrows() {
        List<String> raw = Arrays.asList("cuprum:a", null, " ", "cuprum:a", "cuprum:b",
                "y".repeat(HandbookBookmarksCore.MAX_ID_CHARS + 1));
        assertEquals(List.of("cuprum:a", "cuprum:b"), HandbookBookmarksCore.sanitize(raw));
        assertEquals(List.of(), HandbookBookmarksCore.sanitize(null));
    }

    @Test
    void sanitizeTruncatesToCap() {
        List<String> oversized = new ArrayList<>();
        for (int i = 0; i < HandbookBookmarksCore.MAX_BOOKMARKS + 10; i++) {
            oversized.add("cuprum:page_" + i);
        }
        assertEquals(HandbookBookmarksCore.MAX_BOOKMARKS,
                HandbookBookmarksCore.sanitize(oversized).size());
    }
}
