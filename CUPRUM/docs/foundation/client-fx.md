# CP-FX0 — Client FX foundation (concept, implementation-complete)

Target: Minecraft **1.21.9** (Mojmap + Parchment), Fabric API **0.134.1+1.21.9**, Loom
`net.fabricmc.fabric-loom-remap` 1.17.16, Java 21. Every API signature below was verified
against the decompiled 1.21.9 Mojmap sources (`.gradle/loom-cache/minecraftMaven/.../-sources.jar`)
and the remapped Fabric API module sources (`.gradle/loom-cache/remapped_mods/`), following the
conventions of `docs/API_PROBES.md` / `docs/RENDERING_NOTES.md`.

Scope: foundation contracts + one tiny **diagnostic copper ripple** with deterministic
client-GameTest proof. Explicitly **not** the Storm Shield (U01/U02); the shield later lands *on*
these contracts without editing them. The FX probe block is CP0-style diagnostic infrastructure
and intentionally has **no catalog entry** (same rule as the Charge Probe).

Banned/stale patterns (hard rules):

- `WorldRenderEvents` / `WorldRenderContext` — removed in Fabric API 0.134.1+1.21.9; banned repo-wide.
- Fabric `BlockEntityRendererRegistry` — `@Deprecated`; use vanilla `BlockEntityRenderers.register`.
- Fabric v0 `ResourceManagerHelper` / `SimpleSynchronousResourceReloadListener` — `@Deprecated`;
  use `net.fabricmc.fabric.api.resource.v1.ResourceLoader`.
- Stale `RenderSystem` idioms (`enableBlend`, `disableCull`, `setShader*`) — gone in 1.21.9. All
  blend/cull/depth state is immutable on `RenderPipeline`. Sanctioned `RenderSystem` touchpoints:
  `tryGetDevice()` / `getDevice()` only.
- No mixins (repo has none; none needed here). No common-side references to `net.minecraft.client.*`
  (split env source sets; the server smoke script greps for violations).

## 1. Tier model

Per `docs/feature-concepts/INDEX.md`: **T1** = custom `GpuDevice`/`RenderPipeline` shader path;
**T2** = vanilla-pipeline fallback (particles / vanilla `RenderType`s / billboards); **T3** =
minimal static fallback. Foundation adds **OFF** as terminal failure rung. Tier selection is
presentation-only; nothing in `client.fx` may change gameplay outcomes (QOL-04 invariant).

```java
package dev.cuprum.cuprum.client.fx;

public enum FxTier { T1, T2, T3, OFF }

public final class FxTierPolicy {
    public static FxTier effectiveTier();                 // min(configCap, capabilityCap, compatCap)
    public static void demote(FxTier cap, String reason); // logged once per reason
    public static void resetForReload();                  // called by FxReloadListener
}
```

Resolution order (each step can only lower the cap): `CuprumClientConfig.tierCap` →
`FxCapabilityProbe.capabilityCap()` → `FxCompat.compatCap()`. All renderers/dispatchers consult
`FxTierPolicy.effectiveTier()`; there is no second gate anywhere.

## 2. Capability probe

```java
public final class FxCapabilityProbe {
    public record Report(boolean deviceAvailable, boolean pipelineValid, boolean shaderAssetsPresent,
                         String backendName, String vendor, String renderer, int maxTextureSize,
                         FxTier capabilityCap) {}
    public static Report run(ResourceManager resourceManager); // from FxReloadListener, not client init
    public static FxTier capabilityCap();                      // cached from last run
}
```

Checks in order (first failure decides the cap; all logged once):

1. `RenderSystem.tryGetDevice()` — `null` → cap `T2`.
2. Asset presence via `ResourceManager.getResource(...)`: `cuprum:shaders/core/fx_ripple.vsh`/`.fsh`
   missing → cap `T2`; `cuprum:particles/copper_mote.json` missing → cap `T3`;
   `cuprum:fx/colorblind.json` missing → colorblind remap disabled (never a tier change).
