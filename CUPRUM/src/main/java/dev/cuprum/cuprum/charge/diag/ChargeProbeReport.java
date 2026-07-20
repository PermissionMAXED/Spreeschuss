package dev.cuprum.cuprum.charge.diag;

import dev.cuprum.cuprum.charge.NodeReport;
import dev.cuprum.cuprum.charge.core.ChargeMath;
import dev.cuprum.cuprum.charge.core.ChargePriority;
import java.util.List;

/**
 * Pure formatting of a {@link NodeReport} into the ONE stable diagnostic line (charge.md §7)
 * shared by the Charge Probe and {@code /cuprum cg node} — server code and tests assert the
 * same string, so the format is pinned by unit test and must not drift:
 *
 * <pre>Cg node @ &lt;x&gt;,&lt;y&gt;,&lt;z&gt;: stored=&lt;stored&gt;/&lt;capacity&gt; Cg net=&lt;networkId&gt; frozen=&lt;frozen&gt; roles=&lt;roleMask&gt; prio=&lt;priority&gt; topo=&lt;topologyVersion&gt;</pre>
 *
 * <p>Also hosts the {@code /cuprum cg networks} per-network summary line so the saturating
 * total arithmetic (Eval-A repair: diagnostic stored/capacity totals must never wrap) is a
 * pure, unit-testable helper.
 *
 * <p>The {@link NodeReport}-taking entry points are one-line adapters over MC-free primitive
 * overloads (plan D9): {@code src/test} pins the exact line text and the saturating totals
 * without importing any Minecraft class, and the {@code cgProbeReportsNode} GameTest covers the
 * adapter path end to end.
 */
public final class ChargeProbeReport {
    private ChargeProbeReport() {
    }

    public static String format(NodeReport report) {
        return format(report.pos().getX(), report.pos().getY(), report.pos().getZ(),
                report.stored(), report.capacity(), report.networkId(), report.frozen(),
                report.roleMask(), report.priority(), report.topologyVersion());
    }

    /** MC-free formatting core (plan D9): the exact pinned line, unit-tested in {@code src/test}. */
    public static String format(int x, int y, int z, long stored, long capacity, int networkId,
            boolean frozen, int roleMask, ChargePriority priority, long topologyVersion) {
        return "Cg node @ " + x + "," + y + "," + z
                + ": stored=" + stored + "/" + capacity
                + " Cg net=" + networkId
                + " frozen=" + frozen
                + " roles=" + roleMask
                + " prio=" + priority.name()
                + " topo=" + topologyVersion;
    }

    /**
     * The {@code /cuprum cg networks} summary line for one network: stored/capacity totals use
     * {@link ChargeMath#satAdd} (never wrapping, saturating at {@link Long#MAX_VALUE}).
     */
    public static String summarizeNetwork(int networkId, List<NodeReport> reports) {
        int count = reports.size();
        long[] stored = new long[count];
        long[] capacity = new long[count];
        boolean[] frozen = new boolean[count];
        for (int i = 0; i < count; i++) {
            NodeReport report = reports.get(i);
            stored[i] = report.stored();
            capacity[i] = report.capacity();
            frozen[i] = report.frozen();
        }
        return summarizeNetwork(networkId, stored, capacity, frozen);
    }

    /**
     * MC-free accumulation core (plan D9) over parallel per-node columns; the saturating-total
     * behavior is unit-pinned in {@code src/test}. Arrays must be equal length.
     */
    public static String summarizeNetwork(int networkId, long[] storedByNode, long[] capacityByNode,
            boolean[] frozenByNode) {
        if (storedByNode.length != capacityByNode.length || storedByNode.length != frozenByNode.length) {
            throw new IllegalArgumentException("parallel node columns must be equal length: "
                    + storedByNode.length + "/" + capacityByNode.length + "/" + frozenByNode.length);
        }
        long stored = 0L;
        long capacity = 0L;
        int frozen = 0;
        for (int i = 0; i < storedByNode.length; i++) {
            stored = ChargeMath.satAdd(stored, storedByNode[i]);
            capacity = ChargeMath.satAdd(capacity, capacityByNode[i]);
            if (frozenByNode[i]) {
                frozen++;
            }
        }
        return "Cg net=" + networkId + ": nodes=" + storedByNode.length
                + " frozen=" + frozen
                + " stored=" + stored + "/" + capacity + " Cg";
    }
}
