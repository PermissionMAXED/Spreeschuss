package dev.cuprum.cuprum.client.fx;

import dev.cuprum.cuprum.client.config.CuprumClientConfig;
import dev.cuprum.cuprum.client.config.CuprumClientConfigs;
import net.minecraft.client.Minecraft;

/**
 * Accessibility-aware FX settings reads (client-fx.md §8). One function owns the effective
 * screen-flash scale — FX-01's "T2: no flash" clause and every future Cuprum screen-space
 * flash must route through {@link #effectiveFlash()}; nothing else may read the raw config
 * field. Colorblind remap resolves through {@link ColorblindPalettes} exactly once at
 * snapshot creation ({@code FxRippleSnapshot.of}), never per frame.
 */
public final class FxSettings {
    private FxSettings() {
    }

    /**
     * Effective flash = {@code flashScale x options.screenEffectScale()}, hard-forced to 0 by
     * the vanilla accessibility option {@code hideLightningFlash()} (verified public
     * {@code OptionInstance} accessors). Returns [0, 1].
     */
    public static float effectiveFlash() {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.options.hideLightningFlash().get()) {
            return 0.0f;
        }
        float configScale = CuprumClientConfigs.client().flashScale;
        double vanillaScale = minecraft.options.screenEffectScale().get();
        float effective = (float) (configScale * vanillaScale);
        return Math.max(0.0f, Math.min(1.0f, effective));
    }

    /** The active colorblind mode (QOL-05 groundwork; plan D2: field owned by config module). */
    public static CuprumClientConfig.ColorblindMode colorblindMode() {
        return CuprumClientConfigs.client().colorblindMode;
    }

    /** Applies the active colorblind palette remap to a packed ARGB color. */
    public static int remapColor(int argb) {
        return ColorblindPalettes.remap(argb, colorblindMode());
    }
}
