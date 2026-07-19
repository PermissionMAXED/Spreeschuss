# API probes — Minecraft 1.21.9 (Mojmap + Parchment) / Fabric API 0.134.1+1.21.9

Facts below were verified against the **decompiled 1.21.9 Mojmap sources** produced by
`./gradlew genSources` (Vineflower; sources land in
`.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-{common,clientOnly}-*/-sources.jar`)
and against the **remapped Fabric API 0.134.1+1.21.9 module sources** in
`.gradle/loom-cache/remapped_mods/`. Everything listed is additionally compile-proven by
this project: the rendering signatures via `RenderApiProbe` (dummy `@Override`
implementations of `BlockEntityRenderer`/`ParticleProvider` plus typed
`submitCustomGeometry`, `BlockEntityRenderers.register` and
`ParticleFactoryRegistry.register` calls — a signature change is a hard compile error),
the rest via the mod sources, datagen and gametests, all compiled with
`-Xlint -Werror` (the `lint` task).

## Block entity rendering (extract/submit pipeline, new in this era)

`net.minecraft.client.renderer.blockentity.BlockEntityRenderer<T extends BlockEntity, S extends BlockEntityRenderState>`:

```java
S createRenderState();
default void extractRenderState(T blockEntity, S renderState, float partialTick,
        Vec3 cameraPosition, @Nullable ModelFeatureRenderer.CrumblingOverlay breakProgress);
void submit(S renderState, PoseStack poseStack, SubmitNodeCollector nodeCollector,
        CameraRenderState cameraRenderState);
default boolean shouldRenderOffScreen();
default int getViewDistance();            // 64
default boolean shouldRender(T blockEntity, Vec3 cameraPos);
```

- Render state base: `net.minecraft.client.renderer.blockentity.state.BlockEntityRenderState`
  (static helper `BlockEntityRenderState.extractBase(blockEntity, renderState, breakProgress)`).
- Submit queue: `net.minecraft.client.renderer.SubmitNodeCollector extends OrderedSubmitNodeCollector`
  (`net.minecraft.client.renderer.OrderedSubmitNodeCollector`), key methods:

```java
void submitCustomGeometry(PoseStack poseStack, RenderType renderType,
        SubmitNodeCollector.CustomGeometryRenderer renderer);
void submitBlock(PoseStack poseStack, BlockState blockState, int packedLight, int packedOverlay, int outlineColor);
<S> void submitModel(Model<? super S> model, S state, PoseStack poseStack, RenderType renderType,
        int packedLight, int packedOverlay, int tintColor, @Nullable TextureAtlasSprite sprite,
        int outlineColor, @Nullable ModelFeatureRenderer.CrumblingOverlay crumblingOverlay);
void submitModelPart(ModelPart modelPart, PoseStack poseStack, RenderType renderType,
        int packedLight, int packedOverlay, @Nullable TextureAtlasSprite sprite, ...);
```

- Camera state: `net.minecraft.client.renderer.state.CameraRenderState`.
- Registration (client init):
  `net.minecraft.client.renderer.blockentity.BlockEntityRenderers.register(BlockEntityType<? extends T>, BlockEntityRendererProvider<T, S>)`
  — accessible to mods via Fabric transitive access wideners. The old
  `net.fabricmc.fabric.api.client.rendering.v1.BlockEntityRendererRegistry` is
  **`@Deprecated`** in Fabric API 0.134.1.
- Provider context: `net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider.Context`.

## Particles

- Type registration (common): `Registry.register(BuiltInRegistries.PARTICLE_TYPE, id, type)`
  (`net.minecraft.core.registries.BuiltInRegistries#PARTICLE_TYPE`), helper factories in
  `net.fabricmc.fabric.api.particle.v1.FabricParticleTypes`.
- Client provider registration:
  `net.fabricmc.fabric.api.client.particle.v1.ParticleFactoryRegistry.getInstance()` with

```java
<T extends ParticleOptions> void register(ParticleType<T> type, ParticleProvider<T> factory);
<T extends ParticleOptions> void register(ParticleType<T> type, ParticleFactoryRegistry.PendingParticleFactory<T> constructor);
```

- Provider interface (client): `net.minecraft.client.particle.ParticleProvider<T extends ParticleOptions>` —
  `@Nullable Particle createParticle(T, ClientLevel, double x, double y, double z, double xSpeed, double ySpeed, double zSpeed, RandomSource random)`
  (note the trailing `RandomSource` parameter in 1.21.9).

## Creative tab

- Builder: `net.fabricmc.fabric.api.itemgroup.v1.FabricItemGroup.builder()` returns
  `net.minecraft.world.item.CreativeModeTab.Builder` (`.title(Component)`, `.icon(Supplier<ItemStack>)`,
  `.displayItems(CreativeModeTab.DisplayItemsGenerator)`, `.build()`).
- Registration: `Registry.register(BuiltInRegistries.CREATIVE_MODE_TAB, ResourceKey.create(Registries.CREATIVE_MODE_TAB, id), tab)`.

## Block / item registration (1.21.2+ id-on-properties rules apply)

- `BlockBehaviour.Properties.of().setId(ResourceKey<Block>)` **must** be called before block construction.
- `new Item.Properties().setId(ResourceKey<Item>)`; for BlockItems add `.useBlockDescriptionPrefix()`
  to get the `block.<ns>.<path>` translation key.
