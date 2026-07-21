package dev.cuprum.cuprum.fx.core;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * MC-free unit tests (plan D9) for the fixed-capacity ripple ring: oldest-evicted overflow,
 * per-anchor visitation on packed {@code long} posKeys, age-based expiry with compaction, and
 * the eviction counter the ★ pool budget assert reads.
 */
class FxRippleRingTest {
    /** Mirrors BlockPos.asLong-style packing without MC: unique keys per (x,z) here. */
    private static long key(int x, int z) {
        return ((long) x << 38) | (z & 0x3FFFFFFL);
    }

    private record Slot(long posKey, long startTick, int colorArgb, int radiusQ8) {
    }

    private static List<Slot> drain(FxRippleRing ring) {
        List<Slot> slots = new ArrayList<>();
        ring.visitAll((posKey, startTick, colorArgb, radiusQ8) ->
                slots.add(new Slot(posKey, startTick, colorArgb, radiusQ8)));
        return slots;
    }

    @Test
    void addKeepsInsertionOrderOldestFirst() {
        FxRippleRing ring = new FxRippleRing(4);
        ring.addIfAbsent(key(1, 1), 10L, 0xA, 100);
        ring.addIfAbsent(key(2, 2), 11L, 0xB, 200);
        ring.addIfAbsent(key(3, 3), 12L, 0xC, 300);
        assertEquals(3, ring.size());
        List<Slot> slots = drain(ring);
        assertEquals(10L, slots.get(0).startTick());
        assertEquals(11L, slots.get(1).startTick());
        assertEquals(12L, slots.get(2).startTick());
        assertEquals(0L, ring.evictedTotal());
    }

    @Test
    void overflowEvictsExactlyTheOldest() {
        FxRippleRing ring = new FxRippleRing(3);
        for (int i = 0; i < 5; i++) {
            ring.addIfAbsent(key(i, i), 100L + i, i, 100 + i);
        }
        assertEquals(3, ring.size());
        assertEquals(2L, ring.evictedTotal(), "two oldest evicted");
        List<Slot> slots = drain(ring);
        assertEquals(102L, slots.get(0).startTick(), "slot 0/1 (ticks 100/101) evicted");
        assertEquals(104L, slots.get(2).startTick());
    }

    @Test
    void visitAtFiltersByExactPosKey() {
        FxRippleRing ring = new FxRippleRing(8);
        long anchorA = key(5, -3);
        long anchorB = key(-7, 12);
        ring.addIfAbsent(anchorA, 1L, 0x11, 100);
        ring.addIfAbsent(anchorB, 2L, 0x22, 200);
        ring.addIfAbsent(anchorA, 3L, 0x33, 300);
        List<Slot> atA = new ArrayList<>();
        int visited = ring.visitAt(anchorA, (posKey, startTick, colorArgb, radiusQ8) ->
                atA.add(new Slot(posKey, startTick, colorArgb, radiusQ8)));
        assertEquals(2, visited);
        assertEquals(2, atA.size());
        assertEquals(1L, atA.get(0).startTick(), "oldest first");
        assertEquals(3L, atA.get(1).startTick());
        assertEquals(0x11, atA.get(0).colorArgb());
    }

    @Test
    void expireDropsAgedAndFarFutureSlotsAndCompacts() {
        FxRippleRing ring = new FxRippleRing(8);
        ring.addIfAbsent(key(1, 1), 100L, 1, 100); // age 40 at t=140: expired
        ring.addIfAbsent(key(2, 2), 120L, 2, 200); // age 20: live
        ring.addIfAbsent(key(3, 3), 181L, 3, 300); // age -41 < -lifetime (real time rewind): dropped
        ring.addIfAbsent(key(4, 4), 139L, 4, 400); // age 1: live
        ring.addIfAbsent(key(5, 5), 142L, 5, 500); // age -2: server-seed clock skew, KEPT (not drawn yet)
        ring.expire(140L, 40);
        assertEquals(3, ring.size());
        List<Slot> slots = drain(ring);
        assertEquals(120L, slots.get(0).startTick());
        assertEquals(139L, slots.get(1).startTick());
        assertEquals(142L, slots.get(2).startTick(), "small future skew survives expire");
    }

    @Test
    void expireAfterWrapAroundKeepsRingConsistent() {
        FxRippleRing ring = new FxRippleRing(3);
        for (int i = 0; i < 7; i++) { // head has wrapped repeatedly
            ring.addIfAbsent(key(i, 0), 200L + i, i, 100);
        }
        ring.expire(206L + 40, 40); // only start tick 206 has age < 40? 206+40-206=40 → expired too
        assertEquals(0, ring.size());
        ring.addIfAbsent(key(9, 9), 500L, 9, 900);
        assertEquals(1, ring.size());
        assertEquals(500L, drain(ring).get(0).startTick());
    }

    @Test
    void clearEmptiesButKeepsEvictionDiagnostics() {
        FxRippleRing ring = new FxRippleRing(2);
        ring.addIfAbsent(key(1, 1), 1L, 1, 1);
        ring.addIfAbsent(key(2, 2), 2L, 2, 2);
        ring.addIfAbsent(key(3, 3), 3L, 3, 3);
        assertEquals(1L, ring.evictedTotal());
        ring.clear();
        assertEquals(0, ring.size());
        assertEquals(1L, ring.evictedTotal(), "cumulative diagnostic counter survives clear");
        assertEquals(0, drain(ring).size());
    }

    @Test
    void capacityMustBePositive() {
        assertThrows(IllegalArgumentException.class, () -> new FxRippleRing(0));
        assertThrows(IllegalArgumentException.class, () -> new FxRippleRing(-1));
    }

    @Test
    void duplicateWireIdentityIsACompleteNoOpEvenWhenPayloadPresentationDiffers() {
        FxRippleRing ring = new FxRippleRing(3);
        long center = key(4, 9);
        assertEquals(true, ring.addIfAbsent(center, 100L, 0xFFE77C56, 768));
        assertEquals(false, ring.addIfAbsent(center, 100L, 0xFF00FFFF, 1024),
                "identity is exactly (center, startGameTime), not presentation fields");
        assertEquals(1, ring.size());
        assertEquals(0L, ring.evictedTotal());
        Slot only = drain(ring).get(0);
        assertEquals(0xFFE77C56, only.colorArgb(), "duplicate must not brighten/recolor the live event");
        assertEquals(768, only.radiusQ8(), "duplicate must not replace radius");
    }

    @Test
    void duplicateAtCapacityCannotEvictButNearDuplicatesRemainDistinct() {
        FxRippleRing ring = new FxRippleRing(3);
        long center = key(2, 2);
        assertEquals(true, ring.addIfAbsent(center, 10L, 1, 100));
        assertEquals(true, ring.addIfAbsent(center, 11L, 2, 200), "adjacent game time is distinct");
        assertEquals(true, ring.addIfAbsent(key(2, 3), 10L, 3, 300), "adjacent center is distinct");
        assertEquals(false, ring.addIfAbsent(center, 11L, 2, 200));
        assertEquals(3, ring.size());
        assertEquals(0L, ring.evictedTotal(), "duplicate at capacity must not evict");

        assertEquals(true, ring.addIfAbsent(center, 12L, 4, 400));
        assertEquals(1L, ring.evictedTotal(), "a genuinely new event still evicts the oldest");
        assertEquals(List.of(11L, 10L, 12L),
                drain(ring).stream().map(Slot::startTick).toList());
    }
}