3. `device.precompilePipeline(CuprumRenderPipelines.FX_RIPPLE).isValid()` — `false` → cap `T2`.
   (`GpuDevice.precompilePipeline(RenderPipeline)` → `CompiledRenderPipeline.isValid()`, the same
   mechanism `GameRenderer` uses; `GpuDevice` also exposes `getBackendName/getVendor/getRenderer/
   getMaxTextureSize/getEnabledExtensions` for the report.)

## 3. T1 pipeline / render type / shader assets

```java
public final class CuprumRenderPipelines {
    public static final RenderPipeline FX_RIPPLE = RenderPipelines.register(   // public static, verified
        RenderPipeline.builder(RenderPipelines.MATRICES_FOG_SNIPPET)
            .withLocation(ResourceLocation.fromNamespaceAndPath("cuprum", "pipeline/fx_ripple"))
            .withVertexShader(ResourceLocation.fromNamespaceAndPath("cuprum", "core/fx_ripple"))
            .withFragmentShader(ResourceLocation.fromNamespaceAndPath("cuprum", "core/fx_ripple"))
            .withBlend(BlendFunction.LIGHTNING)            // SRC_ALPHA, ONE (verified constant)
            .withDepthWrite(false)
            .withVertexFormat(DefaultVertexFormat.POSITION_COLOR, VertexFormat.Mode.QUADS)
            .build());
}

public final class CuprumRenderTypes {
    public static final RenderType FX_RIPPLE = RenderType.create(              // public static, verified
        "cuprum:fx_ripple", RenderType.TRANSIENT_BUFFER_SIZE /*1536*/, false, true,
        CuprumRenderPipelines.FX_RIPPLE,
        RenderType.CompositeState.builder().createCompositeState(false));
}
```

Shader assets (`ShaderManager` scans `assets/<ns>/shaders/**`; `ShaderType` maps `.vsh`/`.fsh`):

- `src/main/resources/assets/cuprum/shaders/core/fx_ripple.vsh`
- `src/main/resources/assets/cuprum/shaders/core/fx_ripple.fsh`
- future `#moj_import` includes: `assets/cuprum/shaders/include/`; post chains (reserved for the
  FX-01 screen flash, which must route through `flashScale`): `assets/cuprum/post_effect/*.json`.

V1 GLSL is a passthrough clone of vanilla `core/rendertype_lightning` (ripple positions are
CPU-computed in the geometry callback) plus a `smoothstep` radial edge fade in the fragment stage —
that fade is the only T1-vs-T2 visual delta, keeping shader risk near zero.

Vanilla precedent mirrored: `RenderPipelines.LIGHTNING` = `MATRICES_FOG_SNIPPET` +
`core/rendertype_lightning` + `BlendFunction.LIGHTNING` + `POSITION_COLOR`/`QUADS`; the LIGHTNING
`RenderType` is `create("lightning", 1536, false, true, ...)`; `LightningBoltRenderer.submit` uses
`submitCustomGeometry(poseStack, RenderType.lightning(), ...)` — the T2 path reuses exactly this.

## 4. BlockEntityRenderer extract/submit contract

Verified pipeline (also compile-pinned by the existing `RenderApiProbe`):
`BlockEntityRenderer<T extends BlockEntity, S extends BlockEntityRenderState>` with
`createRenderState()`, `extractRenderState(T, S, float, Vec3, @Nullable ModelFeatureRenderer.CrumblingOverlay)`,
`submit(S, PoseStack, SubmitNodeCollector, CameraRenderState)`, `getViewDistance()` (default 64).
Custom geometry is drawn **batched per `RenderType`** (`CustomFeatureRenderer` iterates
`Map<RenderType, List<CustomGeometrySubmit>>`, one `VertexConsumer` per type per frame).

