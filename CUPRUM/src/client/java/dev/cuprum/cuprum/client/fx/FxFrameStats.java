package dev.cuprum.cuprum.client.fx;

import dev.cuprum.cuprum.client.fx.render.CuprumRenderTypes;
import dev.cuprum.cuprum.fx.core.FxBudgets;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;
import net.minecraft.client.renderer.RenderType;

/**
 * CI-assertable FX render counters (client-fx.md §11 ★ rows): every FX geometry submit is
 * recorded here so budgets are provable numbers, not claims. Counters — custom-pipeline
 * submits (total and since the last tier change: QOL-04's acceptance asserts the "since"
 * counter reads 0 under REDUCED/MINIMAL), vanilla-fallback submits, ripple vertices, and the
 * per-frame vertex budget breach count (must stay 0; the pool caps make a breach impossible
 * by construction).
 *
 * <p>All counters are atomics: recorded on the render thread, read from the gametest thread.
 * {@link #clear()} is wired to render invalidation and identity-guarded session lifecycle (§5).
 */
public final class FxFrameStats {
    private static final AtomicLong CUSTOM_PIPELINE_SUBMITS = new AtomicLong();
    private static final AtomicLong CUSTOM_PIPELINE_SUBMITS_SINCE_TIER_CHANGE = new AtomicLong();
    private static final AtomicLong VANILLA_FALLBACK_SUBMITS = new AtomicLong();
    private static final AtomicLong RIPPLE_VERTICES_TOTAL = new AtomicLong();
    private static final AtomicLong VERTEX_BUDGET_BREACHES = new AtomicLong();
    private static final AtomicLong CURRENT_FRAME_RIPPLE_VERTICES = new AtomicLong();
    private static final AtomicLong PEAK_FRAME_RIPPLE_VERTICES = new AtomicLong();

    /** Identity of the camera-position snapshot shared by every BER extraction in one frame. */
    private static volatile Object frameIdentity;

    private FxFrameStats() {
    }

    /**
     * Starts (or joins) the current extracted world frame. Vanilla creates one camera-position
     * snapshot per frame and passes that same object to every BER extraction, giving a stable
     * frame identity without a mixin or wall-clock heuristic.
     */
    public static synchronized void beginFrame(Object identity) {
        Objects.requireNonNull(identity, "identity");
        if (frameIdentity != identity) {
            frameIdentity = identity;
            CURRENT_FRAME_RIPPLE_VERTICES.set(0);
        }
    }

    /**
     * Records one successfully executed deferred geometry callback. Zero/negative output is not
     * a submit and cannot increment any success counter. Breaches use the aggregate actual
     * vertex total across every ripple callback in the current frame.
     */
    public static void recordSubmit(RenderType type, int vertexCount) {
        if (vertexCount <= 0) {
            return;
        }
        if (type == CuprumRenderTypes.FX_RIPPLE) {
            CUSTOM_PIPELINE_SUBMITS.incrementAndGet();
            CUSTOM_PIPELINE_SUBMITS_SINCE_TIER_CHANGE.incrementAndGet();
        } else {
            VANILLA_FALLBACK_SUBMITS.incrementAndGet();
        }
        RIPPLE_VERTICES_TOTAL.addAndGet(vertexCount);
        long frameTotal = CURRENT_FRAME_RIPPLE_VERTICES.addAndGet(vertexCount);
        PEAK_FRAME_RIPPLE_VERTICES.accumulateAndGet(frameTotal, Math::max);
        if (frameTotal > FxBudgets.MAX_RIPPLE_VERTICES_PER_FRAME
                && frameTotal - vertexCount <= FxBudgets.MAX_RIPPLE_VERTICES_PER_FRAME) {
            VERTEX_BUDGET_BREACHES.incrementAndGet();
        }
    }

    /** Called by {@code FxTierPolicy} when the effective tier flips (QOL-04 counter epoch). */
    public static void onTierChanged() {
        CUSTOM_PIPELINE_SUBMITS_SINCE_TIER_CHANGE.set(0);
    }

    public static long customPipelineSubmits() {
        return CUSTOM_PIPELINE_SUBMITS.get();
    }

    /** QOL-04 hook: must read 0 while the effective tier is T2/T3/OFF (client-fx.md §8). */
    public static long customPipelineSubmitsSinceTierChange() {
        return CUSTOM_PIPELINE_SUBMITS_SINCE_TIER_CHANGE.get();
    }

    public static long vanillaFallbackSubmits() {
        return VANILLA_FALLBACK_SUBMITS.get();
    }

    public static long rippleVerticesTotal() {
        return RIPPLE_VERTICES_TOTAL.get();
    }

    public static long currentFrameRippleVertices() {
        return CURRENT_FRAME_RIPPLE_VERTICES.get();
    }

    public static long peakFrameRippleVertices() {
        return PEAK_FRAME_RIPPLE_VERTICES.get();
    }

    /** ★ budget assert: stays 0 — one submit can never exceed the pool-wide vertex budget. */
    public static long vertexBudgetBreaches() {
        return VERTEX_BUDGET_BREACHES.get();
    }

    /** Wired to render invalidation plus fresh-JOIN/matching-DISCONNECT lifecycle (§5/§9). */
    public static void clear() {
        CUSTOM_PIPELINE_SUBMITS.set(0);
        CUSTOM_PIPELINE_SUBMITS_SINCE_TIER_CHANGE.set(0);
        VANILLA_FALLBACK_SUBMITS.set(0);
        RIPPLE_VERTICES_TOTAL.set(0);
        VERTEX_BUDGET_BREACHES.set(0);
        CURRENT_FRAME_RIPPLE_VERTICES.set(0);
        PEAK_FRAME_RIPPLE_VERTICES.set(0);
        frameIdentity = null;
    }
}
