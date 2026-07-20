package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.TickReport;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Eval-A repair regressions: ACTUAL acceptance return values drive every transfer/report.
 * A destination applying less than requested never causes the requested amount to be
 * subtracted/reported — the rejected remainder continues to the next eligible target or vents
 * exactly (allocator phases AND {@code depositSurge}).
 */
class ActualAcceptanceTest {
    @Test
    void partialConsumerAcceptanceLeavesRemainderToNextTargetsThenVent() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, 2, 100L);
        int picky = graph.addConsumer(2L, 2, 100L);
        graph.nodes.get(picky).acceptPerCallLimit = 40L; // accepts 40 of any delivery
        // maxExtract 0 keeps P3 from re-serving the still-unmet consumer from this storage in
        // the same tick, isolating the P1-remainder -> P2 path under test.
        int storage = graph.addStorage(3L, 2, 10_000L, 1_000L, 0L);
        graph.core.addEdge(producer, picky);
        graph.core.addEdge(picky, storage);
        TickReport report = graph.core.tick(graph.access);
        // P1 delivers 40 (ACTUAL), the 60 Cg remainder stays pooled and P2 stores it.
        assertEquals(100L, graph.nodes.get(producer).totalDrained);
        assertEquals(40L, graph.nodes.get(picky).totalReceived);
        assertEquals(60L, graph.nodes.get(storage).buffer.stored());
        assertEquals(0L, report.vented());
        assertEquals(100L, report.moved());
    }

    @Test
    void partialAcceptanceRemainderCascadesThroughStorageAndBackWithConservation() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, 2, 100L);
        int picky = graph.addConsumer(2L, 2, 100L);
        graph.nodes.get(picky).acceptPerCallLimit = 40L;
        int storage = graph.addStorage(3L, 2, 10_000L, 1_000L, 1_000L);
        graph.core.addEdge(producer, picky);
        graph.core.addEdge(picky, storage);
        TickReport report = graph.core.tick(graph.access);
        // Full cascade in one tick: P1 accepts 40 (pool 60) -> P2 stores 60 -> P3 extracts 60
        // for the still-unmet consumer, which accepts another 40; the 20 Cg rejected remainder
        // is unplaced at the consumer and vents exactly. Conservation is exact throughout.
        assertEquals(100L, graph.nodes.get(producer).totalDrained);
        assertEquals(80L, graph.nodes.get(picky).totalReceived);
        assertEquals(0L, graph.nodes.get(storage).buffer.stored());
        assertEquals(20L, report.vented());
        assertEquals(0L, graph.storedSum(), "Σafter == Σbefore + 100 − 80 − 20");
    }

    @Test
    void zeroAcceptanceConsumerVentsEverythingWithoutFallbackTargets() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, 2, 100L);
        int refuser = graph.addConsumer(2L, 2, 100L);
        graph.nodes.get(refuser).acceptPerCallLimit = 0L;
        graph.core.addEdge(producer, refuser);
        TickReport report = graph.core.tick(graph.access);
        assertEquals(100L, graph.nodes.get(producer).totalDrained);
        assertEquals(0L, graph.nodes.get(refuser).totalReceived);
        assertEquals(100L, report.vented());
        assertEquals(0L, report.moved());
    }

    @Test
    void storageRejectedRemainderInPhaseThreeVentsExactly() {
        TestGraph graph = new TestGraph();
        int storage = graph.addStorage(1L, 2, 10_000L, 1_000L, 1_000L);
        graph.nodes.get(storage).buffer.setStored(500L);
        int picky = graph.addConsumer(2L, 2, 100L);
        graph.nodes.get(picky).acceptPerCallLimit = 30L;
        graph.core.addEdge(storage, picky);
        long storedBefore = graph.storedSum();
        TickReport report = graph.core.tick(graph.access);
        // P3 extracts 100 (the request), the consumer ACTUALLY accepts 30; the 70 Cg remainder
        // is unplaced at the consumer, finds no absorber and vents exactly.
        assertEquals(30L, graph.nodes.get(picky).totalReceived);
        assertEquals(400L, graph.nodes.get(storage).buffer.stored());
        assertEquals(70L, report.vented());
        assertEquals(30L, report.moved());
        assertEquals(storedBefore - 100L, graph.storedSum(), "conservation with partial P3 acceptance");
    }

    @Test
    void partialAbsorberAcceptanceContinuesToNextAbsorberThenVents() {
        TestGraph graph = new TestGraph();
        int producer = graph.addProducer(1L, 2, 100L);
        int stingy = graph.addAbsorber(2L, 2, 1_000L);
        graph.nodes.get(stingy).absorbPerCallLimit = 25L; // registered cap 1,000; actually takes 25
        int backup = graph.addAbsorber(3L, 2, 1_000L);
        graph.core.addEdge(producer, stingy);
        graph.core.addEdge(stingy, backup);
        TickReport report = graph.core.tick(graph.access);
        assertEquals(25L, graph.nodes.get(stingy).totalAbsorbed, "only the ACTUAL absorb counts");
        assertEquals(75L, graph.nodes.get(backup).totalAbsorbed, "remainder continues to the next absorber");
        assertEquals(0L, report.vented());
        assertEquals(100L, report.moved());
    }

    @Test
    void surgeZeroAcceptanceAbsorberPassesRemainderOnThenVentsExactly() {
        TestGraph graph = new TestGraph();
        int storage = graph.addStorage(1L, 2, 1_000L, 1_000L, 1_000L);
        graph.nodes.get(storage).buffer.setStored(1_000L); // full: accepts nothing
        int refuser = graph.addAbsorber(2L, 2, 50_000L);
        graph.nodes.get(refuser).absorbPerCallLimit = 0L;
        int backup = graph.addAbsorber(3L, 2, 50_000L);
        graph.nodes.get(backup).absorbPerCallLimit = 70L;
        graph.core.addEdge(storage, refuser);
        graph.core.addEdge(refuser, backup);
        long accepted = graph.core.depositSurge(storage, 100L, graph.access);
        // Storage full (actual insert 0), first absorber refuses (actual 0), second takes 70,
        // 30 vents exactly. Nothing is deducted for refused requests.
        assertEquals(70L, accepted);
        assertEquals(0L, graph.nodes.get(refuser).totalAbsorbed);
        assertEquals(70L, graph.nodes.get(backup).totalAbsorbed);
        assertEquals(1_000L, graph.nodes.get(storage).buffer.stored());
        assertEquals(30L, graph.core.diagnostics().ventedTotal());
    }

    @Test
    void repeatedSameTickSurgeDepositsRespectCumulativeAbsorberCap() {
        TestGraph graph = new TestGraph();
        int storage = graph.addStorage(1L, 2, 1_000L, 1_000L, 1_000L);
        graph.nodes.get(storage).buffer.setStored(1_000L); // full
        int absorber = graph.addAbsorber(2L, 2, 100L); // 100 Cg per tick window
        graph.core.addEdge(storage, absorber);
        // Budgets replenish at tick() start; run one pass to open a fresh window.
        graph.core.tick(graph.access);
        assertEquals(60L, graph.core.depositSurge(storage, 60L, graph.access), "first deposit within cap");
        assertEquals(40L, graph.core.depositSurge(storage, 60L, graph.access),
                "second same-window deposit only gets the remaining 40 Cg of the cap");
        assertEquals(100L, graph.nodes.get(absorber).totalAbsorbed);
        assertEquals(20L, graph.core.diagnostics().ventedTotal(), "exact remainder vented");
        // A new allocator pass opens a new window: the cap is available again.
        graph.core.tick(graph.access);
        assertEquals(100L, graph.core.depositSurge(storage, 150L, graph.access));
        assertEquals(200L, graph.nodes.get(absorber).totalAbsorbed);
        assertEquals(70L, graph.core.diagnostics().ventedTotal());
    }
}