```java
package dev.cuprum.cuprum.client.fx.render;

public final class FxProbeRenderState extends BlockEntityRenderState {
    // preallocated, primitives only — no live game objects retained
    public final long[]  rippleStartTick = new long[FxBudgets.MAX_RIPPLES];
    public final int[]   rippleColorArgb = new int[FxBudgets.MAX_RIPPLES];
    public final float[] rippleRadius    = new float[FxBudgets.MAX_RIPPLES]; // tick-quantized (diagnostic)
    public int rippleCount;
    public FxTier tier;
}

public final class FxProbeRenderer implements BlockEntityRenderer<FxProbeBlockEntity, FxProbeRenderState> {
    public FxProbeRenderer(BlockEntityRendererProvider.Context context) {}

    @Override public FxProbeRenderState createRenderState() { return new FxProbeRenderState(); }

    @Override public void extractRenderState(FxProbeBlockEntity be, FxProbeRenderState s, float partialTick,
            Vec3 cameraPosition, @Nullable ModelFeatureRenderer.CrumblingOverlay breakProgress) {
        BlockEntityRenderState.extractBase(be, s, breakProgress);
        s.tier = FxTierPolicy.effectiveTier();
        FxDispatcher.get().extractRipplesAt(s, be.getBlockPos()); // pool → arrays, zero allocation
    }

    @Override public void submit(FxProbeRenderState s, PoseStack poseStack,
            SubmitNodeCollector nodeCollector, CameraRenderState cameraRenderState) {
        if (s.tier == FxTier.OFF || s.rippleCount == 0) return;
        RenderType type = s.tier == FxTier.T1 ? CuprumRenderTypes.FX_RIPPLE : RenderType.lightning();
        if (s.tier != FxTier.T3) {
            nodeCollector.submitCustomGeometry(poseStack, type,
                (pose, vertexConsumer) -> FxRippleGeometry.emitRings(pose, vertexConsumer, s));
            FxFrameStats.recordSubmit(type, s.rippleCount * FxBudgets.RIPPLE_VERTICES);
        } // T3 world visual is particle-only (spawned by the dispatcher tick, not here)
    }

    @Override public int getViewDistance() { return 64; }
}
```

Registration (client init; vanilla path via Fabric transitive access wideners):

```java
BlockEntityRenderers.register(CuprumBlockEntities.FX_PROBE, FxProbeRenderer::new);
```

Contract rules: extract copies primitives only; `submit` never touches GL/`RenderSystem` state;
animation phase derives from game time carried in the snapshot (`clientGameTime − payload.gameTime`),
tick-quantized for the diagnostic so screenshots are frame-rate independent.

## 5. Pooled ripple / lightning / particle dispatch

```java
public final class FxDispatcher {
    public static FxDispatcher get();
    public void enqueueRipple(FxRippleSnapshot snapshot);       // render thread (payload handler)
    public void extractRipplesAt(FxProbeRenderState out, BlockPos anchor);
    public void tick(ClientLevel level);                        // ClientTickEvents.END_WORLD_TICK
    public void clear();                                        // InvalidateRenderStateCallback + disconnect
}

public record FxRippleSnapshot(BlockPos center, float maxRadius, int colorArgb, long startGameTime) {
    public static FxRippleSnapshot of(FxRipplePayload payload); // pure; colorblind remap applied here
}

public final class FxRipplePool { /* fixed capacity 16 (SHD.md pin), ring buffer, oldest evicted,
                                     preallocated slots, zero steady-state allocation */ }

public final class FxArcPool { /* declared now, stubbed; TES arcs land here — same shape: bounded
    capacity, snapshot-in / primitive-extract-out, ONE RenderType batch per frame (TES.md pin:
    "all active arcs batch into one render submit pass (T1) or one particle batch (T2/T3)") */ }
```

Wiring in `CuprumClient.onInitializeClient()` (all verified entry points):

- `ClientTickEvents.END_WORLD_TICK.register(level -> FxDispatcher.get().tick(level));`
- `InvalidateRenderStateCallback.EVENT.register(() -> FxDispatcher.get().clear());`
- `ClientPlayConnectionEvents.DISCONNECT` → `clear()`.

