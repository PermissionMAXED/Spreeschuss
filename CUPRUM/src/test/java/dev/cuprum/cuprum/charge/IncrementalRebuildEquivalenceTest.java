package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.ChargeGraphCore;
import dev.cuprum.cuprum.charge.core.RebuildStats;
import dev.cuprum.cuprum.charge.core.Roles;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Lazy-split correctness (charge.md §4): after ANY random add/remove sequence, once the budgeted
 * rebuild queue drains, the partition implied by {@code networkOf} must equal a from-scratch
 * flood fill over the same logical topology (mirrored in the test), regardless of the per-pass
 * budget schedule. Seeds fixed.
 */
class IncrementalRebuildEquivalenceTest {
    /** Test-side mirror of the logical topology, keyed by posKey. */
    private static final class Mirror {
        final Map<Long, Integer> idByPos = new HashMap<>();
        final Map<Long, Set<Long>> adjacency = new HashMap<>();
        long nextPos = 1;

        long addNode(ChargeGraphCore core) {
            long pos = nextPos++;
            idByPos.put(pos, core.addNode(pos, Roles.RELAY, 0, 0L, 0L, 0L));
            adjacency.put(pos, new HashSet<>());
            return pos;
        }

        void addEdge(ChargeGraphCore core, long a, long b) {
            core.addEdge(idByPos.get(a), idByPos.get(b));
            adjacency.get(a).add(b);
            adjacency.get(b).add(a);
        }

        void removeNode(ChargeGraphCore core, long pos) {
            core.removeNode(idByPos.remove(pos));
            for (long neighbor : adjacency.remove(pos)) {
                adjacency.get(neighbor).remove(pos);
            }
        }

        List<Long> alivePositions() {
            return new ArrayList<>(new TreeSet<>(idByPos.keySet()));
        }

        /** From-scratch flood fill over the mirror: the ground-truth component partition. */
        Set<Set<Long>> scratchComponents() {
            Set<Set<Long>> components = new HashSet<>();
            Set<Long> seen = new HashSet<>();
            for (long seed : idByPos.keySet()) {
                if (!seen.add(seed)) {
                    continue;
                }
                Set<Long> component = new TreeSet<>();
                ArrayDeque<Long> queue = new ArrayDeque<>();
                queue.add(seed);
                component.add(seed);
                while (!queue.isEmpty()) {
                    long current = queue.poll();
                    for (long neighbor : adjacency.get(current)) {
                        if (component.add(neighbor)) {
                            seen.add(neighbor);
                            queue.add(neighbor);
                        }
                    }
                }
                components.add(component);
            }
            return components;
        }
    }

    /** Drains the rebuild queue with the given per-pass budget; asserts bounded convergence. */
    private static void converge(ChargeGraphCore core, int budgetPerPass, int nodeBound) {
        int passes = 0;
        int passBound = nodeBound * 8 + 64;
        while (true) {
            RebuildStats stats = core.runRebuild(budgetPerPass);
            if (stats.queueDepth() == 0) {
                return;
            }
            passes++;
            assertTrue(passes <= passBound,
                    "budgeted rebuild failed to converge within " + passBound + " passes");
        }
    }

    /** Partition implied by the core's {@code networkOf} labels (no node may be pending). */
    private static Set<Set<Long>> corePartition(ChargeGraphCore core, Mirror mirror) {
        Map<Integer, Set<Long>> byLabel = new TreeMap<>();
        for (long pos : mirror.alivePositions()) {
            int label = core.networkOf(mirror.idByPos.get(pos));
            assertNotEquals(-1, label, "node " + pos + " still pending rebuild after convergence");
            byLabel.computeIfAbsent(label, key -> new TreeSet<>()).add(pos);
        }
        return new HashSet<>(byLabel.values());
    }

    private static void mutateRandomly(ChargeGraphCore core, Mirror mirror, Random random, int ops) {
        for (int op = 0; op < ops; op++) {
            List<Long> alive = mirror.alivePositions();
            int choice = random.nextInt(10);
            if (alive.size() < 2 || choice < 4) {
                mirror.addNode(core);
            } else if (choice < 8) {
                long a = alive.get(random.nextInt(alive.size()));
                long b = alive.get(random.nextInt(alive.size()));
                if (a != b) {
                    mirror.addEdge(core, a, b);
                }
            } else {
                mirror.removeNode(core, alive.get(random.nextInt(alive.size())));
            }
        }
    }

