package dev.cuprum.cuprum.perf;

import java.util.ArrayList;
import java.util.List;

/**
 * W14 perf-harness foundation (handbook-config.md §9): a plain nanosecond sample recorder
 * shared by server GameTests (feed {@code MinecraftServer.getAverageTickTimeNanos()} or
 * per-tick deltas) and client GameTests (feed {@code Minecraft.getFrameTimeNs()} once per
 * awaited tick). W14 swaps the scenes and reuses sampler/report/gate unchanged — keep this
 * class free of Minecraft imports so both source-set halves and future harness scripts can
 * use it as-is.
 */
public final class PerfSampler {
    private final List<Long> samplesNs = new ArrayList<>();

    private PerfSampler() {
    }

    public static PerfSampler create() {
        return new PerfSampler();
    }

    /** Records one sample; non-positive samples are dropped (timer hiccups, first frame). */
    public void addNs(long ns) {
        if (ns > 0) {
            samplesNs.add(ns);
        }
    }

    public int sampleCount() {
        return samplesNs.size();
    }

    /** Samples after dropping the first {@code warmupSamples} (JIT/chunk-load noise). */
    public List<Long> measuredSamples(int warmupSamples) {
        if (warmupSamples >= samplesNs.size()) {
            return List.of();
        }
        return List.copyOf(samplesNs.subList(warmupSamples, samplesNs.size()));
    }
}