Particle budget: every Cuprum FX spawn goes through
`FxParticleBudget.trySpawn(ClientLevel, ParticleOptions, x, y, z, vx, vy, vz)` (enforces `FxBudgets`
caps, then delegates to `ClientLevel.addParticle(...)`; vanilla `ParticleEngine` `ParticleLimit`
caps and `Options.particles()` still apply underneath). T2: ≤8 `copper_mote` per ripple per
5 ticks; T3: exactly one 8-mote burst on arrival.

## 6. Client payload snapshots (S2C only)

Payload records are common-side (`src/main`, no client classes):

```java
public record FxRipplePayload(BlockPos center, int radiusQ8 /* radius × 256 */, int colorArgb, long gameTime)
        implements CustomPacketPayload {
    public static final CustomPacketPayload.Type<FxRipplePayload> TYPE =
        new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath("cuprum", "fx_ripple"));
    public static final StreamCodec<RegistryFriendlyByteBuf, FxRipplePayload> STREAM_CODEC =
        StreamCodec.composite(BlockPos.STREAM_CODEC, FxRipplePayload::center,
            ByteBufCodecs.VAR_INT, FxRipplePayload::radiusQ8,
            ByteBufCodecs.VAR_INT, FxRipplePayload::colorArgb,
            ByteBufCodecs.VAR_LONG, FxRipplePayload::gameTime,
            FxRipplePayload::new);
    @Override public CustomPacketPayload.Type<? extends CustomPacketPayload> type() { return TYPE; }
}
```

- Common registration (`CuprumNetworking.init()` from `Cuprum.onInitialize`):
  `PayloadTypeRegistry.playS2C().register(FxRipplePayload.TYPE, FxRipplePayload.STREAM_CODEC);`
- Server dispatch (in `FxProbeBlock.useWithoutItem`, guarded by `level.isClientSide()` — a method):
  `for (ServerPlayer p : PlayerLookup.tracking(serverLevel, pos)) ServerPlayNetworking.send(p, payload);`
  return `InteractionResult.SUCCESS_SERVER` (client path returns `SUCCESS`).
- Client receive (`CuprumClientNetworking.init()`):
  `ClientPlayNetworking.registerGlobalReceiver(FxRipplePayload.TYPE,
      (payload, context) -> FxDispatcher.get().enqueueRipple(FxRippleSnapshot.of(payload)));`
  Handler is documented render-thread (`Context { Minecraft client(); LocalPlayer player();
  PacketSender responseSender(); }`), so direct pool access is safe with no extra queue.
- One-way S2C; `client.fx` never sends C2S nor mutates game state (outcome neutrality).

## 7. Particles (1.21.9 shapes — `TextureSheetParticle` no longer exists)

Common (`CuprumParticles`):

```java
public static final SimpleParticleType COPPER_MOTE = Registry.register(
    BuiltInRegistries.PARTICLE_TYPE,
    ResourceLocation.fromNamespaceAndPath("cuprum", "copper_mote"),
    FabricParticleTypes.simple());
```

Client (`CopperMoteParticle`): extends `SingleQuadParticle` (ctor takes a `TextureAtlasSprite`;
abstract `getLayer()` returns `SingleQuadParticle.Layer.TRANSLUCENT` — the Layer records carry the
`RenderPipeline`). Provider implements
`ParticleProvider<SimpleParticleType>.createParticle(type, ClientLevel, x, y, z, xs, ys, zs, RandomSource)`
(trailing `RandomSource` is 1.21.9-specific), registered via

```java
ParticleFactoryRegistry.getInstance().register(CuprumParticles.COPPER_MOTE,
    CopperMoteParticle.Provider::new);   // PendingParticleFactory taking FabricSpriteProvider
```

Assets: sprite list `assets/cuprum/particles/copper_mote.json` (vanilla `FileToIdConverter.json("particles")`
lookup; **required committed asset** — `ParticleResources` fails reload if a registered sprite-based
factory has no json) + texture `assets/cuprum/textures/particle/copper_mote.png` generated
deterministically by a `scripts/gen_*` script like `charge_probe.png`.