    @Test
    void incrementalPartitionMatchesScratchFloodFillOnRandomSequences() {
        for (long seed = 1; seed <= 8; seed++) {
            Random random = new Random(0x4EB1_11DL + seed);
            ChargeGraphCore core = new ChargeGraphCore();
            Mirror mirror = new Mirror();
            // Interleave mutation bursts with partial rebuilds — the mid-rebuild states
            // (re-dirtied regions, stale queue entries) are exactly what must stay correct.
            for (int burst = 0; burst < 6; burst++) {
                mutateRandomly(core, mirror, random, 40);
                core.runRebuild(1 + random.nextInt(7));
            }
            converge(core, 16, mirror.alivePositions().size());
            assertEquals(mirror.scratchComponents(), corePartition(core, mirror), "seed " + seed);
        }
    }

    @Test
    void budgetedRebuildConvergesWithBudgetOne() {
        Random random = new Random(0xC0117E46EL); // "converge"
        ChargeGraphCore core = new ChargeGraphCore();
        Mirror mirror = new Mirror();
        // A long chain, then break it in several places: worst-case single-component dirtying.
        List<Long> chain = new ArrayList<>();
        for (int n = 0; n < 120; n++) {
            chain.add(mirror.addNode(core));
        }
        for (int n = 1; n < 120; n++) {
            mirror.addEdge(core, chain.get(n - 1), chain.get(n));
        }
        converge(core, 1024, 120);
        for (int cut = 0; cut < 5; cut++) {
            mirror.removeNode(core, chain.remove(random.nextInt(chain.size())));
        }
        converge(core, 1, 120);
        Set<Set<Long>> partition = corePartition(core, mirror);
        assertEquals(mirror.scratchComponents(), partition);
        assertEquals(6, partition.size(), "5 interior cuts of a chain must yield 6 components");
    }

    @Test
    void partitionIsIdenticalAcrossBudgetSchedules() {
        // The same mutation sequence converged under budget 3 and budget 100_000 per pass must
        // induce the same partition (labels may differ; the grouping may not).
        Set<Set<Long>> reference = null;
        for (int budget : new int[]{3, 17, 100_000}) {
            Random random = new Random(0x5CEDB1EL);
            ChargeGraphCore core = new ChargeGraphCore();
            Mirror mirror = new Mirror();
            mutateRandomly(core, mirror, random, 250);
            converge(core, budget, mirror.alivePositions().size());
            Set<Set<Long>> partition = corePartition(core, mirror);
            assertEquals(mirror.scratchComponents(), partition, "budget " + budget);
            if (reference == null) {
                reference = partition;
            } else {
                assertEquals(reference, partition, "budget " + budget);
            }
        }
    }

    @Test
    void dirtyNodesReportNoNetworkUntilRelabeled() {
        ChargeGraphCore core = new ChargeGraphCore();
        Mirror mirror = new Mirror();
        long a = mirror.addNode(core);
        long b = mirror.addNode(core);
        long c = mirror.addNode(core);
        mirror.addEdge(core, a, b);
        mirror.addEdge(core, b, c);
        long versionBefore = core.topologyVersion();
        mirror.removeNode(core, b);
        assertTrue(core.topologyVersion() > versionBefore, "removal must bump topology version");
        // Survivors of the broken component are pending: networkOf must report -1, not a stale
        // (still-united) label.
        assertEquals(-1, core.networkOf(mirror.idByPos.get(a)));
        assertEquals(-1, core.networkOf(mirror.idByPos.get(c)));
        converge(core, 1024, 2);
        int labelA = core.networkOf(mirror.idByPos.get(a));
        int labelC = core.networkOf(mirror.idByPos.get(c));
        assertNotEquals(-1, labelA);
        assertNotEquals(-1, labelC);
        assertNotEquals(labelA, labelC, "split halves must land in distinct networks");
    }

    @Test
    void edgeIntoDirtyRegionReunitesBeforeConvergence() {
        // Removing a bridge dirties the component; re-adding an edge BEFORE the rebuild ran must
        // still converge to ONE component (the united region is relabeled by a single fill).
        ChargeGraphCore core = new ChargeGraphCore();
        Mirror mirror = new Mirror();
        long a = mirror.addNode(core);
        long b = mirror.addNode(core);
        long c = mirror.addNode(core);
        long d = mirror.addNode(core);
        mirror.addEdge(core, a, b);
        mirror.addEdge(core, b, c);
        mirror.addEdge(core, c, d);
        converge(core, 1024, 4);
        mirror.removeNode(core, b);
        // No rebuild yet — a, c, d are dirty. Bridge the gap now.
        mirror.addEdge(core, a, c);
        converge(core, 2, 3);
        Set<Set<Long>> partition = corePartition(core, mirror);
        assertEquals(mirror.scratchComponents(), partition);
        assertEquals(1, partition.size(), "re-bridged region must converge to one component");
    }
}
