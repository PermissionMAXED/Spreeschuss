# Rendering notes for 1.21.9 (charge shield & friends)

## The old world-render hook is gone — do not look for it

- `net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents` (and
  `WorldRenderContext`) **do not exist** in Fabric API 0.134.1+1.21.9. They were removed
  as part of the 1.21.9 render-pipeline refactor; the API surface of
  `fabric-rendering-v1` today is: `BlockRenderLayerMap`, `ColorProviderRegistry`,
  `EntityRendererRegistry`, `EntityModelLayerRegistry`, HUD element APIs
  (`hud/HudElementRegistry`), `FabricRenderPipeline`, `FabricRenderState`,
  `SpecialBlockRendererRegistry`, `SpecialGuiElementRegistry`, etc.
  **Any code or tutorial using `WorldRenderEvents.*` is stale for this version and is
  banned in this repository.**
- The deprecated `BlockEntityRendererRegistry` (Fabric) is also legacy; vanilla
  `BlockEntityRenderers.register(...)` is directly accessible via Fabric's transitive
  access wideners.

## How the future Storm Shield (catalog U01/U02) must render

1.21.9 moved world rendering to an **extract → submit → draw** model. Renderers no
longer receive a `MultiBufferSource` during world iteration; they *extract* an immutable
render state on the game side, then *submit* geometry into an ordered queue
(`SubmitNodeCollector`) that the engine sorts and draws through the vanilla pipeline.

Planned approach for the shield barrier:

- A `ShieldProjectorBlockEntity` plus a `BlockEntityRenderer<ShieldProjectorBlockEntity, ShieldRenderState>`:
  - `createRenderState()` returns a mutable `ShieldRenderState extends BlockEntityRenderState`
    (radius, tint, animation phase extracted in `extractRenderState`, which must call
    `BlockEntityRenderState.extractBase(...)`).
  - `submit(state, poseStack, nodeCollector, cameraState)` queues the translucent dome via
    `nodeCollector.submitCustomGeometry(poseStack, RenderType.translucent(), (pose, vertexConsumer) -> ...)`,
    i.e. custom geometry stays on the **vanilla pipeline** (no custom GL state, no custom shaders).
  - `getViewDistance()` raised above 64 if the dome is large; `shouldRenderOffScreen()`
    true because the dome extends beyond the block's bounds.
- Registration in the client initializer through vanilla
  `BlockEntityRenderers.register(CUPRUM_SHIELD_BE_TYPE, ShieldRenderer::new)`.
- **Fallbacks** (in order) if custom geometry proves brittle on some drivers:
  1. `submitBlock`/`submitModel` with a baked dome model (pure vanilla-pipeline path);
  2. particle shell: a `ShieldSparkParticle` registered via
     `ParticleFactoryRegistry.getInstance().register(type, provider)` and spawned along the
     dome surface server-side (`ServerLevel.sendParticles`) — zero custom render code.
- `RenderApiProbe` (client source set) contains a private dummy
  `BlockEntityRenderer<BlockEntity, BlockEntityRenderState>` implementation whose
  `@Override` methods pin `createRenderState`/`extractRenderState`/`submit`, a
  `submitCustomGeometry(PoseStack, RenderType, CustomGeometryRenderer)` call, a dummy
  `ParticleProvider<SimpleParticleType>` implementation, and typed
  `BlockEntityRenderers.register` / `ParticleFactoryRegistry.register` calls — so any
  upstream signature change is a hard compile error. Nothing in it runs at runtime.

## Practical gotchas already hit in this repo

- Client-only classes live in `minecraft-clientOnly-*` (split env source sets):
  anything under `net.minecraft.client.*` must stay in `src/client` (or `src/datagen`,
  which sees the client set, or `src/gametest`).
- The dedicated server smoke test greps its log for
  `ClassNotFoundException: net.minecraft.client` / `NoClassDefFoundError: net/minecraft/client`
  to catch accidental common-side use of client classes.
- Tracer-style debug rendering: prefer particles (`minecraft:electric_spark`) over
  custom geometry for one-off diagnostics; they need no client render code at all.
