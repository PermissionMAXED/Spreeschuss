package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.TickReport;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Randomized (FIXED seed) conservation property tests: after every allocator pass,
 * {@code Σafter == Σbefore + produced − consumed − vented} holds exactly, no storage is ever
 * negative or over capacity, and producers are always drained their full offer (whatever the
 * network cannot place is vented by construction).
 */
class AllocationConservationTest {
    @Test
    void randomizedGraphsConserveChargeEveryTick() {
        Random random = new Random(0xCAFE_01L);
        for (int trial = 0; trial < 30; trial++) {
            TestGraph graph = new TestGraph();
            int nodeCount = 3 + random.nextInt(20);
            List<Integer> ids = new ArrayList<>();
            for (int n = 0; n < nodeCount; n++) {
                long posKey = trial * 1_000L + n;
                int priority = random.nextInt(3);
                switch (random.nextInt(4)) {
                    case 0 -> ids.add(graph.addProducer(posKey, priority, random.nextInt(500)));
                    case 1 -> ids.add(graph.addConsumer(posKey, priority, random.nextInt(500)));
                    case 2 -> ids.add(graph.addStorage(posKey, priority,
                            500L + random.nextInt(5_000), 100L + random.nextInt(400),
                            100L + random.nextInt(400)));
                    default -> ids.add(graph.addAbsorber(posKey, priority, random.nextInt(300)));
                }
            }
            // Random spanning wiring keeps everything in one component; extra random edges.
            for (int n = 1; n < ids.size(); n++) {
                graph.core.addEdge(ids.get(n), ids.get(random.nextInt(n)));
            }
            for (int extra = 0; extra < nodeCount / 2; extra++) {
                int a = random.nextInt(ids.size());
                int b = random.nextInt(ids.size());
                if (a != b) {
                    graph.core.addEdge(ids.get(a), ids.get(b));
                }
            }
            for (int tick = 0; tick < 50; tick++) {
                long storedBefore = graph.storedSum();
                long drainedBefore = graph.drainedSum();
                long receivedBefore = graph.receivedSum();
                TickReport report = graph.core.tick(graph.access);
                long produced = graph.drainedSum() - drainedBefore;
                long consumed = graph.receivedSum() - receivedBefore;
                assertEquals(storedBefore + produced - consumed - report.vented(), graph.storedSum(),
                        "conservation at trial " + trial + " tick " + tick);
                assertTrue(report.vented() >= 0, "vented never negative");
                for (TestGraph.TestNode node : graph.nodes.values()) {
                    if (node.buffer != null) {
                        assertTrue(node.buffer.stored() >= 0, "stored never negative");
                        assertTrue(node.buffer.stored() <= node.buffer.capacity(),
                                "stored never over capacity");
                    }
                }
            }
        }
    }

    @Test
    void producersAreAlwaysDrainedTheirFullOfferRemainderVented() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, 2, 1_000L);
        int consumer = graph.addConsumer(2L, 2, 300L);
        graph.core.addEdge(producer, consumer);
        TickReport report = graph.core.tick(graph.access);
        // 1,000 offered, 300 consumed, no storage/absorber -> 700 vented, offer fully drained.
        assertEquals(1_000L, graph.nodes.get(producer).totalDrained);
        assertEquals(300L, graph.nodes.get(consumer).totalReceived);
        assertEquals(700L, report.vented());
        assertEquals(1_000L, report.moved() + report.vented());
    }

    @Test
    void storageInsertAndExtractBudgetsBoundPerTickFlows() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, 2, 5_000L);
        int storage = graph.addStorage(2L, 2, 20_000L, 1_000L, 250L);
        int consumer = graph.addConsumer(3L, 2, 0L);
        graph.core.addEdge(producer, storage);
        graph.core.addEdge(storage, consumer);
        TickReport first = graph.core.tick(graph.access);
        // P2 respects maxInsert=1,000: 4,000 of the 5,000 offer is vented.
        assertEquals(1_000L, graph.nodes.get(storage).buffer.stored());
        assertEquals(4_000L, first.vented());
        // Now stop producing and let the consumer pull: P3 respects maxExtract=250.
        graph.nodes.get(producer).offerPerTick = 0L;
        graph.nodes.get(consumer).demandPerTick = 10_000L;
        graph.core.tick(graph.access);
        assertEquals(750L, graph.nodes.get(storage).buffer.stored());
        assertEquals(250L, graph.nodes.get(consumer).totalReceived);
    }

    @Test
    void surgeDepositFillsStorageFeedsAbsorbersThenVents() {
        TestGraph graph = new TestGraph();
        int storage = graph.addStorage(1L, 2, 20_000L, 1_000L, 1_000L);
        int absorber = graph.addAbsorber(2L, 2, 30_000L);
        graph.core.addEdge(storage, absorber);
        long accepted = graph.core.depositSurge(storage, 270_000L, graph.access);
        // 20,000 into the cell (insert cap bypassed, capacity not), 30,000 absorbed, rest vented.
        assertEquals(50_000L, accepted);
        assertEquals(20_000L, graph.nodes.get(storage).buffer.stored());
        assertEquals(30_000L, graph.nodes.get(absorber).totalAbsorbed);
        assertEquals(220_000L, graph.core.diagnostics().ventedTotal());
        // The pending surge vent joins ventedLastTick on the next pass without double counting.
        TickReport report = graph.core.tick(graph.access);
        assertEquals(220_000L, report.vented());
        assertEquals(220_000L, graph.core.diagnostics().ventedTotal());
    }

    @Test
    void surgeWithoutAbsorbersVentsExactRemainder() {
        TestGraph graph = new TestGraph();
        int storage = graph.addStorage(1L, 2, 20_000L, 1_000L, 1_000L);
        long accepted = graph.core.depositSurge(storage, 270_000L, graph.access);
        assertEquals(20_000L, accepted);
        assertEquals(20_000L, graph.nodes.get(storage).buffer.stored());
        assertEquals(250_000L, graph.core.diagnostics().ventedTotal());
    }
}
