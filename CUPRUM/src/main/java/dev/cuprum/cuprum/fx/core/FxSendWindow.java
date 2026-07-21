package dev.cuprum.cuprum.fx.core;

/**
 * MC-free per-client S2C coalescing window (client-fx.md §11: the server sends at most
 * {@link FxBudgets#RIPPLE_SENDS_PER_SECOND} ripple payloads per second per client). One
 * instance per connected player, keyed off the server game time; overflow inside a window is
 * dropped silently — ripples are idempotent cosmetic events, never durable state (plan §3.2).
 *
 * <p>{@code long} arithmetic throughout; a game time that jumps backwards (world reload,
 * {@code /time set}) simply opens a fresh window rather than starving the sender.
 */
public final class FxSendWindow {
    private final int maxPerWindow;
    private final int windowTicks;

    private long windowStartTick = Long.MIN_VALUE;
    private int sentInWindow;
    private long coalescedTotal;

    public FxSendWindow(int maxPerWindow, int windowTicks) {
        if (maxPerWindow <= 0 || windowTicks <= 0) {
            throw new IllegalArgumentException("send window parameters must be positive");
        }
        this.maxPerWindow = maxPerWindow;
        this.windowTicks = windowTicks;
    }

    /** Tries to acquire one send slot at {@code gameTime}; false means coalesced (dropped). */
    public boolean tryAcquire(long gameTime) {
        if (windowExpired(gameTime)) {
            windowStartTick = gameTime;
            sentInWindow = 0;
        }
        if (sentInWindow >= maxPerWindow) {
            coalescedTotal++;
            return false;
        }
        sentInWindow++;
        return true;
    }

    public int sentInCurrentWindow(long gameTime) {
        return windowExpired(gameTime) ? 0 : sentInWindow;
    }

    /**
     * The MIN_VALUE sentinel is checked explicitly: {@code gameTime - Long.MIN_VALUE}
     * overflows negative, which would otherwise keep the "window" open forever.
     */
    private boolean windowExpired(long gameTime) {
        return windowStartTick == Long.MIN_VALUE
                || gameTime < windowStartTick
                || gameTime - windowStartTick >= windowTicks;
    }

    public long coalescedTotal() {
        return coalescedTotal;
    }
}
