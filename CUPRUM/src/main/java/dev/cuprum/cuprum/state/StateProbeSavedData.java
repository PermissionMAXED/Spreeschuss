package dev.cuprum.cuprum.state;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.world.level.saveddata.SavedDataType;

/**
 * The W1A persistence probe ({@code cuprum_state_probe}, plan D1): one int boot counter,
 * incremented and logged on every SERVER_STARTED. {@code scripts/server_restart_probe.sh} boots
 * the dedicated server twice against the same world and requires {@code boots=2} on the second
 * boot — proving the on-disk file was re-read through {@code readTagFromDisk} → Fabric's
 * null-DataFixTypes path.
 */
public final class StateProbeSavedData extends CuprumSavedData {
    public static final String ID = "cuprum_state_probe";

    private static final Codec<StateProbeSavedData> BODY_CODEC = RecordCodecBuilder.create(instance -> instance.group(
            Codec.INT.optionalFieldOf("boots", 0).forGetter(StateProbeSavedData::boots)
    ).apply(instance, StateProbeSavedData::new));

    public static final Codec<StateProbeSavedData> CODEC =
            versionedCodec(ID, CuprumSchema.WORLD, BODY_CODEC);

    /** DataFixTypes is always {@code null} (plan D1) — never an unrelated vanilla fixer. */
    public static final SavedDataType<StateProbeSavedData> TYPE =
            new SavedDataType<>(ID, StateProbeSavedData::new, CODEC, null);

    private int boots;

    public StateProbeSavedData() {
        this(0);
    }

    private StateProbeSavedData(int boots) {
        // Best-effort clamp for skewed stored data (plan D5) — this is disk state, not a packet.
        this.boots = Math.max(0, boots);
    }

    public int boots() {
        return boots;
    }

    /** Increments the boot counter and marks the data dirty for the next world save. */
    public int incrementBoots() {
        boots++;
        setDirty();
        return boots;
    }
}