## 8. Reduced-flash / colorblind config

```java
public final class CuprumClientConfig {
    public enum TierCap { FULL /*T1*/, REDUCED /*T2*/, MINIMAL /*T3*/ }       // QOL-04 switch
    public enum ColorblindMode { OFF, DEUTERANOPIA, PROTANOPIA, TRITANOPIA }  // QOL-05 groundwork
    public TierCap tierCap = TierCap.FULL;
    public float flashScale = 1.0f;     // 0..1 multiplies ALL Cuprum screen-space flashes; 0 = none
    public ColorblindMode colorblindMode = ColorblindMode.OFF;
    public boolean shapeGlyphs = true;  // shape variants always available (INDEX invariant #7)
    public static CuprumClientConfig get(); public void save(); // config/cuprum-client.json (Gson)
}
```

- Effective flash = `flashScale × options.screenEffectScale().get()`, hard-forced to 0 when
  `options.hideLightningFlash().get()` (both public `OptionInstance` accessors verified) —
  single function `FxSettings.effectiveFlash()`; pre-wires FX-01's "T2: no flash" clause.
- Colorblind remap applied once at snapshot creation via `ColorblindPalettes.remap(argb, mode)`
  backed by `assets/cuprum/fx/colorblind.json`; the same file carries shape-glyph ids feeding the
  later QOL-05 audit (`unit_test:qol05_indicator_audit`).
- Config screen: cloth-config (pinned dep 20.0.149) `me.shedaniel.clothconfig2.api.ConfigBuilder`
  via `CuprumClientConfigScreen.build(Screen parent)`; ModMenu integration stays dev-runtime optional.
- QOL-04 hook: `REDUCED`/`MINIMAL` must make `FxFrameStats.customPipelineSubmits()` read 0 —
  exactly what QOL-04's acceptance later asserts.

## 9. Resource reload & failure fallback

```java
public final class FxReloadListener implements ResourceManagerReloadListener {   // vanilla interface
    @Override public void onResourceManagerReload(ResourceManager resourceManager) {
        FxTierPolicy.resetForReload();
        FxCapabilityProbe.run(resourceManager);
        FxCompat.refresh();
        ColorblindPalettes.reload(resourceManager);
        FxDispatcher.get().clear();
    }
}
// registration (client init) — v1 API; v0 ResourceManagerHelper is @Deprecated:
ResourceLoader.get(PackType.CLIENT_RESOURCES)
    .registerReloader(ResourceLocation.fromNamespaceAndPath("cuprum", "fx"), new FxReloadListener());
```

Failure ladder (never crash; log once per cause): **T1 → T2** (vanilla `RenderType.lightning()`
geometry + motes) **→ T3** (mote burst only) **→ OFF** (log only). A missing/broken cuprum shader
can only ever cost the smoothstep edge fade, never the feature. `InvalidateRenderStateCallback`
fires on F3+A / resource-pack / video changes → pools and `FxFrameStats` cleared, lazily reinit.

## 10. Iris / Sodium posture

- Only vanilla extension points: `RenderPipelines.register`, `RenderType.create`,
  `SubmitNodeCollector`, `ParticleEngine`, `BlockEntityRenderers.register`. No renderer mixins,
  no framebuffer grabs, no global GL state — the surfaces Sodium reimplements and honors.
- `FxCompat`: `FabricLoader.getInstance().isModLoaded("sodium")` / `isModLoaded("iris")`; if Iris
  present, reflection-only query of `net.irisshaders.iris.api.v0.IrisApi.getInstance().isShaderPackInUse()`
  (never a compile-time dependency; cached; refreshed by `FxReloadListener` since shaderpack toggles
  trigger a resource reload).
