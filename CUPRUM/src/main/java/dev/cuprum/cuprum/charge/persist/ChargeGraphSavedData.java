package dev.cuprum.cuprum.charge.persist;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import dev.cuprum.cuprum.charge.core.ChargePriority;
import dev.cuprum.cuprum.charge.core.Roles;
import dev.cuprum.cuprum.state.CuprumSavedData;
import dev.cuprum.cuprum.state.CuprumSchema;
import dev.cuprum.cuprum.state.StateMigrations;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import net.minecraft.world.level.saveddata.SavedDataType;

/**
 * Per-dimension charge-graph SavedData (charge.md §5 with the plan D1/D5 overrides; id ledger
 * {@code cuprum_charge_graph}). Authoritative ONLY for topology-level records and the
 * {@code vented_total} counter plus a read-only {@code lastKnownStored} diagnostics shadow — a
 * node's stored Cg lives in exactly one place, its BlockEntity NBT. This class NEVER writes
 * charge back into a loaded BE: on BE load the BE value wins unconditionally and the shadow is
 * refreshed from it (no-duplication rule).
 *
 * <p>The codec body deliberately does NOT declare {@code schema_version}: the W1A
 * {@link CuprumSavedData#versionedCodec} envelope owns that field (stamping it on encode and
 * dispatching migrations on decode). {@code SavedDataType}'s DataFixTypes is {@code null} per
 * plan D1 — never an unrelated vanilla fixer; Fabric's object-builder mixin no-ops the update.
 */
public final class ChargeGraphSavedData extends CuprumSavedData {
    public static final String ID = "cuprum_charge_graph";

    static {
        // Schema 0 used the same body fields without validated records. The v0 -> v1 migration
        // is structurally an identity; the v1 constructor below performs canonical repair.
        StateMigrations.register(ID, 0, dynamic -> dynamic);
    }

    /** One persisted topology record ({@code posKey} = {@code BlockPos.asLong()}). */
    public record NodeRecord(long posKey, int roleMask, int priority, long lastKnownStored) {
        private static final Codec<NodeRecord> CODEC = RecordCodecBuilder.create(instance -> instance.group(
                Codec.LONG.fieldOf("posKey").forGetter(NodeRecord::posKey),
                Codec.INT.fieldOf("roleMask").forGetter(NodeRecord::roleMask),
                Codec.INT.fieldOf("priority").forGetter(NodeRecord::priority),
                Codec.LONG.fieldOf("lastKnownStored").forGetter(NodeRecord::lastKnownStored)
        ).apply(instance, NodeRecord::new));

        public NodeRecord {
            roleMask &= Roles.ALL;
            priority = ChargePriority.fromOrdinal(priority).ordinal();
            lastKnownStored = Math.max(0L, lastKnownStored);
        }
    }

    private static final Codec<ChargeGraphSavedData> BODY_CODEC = RecordCodecBuilder.create(instance -> instance.group(
            NodeRecord.CODEC.listOf().optionalFieldOf("nodes", List.of()).forGetter(ChargeGraphSavedData::nodes),
            Codec.LONG.optionalFieldOf("vented_total", 0L).forGetter(ChargeGraphSavedData::ventedTotal)
    ).apply(instance, ChargeGraphSavedData::new));

    public static final Codec<ChargeGraphSavedData> CODEC =
            versionedCodec(ID, CuprumSchema.WORLD, BODY_CODEC);

    /** DataFixTypes is always {@code null} (plan D1) — never an unrelated vanilla fixer. */
    public static final SavedDataType<ChargeGraphSavedData> TYPE =
            new SavedDataType<>(ID, ChargeGraphSavedData::new, CODEC, null);

    private List<NodeRecord> nodes;
    private long ventedTotal;

    public ChargeGraphSavedData() {
        this(List.of(), 0L);
    }

    private ChargeGraphSavedData(List<NodeRecord> nodes, long ventedTotal) {
        this.nodes = normalizeNodes(nodes);
        this.ventedTotal = Math.max(0L, ventedTotal);
    }

    public List<NodeRecord> nodes() {
        return nodes;
    }

    public long ventedTotal() {
        return ventedTotal;
    }

    /**
     * Replaces the persisted snapshot with the manager's current truth and marks the data dirty
     * — called only when something meaningful changed (topology, shadow values, vent counter),
     * so the restart proof reflects real writes.
     */
    public void replaceSnapshot(List<NodeRecord> newNodes, long newVentedTotal) {
        this.nodes = normalizeNodes(newNodes);
        this.ventedTotal = Math.max(0L, newVentedTotal);
        setDirty();
    }

    /**
     * Canonical persisted-record policy: records are sorted by signed {@code posKey}; if a
     * malformed file repeats a position, its last occurrence wins.
     */
    private static List<NodeRecord> normalizeNodes(List<NodeRecord> records) {
        Map<Long, NodeRecord> byPosition = new TreeMap<>();
        for (NodeRecord record : records) {
            byPosition.put(record.posKey(), record);
        }
        return List.copyOf(byPosition.values());
    }
}
