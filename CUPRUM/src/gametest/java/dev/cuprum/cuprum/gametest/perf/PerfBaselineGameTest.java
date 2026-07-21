package dev.cuprum.cuprum.gametest.perf;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.perf.PerfBudget;
import dev.cuprum.cuprum.perf.PerfBudgets;
import dev.cuprum.cuprum.perf.PerfSampler;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;

/**
 * {@code w1_perf_baseline_idle} (handbook-config.md §9; plan §4-W1E): the deliberately loose
 * W1 server-side calibration gate — {@link PerfBudgets#W1_IDLE_TICK_SAMPLES} idle ticks
 * sampled once per tick from the verified {@code MinecraftServer.getAverageTickTimeNanos()},
 * first {@link PerfBudgets#W1_WARMUP_SAMPLES} dropped, mean must stay under 10 ms. The gate
 * writes {@code build/perf/w1_perf_baseline_idle.json} (CI artifact) and hard-fails over
 * budget. W14 swaps the scene (dome + turrets + tube items) and reuses sampler/report/gate
 * unchanged. Own environment ⇒ own batch: no other Cuprum test runs while sampling.
 */
public class PerfBaselineGameTest {
    private static final int TOTAL_SAMPLES =
            PerfBudgets.W1_IDLE_TICK_SAMPLES + PerfBudgets.W1_WARMUP_SAMPLES;

    @GameTest(environment = "cuprum-gametest:perf_idle", maxTicks = TOTAL_SAMPLES + 400)
    public void w1PerfBaselineIdle(GameTestHelper helper) {
        PerfSampler sampler = PerfSampler.create();
        boolean[] evaluated = {false};
        helper.onEachTick(() -> {
            if (evaluated[0]) {
                return;
            }
            if (sampler.sampleCount() < TOTAL_SAMPLES) {
                sampler.addNs(helper.getLevel().getServer().getAverageTickTimeNanos());
                return;
            }
            evaluated[0] = true;
            PerfBudget.Result result = PerfBudget.assertMeanBelow(sampler, "w1_perf_baseline_idle",
                    PerfBudgets.W1_IDLE_TICK_MEAN_NS, PerfBudgets.W1_WARMUP_SAMPLES);
            Cuprum.LOGGER.info("[perf] w1_perf_baseline_idle: mean {} ns (p95 {} ns, max {} ns) over {} samples"
                            + " — budget {} ns", result.meanNs(), result.p95Ns(), result.maxNs(),
                    result.samples(), result.budgetNs());
            helper.succeed();
        });
    }
}