- `Level.isClientSide()` is a **method** (the field is private in 1.21.9 Mojmap).
- Block use hook: `protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hitResult)`;
  results are `InteractionResult.SUCCESS`, `InteractionResult.SUCCESS_SERVER`, `InteractionResult.PASS`, …
- `SoundType` lives at `net.minecraft.world.level.block.SoundType` (not `net.minecraft.sounds`).

## Datagen entry points (Fabric data-generation API 23.2.x)

- Entrypoint key `fabric-datagen` → `net.fabricmc.fabric.api.datagen.v1.DataGeneratorEntrypoint`
  (`void onInitializeDataGenerator(FabricDataGenerator)`, `default String getEffectiveModId()` —
  override it when the datagen lives in its own `cuprum-datagen` mod but should emit into the
  `cuprum` namespace).
- `FabricDataGenerator.createPack()` → `FabricDataGenerator.Pack.addProvider(...)`.
- Models (client classes): `net.fabricmc.fabric.api.client.datagen.v1.provider.FabricModelProvider`
  (ctor `(FabricDataOutput)`), overrides
  `generateBlockStateModels(net.minecraft.client.data.models.BlockModelGenerators)` and
  `generateItemModels(net.minecraft.client.data.models.ItemModelGenerators)`;
  `BlockModelGenerators.createTrivialCube(Block)` emits blockstate + `cube_all` model + item model.
- Loot: `net.fabricmc.fabric.api.datagen.v1.provider.FabricBlockLootTableProvider`
  (ctor `(FabricDataOutput, CompletableFuture<HolderLookup.Provider>)`), override `generate()`, use `dropSelf(Block)`.
- Recipes: `net.fabricmc.fabric.api.datagen.v1.provider.FabricRecipeProvider extends RecipeProvider.Runner`;
  override `protected RecipeProvider createRecipeProvider(HolderLookup.Provider, RecipeOutput)` and
  `getName()`; inside the anonymous `RecipeProvider` override `public void buildRecipes()` and use the
  **instance** methods `shaped(RecipeCategory, ItemLike)`, `shapeless(...)`, `unlockedBy(getHasName(item), has(item))`,
  `.save(this.output)`.
- Tags: `net.fabricmc.fabric.api.datagen.v1.provider.FabricTagProvider.BlockTagProvider`
  (ctor `(FabricDataOutput, CompletableFuture<HolderLookup.Provider>)`), override
  `protected void addTags(HolderLookup.Provider)`, use `valueLookupBuilder(TagKey<Block>).add(block)`.
- Lang: `net.fabricmc.fabric.api.datagen.v1.provider.FabricLanguageProvider`
  (ctor `(FabricDataOutput, String languageCode, CompletableFuture<HolderLookup.Provider>)`), override
  `generateTranslations(HolderLookup.Provider, TranslationBuilder)`.

## GameTest entry points (post-1.21.5 data-driven rewrite)

- Server: entrypoint key `fabric-gametest`; annotate **public non-static void** methods taking
  `net.minecraft.gametest.framework.GameTestHelper` with
  `net.fabricmc.fabric.api.gametest.v1.GameTest`
  (defaults: `environment = "minecraft:default"`, `structure = "fabric-gametest-api-v1:empty"`, `maxTicks = 20`).
  The old `FabricGameTest` interface / vanilla `@GameTest` annotation registration is gone.
- `GameTestHelper` key methods (all verified):
  `setBlock(BlockPos, Block)`, `assertBlockPresent(Block, BlockPos)`,
  `useBlock(BlockPos, Player)`, `makeMockPlayer(GameType)`, `destroyBlock(BlockPos)`,
  `getLevel()`, `absolutePos(BlockPos)`, `assertItemEntityPresent(Item, BlockPos, double)`, `succeed()`.
  (`GameTestHelper.destroyBlock` does **not** drop loot; use `getLevel().destroyBlock(absolutePos(p), true)`.)
- Client: entrypoint key `fabric-client-gametest`; implement
  `net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest`
  (`void runTest(ClientGameTestContext context)`).
  `ClientGameTestContext`: `waitForScreen(Class<? extends Screen>)`, `takeScreenshot(String) → Path`,
  `waitTicks(int)`, `worldBuilder()` → `TestWorldBuilder.create()` → `TestSingleplayerContext`
  (`getClientWorld().waitForChunksRender()`, `getServer().runCommand(String)`, `AutoCloseable`).

## Loom 1.17.16 (remap variant) wiring

- Plugin id **`net.fabricmc.fabric-loom-remap`** (1.21.9 is obfuscated; plain
  `net.fabricmc.fabric-loom` targets unobfuscated versions and must not be used here).
- `fabricApi.configureDataGeneration { createSourceSet = true; modId = '...'; client = true }`
  creates the `datagen` source set + `runDatagen` task (output `src/main/generated`, added to main resources).
- `fabricApi.configureTests { createSourceSet = true; modId = '...'; eula = true }`
  creates the `gametest` source set + `runGameTest` (server, wired into `check`) and
  `runClientGameTest` (run dir `build/run/clientGameTest`, EULA auto-accepted).
- Source-set mods with `splitEnvironmentSourceSets()`: `loom.mods { cuprum { sourceSet sourceSets.main; sourceSet sourceSets.client } }`.
