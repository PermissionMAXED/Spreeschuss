package dev.cuprum.cuprum.multiblock;

import net.minecraft.util.StringRepresentable;

/**
 * Why a controller is in {@link FormationState#FAULT} (multiblock.md §3.2, frozen). Faults are
 * diagnostic-only and never persisted (plan §3.1); the serialized name rides the BE update tag.
 */
public enum FaultCode implements StringRepresentable {
    /** A member position holds the wrong block/state; the fault names the first failing pos. */
    MISMATCH("mismatch"),
    /** A member chunk is not loaded; detected without reading the chunk. */
    UNLOADED("unloaded"),
    /** A member position is claimed by another formed controller. */
    CONFLICT("conflict"),
    /** The bound pattern id vanished after {@code /reload}. */
    PATTERN_MISSING("pattern_missing");

    private final String id;

    FaultCode(String id) {
        this.id = id;
    }

    @Override
    public String getSerializedName() {
        return id;
    }

    /** Serialized-name lookup; unknown names fall back to {@link #MISMATCH}. */
    public static FaultCode byName(String name) {
        for (FaultCode code : values()) {
            if (code.id.equals(name)) {
                return code;
            }
        }
        return MISMATCH;
    }
}
