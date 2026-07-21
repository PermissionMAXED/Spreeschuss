package dev.cuprum.cuprum.client.fx;

import com.mojang.blaze3d.systems.GpuDevice;
import com.mojang.blaze3d.systems.RenderSystem;
import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.client.fx.render.CuprumRenderPipelines;
import java.util.function.BooleanSupplier;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.ResourceManager;

/**
 * Runtime capability probe (client-fx.md §2): decides the {@code capabilityCap} rung of the
 * tier ladder. Runs from {@code FxReloadListener} (never client init — the device and shader
 * assets only exist once resources are live).
 *
 * <ol>
 *   <li>Required packaged shader and particle resources are asserted present. Missing/malformed
 *       static resources are a vanilla reload failure, not an interceptable tier event; the
 *       JUnit resource gate and real client compile/smoke gate prevent shipping that state.</li>
 *   <li>{@link RenderSystem#tryGetDevice()} null/invalid → production demotion to T2.</li>
 *   <li>{@code device.precompilePipeline(FX_RIPPLE).isValid()} false or an interceptable backend
 *       exception → production demotion to T2. A source compile error already hard-failed before
 *       this listener; this check covers deferred/degraded device results.</li>
 * </ol>
 */
public final class FxCapabilityProbe {
    private static final ResourceLocation SHADER_VSH =
            ResourceLocation.fromNamespaceAndPath("cuprum", "shaders/core/fx_ripple.vsh");
    private static final ResourceLocation SHADER_FSH =
            ResourceLocation.fromNamespaceAndPath("cuprum", "shaders/core/fx_ripple.fsh");
    private static final ResourceLocation PARTICLE_JSON =
            ResourceLocation.fromNamespaceAndPath("cuprum", "particles/copper_mote.json");

    /** Everything primitive/string — safe to cache and log; no live GL objects retained. */
    public record Report(boolean deviceAvailable, boolean pipelineValid, boolean shaderAssetsPresent,
                         boolean particleAssetPresent, String backendName, String vendor, String renderer,
                         int maxTextureSize, FxTier capabilityCap) {
    }

    private static volatile Report lastReport;

    private FxCapabilityProbe() {
    }

    /** Runs the full probe (render thread, from the reload listener); caches the report. */
    public static Report run(ResourceManager resourceManager) {
        boolean shaderAssets = resourceManager.getResource(SHADER_VSH).isPresent()
                && resourceManager.getResource(SHADER_FSH).isPresent();
        boolean particleAsset = resourceManager.getResource(PARTICLE_JSON).isPresent();
        if (!shaderAssets || !particleAsset) {
            throw new IllegalStateException("required packaged FX resources missing after build gate"
                    + " (shaders=" + shaderAssets + ", particleJson=" + particleAsset + ")");
        }

        GpuDevice device = RenderSystem.tryGetDevice();
        boolean deviceAvailable = device != null;
        boolean pipelineValid = false;
        String backendName = "<none>";
        String vendor = "<none>";
        String renderer = "<none>";
        int maxTextureSize = 0;

        FxTier cap = evaluateDevice(deviceAvailable,
                () -> device != null && device.precompilePipeline(CuprumRenderPipelines.FX_RIPPLE).isValid());
        if (deviceAvailable) {
            try {
                backendName = device.getBackendName();
                vendor = device.getVendor();
                renderer = device.getRenderer();
                maxTextureSize = device.getMaxTextureSize();
            } catch (RuntimeException exception) {
                FxTierPolicy.demote(FxTier.T2,
                        "invalid GPU device metadata (" + exception.getClass().getSimpleName() + ")");
                cap = FxTier.T2;
            }
            pipelineValid = cap == FxTier.T1;
        }

        Report report = new Report(deviceAvailable, pipelineValid, shaderAssets, particleAsset,
                backendName, vendor, renderer, maxTextureSize, cap);
        lastReport = report;
        Cuprum.LOGGER.info(
                "[fx] capability probe: cap={} device={} pipelineValid={} shaders={} particleJson={} backend=\"{}\" vendor=\"{}\" renderer=\"{}\" maxTexture={}",
                cap, deviceAvailable, pipelineValid, shaderAssets, particleAsset,
                backendName, vendor, renderer, maxTextureSize);
        return report;
    }

    /** Package-private production decision seam for permanent client failure-path tests. */
    static FxTier evaluateDeviceForTesting(boolean deviceAvailable, BooleanSupplier precompileValid) {
        return evaluateDevice(deviceAvailable, precompileValid);
    }

    private static FxTier evaluateDevice(boolean deviceAvailable, BooleanSupplier precompileValid) {
        if (!deviceAvailable) {
            FxTierPolicy.demote(FxTier.T2, "GPU device unavailable");
            return FxTier.T2;
        }
        try {
            if (!precompileValid.getAsBoolean()) {
                FxTierPolicy.demote(FxTier.T2, "FX_RIPPLE precompile result invalid");
                return FxTier.T2;
            }
        } catch (RuntimeException exception) {
            FxTierPolicy.demote(FxTier.T2,
                    "FX_RIPPLE precompile failure (" + exception.getClass().getSimpleName() + ")");
            return FxTier.T2;
        }
        return FxTier.T1;
    }

    /** Cached cap from the last {@link #run}; T1 (no cap) before the first reload completes. */
    public static FxTier capabilityCap() {
        Report report = lastReport;
        return report != null ? report.capabilityCap() : FxTier.T1;
    }

    /** The full cached report, or null before the first run (diagnostics/gametests). */
    public static Report lastReport() {
        return lastReport;
    }
}
