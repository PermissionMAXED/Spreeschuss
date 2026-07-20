package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.TickReport;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Eval-A repair regressions (F4): surge bypasses ONLY the storage insert rate — relay
 * throughput remains enforced, cumulatively across multiple deposits within one tick window
 * (budgets replenish at each allocator pass; the pass and every surge until the next pass draw
 * from the same remaining budgets).
 */
class SurgeRelayThroughputTest {
    /** The exact Eval-A scenario: storage → 10 Cg/t relay → absorber, 100 Cg surge. */
    @Test
    void surgeThroughRelayIsCappedByRelayBudgetAndVentsExactRemainder() {
        TestGraph graph = new TestGraph();
        int storage = graph.addStorage(1L, 2, 1_000L, 1_000L, 1_000L);
        graph.nodes.get(storage).buffer.setStored(1_000L); // full: own storage takes 0
        int relay = graph.addRelay(2L, 2, 10L);
        int absorber = graph.addAbsorber(3L, 2, 1_000_000L);
        graph.core.addEdge(storage, relay);
        graph.core.addEdge(relay, absorber);
        long accepted = graph.core.depositSurge(storage, 100L, graph.access);
        // No more than the 10 Cg/t relay budget reaches the absorber; the remainder vents.
        assertEquals(10L, accepted);
        assertEquals(10L, graph.nodes.get(absorber).totalAbsorbed);
        assertEquals(90L, graph.core.diagnostics().ventedTotal());
        assertEquals(1_000L, graph.nodes.get(storage).buffer.stored(), "capacity still respected");
    }

    @Test
    void repeatedSameWindowDepositsCannotResetOrExceedTheRelayBudget() {
        TestGraph graph = new TestGraph();
        int storage = graph.addStorage(1L, 2, 1_000L, 1_000L, 1_000L);
        graph.nodes.get(storage).buffer.setStored(1_000L);
        int relay = graph.addRelay(2L, 2, 10L);
        int absorber = graph.addAbsorber(3L, 2, 1_000_000L);
        graph.core.addEdge(storage, relay);
        graph.core.addEdge(relay, absorber);
        assertEquals(4L, graph.core.depositSurge(storage, 4L, graph.access));
        assertEquals(4L, graph.core.depositSurge(storage, 4L, graph.access));
        // 8 of 10 Cg consumed: the third deposit gets only the remaining 2, then everything vents.
        assertEquals(2L, graph.core.depositSurge(storage, 4L, graph.access));
        assertEquals(0L, graph.core.depositSurge(storage, 100L, graph.access),
                "an exhausted relay blocks the path entirely");
        assertEquals(10L, graph.nodes.get(absorber).totalAbsorbed);
        assertEquals(102L, graph.core.diagnostics().ventedTotal());
        // The next allocator pass opens a new window with a fresh 10 Cg budget.
        graph.core.tick(graph.access);
        assertEquals(10L, graph.core.depositSurge(storage, 100L, graph.access));
        assertEquals(20L, graph.nodes.get(absorber).totalAbsorbed);
    }

    @Test
    void allocatorAndSurgeShareOneCumulativeRelayBudgetPerWindow() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, 2, 6L);
        int relay = graph.addRelay(2L, 2, 10L);
        int consumer = graph.addConsumer(3L, 2, 6L);
        int absorber = graph.addAbsorber(4L, 2, 1_000_000L);
        // Line: producer - relay - consumer - absorber; every cross-relay transfer shares the
        // relay's 10 Cg/t budget. (The surge origin must be a node: use the producer.)
        graph.core.addEdge(producer, relay);
        graph.core.addEdge(relay, consumer);
        graph.core.addEdge(consumer, absorber);
        TickReport report = graph.core.tick(graph.access);
        // The pass moved 6 Cg producer -> consumer across the relay, leaving 4 Cg of budget.
        assertEquals(6L, graph.nodes.get(consumer).totalReceived);
        assertEquals(0L, report.vented());
        // A surge at the producer must cross the same relay to reach the absorber: only the
        // remaining 4 Cg fit; 96 vent.
        long accepted = graph.core.depositSurge(producer, 100L, graph.access);
        assertEquals(4L, accepted);
        assertEquals(4L, graph.nodes.get(absorber).totalAbsorbed);
        assertEquals(96L, graph.core.diagnostics().ventedTotal());
    }

    @Test
    void allocatorRelayBudgetStillBoundsNormalFlows() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, 2, 100L);
        int relay = graph.addRelay(2L, 2, 10L);
        int consumer = graph.addConsumer(3L, 2, 100L);
        graph.core.addEdge(producer, relay);
        graph.core.addEdge(relay, consumer);
        TickReport report = graph.core.tick(graph.access);
        assertEquals(10L, graph.nodes.get(consumer).totalReceived, "P1 capped by relay throughput");
        assertEquals(90L, report.vented(), "undeliverable offer vents");
        assertEquals(100L, graph.nodes.get(producer).totalDrained);
    }
}