- Policy: Iris shaderpack active → `compatCap = T2` (custom core-shader pipelines are the one thing
  shaderpacks may not honor); Sodium alone → no cap, but the probe report logs backend/renderer
  strings for triage. Documented design rule, not an assumption about third-party internals.

## 11. Budgets (★ = CI-assertable via `FxFrameStats` counters)

| Budget | Value | Source / enforcement |
|---|---|---|
| Concurrent ripples | ★ 16 (`FxBudgets.MAX_RIPPLES`) | SHD.md pin "max 16 concurrent ripples"; pool capacity enforces |
| Ripple geometry | ★ 32 segments × 4 verts = 128 verts/ripple (`RIPPLE_VERTICES`); ≤2,048 verts/frame pool-wide | `FxRippleGeometry` constant + counter |
| Draw batches | ★ T1 adds exactly 1 `RenderType` batch (`cuprum:fx_ripple`); T2 adds 0 (rides vanilla `lightning()` batch); ≤4 distinct Cuprum world-FX `RenderType`s ever (ripple/arc/dome/aurora reserved) | per-`RenderType` batching verified in `CustomFeatureRenderer` |
| Particles | ★ spawn ≤64/tick, ≤256 live Cuprum FX motes (`FxParticleBudget`), beneath vanilla `ParticleLimit`/`ParticleStatus` | dispatcher gate |
| Payloads | ★ `FxRipplePayload` ≤32 bytes wire; server coalesces to ≤16 ripple payloads/s per client | matches pool capacity |
| Frame time | ≤0.5 ms/frame render-thread for 16 ripples at T1 on the reference client; reference scene ≤16.6 ms/frame | QOL.md W14 harness — **not** CI-blocked at CP-FX0 (CI asserts counters only; ms budgets belong to the W14 perf gates, cf. `w14_fx_effect_budget` server-side) |

## 12. Diagnostic copper ripple + proof

Feature (CP0 infrastructure, **no catalog entry**): block `cuprum:fx_probe` + `FxProbeBlockEntity`
(`FabricBlockEntityTypeBuilder.create(FxProbeBlockEntity::new, block).build()` registered in
`BuiltInRegistries.BLOCK_ENTITY_TYPE`; block registered with the existing `CuprumBlocks` pattern —
`BlockBehaviour.Properties.of().setId(key)` before construction). Right-click server-side sends one
`FxRipplePayload` (radiusQ8 = 768 ⇒ 3.0 blocks, copper `0xFFE77C56`, current game time) to tracking
players; client draws a tick-quantized expanding ring on the block top for 40 ticks
(T1 custom pipeline / T2 vanilla lightning type + motes / T3 mote burst).

**Server GameTest** (`fabric-gametest`; no render assertions per parity scope rules):
`FxProbeGameTest.fxProbeUsePulses` — place, `helper.useBlock(pos, helper.makeMockPlayer(GameType.SURVIVAL))`,
assert the BE pulse counter incremented (dispatch/state only), break-drop like the charge probe test.

**Client GameTest** (`fabric-client-gametest`, entry added to `src/gametest/resources/fabric.mod.json`):

```java
public class FxRippleClientGameTest implements FabricClientGameTest {
    @Override public void runTest(ClientGameTestContext context) {
        try (TestSingleplayerContext sp = context.worldBuilder().create()) {
            sp.getClientWorld().waitForChunksRender();
            sp.getServer().runCommand("time set noon");
            sp.getServer().runCommand("gamerule doDaylightCycle false");
            sp.getServer().runCommand("weather clear");
            sp.getServer().runCommand("tp @p 0.5 -60 0.5 0 30");
            sp.getServer().runCommand("setblock 0 -60 4 cuprum:fx_probe");
            context.runOnClient(mc -> mc.options.hideGui = true);
            context.waitTicks(20);
            context.getInput().holdMouse(GLFW.GLFW_MOUSE_BUTTON_RIGHT);   // use probe (crosshair on it)
            context.waitTicks(2);
            context.getInput().releaseMouse(GLFW.GLFW_MOUSE_BUTTON_RIGHT);
            context.waitTicks(10);                                        // ripple phase = 10 ticks
            context.assertScreenshotEquals(TestScreenshotComparisonOptions.of("fx_ripple_t1")
                    .withRegion(300, 200, 680, 400));
            long custom = context.computeOnClient(mc -> FxFrameStats.customPipelineSubmits()); // > 0 at T1
            context.runOnClient(mc -> CuprumClientConfig.get().tierCap = TierCap.REDUCED);
            context.waitTicks(5);
            long reduced = context.computeOnClient(mc ->
                    FxFrameStats.customPipelineSubmitsSinceTierChange());  // == 0 at T2; vanilla batch >= 1
            context.assertScreenshotEquals(TestScreenshotComparisonOptions.of("fx_ripple_t2")
                    .withRegion(300, 200, 680, 400));
        }
    }
}
```

