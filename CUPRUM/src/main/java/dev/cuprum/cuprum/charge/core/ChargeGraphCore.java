package dev.cuprum.cuprum.charge.core;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Deterministic charge-graph topology + solver over dense int ids (charge.md §2a/§3/§4 with the
 * FOUNDATION_PLAN D7 override). Pure Java, ZERO Minecraft imports (plan D9) — the MC-facing
 * {@code ChargeGraphManager} owns world wiring; this class owns truth.
 *
 * <p><b>Canonical order</b> (the only iteration order the solver ever uses): ascending
 * {@code (priority.ordinal(), Long.compare(posKey))}. It is cached per topology version; hash
 * maps are never iterated directly, so results are identical across node insertion-order
 * permutations.
 *
 * <p><b>Allocator phases</b> per loaded sub-island (charge.md §3, all greedy in canonical
 * order): P0 every producer is drained its FULL offer up front (actual drained amounts form
 * per-node unplaced pools); P1 pools → consumer demands (DEFENSE first — at 50% supply DEFENSE
 * receives 100% of its request and MISC exactly 0); P2 residual pools → storages respecting
 * {@code maxInsert}; P3 unmet demand ← storages respecting {@code maxExtract} (a consumer's
 * rejected remainder becomes unplaced at the consumer); P4 all unplaced pools → surge
 * absorbers, remainder <b>vented</b> (saturating counters, never negative). Whatever the
 * network cannot place is vented by construction, so
 * {@code Σafter = Σbefore + produced − consumed − vented} holds exactly with produced = actual
 * drained and consumed = actual accepted + actual absorbed.
 *
 * <p><b>Actual-amount accounting</b> (Eval-A repair): every {@link NodeAccess} mutator returns
 * the amount actually applied and ONLY that value drives pools, budgets, relay charges and the
 * moved/vented counters. A destination that accepts less than requested never causes the source
 * to lose the difference: the remainder stays pooled and continues to the next eligible target
 * or vents exactly. Multi-role nodes are dispatched per explicit operation (drain / accept /
 * insertStorage / extractStorage / absorb) — never by delta sign — and a node never transfers
 * to itself.
 *
 * <p><b>Per-tick transfer budgets</b>: relay pass-through and surge-absorber acceptance budgets
 * are persistent arrays replenished at the START of each allocator pass ({@link #tick}); the
 * pass itself and every {@link #depositSurge} call until the next pass draw from the SAME
 * remaining budgets, so repeated same-window deposits accumulate against (and can never reset
 * or exceed) one tick's throughput. Normal storage insert/extract budgets belong to the
 * storage implementation: the graph limits each request and the returned actual amount reflects
 * the same lazy game-tick budget external API calls use.
 *
 * <p><b>Deliberate extension and diagnostic surface</b>:
 * <ul>
 *   <li>A relay node's pass-through budget and a surge absorber's per-tick absorb cap are
 *       registered through the {@code maxInsert} column of {@link #addNode} (they have no
 *       storage, so the column is otherwise unused). Relay budgets are enforced greedily along
 *       deterministic BFS shortest paths (canonical neighbor order) — exact for the chain/tree
 *       layouts every W1–W5 acceptance uses, a documented approximation on meshes; path routing
 *       is only computed when the sub-island actually contains a relay.</li>
 *   <li>{@link #diagnostics()}, {@link #ticksRun()}, {@link #isActive(int)},
 *       {@link #roleMaskOf(int)}, {@link #priorityOrdinalOf(int)}, {@link #capacityOf(int)},
 *       {@link #aliveNodeIds()} and {@link #loadedIslandMembers(int)} are the deliberate
 *       read-only surface required by the manager/diagnostics contracts (brief §2b/§6).</li>
 * </ul>
 *
 * <p><b>Freeze semantics</b> (charge.md §4): frozen ({@code setActive(false)}) nodes keep their
 * edges but are excluded from every allocator phase and from sub-island membership; their stored
 * Cg cannot change. Sub-islands are recomputed only when topology, freeze state or rebuild
 * labels actually changed — never by per-tick polling.
 *
 * <p><b>Lazy split</b> (charge.md §4): removing a node marks its former component dirty; dirty
 * nodes report {@code networkOf == -1}, do not tick, and are relabeled by a budgeted flood fill
 * ({@link #runRebuild}) with a carry-over queue.
 */
public final class ChargeGraphCore {
    private static final int NO_NETWORK = -1;

    // --- node columns (parallel arrays, dense int ids with free-list reuse) ---
    private long[] posKey = new long[16];
    private int[] roleMask = new int[16];
    private int[] priority = new int[16];
    private long[] capacity = new long[16];
    private long[] maxInsert = new long[16];
    private long[] maxExtract = new long[16];
    private boolean[] alive = new boolean[16];
    private boolean[] active = new boolean[16];
    private boolean[] dirty = new boolean[16];
    private int[] network = new int[16];
    private int[][] adjacency = new int[16][];
    private int[] adjacencyCount = new int[16];

    private int nodeArraySize;
    private int aliveCount;
    private int frozenCount;
    private int edgeCount;
    private final ArrayDeque<Integer> freeIds = new ArrayDeque<>();
    private final Map<Long, Integer> posToId = new HashMap<>();

    // --- network labels (clean nodes only; dirty nodes are pending rebuild) ---
    private int nextLabel;
    private final Map<Integer, ArrayList<Integer>> labelMembers = new HashMap<>();
    /** Rebuild queue entries: {@code (nodeId << 32) | (label & 0xFFFFFFFF)}; label -1 = seed. */
    private final ArrayDeque<Long> rebuildQueue = new ArrayDeque<>();

    // --- versions / cache epochs ---
    private long topologyVersion;
    private long structureEpoch;

    // --- canonical order cache (keyed on topologyVersion) ---
    private int[] canonicalIds = new int[0];
    private int[] canonicalRank = new int[16];
    private long canonicalCacheVersion = -1;

    // --- sub-island cache (keyed on structureEpoch) ---
    private int[] islandId = new int[16];
    private int[][] islandMembers = new int[0][];
    private int islandCount;
    private long islandCacheEpoch = -1;

    // --- diagnostics / counters (saturating) ---
    private long ticksRun;
    private long tickNanosLast;
    private long tickNanosEma;
    private long ventedLastTick;
    private long ventedTotal;
    private long movedLastTick;
    private long ventedPendingSurge;

    // --- per-tick-window transfer budgets (by node id; replenished at each tick() start,
    // shared with depositSurge until the next pass — see class javadoc) ---
    private long[] relayBudget = new long[16];
    private long[] absorbBudget = new long[16];

    // --- tick scratch (reused; zero steady-state allocation in the tick path) ---
    private long[] scratchPool = new long[0];
    private long[] scratchDemand = new long[0];
    private long[] scratchStoredView = new long[0];
    private long[] scratchInsertBudget = new long[0];
    private long[] scratchExtractBudget = new long[0];
    private int[] scratchProducers = new int[0];
    private int[] scratchConsumers = new int[0];
    private int[] scratchStorages = new int[0];
    private int[] scratchAbsorbers = new int[0];
    private int[] bfsQueue = new int[16];
    private int[] bfsPrev = new int[16];
    private int[] bfsSeen = new int[16];
    private int bfsEpoch;
    /** Relay intermediates of the last {@link #pathCap} route (charged by {@link #chargePath}). */
    private int[] pathRelays = new int[16];
    private int pathRelayCount;

    // ------------------------------------------------------------------
    // Topology
    // ------------------------------------------------------------------

    /**
     * Adds a node; returns its dense id. {@code posKey} must be unique; {@code priority} is a
     * {@link ChargePriority} ordinal; relay/absorber per-tick budgets ride in {@code maxInsert}
     * (documented adaptation). New nodes start active (loaded) in a fresh singleton network.
     */
    public int addNode(long posKeyValue, int roleMaskValue, int priorityValue, long capacityValue,
            long maxInsertValue, long maxExtractValue) {
        if (posToId.containsKey(posKeyValue)) {
            throw new IllegalArgumentException("duplicate node posKey " + posKeyValue);
        }
        if ((roleMaskValue & ~Roles.ALL) != 0) {
            throw new IllegalArgumentException("unknown role bits in mask " + roleMaskValue);
        }
        if (priorityValue < 0 || priorityValue >= ChargePriority.values().length) {
            throw new IllegalArgumentException("priority ordinal out of range: " + priorityValue);
        }
        if (capacityValue < 0 || maxInsertValue < 0 || maxExtractValue < 0) {
            throw new IllegalArgumentException("negative node limits");
        }
        int id = freeIds.isEmpty() ? nodeArraySize++ : freeIds.pop();
        ensureNodeArrays(id + 1);
        posKey[id] = posKeyValue;
        roleMask[id] = roleMaskValue;
        priority[id] = priorityValue;
        capacity[id] = capacityValue;
        maxInsert[id] = maxInsertValue;
        maxExtract[id] = maxExtractValue;
        // A node added mid-window carries its full transfer budget until the next pass resets.
        relayBudget[id] = Roles.has(roleMaskValue, Roles.RELAY) ? maxInsertValue : 0L;
        absorbBudget[id] = Roles.has(roleMaskValue, Roles.SURGE_ABSORBER) ? maxInsertValue : 0L;
        alive[id] = true;
        active[id] = true;
        dirty[id] = false;
        adjacency[id] = adjacency[id] == null ? new int[4] : adjacency[id];
        adjacencyCount[id] = 0;
        int label = nextLabel++;
        network[id] = label;
        ArrayList<Integer> members = new ArrayList<>(4);
        members.add(id);
        labelMembers.put(label, members);
        posToId.put(posKeyValue, id);
        aliveCount++;
        topologyVersion++;
        structureEpoch++;
        return id;
    }

    /**
     * Removes a node: its former component is marked dirty (lazy split) and re-seeded into the
     * budgeted rebuild queue; {@code networkOf} reports -1 for those nodes until relabeled.
     */
    public void removeNode(int nodeId) {
        checkAlive(nodeId);
        // Snapshot the affected component before mutating (clean node: its label's members;
        // dirty node: its region is already queued, only direct neighbors need re-seeding).
        List<Integer> affected;
        if (!dirty[nodeId]) {
            affected = new ArrayList<>(labelMembers.getOrDefault(network[nodeId], new ArrayList<>()));
        } else {
            affected = new ArrayList<>(adjacencyCount[nodeId]);
            for (int i = 0; i < adjacencyCount[nodeId]; i++) {
                affected.add(adjacency[nodeId][i]);
            }
        }
        // Detach edges.
        for (int i = 0; i < adjacencyCount[nodeId]; i++) {
            int neighbor = adjacency[nodeId][i];
            removeFromAdjacency(neighbor, nodeId);
            edgeCount--;
        }
        adjacencyCount[nodeId] = 0;
        // Detach node.
        if (!dirty[nodeId]) {
            removeMember(network[nodeId], nodeId);
        }
        dirty[nodeId] = false;
        alive[nodeId] = false;
        if (!active[nodeId]) {
            frozenCount--;
        }
        active[nodeId] = false;
        posToId.remove(posKey[nodeId]);
        freeIds.push(nodeId);
        aliveCount--;
        // Dirty the survivors of the former component.
        for (int member : affected) {
            if (member != nodeId && alive[member]) {
                markDirty(member);
            }
        }
        topologyVersion++;
        structureEpoch++;
    }

    /** Adds an undirected edge (deduplicated); merges or re-dirties network labels as needed. */
    public void addEdge(int a, int b) {
        checkAlive(a);
        checkAlive(b);
        if (a == b) {
            throw new IllegalArgumentException("self edge on node " + a);
        }
        if (hasEdge(a, b)) {
            return;
        }
        appendAdjacency(a, b);
        appendAdjacency(b, a);
        edgeCount++;
        if (!dirty[a] && !dirty[b]) {
            if (network[a] != network[b]) {
                mergeLabels(network[a], network[b]);
            }
        } else if (dirty[a] != dirty[b]) {
            // One side is mid-rebuild: re-dirty the clean side's component so one flood fill
            // relabels the united component (the fill only walks dirty nodes).
            int clean = dirty[a] ? b : a;
            for (int member : new ArrayList<>(labelMembers.getOrDefault(network[clean], new ArrayList<>()))) {
                if (alive[member]) {
                    markDirty(member);
                }
            }
        }
        topologyVersion++;
        structureEpoch++;
    }

    /**
     * Chunk freeze flag (charge.md §4): inactive nodes keep edges/stored but are excluded from
     * every allocator phase. Refreshed by the manager only on chunk-state changes.
     */
    public void setActive(int nodeId, boolean activeValue) {
        checkAlive(nodeId);
        if (active[nodeId] == activeValue) {
            return;
        }
        active[nodeId] = activeValue;
        frozenCount += activeValue ? -1 : 1;
        structureEpoch++;
    }

    public long topologyVersion() {
        return topologyVersion;
    }

    /** Component id, or -1 while the node's component is dirty (pending rebuild). */
    public int networkOf(int nodeId) {
        checkAlive(nodeId);
        return dirty[nodeId] ? NO_NETWORK : network[nodeId];
    }

    // ------------------------------------------------------------------
    // Budgeted rebuild (lazy split with carry-over queue)
    // ------------------------------------------------------------------

    /**
     * Processes up to {@code maxVisits} queued nodes of the lazy-split flood fill; returns the
     * carry-over depth. Every dirty node carries its own seed entry, so several fills may start
     * inside one dirty region; when two fills meet across an edge (a walked neighbor is already
     * clean under a different label) their labels are merged — one component can never converge
     * into several labels. Stale entries (removed or re-dirtied nodes) are skipped without
     * charging the budget's relabel count but still bound the loop.
     */
    public RebuildStats runRebuild(int maxVisits) {
        if (maxVisits < 0) {
            throw new IllegalArgumentException("maxVisits must be >= 0");
        }
        int visited = 0;
        int iterations = 0;
        int iterationBound = Math.max(maxVisits, maxVisits * 4);
        boolean changed = false;
        while (visited < maxVisits && iterations < iterationBound && !rebuildQueue.isEmpty()) {
            iterations++;
            long entry = rebuildQueue.poll();
            int id = (int) (entry >>> 32);
            int label = (int) entry;
            if (!alive[id]) {
                continue;
            }
            if (label == NO_NETWORK) {
                // Seed: needs a fresh label unless something already relabeled it (in which
                // case its continuation entry owns the adjacency walk).
                if (!dirty[id]) {
                    continue;
                }
                label = nextLabel++;
                assignLabel(id, label);
                changed = true;
                visited++;
            } else if (dirty[id]) {
                // Re-dirtied since enqueue: its new seed entry will reprocess it.
                continue;
            } else {
                // Continuation: walk with the CURRENT label (a merge may have replaced the
                // enqueued one) so every relabeled node's adjacency is walked exactly once.
                label = network[id];
                visited++;
            }
            for (int i = 0; i < adjacencyCount[id]; i++) {
                int neighbor = adjacency[id][i];
                if (!alive[neighbor]) {
                    continue;
                }
                if (dirty[neighbor]) {
                    assignLabel(neighbor, label);
                    changed = true;
                    rebuildQueue.add(((long) neighbor << 32) | (label & 0xFFFFFFFFL));
                } else if (network[neighbor] != label) {
                    // Two fills met across this edge: one component, merge the labels.
                    mergeLabels(label, network[neighbor]);
                    label = network[id];
                    changed = true;
                }
            }
        }
        if (changed) {
            structureEpoch++;
        }
        return new RebuildStats(visited, rebuildQueue.size());
    }

    // ------------------------------------------------------------------
    // Allocator
    // ------------------------------------------------------------------

    /**
     * One deterministic allocator pass over every loaded sub-island (charge.md §3). See the
     * class javadoc for the phase semantics, the actual-amount accounting and the conservation
     * contract. Replenishes the per-tick-window relay/absorber transfer budgets first — the
     * budgets then serve this pass AND every {@link #depositSurge} call until the next pass.
     */
    public TickReport tick(NodeAccess access) {
        long start = System.nanoTime();
        refreshCanonicalCache();
        refreshIslandCache();
        resetTransferBudgets();
        long moved = 0;
        // Surge vents since the previous tick are already inside ventedTotal (immediate, so
        // diagnostics after a mid-tick strike are truthful); they only join ventedLastTick here.
        long vented = ventedPendingSurge;
        ventedPendingSurge = 0;
        int islandsTicked = 0;
        for (int[] members : islandMembers) {
            if (members.length == 0) {
                continue;
            }
            islandsTicked++;
            moved = ChargeMath.satAdd(moved, tickIsland(members, access));
            vented = ChargeMath.satAdd(vented, lastIslandVented);
            ventedTotal = ChargeMath.satAdd(ventedTotal, lastIslandVented);
        }
        movedLastTick = moved;
        ventedLastTick = vented;
        ticksRun++;
        long nanos = System.nanoTime() - start;
        tickNanosLast = nanos;
        tickNanosEma = tickNanosEma == 0 ? nanos : (tickNanosEma * 7 + nanos) / 8;
        return new TickReport(moved, vented, islandsTicked, nanos);
    }

    /** Replenishes relay/absorber per-tick-window budgets (class javadoc: budget windows). */
    private void resetTransferBudgets() {
        for (int id = 0; id < nodeArraySize; id++) {
            if (!alive[id]) {
                continue;
            }
            relayBudget[id] = Roles.has(roleMask[id], Roles.RELAY) ? maxInsert[id] : 0L;
            absorbBudget[id] = Roles.has(roleMask[id], Roles.SURGE_ABSORBER) ? maxInsert[id] : 0L;
        }
    }

    /** Clamps a receiver-returned actual into {@code [0, requested]} (NodeAccess contract). */
    private static long clampActual(long returned, long requested) {
        return returned <= 0 ? 0L : Math.min(returned, requested);
    }

    /** Vented amount of the island processed by the last {@link #tickIsland} call. */
    private long lastIslandVented;

    private long tickIsland(int[] members, NodeAccess access) {
        int m = members.length;
        ensureScratch(m);
        boolean hasRelay = false;
        int producers = 0;
        int consumers = 0;
        int storages = 0;
        int absorbers = 0;
        for (int i = 0; i < m; i++) {
            int id = members[i];
            int mask = roleMask[id];
            scratchPool[i] = 0L;
            if (Roles.has(mask, Roles.PRODUCER)) {
                scratchProducers[producers++] = i;
            }
            if (Roles.has(mask, Roles.CONSUMER)) {
                scratchConsumers[consumers++] = i;
                scratchDemand[i] = Math.max(0L, access.demand(id));
            } else {
                scratchDemand[i] = 0L;
            }
            if (Roles.has(mask, Roles.STORAGE)) {
                scratchStorages[storages++] = i;
                scratchStoredView[i] = ChargeMath.clamp(access.stored(id), 0L, capacity[id]);
                scratchInsertBudget[i] = maxInsert[id];
                scratchExtractBudget[i] = maxExtract[id];
            } else {
                scratchStoredView[i] = 0L;
                scratchInsertBudget[i] = 0L;
                scratchExtractBudget[i] = 0L;
            }
            if (Roles.has(mask, Roles.SURGE_ABSORBER)) {
                scratchAbsorbers[absorbers++] = i;
            }
            if (Roles.has(mask, Roles.RELAY)) {
                hasRelay = true;
            }
        }
        long moved = 0;
        // P0: drain every producer's FULL offer up front; ACTUAL drained amounts form the
        // per-node unplaced pools (charge.md §3: what the network cannot place is vented).
        for (int pi = 0; pi < producers; pi++) {
            int p = scratchProducers[pi];
            int id = members[p];
            long offer = Math.max(0L, access.offer(id));
            if (offer > 0) {
                scratchPool[p] = clampActual(access.drain(id, offer), offer);
            }
        }
        // P1: pools -> consumer demands, consumers greedy in canonical order. Only the ACTUAL
        // accepted amount leaves the pool / charges the relay path.
        for (int ci = 0; ci < consumers; ci++) {
            int c = scratchConsumers[ci];
            for (int pi = 0; pi < producers && scratchDemand[c] > 0; pi++) {
                int p = scratchProducers[pi];
                if (scratchPool[p] <= 0 || p == c) {
                    continue;
                }
                long want = Math.min(scratchDemand[c], scratchPool[p]);
                long request = Math.min(want, pathCap(members[p], members[c], hasRelay));
                if (request <= 0) {
                    continue;
                }
                long accepted = clampActual(access.accept(members[c], request), request);
                if (accepted <= 0) {
                    continue;
                }
                chargePath(accepted, hasRelay);
                scratchPool[p] -= accepted;
                scratchDemand[c] -= accepted;
                moved = ChargeMath.satAdd(moved, accepted);
            }
        }
        // P2: residual pools -> storages. The scratch cap bounds graph requests; the receiving
        // storage applies the one shared graph+external normal budget and capacity, and only its
        // ACTUAL insert drives accounting.
        for (int pi = 0; pi < producers; pi++) {
            int p = scratchProducers[pi];
            for (int si = 0; si < storages && scratchPool[p] > 0; si++) {
                int s = scratchStorages[si];
                if (s == p || scratchInsertBudget[s] <= 0) {
                    continue;
                }
                long room = ChargeMath.satSub(capacity[members[s]], scratchStoredView[s]);
                long want = Math.min(scratchPool[p], Math.min(room, scratchInsertBudget[s]));
                if (want <= 0) {
                    continue;
                }
                long request = Math.min(want, pathCap(members[p], members[s], hasRelay));
                if (request <= 0) {
                    continue;
                }
                long inserted = clampActual(access.insertStorage(members[s], request), request);
                if (inserted <= 0) {
                    continue;
                }
                chargePath(inserted, hasRelay);
                scratchPool[p] -= inserted;
                scratchInsertBudget[s] -= inserted;
                scratchStoredView[s] = ChargeMath.satAdd(scratchStoredView[s], inserted);
                moved = ChargeMath.satAdd(moved, inserted);
            }
        }
        // P3: unmet demand <- storages. The scratch cap bounds graph requests; the receiving
        // storage applies the shared graph+external extract budget. A consumer's rejected
        // remainder becomes unplaced AT THE CONSUMER and continues to P4/vent.
        for (int ci = 0; ci < consumers; ci++) {
            int c = scratchConsumers[ci];
            for (int si = 0; si < storages && scratchDemand[c] > 0; si++) {
                int s = scratchStorages[si];
                if (s == c || scratchExtractBudget[s] <= 0) {
                    continue;
                }
                long avail = Math.min(scratchStoredView[s], scratchExtractBudget[s]);
                long want = Math.min(scratchDemand[c], avail);
                if (want <= 0) {
                    continue;
                }
                long request = Math.min(want, pathCap(members[s], members[c], hasRelay));
                if (request <= 0) {
                    continue;
                }
                long extracted = clampActual(access.extractStorage(members[s], request), request);
                if (extracted <= 0) {
                    continue;
                }
                chargePath(extracted, hasRelay);
                scratchStoredView[s] -= extracted;
                scratchExtractBudget[s] -= extracted;
                long accepted = clampActual(access.accept(members[c], extracted), extracted);
                scratchDemand[c] -= accepted;
                moved = ChargeMath.satAdd(moved, accepted);
                if (accepted < extracted) {
                    scratchPool[c] = ChargeMath.satAdd(scratchPool[c], extracted - accepted);
                }
            }
        }
        // P4: every unplaced pool -> surge absorbers (persistent per-window absorb budgets,
        // ACTUAL absorbed only); whatever remains is vented.
        long ventedIsland = 0;
        for (int i = 0; i < m; i++) {
            if (scratchPool[i] <= 0) {
                continue;
            }
            for (int ai = 0; ai < absorbers && scratchPool[i] > 0; ai++) {
                int a = scratchAbsorbers[ai];
                int absorberId = members[a];
                if (a == i || absorbBudget[absorberId] <= 0) {
                    continue;
                }
                long want = Math.min(scratchPool[i], absorbBudget[absorberId]);
                long request = Math.min(want, pathCap(members[i], absorberId, hasRelay));
                if (request <= 0) {
                    continue;
                }
                long absorbed = clampActual(access.absorb(absorberId, request), request);
                if (absorbed <= 0) {
                    continue;
                }
                chargePath(absorbed, hasRelay);
                scratchPool[i] -= absorbed;
                absorbBudget[absorberId] -= absorbed;
                moved = ChargeMath.satAdd(moved, absorbed);
            }
            ventedIsland = ChargeMath.satAdd(ventedIsland, scratchPool[i]);
            scratchPool[i] = 0L;
        }
        lastIslandVented = ventedIsland;
        return moved;
    }

    /**
     * Relay throughput enforcement (documented approximation, charge.md §3): computes the
     * deterministic BFS shortest path from {@code from} to {@code to} (canonical-rank neighbor
     * order; traversal THROUGH an exhausted relay is blocked, endpoints are exempt) and returns
     * the transferable cap = the smallest remaining relay budget among the path's intermediates
     * ({@link Long#MAX_VALUE} when the path has none), remembering the path's relays for
     * {@link #chargePath}. Returns 0 when no traversable path exists. Graphs without relays
     * skip routing entirely. Budgets are the persistent per-tick-window arrays, so allocator
     * phases and same-window surge deposits share one cumulative budget.
     */
    private long pathCap(int from, int to, boolean hasRelay) {
        if (!hasRelay) {
            pathRelayCount = 0;
            return Long.MAX_VALUE;
        }
        advanceBfsEpoch();
        int head = 0;
        int tail = 0;
        bfsQueue[tail++] = from;
        bfsSeen[from] = bfsEpoch;
        bfsPrev[from] = -1;
        boolean found = from == to;
        while (head < tail && !found) {
            int current = bfsQueue[head++];
            // Traversal THROUGH an exhausted relay is blocked (endpoints are exempt).
            if (current != from && Roles.has(roleMask[current], Roles.RELAY)
                    && relayBudget[current] <= 0) {
                continue;
            }
            // Deterministic neighbor order: canonical rank ascending (count <= 6 in MC).
            int count = adjacencyCount[current];
            int[] neighbors = adjacency[current];
            for (int pass = 0; pass < count && !found; pass++) {
                int best = -1;
                int bestRank = Integer.MAX_VALUE;
                for (int i = 0; i < count; i++) {
                    int candidate = neighbors[i];
                    if (!alive[candidate] || bfsSeen[candidate] == bfsEpoch) {
                        continue;
                    }
                    if (!active[candidate] || dirty[candidate]) {
                        continue;
                    }
                    int rank = canonicalRank[candidate];
                    if (rank < bestRank) {
                        bestRank = rank;
                        best = candidate;
                    }
                }
                if (best == -1) {
                    break;
                }
                bfsSeen[best] = bfsEpoch;
                bfsPrev[best] = current;
                bfsQueue[tail++] = best;
                if (best == to) {
                    found = true;
                }
            }
        }
        if (!found) {
            pathRelayCount = 0;
            return 0L;
        }
        // Walk the path backwards, remembering relay intermediates and their min budget.
        pathRelayCount = 0;
        long minBudget = Long.MAX_VALUE;
        for (int n = bfsPrev[to]; n != -1 && n != from; n = bfsPrev[n]) {
            if (Roles.has(roleMask[n], Roles.RELAY)) {
                pathRelays[pathRelayCount++] = n;
                minBudget = Math.min(minBudget, relayBudget[n]);
            }
        }
        return minBudget;
    }

    /**
     * Advances the BFS visitation stamp without ever using zero or a negative epoch. Clearing
     * at rollover prevents both the zero-initialized-slot collision and eventual stale-stamp
     * reuse after the int range is exhausted.
     */
    private void advanceBfsEpoch() {
        if (bfsEpoch <= 0 || bfsEpoch == Integer.MAX_VALUE) {
            Arrays.fill(bfsSeen, 0);
            bfsEpoch = 1;
        } else {
            bfsEpoch++;
        }
    }

    /** Charges the {@link #pathCap}-remembered relays with the ACTUAL transferred amount. */
    private void chargePath(long actual, boolean hasRelay) {
        if (!hasRelay || actual <= 0) {
            return;
        }
        for (int i = 0; i < pathRelayCount; i++) {
            relayBudget[pathRelays[i]] -= actual;
        }
        pathRelayCount = 0;
    }

    // ------------------------------------------------------------------
    // Surge
    // ------------------------------------------------------------------

    /**
     * Deposits a surge (e.g. a 270,000 Cg strike) at a node: fills the node's own storage first
     * (bypassing normal insert caps but never capacity, charge.md §3 surge rule — the ACTUAL
     * {@link NodeAccess#insertSurgeStorage} return drives the accounting), then feeds surge absorbers
     * in the node's loaded sub-island in canonical order. Each absorber feed is limited by the
     * absorber's remaining per-tick-window budget AND the relay throughput along the
     * deterministic path from the deposit node ({@link #pathCap}); only the ACTUAL
     * {@link NodeAccess#absorb} return is charged/subtracted, and a rejected remainder continues
     * to the next eligible absorber. Whatever nothing accepts is vented EXACTLY (counted into
     * {@code ventedTotal} immediately). Returns the accepted amount (stored + absorbed).
     *
     * <p><b>Tick-boundary semantics</b> (class javadoc: budget windows): relay/absorber budgets
     * are replenished at the start of each allocator pass. A surge landing between passes draws
     * on whatever the just-finished pass (and earlier same-window deposits) left, so repeated
     * deposits within one window are cumulative and can never exceed one tick's throughput; the
     * next pass starts a fresh window. Frozen or rebuild-pending nodes accept nothing and vent
     * nothing.
     */
    public long depositSurge(int nodeId, long amountCg, NodeAccess access) {
        checkAlive(nodeId);
        if (amountCg <= 0) {
            return 0L;
        }
        if (!active[nodeId] || dirty[nodeId]) {
            return 0L;
        }
        refreshCanonicalCache();
        refreshIslandCache();
        long remaining = amountCg;
        long accepted = 0;
        if (Roles.has(roleMask[nodeId], Roles.STORAGE)) {
            long put = clampActual(access.insertSurgeStorage(nodeId, remaining), remaining);
            accepted += put;
            remaining -= put;
        }
        if (remaining > 0) {
            int[] members = islandMembers[islandId[nodeId]];
            boolean hasRelay = false;
            for (int member : members) {
                if (Roles.has(roleMask[member], Roles.RELAY)) {
                    hasRelay = true;
                    break;
                }
            }
            for (int member : members) {
                if (remaining <= 0) {
                    break;
                }
                if (member == nodeId || !Roles.has(roleMask[member], Roles.SURGE_ABSORBER)) {
                    continue;
                }
                if (absorbBudget[member] <= 0) {
                    continue;
                }
                long want = Math.min(remaining, absorbBudget[member]);
                long request = Math.min(want, pathCap(nodeId, member, hasRelay));
                if (request <= 0) {
                    continue;
                }
                long absorbed = clampActual(access.absorb(member, request), request);
                if (absorbed <= 0) {
                    continue;
                }
                chargePath(absorbed, hasRelay);
                absorbBudget[member] -= absorbed;
                accepted += absorbed;
                remaining -= absorbed;
            }
        }
        if (remaining > 0) {
            ventedTotal = ChargeMath.satAdd(ventedTotal, remaining);
            ventedPendingSurge = ChargeMath.satAdd(ventedPendingSurge, remaining);
        }
        return accepted;
    }

    // ------------------------------------------------------------------
    // Diagnostics and read-only queries
    // ------------------------------------------------------------------

    public GraphDiagnosticsSnapshot diagnostics() {
        return new GraphDiagnosticsSnapshot(aliveCount, edgeCount, labelMembers.size(), frozenCount,
                topologyVersion, tickNanosLast, tickNanosEma, ventedLastTick, ventedTotal,
                movedLastTick, rebuildQueue.size());
    }

    /** Total allocator passes run — the anchor for exact-tick GameTests. */
    public long ticksRun() {
        return ticksRun;
    }

    /*
     * Deliberate internal read-only W1B surface. These methods are public only because the
     * Minecraft-facing ChargeGraphManager lives in the sibling charge package; callers receive
     * values or defensive copies and cannot mutate graph state through them.
     */

    /**
     * Returns the live node's chunk/BE active flag. A rebuild-pending node can be active while
     * still excluded from allocation until its dirty component is relabeled.
     */
    public boolean isActive(int nodeId) {
        checkAlive(nodeId);
        return active[nodeId];
    }

    /** Returns the exact registered {@link Roles} bitmask for the live {@code nodeId}. */
    public int roleMaskOf(int nodeId) {
        checkAlive(nodeId);
        return roleMask[nodeId];
    }

    /** Returns the registered {@link ChargePriority} ordinal for the live {@code nodeId}. */
    public int priorityOrdinalOf(int nodeId) {
        checkAlive(nodeId);
        return priority[nodeId];
    }

    /** Returns the registered non-negative storage capacity for the live {@code nodeId}. */
    public long capacityOf(int nodeId) {
        checkAlive(nodeId);
        return capacity[nodeId];
    }

    /** Returns all live node ids in canonical order as a defensive copy. */
    public int[] aliveNodeIds() {
        refreshCanonicalCache();
        return canonicalIds.clone();
    }

    /**
     * The loaded sub-island members (canonical order, copy) around {@code nodeId}, or an empty
     * array when the node is frozen or pending rebuild. Diagnostics only (NodeReport's
     * networkStored/networkCapacity are computed over LOADED members only).
     */
    public int[] loadedIslandMembers(int nodeId) {
        checkAlive(nodeId);
        if (!active[nodeId] || dirty[nodeId]) {
            return new int[0];
        }
        refreshCanonicalCache();
        refreshIslandCache();
        return islandMembers[islandId[nodeId]].clone();
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private void checkAlive(int nodeId) {
        if (nodeId < 0 || nodeId >= nodeArraySize || !alive[nodeId]) {
            throw new IllegalArgumentException("no such node id " + nodeId);
        }
    }

    private void ensureNodeArrays(int size) {
        if (size <= posKey.length) {
            return;
        }
        int newSize = Math.max(size, posKey.length * 2);
        posKey = Arrays.copyOf(posKey, newSize);
        roleMask = Arrays.copyOf(roleMask, newSize);
        priority = Arrays.copyOf(priority, newSize);
        capacity = Arrays.copyOf(capacity, newSize);
        maxInsert = Arrays.copyOf(maxInsert, newSize);
        maxExtract = Arrays.copyOf(maxExtract, newSize);
        alive = Arrays.copyOf(alive, newSize);
        active = Arrays.copyOf(active, newSize);
        dirty = Arrays.copyOf(dirty, newSize);
        network = Arrays.copyOf(network, newSize);
        adjacency = Arrays.copyOf(adjacency, newSize);
        adjacencyCount = Arrays.copyOf(adjacencyCount, newSize);
        canonicalRank = Arrays.copyOf(canonicalRank, newSize);
        islandId = Arrays.copyOf(islandId, newSize);
        relayBudget = Arrays.copyOf(relayBudget, newSize);
        absorbBudget = Arrays.copyOf(absorbBudget, newSize);
        bfsQueue = Arrays.copyOf(bfsQueue, newSize);
        bfsPrev = Arrays.copyOf(bfsPrev, newSize);
        bfsSeen = Arrays.copyOf(bfsSeen, newSize);
        pathRelays = Arrays.copyOf(pathRelays, newSize);
    }

    private void ensureScratch(int size) {
        if (size <= scratchPool.length) {
            return;
        }
        int newSize = Math.max(size, Math.max(16, scratchPool.length * 2));
        scratchPool = new long[newSize];
        scratchDemand = new long[newSize];
        scratchStoredView = new long[newSize];
        scratchInsertBudget = new long[newSize];
        scratchExtractBudget = new long[newSize];
        scratchProducers = new int[newSize];
        scratchConsumers = new int[newSize];
        scratchStorages = new int[newSize];
        scratchAbsorbers = new int[newSize];
    }

    private boolean hasEdge(int a, int b) {
        for (int i = 0; i < adjacencyCount[a]; i++) {
            if (adjacency[a][i] == b) {
                return true;
            }
        }
        return false;
    }

    private void appendAdjacency(int node, int neighbor) {
        if (adjacencyCount[node] == adjacency[node].length) {
            adjacency[node] = Arrays.copyOf(adjacency[node], adjacency[node].length * 2);
        }
        adjacency[node][adjacencyCount[node]++] = neighbor;
    }

    private void removeFromAdjacency(int node, int neighbor) {
        int count = adjacencyCount[node];
        for (int i = 0; i < count; i++) {
            if (adjacency[node][i] == neighbor) {
                adjacency[node][i] = adjacency[node][count - 1];
                adjacencyCount[node] = count - 1;
                return;
            }
        }
    }

    /** Merges the smaller member list into the larger one's label. */
    private void mergeLabels(int labelA, int labelB) {
        ArrayList<Integer> membersA = labelMembers.get(labelA);
        ArrayList<Integer> membersB = labelMembers.get(labelB);
        int keep = membersA.size() >= membersB.size() ? labelA : labelB;
        int drop = keep == labelA ? labelB : labelA;
        ArrayList<Integer> dropped = labelMembers.remove(drop);
        ArrayList<Integer> kept = labelMembers.get(keep);
        for (int member : dropped) {
            network[member] = keep;
            kept.add(member);
        }
    }

    private void removeMember(int label, int nodeId) {
        ArrayList<Integer> members = labelMembers.get(label);
        if (members != null) {
            members.remove(Integer.valueOf(nodeId));
            if (members.isEmpty()) {
                labelMembers.remove(label);
            }
        }
    }

    private void markDirty(int nodeId) {
        if (dirty[nodeId]) {
            return;
        }
        removeMember(network[nodeId], nodeId);
        dirty[nodeId] = true;
        rebuildQueue.add(((long) nodeId << 32) | (NO_NETWORK & 0xFFFFFFFFL));
    }

    private void assignLabel(int nodeId, int label) {
        dirty[nodeId] = false;
        network[nodeId] = label;
        labelMembers.computeIfAbsent(label, key -> new ArrayList<>()).add(nodeId);
    }

    private void refreshCanonicalCache() {
        if (canonicalCacheVersion == topologyVersion) {
            return;
        }
        Integer[] ids = new Integer[aliveCount];
        int n = 0;
        for (int id = 0; id < nodeArraySize; id++) {
            if (alive[id]) {
                ids[n++] = id;
            }
        }
        Arrays.sort(ids, (x, y) -> {
            int byPriority = Integer.compare(priority[x], priority[y]);
            return byPriority != 0 ? byPriority : Long.compare(posKey[x], posKey[y]);
        });
        canonicalIds = new int[n];
        for (int i = 0; i < n; i++) {
            canonicalIds[i] = ids[i];
            canonicalRank[ids[i]] = i;
        }
        canonicalCacheVersion = topologyVersion;
    }

    private void refreshIslandCache() {
        if (islandCacheEpoch == structureEpoch) {
            return;
        }
        refreshCanonicalCache();
        // Pass 1: label islands over alive && active && !dirty nodes (BFS via the shared queue).
        islandCount = 0;
        for (int id = 0; id < nodeArraySize; id++) {
            islandId[id] = -1;
        }
        for (int seed : canonicalIds) {
            if (!active[seed] || dirty[seed] || islandId[seed] != -1) {
                continue;
            }
            int island = islandCount++;
            int head = 0;
            int tail = 0;
            bfsQueue[tail++] = seed;
            islandId[seed] = island;
            while (head < tail) {
                int current = bfsQueue[head++];
                for (int i = 0; i < adjacencyCount[current]; i++) {
                    int neighbor = adjacency[current][i];
                    if (alive[neighbor] && active[neighbor] && !dirty[neighbor] && islandId[neighbor] == -1) {
                        islandId[neighbor] = island;
                        bfsQueue[tail++] = neighbor;
                    }
                }
            }
        }
        // Pass 2: collect members in canonical order.
        int[] sizes = new int[islandCount];
        for (int id : canonicalIds) {
            if (islandId[id] != -1) {
                sizes[islandId[id]]++;
            }
        }
        islandMembers = new int[islandCount][];
        for (int i = 0; i < islandCount; i++) {
            islandMembers[i] = new int[sizes[i]];
            sizes[i] = 0;
        }
        for (int id : canonicalIds) {
            int island = islandId[id];
            if (island != -1) {
                islandMembers[island][sizes[island]++] = id;
            }
        }
        islandCacheEpoch = structureEpoch;
    }
}
