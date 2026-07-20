package dev.cuprum.cuprum.state;

/**
 * The one version envelope for all Cuprum state (plan D5, replaces the briefs' {@code cg_version}
 * and {@code cuprum_data_version}): an integer schema per domain, independent of vanilla
 * DataVersion. BE envelopes write {@code putInt(KEY, <domain version>)} inside their
 * {@code cuprum_state} child; SavedData codecs carry {@code schema_version}
 * ({@code optionalFieldOf}, default 1) via {@link Versioned}.
 */
public final class CuprumSchema {
    /** BE-envelope key ({@code cuprum_state.cuprum_schema}). */
    public static final String KEY = "cuprum_schema";
    /** SavedData codec version field (plan §3.1). */
    public static final String SAVED_DATA_VERSION_KEY = "schema_version";

    public static final int ITEM = 1;
    public static final int BLOCK_ENTITY = 1;
    public static final int PLAYER = 1;
    public static final int WORLD = 1;

    private CuprumSchema() {
    }
}
