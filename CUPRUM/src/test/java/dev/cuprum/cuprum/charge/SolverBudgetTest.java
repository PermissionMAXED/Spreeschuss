package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.ChargePriority;
import dev.cuprum.cuprum.charge.core.TickReport;
import java.util.Random;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Solver budget (FOUNDATION_PLAN D8 — replaces the rejected {@code cgSolverBudget1000Nodes}
 * GameTest): ONE CONNECTED 1,000-node graph (single network, single active island — asserted),
 * 100 measured allocator ticks on the MC-free
 * {@link dev.cuprum.cuprum.charge.core.ChargeGraphCore}; hard-assert avg ≤ 1.0 ms/tick and log
 * the actual average against the 0.15 ms W5 target.
 *
 * <p><b>Timing scope</b> (honest accounting): each measured sample is one FULL
 * {@code ChargeGraphCore.tick()} — canonical/island cache refresh, transfer-budget reset, all
 * four phases and every {@code NodeAccess} call included. Excluded are (a) one-time graph
 * CONSTRUCTION (addNode/addEdge — a world-load cost, not a per-tick cost; the D8 contract
 * budgets the per-tick allocator) and (b) {@value #WARMUP_TICKS} JIT warmup ticks over the
 * ALREADY-CONVERGED topology (the rebuild queue is asserted empty before measuring, so warmup
 * hides no rebuild work — incremental rebuild costs are covered by
 * {@link IncrementalRebuildEquivalenceTest}).
 *
 * <p>The graph is a 1,000-node chain with cross-links every 10 nodes, alternating
 * surplus/deficit segments of 100 so all allocator phases stay busy every tick — surplus
 * segments exercise P1/P2/P4, deficit segments with pre-charged storages exercise P1/P3.
 * Relays are deliberately absent: relay path routing is a per-transfer computation covered
 * functionally by its own tests, and no W1–W5 acceptance ships a 1,000-node relay mesh. Seeds
 * fixed.
 */
class SolverBudgetTest {
    private static final int NODE_COUNT = 1_000;
    private static final int WARMUP_TICKS = 50;
    private static final int MEASURED_TICKS = 100;
    private static final long HARD_CAP_NANOS = 1_000_000L;   // 1.0 ms CI-soft budget (hard here).
    private static final double TARGET_MS = 0.15;            // W5 target, logged only.

    @Test
    void connectedThousandNodeGraphAveragesUnderOneMillisecondPerTick() {
        Random random = new Random(0xB0D6E7L);
        TestGraph graph = new TestGraph();
        int[] ids = new int[NODE_COUNT];
        for (int n = 0; n < NODE_COUNT; n++) {
            boolean surplus = (n / 100) % 2 == 0; // alternating 100-node segments
            long posKey = n;
            int priority = ChargePriority.values()[n % 3].ordinal();
            int role = n % 10;
            if (role < 2) {
                // 200 producers; surplus segments offer far above local demand.
                long offer = (surplus ? 90L : 25L) + random.nextInt(20);
                ids[n] = graph.addProducer(posKey, priority, offer);
            } else if (role < 5) {
                // 300 consumers.
                ids[n] = graph.addConsumer(posKey, priority, 30L + random.nextInt(15));
            } else if (role < 9) {
                // 400 storages, big enough to never fill during the run.
                ids[n] = graph.addStorage(posKey, priority, 500_000L, 50L, 50L);
                if (!surplus) {
                    // Deficit segments start charged so P3 (storage -> unmet demand) is busy.
                    graph.nodes.get(ids[n]).buffer.setStored(250_000L);
                }
            } else {
                // 100 surge absorbers with a small per-tick cap (P4 busy).
                ids[n] = graph.addAbsorber(posKey, priority, 5L);
            }
        }
        // ONE connected component: a full chain plus cross-links every 10 nodes.
        for (int n = 1; n < NODE_COUNT; n++) {
            graph.core.addEdge(ids[n - 1], ids[n]);
        }
        for (int n = 10; n < NODE_COUNT; n += 10) {
            graph.core.addEdge(ids[n - 10], ids[n]);
        }
        assertEquals(NODE_COUNT, graph.core.diagnostics().nodes(), "graph must hold 1,000 nodes");

        for (int tick = 0; tick < WARMUP_TICKS; tick++) {
            graph.core.tick(graph.access);
        }
        // Single network, single fully-loaded active island, converged topology — asserted so
        // the measured window can hide neither fragmentation nor pending rebuild work.
        assertEquals(1, graph.core.diagnostics().networks(), "exactly one network");
        assertEquals(NODE_COUNT, graph.core.loadedIslandMembers(ids[0]).length,
                "exactly one active island holding all 1,000 nodes");
        assertEquals(0, graph.core.diagnostics().rebuildQueueDepth(), "no rebuild work pending");

        long totalNanos = 0;
        long minMoved = Long.MAX_VALUE;
        for (int tick = 0; tick < MEASURED_TICKS; tick++) {
            TickReport report = graph.core.tick(graph.access);
            totalNanos += report.nanos();
            minMoved = Math.min(minMoved, report.moved());
        }
        // Guard against a tautological timing run: the solver must actually move charge in
        // every measured tick (the graph stays busy by construction).
        assertTrue(minMoved > 0, "solver idled during the measured window (moved=0)");

        long avgNanos = totalNanos / MEASURED_TICKS;
        double avgMs = avgNanos / 1_000_000.0;
        System.out.printf(
                "SolverBudgetTest: avg %.4f ms/tick over %d ticks @ %d connected nodes"
                        + " (hard cap 1.00 ms, W5 target %.2f ms)%n",
                avgMs, MEASURED_TICKS, NODE_COUNT, TARGET_MS);
        assertTrue(avgNanos <= HARD_CAP_NANOS,
                "solver budget exceeded: avg " + avgMs + " ms/tick > 1.0 ms hard cap");
    }
}