Determinism levers (verified API): tick-quantized diagnostic radius (no partialTick), fixed tp pose,
frozen time/weather, hidden GUI, region-cropped fuzzy compare (default 0.5% tolerance;
`withGrayscale()` available). Templates live in the gametest mod resources `templates/` dir
(`src/gametest/resources/templates/fx_ripple_t1.png`, `fx_ripple_t2.png`) — auto-captured on first
run by the framework, then committed. Runs headless via the existing `scripts/client_smoke.sh`
(Xvfb); screenshots land in `build/run/clientGameTest/screenshots/`.

## 13. Compile probes (`FxApiProbe`, client source set)

Same rules as the frozen `RenderApiProbe`: private members, never invoked, `@Override`/typed calls
make upstream signature changes hard compile errors under `-Xlint -Werror`. Pins:

1. `RenderPipeline.builder(RenderPipelines.MATRICES_FOG_SNIPPET).withLocation(rl).withVertexShader(rl)
   .withFragmentShader(rl).withBlend(BlendFunction.LIGHTNING).withDepthWrite(false)
   .withVertexFormat(DefaultVertexFormat.POSITION_COLOR, VertexFormat.Mode.QUADS).build()`
   + typed `RenderPipelines.register(RenderPipeline)` call.
2. Typed `RenderType.create(String, int, boolean, boolean, RenderPipeline, RenderType.CompositeState)`
   with `RenderType.CompositeState.builder().createCompositeState(false)`.
3. `CompiledRenderPipeline probe(GpuDevice d, RenderPipeline p) { return d.precompilePipeline(p); }`
   + `boolean` pull of `isValid()`; typed `RenderSystem.tryGetDevice()` call.
4. Private `SingleQuadParticle` subclass: ctor chaining `(ClientLevel, double, double, double,
   TextureAtlasSprite)`, `@Override protected SingleQuadParticle.Layer getLayer()`; a
   `ParticleProvider.Sprite<SimpleParticleType>` lambda; typed
   `ParticleFactoryRegistry.PendingParticleFactory<SimpleParticleType>` registration.
5. Typed `PayloadTypeRegistry.playS2C().register(CustomPacketPayload.Type<T>,
   StreamCodec<? super RegistryFriendlyByteBuf, T>)` and
   `ClientPlayNetworking.registerGlobalReceiver(type, (payload, context) -> { Minecraft mc = context.client(); })`
   calls (the payload record itself compile-probes `StreamCodec.composite` + `CustomPacketPayload.Type`).
6. `ResourceLoader.get(PackType.CLIENT_RESOURCES).registerReloader(rl, listener)` with a
   `ResourceManagerReloadListener` `@Override onResourceManagerReload(ResourceManager)` —
   pins the non-deprecated v1 reload path.
7. `InvalidateRenderStateCallback.EVENT.register(...)`, `ClientTickEvents.END_WORLD_TICK.register(...)`.
8. `Options` accessor pins: typed reads of `options.hideLightningFlash().get()`,
   `options.screenEffectScale().get()`, `options.particles().get()`.
