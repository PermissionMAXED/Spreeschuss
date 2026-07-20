package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.ChargeBuffer;
import dev.cuprum.cuprum.charge.core.ChargeGraphCore;
import dev.cuprum.cuprum.charge.core.ChargeMath;
import dev.cuprum.cuprum.charge.core.NodeAccess;
import dev.cuprum.cuprum.charge.core.Roles;
import java.util.HashMap;
import java.util.Map;

/**
 * Pure-Java test fixture: a {@link ChargeGraphCore} wired to synthetic nodes through the same
 * phase-specific {@link NodeAccess} dispatch the MC manager uses (drain / accept /
 * insertStorage / extractStorage / absorb — one explicit operation per role-flow, actual
 * applied amounts returned). Storage nodes run on REAL {@link ChargeBuffer}s so the buffer
 * clamp authority is part of every allocation test. Supports MULTI-ROLE nodes and
 * partial/zero-acceptance consumers/absorbers for the Eval-A conservation repairs.
 */
final class TestGraph {
    final ChargeGraphCore core = new ChargeGraphCore();
    final Map<Integer, TestNode> nodes = new HashMap<>();

    static final class TestNode {
        int roleMask;
        long offerPerTick;
        long remaining = Long.MAX_VALUE;
        long demandPerTick;
        ChargeBuffer buffer;
        long totalDrained;
        long totalReceived;
        long totalAbsorbed;
        /** Per-call consumer acceptance cap (partial/zero acceptance tests); MAX = accept all. */
        long acceptPerCallLimit = Long.MAX_VALUE;
        /** Per-call absorber acceptance cap (partial/zero acceptance tests); MAX = absorb all. */
        long absorbPerCallLimit = Long.MAX_VALUE;
    }

    final NodeAccess access = new NodeAccess() {
        @Override
        public long offer(int nodeId) {
            TestNode node = nodes.get(nodeId);
            return Roles.has(node.roleMask, Roles.PRODUCER) ? Math.min(node.offerPerTick, node.remaining) : 0L;
        }

        @Override
        public long demand(int nodeId) {
            TestNode node = nodes.get(nodeId);
            return Roles.has(node.roleMask, Roles.CONSUMER) ? node.demandPerTick : 0L;
        }

        @Override
        public long stored(int nodeId) {
            TestNode node = nodes.get(nodeId);
            return node.buffer != null ? node.buffer.stored() : 0L;
        }

        @Override
        public long drain(int nodeId, long amountCg) {
            TestNode node = nodes.get(nodeId);
            if (!Roles.has(node.roleMask, Roles.PRODUCER)) {
                return 0L;
            }
            long drained = Math.max(0L, Math.min(amountCg, node.remaining));
            node.remaining -= drained;
            node.totalDrained = ChargeMath.satAdd(node.totalDrained, drained);
            return drained;
        }

        @Override
        public long accept(int nodeId, long amountCg) {
            TestNode node = nodes.get(nodeId);
            if (!Roles.has(node.roleMask, Roles.CONSUMER)) {
                return 0L;
            }
            long accepted = Math.max(0L, Math.min(amountCg, node.acceptPerCallLimit));
            node.totalReceived = ChargeMath.satAdd(node.totalReceived, accepted);
            return accepted;
        }

        @Override
        public long insertStorage(int nodeId, long amountCg) {
            TestNode node = nodes.get(nodeId);
            if (node.buffer == null) {
                return 0L;
            }
            node.buffer.beginGameTick(core.ticksRun());
            return node.buffer.insert(amountCg, false);
        }

        @Override
        public long extractStorage(int nodeId, long amountCg) {
            TestNode node = nodes.get(nodeId);
            if (node.buffer == null) {
                return 0L;
            }
            node.buffer.beginGameTick(core.ticksRun());
            return node.buffer.extract(amountCg, false);
        }

        @Override
        public long insertSurgeStorage(int nodeId, long amountCg) {
            TestNode node = nodes.get(nodeId);
            return node.buffer != null ? node.buffer.depositSurge(amountCg) : 0L;
        }

        @Override
        public long absorb(int nodeId, long amountCg) {
            TestNode node = nodes.get(nodeId);
            if (!Roles.has(node.roleMask, Roles.SURGE_ABSORBER)) {
                return 0L;
            }
            long absorbed = Math.max(0L, Math.min(amountCg, node.absorbPerCallLimit));
            node.totalAbsorbed = ChargeMath.satAdd(node.totalAbsorbed, absorbed);
            return absorbed;
        }
    };

    /** Generic (multi-role capable) node: a buffer is attached iff the STORAGE role is set. */
    int addNode(long posKey, int roleMask, int priority, long capacity, long maxInsert, long maxExtract) {
        int id = core.addNode(posKey, roleMask, priority, capacity, maxInsert, maxExtract);
        TestNode node = new TestNode();
        node.roleMask = roleMask;
        if (Roles.has(roleMask, Roles.STORAGE)) {
            node.buffer = new ChargeBuffer(capacity, maxInsert, maxExtract);
        }
        nodes.put(id, node);
        return id;
    }

    int addProducer(long posKey, int priority, long offerPerTick) {
        int id = addNode(posKey, Roles.PRODUCER, priority, 0L, 0L, 0L);
        nodes.get(id).offerPerTick = offerPerTick;
        return id;
    }

    int addConsumer(long posKey, int priority, long demandPerTick) {
        int id = addNode(posKey, Roles.CONSUMER, priority, 0L, 0L, 0L);
        nodes.get(id).demandPerTick = demandPerTick;
        return id;
    }

    int addStorage(long posKey, int priority, long capacity, long maxInsert, long maxExtract) {
        return addNode(posKey, Roles.STORAGE, priority, capacity, maxInsert, maxExtract);
    }

    int addRelay(long posKey, int priority, long throughputPerTick) {
        return addNode(posKey, Roles.RELAY, priority, 0L, throughputPerTick, 0L);
    }

    int addAbsorber(long posKey, int priority, long absorbCapPerTick) {
        return addNode(posKey, Roles.SURGE_ABSORBER, priority, 0L, absorbCapPerTick, 0L);
    }

    void removeNode(int nodeId) {
        core.removeNode(nodeId);
        nodes.remove(nodeId);
    }

    long storedSum() {
        long sum = 0;
        for (TestNode node : nodes.values()) {
            if (node.buffer != null) {
                sum = ChargeMath.satAdd(sum, node.buffer.stored());
            }
        }
        return sum;
    }

    long drainedSum() {
        long sum = 0;
        for (TestNode node : nodes.values()) {
            sum = ChargeMath.satAdd(sum, node.totalDrained);
        }
        return sum;
    }

    long receivedSum() {
        long sum = 0;
        for (TestNode node : nodes.values()) {
            sum = ChargeMath.satAdd(sum, ChargeMath.satAdd(node.totalReceived, node.totalAbsorbed));
        }
        return sum;
    }
}
