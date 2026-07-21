package dev.cuprum.cuprum.client.fx;

import net.minecraft.server.packs.resources.ResourceManager;
import net.minecraft.server.packs.resources.ResourceManagerReloadListener;

/**
 * Resource reload = the FX system's reset/recovery point (client-fx.md §9): every reload
 * clears the runtime failure cap ({@link FxTierPolicy#resetForReload()}), re-runs the
 * capability probe against the fresh resource set, refreshes the compat posture (shaderpack
 * toggles trigger a reload), re-parses the colorblind palettes and drops all pooled FX state
 * — leaks are impossible because the pools are the only FX-owned references to level data.
 *
 * <p>Registered under the ledger id {@code cuprum:fx} on {@code PackType.CLIENT_RESOURCES}
 * via the Fabric v1 {@code ResourceLoader} (the v0 helper is deprecated/banned), ordered
 * <b>after</b> vanilla {@code minecraft:shaders} so {@code precompilePipeline} sees the
 * freshly compiled shader cache ({@code ShaderManager.apply} has already swapped in the new
 * compilation set when this listener runs).
 */
public final class FxReloadListener implements ResourceManagerReloadListener {
    @Override
    public void onResourceManagerReload(ResourceManager resourceManager) {
        FxTierPolicy.resetForReload();
        FxCapabilityProbe.run(resourceManager);
        FxCompat.refresh();
        ColorblindPalettes.reload(resourceManager);
        FxDispatcher.get().clear();
        FxFrameStats.clear();
    }
}
