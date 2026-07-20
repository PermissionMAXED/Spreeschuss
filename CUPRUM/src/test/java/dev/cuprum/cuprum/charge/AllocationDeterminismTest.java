package dev.cuprum.cuprum.charge;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Insertion-order determinism (charge.md §3): the allocator's canonical order is
 * {@code (priority.ordinal(), posKey)} — NEVER hash-iteration order — so building the same
 * logical graph under arbitrary node/edge insertion permutations must produce bit-identical
 * per-node outcomes tick after tick. Seeds fixed.
 */
class AllocationDeterminismTest {
    /** One logical node blueprint, keyed by posKey (identical across permutations). */
    private record Blueprint(long posKey, int kind, int priority, long a, long b, long c) {
    }

    private static List<Blueprint> blueprint(Random random, int nodeCount) {
        List<Blueprint> nodes = new ArrayList<>();
        for (int n = 0; n < nodeCount; n++) {
            nodes.add(new Blueprint(1_000L + n, random.nextInt(4), random.nextInt(3),
                    50L + random.nextInt(500), 100L + random.nextInt(400), 100L + random.nextInt(400)));
        }
        return nodes;
    }

    private static List<long[]> edges(Random random, List<Blueprint> nodes) {
        List<long[]> edges = new ArrayList<>();
        for (int n = 1; n < nodes.size(); n++) {
            edges.add(new long[]{nodes.get(n).posKey(), nodes.get(random.nextInt(n)).posKey()});
        }
        for (int extra = 0; extra < nodes.size(); extra++) {
            int a = random.nextInt(nodes.size());
            int b = random.nextInt(nodes.size());
            if (a != b) {
                edges.add(new long[]{nodes.get(a).posKey(), nodes.get(b).posKey()});
            }
        }
        return edges;
    }

    /** Builds the blueprint under the given permutation and runs {@code ticks} passes. */
    private static Map<Long, long[]> run(List<Blueprint> nodes, List<long[]> edges,
            List<Integer> nodeOrder, List<Integer> edgeOrder, int ticks) {
        TestGraph graph = new TestGraph();
        Map<Long, Integer> idByPos = new HashMap<>();
        for (int index : nodeOrder) {
            Blueprint node = nodes.get(index);
            int id = switch (node.kind()) {
                case 0 -> graph.addProducer(node.posKey(), node.priority(), node.a());
                case 1 -> graph.addConsumer(node.posKey(), node.priority(), node.a());
                case 2 -> graph.addStorage(node.posKey(), node.priority(), node.a() * 20L, node.b(), node.c());
                default -> graph.addAbsorber(node.posKey(), node.priority(), node.a());
            };
            idByPos.put(node.posKey(), id);
        }
        for (int index : edgeOrder) {
            long[] edge = edges.get(index);
            graph.core.addEdge(idByPos.get(edge[0]), idByPos.get(edge[1]));
        }
        for (int tick = 0; tick < ticks; tick++) {
            graph.core.tick(graph.access);
        }
        Map<Long, long[]> outcome = new HashMap<>();
        for (Blueprint node : nodes) {
            TestGraph.TestNode state = graph.nodes.get(idByPos.get(node.posKey()));
            outcome.put(node.posKey(), new long[]{
                    state.buffer != null ? state.buffer.stored() : 0L,
                    state.totalDrained, state.totalReceived, state.totalAbsorbed});
        }
        return outcome;
    }

    @Test
    void insertionOrderPermutationsProduceIdenticalOutcomes() {
        Random random = new Random(0xD00D_01L);
        for (int trial = 0; trial < 10; trial++) {
            List<Blueprint> nodes = blueprint(random, 4 + random.nextInt(14));
            List<long[]> edges = edges(random, nodes);
            List<Integer> nodeOrder = new ArrayList<>();
            for (int n = 0; n < nodes.size(); n++) {
                nodeOrder.add(n);
            }
            List<Integer> edgeOrder = new ArrayList<>();
            for (int e = 0; e < edges.size(); e++) {
                edgeOrder.add(e);
            }
            Map<Long, long[]> reference = run(nodes, edges, nodeOrder, edgeOrder, 25);
            for (int permutation = 0; permutation < 5; permutation++) {
                Collections.shuffle(nodeOrder, new Random(trial * 100L + permutation));
                Collections.shuffle(edgeOrder, new Random(trial * 100L + permutation + 50));
                Map<Long, long[]> permuted = run(nodes, edges, nodeOrder, edgeOrder, 25);
                for (Blueprint node : nodes) {
                    long[] expected = reference.get(node.posKey());
                    long[] actual = permuted.get(node.posKey());
                    for (int i = 0; i < expected.length; i++) {
                        assertEquals(expected[i], actual[i],
                                "trial " + trial + " permutation " + permutation
                                        + " posKey " + node.posKey() + " field " + i);
                    }
                }
            }
        }
    }

    @Test
    void repeatedRunsOnOneGraphAreExactlyReproducible() {
        // Two independent graphs built identically must evolve identically for many ticks.
        Random seedA = new Random(0xD00D_02L);
        Random seedB = new Random(0xD00D_02L);
        List<Blueprint> nodesA = blueprint(seedA, 12);
        List<Blueprint> nodesB = blueprint(seedB, 12);
        List<long[]> edgesA = edges(seedA, nodesA);
        List<long[]> edgesB = edges(seedB, nodesB);
        List<Integer> order = new ArrayList<>();
        for (int n = 0; n < 12; n++) {
            order.add(n);
        }
        List<Integer> edgeOrder = new ArrayList<>();
        for (int e = 0; e < edgesA.size(); e++) {
            edgeOrder.add(e);
        }
        Map<Long, long[]> runA = run(nodesA, edgesA, order, edgeOrder, 100);
        Map<Long, long[]> runB = run(nodesB, edgesB, order, edgeOrder, 100);
        assertEquals(runA.keySet(), runB.keySet());
        for (Map.Entry<Long, long[]> entry : runA.entrySet()) {
            long[] expected = entry.getValue();
            long[] actual = runB.get(entry.getKey());
            for (int i = 0; i < expected.length; i++) {
                assertEquals(expected[i], actual[i], "posKey " + entry.getKey() + " field " + i);
            }
        }
    }
}
