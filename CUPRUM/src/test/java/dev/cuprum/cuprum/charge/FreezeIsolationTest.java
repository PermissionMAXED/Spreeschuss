package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.TickReport;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Chunk-freeze semantics (charge.md §4): frozen nodes keep their edges and stored Cg but are
 * excluded from every allocator phase — no phantom transfer through or into unloaded regions;
 * loaded sub-islands of a partially frozen network tick independently.
 */
class FreezeIsolationTest {
    @Test
    void frozenStorageNeverChangesAndUnfreezingResumesFlow() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, 2, 100L);
        int storage = graph.addStorage(2L, 2, 20_000L, 1_000L, 1_000L);
        graph.core.addEdge(producer, storage);
        graph.core.tick(graph.access);
        assertEquals(100L, graph.nodes.get(storage).buffer.stored());

        graph.core.setActive(storage, false);
        for (int tick = 0; tick < 5; tick++) {
            graph.core.tick(graph.access);
        }
        // Frozen: stored unchanged; the producer's island vents its whole offer.
        assertEquals(100L, graph.nodes.get(storage).buffer.stored());

        graph.core.setActive(storage, true);
        graph.core.tick(graph.access);
        assertEquals(200L, graph.nodes.get(storage).buffer.stored());
    }

    @Test
    void frozenMiddleSplitsTheLoadedNetworkIntoIndependentIslands() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, 2, 100L);
        int middle = graph.addStorage(2L, 2, 20_000L, 1_000L, 1_000L);
        int consumer = graph.addConsumer(3L, 2, 100L);
        graph.core.addEdge(producer, middle);
        graph.core.addEdge(middle, consumer);
        graph.nodes.get(middle).buffer.setStored(5_000L);

        graph.core.setActive(middle, false);
        TickReport report = graph.core.tick(graph.access);
        // The frozen middle blocks the P1 path? No: producer and consumer are still directly
        // connected THROUGH the topology, but they sit in different LOADED sub-islands because
        // the only bridge is frozen — nothing moves, the offer vents, storage keeps its Cg.
        assertEquals(0L, graph.nodes.get(consumer).totalReceived);
        assertEquals(5_000L, graph.nodes.get(middle).buffer.stored());
        assertEquals(100L, report.vented());
        assertEquals(2, report.networksTicked());

        graph.core.setActive(middle, true);
        graph.core.tick(graph.access);
        // One island again: DEFENSE-less simple flow, consumer served directly.
        assertEquals(100L, graph.nodes.get(consumer).totalReceived);
        assertEquals(5_000L, graph.nodes.get(middle).buffer.stored());
    }

    @Test
    void surgeAtFrozenNodeAcceptsNothingAndVentsNothing() {
        TestGraph graph = new TestGraph();
        int storage = graph.addStorage(1L, 2, 20_000L, 1_000L, 1_000L);
        graph.core.setActive(storage, false);
        long ventedBefore = graph.core.diagnostics().ventedTotal();
        assertEquals(0L, graph.core.depositSurge(storage, 270_000L, graph.access));
        assertEquals(0L, graph.nodes.get(storage).buffer.stored());
        assertEquals(ventedBefore, graph.core.diagnostics().ventedTotal());
    }

    @Test
    void frozenNodesKeepEdgesAndNetworkMembership() {
        TestGraph graph = new TestGraph();
        int a = graph.addStorage(1L, 2, 1_000L, 100L, 100L);
        int b = graph.addStorage(2L, 2, 1_000L, 100L, 100L);
        graph.core.addEdge(a, b);
        int networkBefore = graph.core.networkOf(a);
        assertEquals(networkBefore, graph.core.networkOf(b));
        graph.core.setActive(b, false);
        // Freezing is NOT a topology change: same network label, edges intact.
        assertEquals(networkBefore, graph.core.networkOf(a));
        assertEquals(networkBefore, graph.core.networkOf(b));
        assertTrue(graph.core.loadedIslandMembers(b).length == 0,
                "frozen node has no loaded island");
        assertEquals(1, graph.core.loadedIslandMembers(a).length);
    }
}
