package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.ChargeGraphCore;
import java.lang.reflect.Field;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Regression coverage for deterministic relay BFS visitation-stamp rollover. */
class RelayEpochRolloverTest {
    @Test
    void relayRoutingSurvivesIntegerMaxRollover() throws ReflectiveOperationException {
        TestGraph graph = new TestGraph();
        int consumer = addRelayChain(graph);
        Field epoch = ChargeGraphCore.class.getDeclaredField("bfsEpoch");
        epoch.setAccessible(true);
        epoch.setInt(graph.core, Integer.MAX_VALUE - 1);

        graph.core.tick(graph.access);
        assertEquals(100L, graph.nodes.get(consumer).totalReceived);
        assertEquals(Integer.MAX_VALUE, epoch.getInt(graph.core));

        graph.core.tick(graph.access);
        assertEquals(200L, graph.nodes.get(consumer).totalReceived);
        assertEquals(1, epoch.getInt(graph.core), "rollover must clear stamps and resume at one");
    }

    @Test
    void aPreviouslyWrappedNegativeEpochRecoversOnTheNextRoute() throws ReflectiveOperationException {
        TestGraph graph = new TestGraph();
        int consumer = addRelayChain(graph);
        Field epoch = ChargeGraphCore.class.getDeclaredField("bfsEpoch");
        epoch.setAccessible(true);
        epoch.setInt(graph.core, -1);

        graph.core.tick(graph.access);

        assertEquals(100L, graph.nodes.get(consumer).totalReceived);
        assertEquals(1, epoch.getInt(graph.core));
    }

    private static int addRelayChain(TestGraph graph) {
        int producer = graph.addProducer(1L, 2, 100L);
        int relay = graph.addRelay(2L, 2, 500L);
        int consumer = graph.addConsumer(3L, 2, 100L);
        graph.core.addEdge(producer, relay);
        graph.core.addEdge(relay, consumer);
        return consumer;
    }
}