9. Common-side pins (in `src/main`, satisfied by the real registrations, not a probe class):
   `FabricBlockEntityTypeBuilder.create(...).build()` + `Registry.register(BuiltInRegistries.BLOCK_ENTITY_TYPE, ...)`,
   `Registry.register(BuiltInRegistries.PARTICLE_TYPE, rl, FabricParticleTypes.simple())`,
   `ServerPlayNetworking.send(ServerPlayer, CustomPacketPayload)`, `PlayerLookup.tracking(ServerLevel, BlockPos)`.

Each addition also gets a row in `docs/API_PROBES.md` (new "Custom pipelines & FX foundation" section).

## 14. File map & strict ownership

> **⚠ LEAD RECONCILIATION — shared files.** The files marked **[SHARED]** are cross-wave
> integration points that other specialists (power/net/registry leads) will also touch. CP-FX0 may
> only **append** to them; any structural change requires lead sign-off, and payload/registry id
> allocations (`cuprum:fx_ripple`, `cuprum:copper_mote`, `cuprum:fx_probe`) must be reconciled
> against the lead's id ledger before implementation.

```
src/main/java/dev/cuprum/cuprum/
  block/FxProbeBlock.java                  CP-FX0 owns; frozen after landing
  blockentity/FxProbeBlockEntity.java      CP-FX0 owns
  CuprumBlockEntities.java                 [SHARED] CP-FX0 creates; later waves append entries only
  CuprumParticles.java                     [SHARED] CP-FX0 creates; later waves append entries only
  CuprumBlocks.java / CuprumItems.java     [SHARED] existing; CP-FX0 appends fx_probe entries only
  net/CuprumNetworking.java                [SHARED] CP-FX0 creates; waves append register calls only
  net/FxRipplePayload.java                 CP-FX0 owns; immutable — new effects add NEW payload records

src/client/java/dev/cuprum/cuprum/client/
  CuprumClient.java                        [SHARED] each wave appends one init call
  RenderApiProbe.java                      FROZEN — existing probe, never touched
  FxApiProbe.java                          CP-FX0 owns; append-only, RenderApiProbe rules
  net/CuprumClientNetworking.java          [SHARED] CP-FX0 creates; waves append receivers only
  fx/** (tier, probe, compat, stats, budgets, dispatcher, pools, render, particle, config, reload)
                                           CP-FX0 owns; extension only via enqueue methods and
                                           append-only registries (CuprumRenderPipelines/-Types)

src/main/resources/assets/cuprum/
  shaders/core/fx_ripple.{vsh,fsh}         CP-FX0 owns
  particles/copper_mote.json               CP-FX0 owns (required committed asset)
  textures/particle/copper_mote.png        generated by scripts/gen_* (never hand-edited)
  fx/colorblind.json                       CP-FX0 owns; QOL-05 wave appends glyph rows

src/gametest/
  .../FxProbeGameTest.java, FxRippleClientGameTest.java   CP-FX0 owns
  resources/fabric.mod.json                [SHARED] append entrypoint entries only
  resources/templates/fx_ripple_t{1,2}.png CP-FX0 owns (captured, then committed)
```

Storm Shield (U01/U02) and TES arcs add **new files** under `fx/shield/`, `fx/arc/` plus new payload
records; they may append registry entries and `enqueue*` calls but never modify `FxDispatcher`
internals, pool classes, `FxBudgets` values, or the frozen probes. `FxBudgets` value changes
require budget review against the family-header pins (SHD/TES/QOL/FX docs).

## 15. Implementation order & validation

Common records/registries → client tier/probe/config → pipeline + render type + shaders →
dispatcher/pools → probe block wiring → `FxApiProbe` + `docs/API_PROBES.md` rows → gametests →
template capture via `scripts/client_smoke.sh`. Validate with `./gradlew check build` (lint
`-Werror` across all source sets; catalog parity untouched — the FX probe deliberately has no
catalog entry) plus `scripts/server_smoke.sh` (client-class leak grep) and `scripts/client_smoke.sh`.
