package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.ChargePriority;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * PWR-18 brownout semantics (charge.md §3 P1): consumers are served fully-greedy strictly by
 * priority tier in canonical order — at 50% total supply the DEFENSE consumer receives 100% of
 * its request and MISC receives exactly 0.
 */
class PriorityBrownoutTest {
    private static final int DEFENSE = ChargePriority.DEFENSE.ordinal();
    private static final int LOGISTICS = ChargePriority.LOGISTICS.ordinal();
    private static final int MISC = ChargePriority.MISC.ordinal();

    @Test
    void atFiftyPercentSupplyDefenseGetsAllMiscGetsExactlyZero() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(10L, MISC, 100L);
        int defense = graph.addConsumer(11L, DEFENSE, 100L);
        int misc = graph.addConsumer(12L, MISC, 100L);
        graph.core.addEdge(producer, defense);
        graph.core.addEdge(producer, misc);
        for (int tick = 1; tick <= 10; tick++) {
            graph.core.tick(graph.access);
            assertEquals(100L * tick, graph.nodes.get(defense).totalReceived,
                    "DEFENSE fully served at tick " + tick);
            assertEquals(0L, graph.nodes.get(misc).totalReceived,
                    "MISC starved at tick " + tick);
        }
    }

    @Test
    void middleTierDrainsBeforeMiscAndAfterDefense() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(20L, MISC, 250L);
        int defense = graph.addConsumer(21L, DEFENSE, 100L);
        int logistics = graph.addConsumer(22L, LOGISTICS, 100L);
        int misc = graph.addConsumer(23L, MISC, 100L);
        graph.core.addEdge(producer, defense);
        graph.core.addEdge(producer, logistics);
        graph.core.addEdge(producer, misc);
        graph.core.tick(graph.access);
        // 250 supply vs 300 demand: DEFENSE 100, LOGISTICS 100, MISC the remaining 50.
        assertEquals(100L, graph.nodes.get(defense).totalReceived);
        assertEquals(100L, graph.nodes.get(logistics).totalReceived);
        assertEquals(50L, graph.nodes.get(misc).totalReceived);
    }

    @Test
    void storageDischargeAlsoServesByPriority() {
        TestGraph graph = new TestGraph();
        int storage = graph.addStorage(30L, MISC, 20_000L, 1_000L, 150L);
        graph.nodes.get(storage).buffer.setStored(20_000L);
        int defense = graph.addConsumer(31L, DEFENSE, 100L);
        int misc = graph.addConsumer(32L, MISC, 100L);
        graph.core.addEdge(storage, defense);
        graph.core.addEdge(storage, misc);
        graph.core.tick(graph.access);
        // P3 extract budget 150: DEFENSE gets its full 100 first, MISC only the remaining 50.
        assertEquals(100L, graph.nodes.get(defense).totalReceived);
        assertEquals(50L, graph.nodes.get(misc).totalReceived);
        assertEquals(20_000L - 150L, graph.nodes.get(storage).buffer.stored());
    }

    @Test
    void equalPriorityTiesBreakOnPosKeyCanonicalOrder() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(40L, MISC, 100L);
        // Same tier: the LOWER posKey is canonically first and gets served first.
        int late = graph.addConsumer(45L, MISC, 100L);
        int early = graph.addConsumer(41L, MISC, 100L);
        graph.core.addEdge(producer, late);
        graph.core.addEdge(producer, early);
        graph.core.tick(graph.access);
        assertEquals(100L, graph.nodes.get(early).totalReceived);
        assertEquals(0L, graph.nodes.get(late).totalReceived);
    }
}
