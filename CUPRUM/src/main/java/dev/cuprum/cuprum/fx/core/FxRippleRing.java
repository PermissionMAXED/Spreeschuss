package dev.cuprum.cuprum.fx.core;

/**
 * Fixed-capacity ring buffer for live ripple snapshots (client-fx.md §5): preallocated
 * parallel primitive slots, oldest-evicted on overflow, zero steady-state allocation. MC-free
 * (positions are packed {@code long} posKeys, plan D9) so the eviction/iteration logic is unit
 * tested in {@code src/test}; the client dispatcher owns the only instance and adds thread
 * confinement plus MC type conversion on top.
 *
 * <p>Slot layout is structure-of-arrays on purpose: extraction copies primitives straight into
 * the render state arrays without boxing or iterator garbage.
 */
public final class FxRippleRing {
    private final int capacity;
    private final long[] posKey;
    private final long[] startTick;
    private final int[] colorArgb;
    private final int[] radiusQ8;

    /** Index of the oldest live slot. */
    private int head;
    /** Number of live slots (0..capacity). */
    private int size;
    /** Total ripples ever evicted by overflow (diagnostics/budget counter). */
    private long evicted;

    public FxRippleRing(int capacity) {
        if (capacity <= 0) {
            throw new IllegalArgumentException("ring capacity must be positive: " + capacity);
        }
        this.capacity = capacity;
        this.posKey = new long[capacity];
        this.startTick = new long[capacity];
        this.colorArgb = new int[capacity];
        this.radiusQ8 = new int[capacity];
    }

    /**
     * Adds an event only when its wire identity ({@code posKey}, {@code startTick}) is absent.
     * Exact duplicate S2C delivery is a no-op: it cannot brighten, consume capacity, evict an
     * unrelated event, or alter diagnostics. Returns true only for a newly inserted event.
     */
    public boolean addIfAbsent(
            long posKeyValue, long startTickValue, int colorArgbValue, int radiusQ8Value) {
        for (int i = 0; i < size; i++) {
            int slot = wrap(head + i);
            if (posKey[slot] == posKeyValue && startTick[slot] == startTickValue) {
                return false;
            }
        }
        addUnchecked(posKeyValue, startTickValue, colorArgbValue, radiusQ8Value);
        return true;
    }

    private void addUnchecked(long posKeyValue, long startTickValue, int colorArgbValue, int radiusQ8Value) {
        int slot;
        if (size == capacity) {
            slot = head;
            head = next(head);
            evicted++;
        } else {
            slot = wrap(head + size);
            size++;
        }
        posKey[slot] = posKeyValue;
        startTick[slot] = startTickValue;
        colorArgb[slot] = colorArgbValue;
        radiusQ8[slot] = radiusQ8Value;
    }

    /**
     * Removes every ripple whose age at {@code nowTick} reaches {@code lifetimeTicks}, plus
     * bogus slots more than one lifetime in the future. Small NEGATIVE ages are kept: the
     * payload seed is the <b>server</b> game time and the client clock routinely lags it by a
     * tick or two (time sync every 20 ticks), so a fresh arrival often looks 1–2 ticks
     * "future". Such slots simply don't render until the client clock catches up
     * ({@code RippleMath.radiusQ8AtAge} returns 0 for negative ages); a real time rewind
     * beyond one lifetime still drops.
     */
    public void expire(long nowTick, int lifetimeTicks) {
        // Ripples are ring-ordered by insertion, but wall-clock start ticks may interleave
        // across sources, so each slot is tested individually with compaction.
        int kept = 0;
        for (int i = 0; i < size; i++) {
            int slot = wrap(head + i);
            long age = nowTick - startTick[slot];
            if (age <= -lifetimeTicks || age >= lifetimeTicks) {
                continue; // expired, or further in the future than clock skew can explain
            }
            int target = wrap(head + kept);
            if (target != slot) {
                posKey[target] = posKey[slot];
                startTick[target] = startTick[slot];
                colorArgb[target] = colorArgb[slot];
                radiusQ8[target] = radiusQ8[slot];
            }
            kept++;
        }
        size = kept;
    }

    /** Copies every live ripple at {@code anchorPosKey} into the visitor, oldest first. */
    public int visitAt(long anchorPosKey, Visitor visitor) {
        int visited = 0;
        for (int i = 0; i < size; i++) {
            int slot = wrap(head + i);
            if (posKey[slot] == anchorPosKey) {
                visitor.accept(posKey[slot], startTick[slot], colorArgb[slot], radiusQ8[slot]);
                visited++;
            }
        }
        return visited;
    }

    /** Copies every live ripple into the visitor, oldest first (tick cadence / accounting). */
    public int visitAll(Visitor visitor) {
        for (int i = 0; i < size; i++) {
            int slot = wrap(head + i);
            visitor.accept(posKey[slot], startTick[slot], colorArgb[slot], radiusQ8[slot]);
        }
        return size;
    }

    public void clear() {
        head = 0;
        size = 0;
    }

    public int size() {
        return size;
    }

    public int capacity() {
        return capacity;
    }

    public long evictedTotal() {
        return evicted;
    }

    private int next(int index) {
        return wrap(index + 1);
    }

    private int wrap(int index) {
        return index % capacity;
    }

    /** Primitive-only slot visitor: no boxing, no snapshot objects (plan D9). */
    @FunctionalInterface
    public interface Visitor {
        void accept(long posKey, long startTick, int colorArgb, int radiusQ8);
    }
}
