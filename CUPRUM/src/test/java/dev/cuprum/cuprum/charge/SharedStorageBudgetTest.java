package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.ChargeBuffer;
import dev.cuprum.cuprum.charge.core.TickReport;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Normal graph and external storage calls share one lazy game-tick budget. Surge storage is an
 * explicit capacity-only path and neither consumes nor resets that normal budget.
 */
class SharedStorageBudgetTest {
    private static final int MISC = 2;

    @Test
    void insertBudgetIsSharedApiThenGraph() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, MISC, 100L);
        int storage = graph.addStorage(2L, MISC, 20_000L, 100L, 100L);
        graph.core.addEdge(producer, storage);
        ChargeBuffer buffer = graph.nodes.get(storage).buffer;

        buffer.beginGameTick(graph.core.ticksRun());
        assertEquals(100L, buffer.insert(100L, false));
        TickReport report = graph.core.tick(graph.access);

        assertEquals(100L, buffer.stored());
        assertEquals(100L, report.vented(), "rejected graph remainder must conserve by venting");
    }

    @Test
    void insertBudgetIsSharedGraphThenApi() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, MISC, 100L);
        int storage = graph.addStorage(2L, MISC, 20_000L, 100L, 100L);
        graph.core.addEdge(producer, storage);
        ChargeBuffer buffer = graph.nodes.get(storage).buffer;

        graph.core.tick(graph.access);
        buffer.beginGameTick(0L);

        assertEquals(0L, buffer.insert(100L, false));
        assertEquals(100L, buffer.stored());
    }

    @Test
    void extractBudgetIsSharedApiThenGraph() {
        TestGraph graph = new TestGraph();
        int storage = graph.addStorage(1L, MISC, 20_000L, 100L, 100L);
        int consumer = graph.addConsumer(2L, MISC, 100L);
        graph.core.addEdge(storage, consumer);
        ChargeBuffer buffer = graph.nodes.get(storage).buffer;
        buffer.setStored(20_000L);

        buffer.beginGameTick(graph.core.ticksRun());
        assertEquals(100L, buffer.extract(100L, false));
        graph.core.tick(graph.access);

        assertEquals(0L, graph.nodes.get(consumer).totalReceived);
        assertEquals(19_900L, buffer.stored());
    }

    @Test
    void extractBudgetIsSharedGraphThenApi() {
        TestGraph graph = new TestGraph();
        int storage = graph.addStorage(1L, MISC, 20_000L, 100L, 100L);
        int consumer = graph.addConsumer(2L, MISC, 100L);
        graph.core.addEdge(storage, consumer);
        ChargeBuffer buffer = graph.nodes.get(storage).buffer;
        buffer.setStored(20_000L);

        graph.core.tick(graph.access);
        buffer.beginGameTick(0L);

        assertEquals(0L, buffer.extract(100L, false));
        assertEquals(100L, graph.nodes.get(consumer).totalReceived);
        assertEquals(19_900L, buffer.stored());
    }

    @Test
    void aDifferentGameTickLazilyReplenishesBudgetsAcrossLongWrap() {
        ChargeBuffer buffer = new ChargeBuffer(1_000L, 100L, 100L);
        buffer.beginGameTick(Long.MAX_VALUE);
        assertEquals(100L, buffer.insert(100L, false));
        assertEquals(0L, buffer.insert(1L, false));
        buffer.beginGameTick(Long.MIN_VALUE);
        assertEquals(100L, buffer.insert(100L, false));
    }

    @Test
    void surgeIsIsolatedFromNormalBudgetInEitherOrder() {
        ChargeBuffer normalFirst = new ChargeBuffer(1_000L, 100L, 100L);
        normalFirst.beginGameTick(7L);
        assertEquals(100L, normalFirst.insert(100L, false));
        assertEquals(500L, normalFirst.depositSurge(500L));
        assertEquals(0L, normalFirst.insert(1L, false));
        assertEquals(600L, normalFirst.stored());

        ChargeBuffer surgeFirst = new ChargeBuffer(1_000L, 100L, 100L);
        surgeFirst.beginGameTick(7L);
        assertEquals(500L, surgeFirst.depositSurge(500L));
        assertEquals(100L, surgeFirst.insert(100L, false));
        assertEquals(600L, surgeFirst.stored());
    }

    @Test
    void graphSurgeStoragePathDoesNotConsumeNormalInsertBudget() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, MISC, 100L);
        int storage = graph.addStorage(2L, MISC, 1_000L, 100L, 100L);
        graph.core.addEdge(producer, storage);

        assertEquals(500L, graph.core.depositSurge(storage, 500L, graph.access));
        graph.core.tick(graph.access);

        assertEquals(600L, graph.nodes.get(storage).buffer.stored());
    }
}
