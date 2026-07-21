package dev.cuprum.cuprum.client.fx;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.client.fx.particle.CopperMoteParticle;
import dev.cuprum.cuprum.client.fx.render.CuprumRenderPipelines;
import dev.cuprum.cuprum.client.fx.render.CuprumRenderTypes;
import dev.cuprum.cuprum.client.fx.render.FxProbeRenderer;
import dev.cuprum.cuprum.fx.FxContent;
import dev.cuprum.cuprum.fx.FxRipplePayload;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.client.particle.v1.ParticleFactoryRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.InvalidateRenderStateCallback;
import net.fabricmc.fabric.api.networking.v1.PacketSender;
import net.fabricmc.fabric.api.resource.v1.ResourceLoader;
import net.fabricmc.fabric.api.resource.v1.reloader.ResourceReloaderKeys;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderers;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.PackType;
import net.minecraft.world.level.Level;

/**
 * Client FX bootstrap (plan §5.1: called once from {@code CuprumClient.onInitializeClient()}
 * after {@code MachineClientModule.init()}). Wires all client-fx.md entry points:
 *
 * <ul>
 *   <li>pipeline/RenderType static registration (must precede the first {@code ShaderManager}
 *       apply so the pipeline is in {@code RenderPipelines.getStaticPipelines()}),</li>
 *   <li>the FX probe BER (vanilla {@code BlockEntityRenderers.register} via Fabric transitive
 *       access wideners; the Fabric {@code BlockEntityRendererRegistry} is deprecated/banned),</li>
 *   <li>the copper-mote sprite factory,</li>
 *   <li>the S2C ripple receiver (documented render-thread; direct pool access, no queue),</li>
 *   <li>dispatcher tick + reset hooks ({@code END_WORLD_TICK}, {@code
 *       InvalidateRenderStateCallback} for F3+A / pack / video changes, and session-identity
 *       guarded JOIN/DISCONNECT),</li>
 *   <li>the {@code cuprum:fx} reload listener (ledger §3.4), ordered after vanilla shaders so
 *       the capability probe sees the fresh compiled-shader cache.</li>
 * </ul>
 *
 * <p>FX connection lifecycle is guarded independently from net/config state because this module
 * owns a separate singleton. The only nested lock order is {@link #FX_SESSION_LOCK} then the
 * {@link FxDispatcher} instance monitor (inside {@link FxDispatcher#clear()}); dispatcher code
 * must never call back into this lifecycle lock. JOIN, DISCONNECT, and receiver mutation hold
 * that order. A stale disconnect is ordered wholly before a newer JOIN or becomes a no-op wholly
 * after it; stale receiver work is rejected by exact response-sender identity. The lifecycle
 * callbacks touch only mod-owned pools/counters and never access {@code Minecraft}, a client
 * level, or any other world state, because DISCONNECT may run on a Netty event-loop thread.
 */
public final class FxClientModule {
    /** Guards both active identities and every lifecycle/receiver pool-counter transition. */
    private static final Object FX_SESSION_LOCK = new Object();

    /** Exact connection that owns the current FX singleton state; null between sessions. */
    private static ClientPacketListener activeFxSession;

    /**
     * Exact response sender supplied by the owning connection's JOIN event. Payload contexts
     * expose this same object, so it identifies the connection that delivered the payload.
     */
    private static PacketSender activeFxResponseSender;

    private FxClientModule() {
    }

    public static void init() {
        CuprumRenderPipelines.init();
        CuprumRenderTypes.init();

        BlockEntityRenderers.register(FxContent.FX_PROBE_BLOCK_ENTITY, FxProbeRenderer::new);
        ParticleFactoryRegistry.getInstance().register(FxContent.COPPER_MOTE, CopperMoteParticle.Provider::new);

        ClientPlayNetworking.registerGlobalReceiver(FxRipplePayload.TYPE, (payload, context) -> {
            PacketSender responseSender = context.responseSender();
            ResourceKey<Level> currentDimension =
                    context.client().level == null ? null : context.client().level.dimension();
            receiveRipple(payload, responseSender, currentDimension);
        });

        ClientTickEvents.END_WORLD_TICK.register(level -> FxDispatcher.get().tick(level));
        InvalidateRenderStateCallback.EVENT.register(() -> {
            FxDispatcher.get().clear();
            FxFrameStats.clear();
        });
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            synchronized (FX_SESSION_LOCK) {
                // Clear first, install second: no state from a previous connection can become
                // owned by this one. This path runs on the client thread, but intentionally uses
                // the same lock and lock order as the any-thread DISCONNECT path.
                clearSessionState();
                activeFxSession = handler;
                activeFxResponseSender = sender;
            }
        });
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
            synchronized (FX_SESSION_LOCK) {
                if (activeFxSession != null && activeFxSession != handler) {
                    return; // stale disconnect of A after newer session B installed its identity
                }
                // A no-active-session delivery is cleanup-safe only before a newer JOIN wins
                // this lock. Once B is installed, the identity check above makes stale A a no-op.
                clearSessionState();
                activeFxSession = null;
                activeFxResponseSender = null;
            }
        });

        ResourceLocation reloaderId = ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "fx");
        ResourceLoader resourceLoader = ResourceLoader.get(PackType.CLIENT_RESOURCES);
        resourceLoader.registerReloader(reloaderId, new FxReloadListener());
        resourceLoader.addReloaderOrdering(ResourceReloaderKeys.Client.SHADERS, reloaderId);

        Cuprum.LOGGER.info("[fx] client FX foundation initialized (pipeline {}, render types {})",
                CuprumRenderPipelines.FX_RIPPLE.getLocation(), CuprumRenderTypes.worldFxTypes().size());
    }

    /**
     * Clears only mod-owned thread-safe state. Caller must hold {@link #FX_SESSION_LOCK}; this
     * method must never grow Minecraft/client-level access because DISCONNECT can call it off-thread.
     */
    private static void clearSessionState() {
        FxDispatcher.get().clear();
        FxFrameStats.clear();
    }

    /**
     * Shared production delivery seam. The sender check and every resulting dispatcher,
     * frame-counter, or particle-budget mutation are one session-locked transition. The
     * dimension is sampled by the render-thread receiver before entering; no lifecycle callback
     * performs world access.
     */
    static boolean receiveRipple(FxRipplePayload payload, PacketSender responseSender,
            ResourceKey<Level> currentDimension) {
        synchronized (FX_SESSION_LOCK) {
            if (activeFxSession == null || activeFxResponseSender != responseSender
                    || currentDimension == null) {
                return false;
            }
            return FxDispatcher.get().enqueueRippleFromDimension(
                    FxRippleSnapshot.of(payload), currentDimension, currentDimension);
        }
    }

    /** Exact JOIN response-sender identity, exposed only to the package-local lifecycle test. */
    static PacketSender activeFxResponseSenderForTesting() {
        synchronized (FX_SESSION_LOCK) {
            return activeFxResponseSender;
        }
    }
}
