package dev.cuprum.cuprum.multiblock;

/**
 * Controller formation state (multiblock.md §3.2, frozen). Ordinals are wire/menu contract:
 * {@code UNFORMED=0, FORMED=1, FAULT=2} (menu status slot, BE update-tag byte).
 */
public enum FormationState {
    UNFORMED,
    FORMED,
    FAULT;

    /** Ordinal-indexed lookup with hostile values clamped to {@link #UNFORMED}. */
    public static FormationState byOrdinal(int ordinal) {
        FormationState[] values = values();
        return ordinal >= 0 && ordinal < values.length ? values[ordinal] : UNFORMED;
    }
}
