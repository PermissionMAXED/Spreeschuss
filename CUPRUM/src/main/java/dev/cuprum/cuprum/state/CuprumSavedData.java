package dev.cuprum.cuprum.state;

import com.mojang.serialization.Codec;
import net.minecraft.world.level.saveddata.SavedData;

/**
 * Base class for every Cuprum SavedData (plan §3.1): subclasses build their codec through
 * {@link #versionedCodec} so the {@code schema_version} envelope and the {@link StateMigrations}
 * chain are applied uniformly. The corresponding {@code SavedDataType} must always pass
 * {@code null} for DataFixTypes (plan D1 — Fabric's object-builder mixin no-ops it; never apply
 * an unrelated vanilla fixer). Full corruption quarantine and future-version state-lock are
 * staged for the first wave persisting high-value player data (plan D10); the W1 floor is the
 * version envelope + WARN + clamped best-effort reads inside {@link Versioned}.
 */
public abstract class CuprumSavedData extends SavedData {
    protected CuprumSavedData() {
    }

    /** Wraps {@code bodyCodec} in the schema envelope + migration chain for {@code domain}. */
    protected static <T extends CuprumSavedData> Codec<T> versionedCodec(
            String domain, int currentVersion, Codec<T> bodyCodec) {
        return Versioned.codec(domain, currentVersion, bodyCodec, StateMigrations.steps(domain));
    }
}
