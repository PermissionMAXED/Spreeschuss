package dev.cuprum.cuprum.client.config;

import dev.cuprum.cuprum.Cuprum;
import me.shedaniel.autoconfig.ConfigData;
import me.shedaniel.autoconfig.annotation.Config;

/**
 * The client-only config (plan §3.3): presentation + accessibility, AutoConfig + Jankson →
 * {@code config/cuprum-client.json5}. A separate file (not {@code PartitioningSerializer}) keeps
 * client classes out of main and lets the dedicated server ignore it entirely. The FX fields are
 * owned semantically by client-fx (plan D2 rejected its own Gson file); W1D reads them through
 * {@code FxTierPolicy}. No Cloth screens yet — those land in W1E.
 */
@Config(name = "cuprum-client")
public class CuprumClientConfig implements ConfigData {
    /** QOL-04 switch: caps the FX tier ladder (FULL→T1, REDUCED→T2, MINIMAL→T3). */
    public enum FxTierCap {
        FULL, REDUCED, MINIMAL
    }

    /** QOL-05 groundwork; palette remap ids resolve against {@code fx/colorblind.json} (W1D). */
    public enum ColorblindMode {
        OFF, DEUTERANOPIA, PROTANOPIA, TRITANOPIA
    }

    public FxTierCap fxTierCap = FxTierCap.FULL;
    /** 0..1, multiplies ALL Cuprum screen-space flashes (effective flash also scales with vanilla
     * {@code screenEffectScale()} and is forced 0 by {@code hideLightningFlash()} — W1D). */
    public float flashScale = 1.0f;
    public ColorblindMode colorblindMode = ColorblindMode.OFF;
    /** QOL-05: state indicators get glyph + color (shape variants always available). */
    public boolean shapeCodedIndicators = true;

    /** Clamps/restores out-of-range file values and logs each correction (plan §3.3). */
    @Override
    public void validatePostLoad() {
        if (fxTierCap == null) {
            fxTierCap = FxTierCap.FULL;
            Cuprum.LOGGER.warn("[config] fxTierCap missing/invalid; restored to FULL");
        }
        if (colorblindMode == null) {
            colorblindMode = ColorblindMode.OFF;
            Cuprum.LOGGER.warn("[config] colorblindMode missing/invalid; restored to OFF");
        }
        if (!(flashScale >= 0.0f && flashScale <= 1.0f)) { // negated to also catch NaN
            float clamped = Float.isNaN(flashScale) ? 1.0f : Math.max(0.0f, Math.min(1.0f, flashScale));
            Cuprum.LOGGER.warn("[config] flashScale = {} out of range [0, 1]; clamped to {}", flashScale, clamped);
            flashScale = clamped;
        }
    }
}
