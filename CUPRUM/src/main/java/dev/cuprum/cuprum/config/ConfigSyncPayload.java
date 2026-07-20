package dev.cuprum.cuprum.config;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.config.CuprumCommonConfig.Bounds;
import dev.cuprum.cuprum.config.CuprumCommonConfig.IntRange;
import dev.cuprum.cuprum.net.CuprumNetVersion;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * S2C common-config snapshot ({@code cuprum:s2c/config/common}), sent on JOIN and after
 * {@code /reload} (plan §3.3): the client stores it as an "effective config" overlay and restores
 * local values on disconnect — the server always wins, the client file is never rewritten.
 * Carries the sender's net version for skew diagnostics (no handshake in W1, plan D3). All
 * fields are explicit typed VAR_INTs; the schema-freeze GameTest pins the key set this mirrors.
 *
 * <p>Although S2C, the canonical constructor rejects every out-of-range wire value against the
 * shared {@link Bounds} (decode-time throw = disconnect from the skewed/hostile peer). The
 * overlay never depends on clamping — a payload that decoded is in-range by construction.
 */
public record ConfigSyncPayload(
        int netVersion,
        int passiveBaselineCgPerTick,
        int leydenJarCapacityCg,
        int strikeDepositCg,
        int wireLossPpTenthsPerSpanBare,
        int wireLossPpTenthsPerSpanHv,
        int ratePerSecDefault,
        int burstDefault,
        int rateGlobalPerSec,
        int violationKickThreshold,
        int violationWindowTicks) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<ConfigSyncPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "s2c/config/common"));

    public static final StreamCodec<RegistryFriendlyByteBuf, ConfigSyncPayload> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.VAR_INT, ConfigSyncPayload::netVersion,
            ByteBufCodecs.VAR_INT, ConfigSyncPayload::passiveBaselineCgPerTick,
            ByteBufCodecs.VAR_INT, ConfigSyncPayload::leydenJarCapacityCg,
            ByteBufCodecs.VAR_INT, ConfigSyncPayload::strikeDepositCg,
            ByteBufCodecs.VAR_INT, ConfigSyncPayload::wireLossPpTenthsPerSpanBare,
            ByteBufCodecs.VAR_INT, ConfigSyncPayload::wireLossPpTenthsPerSpanHv,
            ByteBufCodecs.VAR_INT, ConfigSyncPayload::ratePerSecDefault,
            ByteBufCodecs.VAR_INT, ConfigSyncPayload::burstDefault,
            ByteBufCodecs.VAR_INT, ConfigSyncPayload::rateGlobalPerSec,
            ByteBufCodecs.VAR_INT, ConfigSyncPayload::violationKickThreshold,
            ByteBufCodecs.VAR_INT, ConfigSyncPayload::violationWindowTicks,
            ConfigSyncPayload::new);

    public ConfigSyncPayload {
        requirePositive("netVersion", netVersion);
        requireInRange("passiveBaselineCgPerTick", passiveBaselineCgPerTick, Bounds.PASSIVE_BASELINE_CG_PER_TICK);
        requireInRange("leydenJarCapacityCg", leydenJarCapacityCg, Bounds.LEYDEN_JAR_CAPACITY_CG);
        requireInRange("strikeDepositCg", strikeDepositCg, Bounds.STRIKE_DEPOSIT_CG);
        requireInRange("wireLossPpTenthsPerSpanBare", wireLossPpTenthsPerSpanBare,
                Bounds.WIRE_LOSS_PP_TENTHS_PER_SPAN_BARE);
        requireInRange("wireLossPpTenthsPerSpanHv", wireLossPpTenthsPerSpanHv,
                Bounds.WIRE_LOSS_PP_TENTHS_PER_SPAN_HV);
        requireInRange("ratePerSecDefault", ratePerSecDefault, Bounds.RATE_PER_SEC_DEFAULT);
        requireInRange("burstDefault", burstDefault, Bounds.BURST_DEFAULT);
        requireInRange("rateGlobalPerSec", rateGlobalPerSec, Bounds.RATE_GLOBAL_PER_SEC);
        requireInRange("violationKickThreshold", violationKickThreshold, Bounds.VIOLATION_KICK_THRESHOLD);
        requireInRange("violationWindowTicks", violationWindowTicks, Bounds.VIOLATION_WINDOW_TICKS);
    }

    private static void requireInRange(String field, int value, IntRange range) {
        if (!range.contains(value)) {
            throw new IllegalArgumentException(
                    field + " = " + value + " outside [" + range.min() + ", " + range.max() + "]");
        }
    }

    private static void requirePositive(String field, int value) {
        if (value < 1) {
            throw new IllegalArgumentException(field + " = " + value + " must be >= 1");
        }
    }

    /** Snapshot of the server's authoritative (local) config. */
    public static ConfigSyncPayload of(CuprumCommonConfig config) {
        return new ConfigSyncPayload(
                CuprumNetVersion.NET_VERSION,
                config.charge.passiveBaselineCgPerTick,
                config.charge.leydenJarCapacityCg,
                config.charge.strikeDepositCg,
                config.charge.wireLossPpTenthsPerSpanBare,
                config.charge.wireLossPpTenthsPerSpanHv,
                config.net.ratePerSecDefault,
                config.net.burstDefault,
                config.net.rateGlobalPerSec,
                config.net.violationKickThreshold,
                config.net.violationWindowTicks);
    }

    /**
     * Materializes the snapshot as a config object for the client overlay. Wire values were
     * already validated (constructor); {@code validatePostLoad} runs anyway as belt-and-braces
     * for programmatic construction paths — it can never change a value that decoded.
     */
    public CuprumCommonConfig toOverlayConfig() {
        CuprumCommonConfig overlay = new CuprumCommonConfig();
        overlay.charge.passiveBaselineCgPerTick = passiveBaselineCgPerTick;
        overlay.charge.leydenJarCapacityCg = leydenJarCapacityCg;
        overlay.charge.strikeDepositCg = strikeDepositCg;
        overlay.charge.wireLossPpTenthsPerSpanBare = wireLossPpTenthsPerSpanBare;
        overlay.charge.wireLossPpTenthsPerSpanHv = wireLossPpTenthsPerSpanHv;
        overlay.net.ratePerSecDefault = ratePerSecDefault;
        overlay.net.burstDefault = burstDefault;
        overlay.net.rateGlobalPerSec = rateGlobalPerSec;
        overlay.net.violationKickThreshold = violationKickThreshold;
        overlay.net.violationWindowTicks = violationWindowTicks;
        overlay.validatePostLoad();
        return overlay;
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
