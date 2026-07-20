package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.Roles;
import dev.cuprum.cuprum.charge.core.TickReport;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Eval-A repair regression/property tests: multi-role nodes go through EXPLICIT phase-specific
 * {@link dev.cuprum.cuprum.charge.core.NodeAccess} operations (never delta-sign dispatch), a
 * node never transfers to itself, and conservation
 * ({@code Σafter == Σbefore + produced − consumed − vented}) holds exactly for every role
 * combination.
 */
class MultiRoleConservationTest {
    /**
     * The exact Eval-A repro: a producer+storage node must not create charge. Under the old
     * sign-dispatched {@code applyDelta}, the producer's −50 drain hit the storage branch and
     * corrupted the buffer while the offer stayed undrained. Now the drain targets the producer
     * role explicitly and the node's own storage is skipped (no self-transfer): the unplaced
     * offer vents exactly.
     */
    @Test
    void producerPlusStorageNodeCreatesNothing() {
        TestGraph graph = new TestGraph();
        int hybrid = graph.addNode(1L, Roles.PRODUCER | Roles.STORAGE, 2, 10_000L, 1_000L, 1_000L);
        graph.nodes.get(hybrid).offerPerTick = 50L;
        int idleConsumer = graph.addConsumer(2L, 2, 0L);
        graph.core.addEdge(hybrid, idleConsumer);
        long storedBefore = graph.storedSum();
        TickReport report = graph.core.tick(graph.access);
        assertEquals(50L, graph.nodes.get(hybrid).totalDrained, "offer fully drained (producer role)");
        assertEquals(0L, graph.nodes.get(hybrid).buffer.stored(), "own storage untouched (no self-transfer)");
        assertEquals(50L, report.vented(), "unplaced offer vents exactly");
        assertEquals(0L, report.moved());
        assertEquals(storedBefore, graph.storedSum(), "no charge created or destroyed");
    }

    @Test
    void producerPlusStorageOfferFlowsToOtherStoragesNotItself() {
        TestGraph graph = new TestGraph();
        int hybrid = graph.addNode(1L, Roles.PRODUCER | Roles.STORAGE, 2, 10_000L, 1_000L, 1_000L);
        graph.nodes.get(hybrid).offerPerTick = 100L;
        int other = graph.addStorage(2L, 2, 10_000L, 1_000L, 1_000L);
        graph.core.addEdge(hybrid, other);
        TickReport report = graph.core.tick(graph.access);
        assertEquals(100L, graph.nodes.get(hybrid).totalDrained);
        assertEquals(0L, graph.nodes.get(hybrid).buffer.stored(), "own storage skipped");
        assertEquals(100L, graph.nodes.get(other).buffer.stored(), "other storage receives the offer");
        assertEquals(0L, report.vented());
        assertEquals(100L, report.moved());
    }

    @Test
    void consumerPlusStorageDoesNotSelfFeed() {
        TestGraph graph = new TestGraph();
        int hybrid = graph.addNode(1L, Roles.CONSUMER | Roles.STORAGE, 2, 10_000L, 1_000L, 1_000L);
        graph.nodes.get(hybrid).demandPerTick = 50L;
        graph.nodes.get(hybrid).buffer.setStored(1_000L);
        TickReport report = graph.core.tick(graph.access);
        assertEquals(0L, graph.nodes.get(hybrid).totalReceived, "demand not served from own storage");
        assertEquals(1_000L, graph.nodes.get(hybrid).buffer.stored(), "own storage unchanged");
        assertEquals(0L, report.moved());
        assertEquals(0L, report.vented());
    }

    @Test
    void consumerPlusStorageIsServedByOtherStorages() {
        TestGraph graph = new TestGraph();
        int other = graph.addStorage(1L, 2, 10_000L, 1_000L, 1_000L);
        graph.nodes.get(other).buffer.setStored(500L);
        int hybrid = graph.addNode(2L, Roles.CONSUMER | Roles.STORAGE, 2, 10_000L, 1_000L, 1_000L);
        graph.nodes.get(hybrid).demandPerTick = 50L;
        graph.core.addEdge(other, hybrid);
        TickReport report = graph.core.tick(graph.access);
        assertEquals(50L, graph.nodes.get(hybrid).totalReceived, "P3 serves the consumer role");
        assertEquals(0L, graph.nodes.get(hybrid).buffer.stored(), "delivery feeds the consumer, not the buffer");
        assertEquals(450L, graph.nodes.get(other).buffer.stored());
        assertEquals(50L, report.moved());
        assertEquals(0L, report.vented());
    }

    @Test
    void producerPlusConsumerDoesNotSelfFeed() {
        TestGraph graph = new TestGraph();
        int hybrid = graph.addNode(1L, Roles.PRODUCER | Roles.CONSUMER, 2, 0L, 0L, 0L);
        graph.nodes.get(hybrid).offerPerTick = 100L;
        graph.nodes.get(hybrid).demandPerTick = 100L;
        int other = graph.addProducer(2L, 2, 30L);
        graph.core.addEdge(hybrid, other);
        TickReport report = graph.core.tick(graph.access);
        // The hybrid's demand is served ONLY by the other producer; its own 100 Cg offer finds
        // no other consumer/storage/absorber and vents.
        assertEquals(30L, graph.nodes.get(hybrid).totalReceived);
        assertEquals(100L, graph.nodes.get(hybrid).totalDrained);
        assertEquals(30L, graph.nodes.get(other).totalDrained);
        assertEquals(100L, report.vented());
        assertEquals(30L, report.moved());
    }

    /**
     * Property: EVERY non-empty role combination (all 31 masks appear across trials), random
     * wiring, random partial-acceptance limits — conservation holds exactly on every tick and
     * no buffer ever goes negative/over capacity. Fixed seed.
     */
    @Test
    void randomizedMixedRoleGraphsConserveChargeEveryTick() {
        Random random = new Random(0x3117_B0BL);
        for (int trial = 0; trial < 40; trial++) {
            TestGraph graph = new TestGraph();
            int nodeCount = 4 + random.nextInt(16);
            List<Integer> ids = new ArrayList<>();
            for (int n = 0; n < nodeCount; n++) {
                long posKey = trial * 1_000L + n;
                int priority = random.nextInt(3);
                int mask = 1 + random.nextInt(31); // any non-empty role combination
                long capacity = Roles.has(mask, Roles.STORAGE) ? 500L + random.nextInt(5_000) : 0L;
                long maxInsert = 100L + random.nextInt(400);
                long maxExtract = 100L + random.nextInt(400);
                int id = graph.addNode(posKey, mask, priority, capacity, maxInsert, maxExtract);
                TestGraph.TestNode node = graph.nodes.get(id);
                if (Roles.has(mask, Roles.PRODUCER)) {
                    node.offerPerTick = random.nextInt(500);
                }
                if (Roles.has(mask, Roles.CONSUMER)) {
                    node.demandPerTick = random.nextInt(500);
                    if (random.nextInt(4) == 0) {
                        node.acceptPerCallLimit = random.nextInt(100); // partial/zero acceptor
                    }
                }
                if (Roles.has(mask, Roles.SURGE_ABSORBER) && random.nextInt(4) == 0) {
                    node.absorbPerCallLimit = random.nextInt(100);
                }
                ids.add(id);
            }
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
            for (int tick = 0; tick < 40; tick++) {
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
                        assertTrue(node.buffer.stored() <= node.buffer.capacity(), "stored never over capacity");
                    }
                }
            }
        }
    }
}
