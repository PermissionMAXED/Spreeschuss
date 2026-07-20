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
- **Batch isolation via test environments** (verified 1.21.9 `GameTestBatchFactory` /
  `GameTestRunner`): tests are grouped into batches **by environment holder** and batches run
  strictly sequentially (`runBatch(index + 1)` after the previous completes) — tests inside one
  batch tick concurrently. `test_environment` is a datapack registry (`RegistryDataLoader`), so
  `data/<modid>/test_environment/<name>.json` with `{"type": "minecraft:all_of",
  "definitions": []}` defines a setup-free environment identical to `minecraft:default` but in
  its **own sequential batch** — required for tests that mutate global/static state (Fabric's
  `TestAnnotationLocator` resolves `@GameTest(environment = ...)` via `getOrThrow`, failing
  loudly on typos).
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

## Networking & state (W1A; compile-pinned by `NetApiProbe`, `StateApiProbe`, `ClientNetApiProbe`)

### Fabric networking (fabric-networking-api-v1, payload object API)

- Payload type registration:
  `net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry.playC2S()/playS2C()/configurationC2S()/configurationS2C()`
  → `.register(CustomPacketPayload.Type<T>, StreamCodec<? super B, T>)`
  (play registries take `RegistryFriendlyByteBuf`, configuration takes `FriendlyByteBuf`).
  Type-before-receiver per payload type is an API requirement.
- Server receivers/sends: `ServerPlayNetworking.registerGlobalReceiver(type, handler)`;
  handler `receive(T payload, ServerPlayNetworking.Context ctx)` runs **on the server thread**;
  `Context.server()/player()/responseSender()`; `ServerPlayNetworking.send(ServerPlayer, CustomPacketPayload)`,
  `canSend(ServerPlayer, CustomPacketPayload.Type<?>)`.
  `ServerConfigurationNetworking.registerGlobalReceiver/send` exist for the (unused in W1) config phase.
- Client receivers/sends: `ClientPlayNetworking.registerGlobalReceiver(type, handler)` — play payload
  handlers run **on the render thread** (`AbstractChanneledNetworkAddon.handle` throws the vanilla
  off-thread exception when not on the receive thread, so vanilla reschedules onto the main thread);
  `Context.client()/player()/responseSender()`; `ClientPlayNetworking.send(CustomPacketPayload)`,
  `canSend(CustomPacketPayload.Type<?>)`; `ClientConfigurationNetworking.registerGlobalReceiver/send`.
- **DISCONNECT event threading** (both sides, verified in fabric-networking-api-v1 5.0.13 sources):
  `ClientPlayConnectionEvents.DISCONNECT` / `ServerPlayConnectionEvents.DISCONNECT` fire from
  `AbstractNetworkAddon.handleDisconnect()` (guarded by a CAS — exactly once per connection), which
  Fabric's `ClientConnectionMixin` invokes from **either** `Connection.channelInactive` (a **Netty
  event-loop thread**) **or** `Connection.handleDisconnection` (main-thread tick path), whichever
  runs first. Disconnect handlers must therefore not assume the render/server thread — and the two
  sides need **different** strategies (verified in the 1.21.9 sources):
  - **Client: never defer disconnect cleanup with `Minecraft.execute`.** `Minecraft.disconnect(
    Screen, boolean)` calls `dropAllTasks()` (`BlockableEventLoop.pendingRunnables.clear()`)
    during world teardown; a cleanup runnable queued from the Netty-thread DISCONNECT is deleted
    before it ever runs (`ClientLevel.disconnect` closes the channel first, so `channelInactive`
    → event → `execute` can precede `dropAllTasks()`). Client disconnect handlers must mutate
    only mod-owned thread-safe state, synchronously, inside the callback (`CuprumClientNet`'s
    session lock pattern).
  - **Server: defer to `MinecraftServer.execute` is safe and required for per-connection maps.**
    `MinecraftServer` has **no** `dropAllTasks()` call site, so queued cleanup cannot be
    discarded; scheduling serializes the removal behind any in-flight server-thread dispatch
    (an inline Netty-thread removal could race `tryAcquire`/`record`, and a create-on-lookup
    would then resurrect the state forever since the event fires only once). Fired on the
    server thread (vanilla `handleDisconnection` tick path, embedded-channel gametests) the
    task runs inline (`BlockableEventLoop.execute` runs same-thread unless inside `doRunTask`);
    after `stopServer` begins, `scheduleExecutables()` is false and it degrades to run-inline —
    safe, the game loop has exited. Late lookups must be non-creating (`Map.get`, never
    `computeIfAbsent`) so an absent connection can never regain state.
  - **Server: a UUID is not a connection identity — queued removals must be
    handler-conditional.** The UUID survives reconnects, so a queued stale removal keyed only
    by UUID can delete a newer same-UUID session that JOINed before the queue drained (and
    vanilla's duplicate-login kick — `PlayerList.disconnectAllPlayersWithProfile` — closes the
    old channel asynchronously, so the old DISCONNECT can even arrive *after* the new JOIN).
    The per-connection token is the `ServerGamePacketListenerImpl` the JOIN/DISCONNECT events
    pass: verified 1.21.9, it is unique per connection and survives respawn
    (`PlayerList.respawn` does `serverPlayer.connection = player.connection` onto the **new**
    `ServerPlayer` object — so never bind to the player object either). Cleanup must remove
    the entry only while the disconnecting handler still owns it, and lookups must refuse a
    sender whose `player.connection` is not the tracked owner.
  - **Server: queued cleanup is not guaranteed to run at shutdown — sweep at SERVER_STOPPED.**
    In `MinecraftServer.runServer` the finally block sets `stopped = true` *then* calls
    `stopServer()`: a task queued from another thread after the loop's final drain but before
    `stopped = true` is enqueued (`scheduleExecutables()` still true) yet never executed. Mod
    statics also outlive the server instance inside one JVM (integrated server, gametest
    server), so per-connection maps must be cleared synchronously from
    `ServerLifecycleEvents.SERVER_STOPPED` — fired on the server thread at the TAIL of
    `stopServer()` (Fabric `MinecraftServerMixin`), after every world and connection closed;
    `SERVER_STOPPING` fires at its HEAD, before players are disconnected.
- Connection lifecycle: `ServerPlayConnectionEvents.JOIN` (`(handler, sender, server)`; fires inside
  `PlayerList.placeNewPlayer` via Fabric's `PlayerManagerMixin`), `ServerPlayConnectionEvents.DISCONNECT`
  (`(handler, server)`); client side `ClientPlayConnectionEvents.JOIN/DISCONNECT`;
  `EntityTrackingEvents.START_TRACKING`; `ServerTickEvents.END_SERVER_TICK`;
  `ServerLifecycleEvents.SERVER_STARTED/END_DATA_PACK_RELOAD` (`(server, resourceManager, success)`).
  **`SERVER_STARTED` fires in `MinecraftServer.runServer` after `initServer()`**, i.e. *after* the
  dedicated server's `Done (…s)!` console line (matters for log-grepping smoke scripts).
- Player lookup: `PlayerLookup.all(MinecraftServer)`, `tracking(ServerLevel, ChunkPos)`,
  `tracking(BlockEntity)`, `tracking(Entity)`; `PacketSender.sendPacket(CustomPacketPayload)`.
- Bounded codec primitives: `ByteBufCodecs.VAR_INT/VAR_LONG/BOOL`, `ByteBufCodecs.stringUtf8(maxLength)`,
  `byteArray(maxSize)`, `collection(IntFunction, StreamCodec, maxSize)`,
  `idMapper(IntFunction, ToIntFunction)`; `StreamCodec.composite(...)` has fixed overloads for
  **1–9 and 11** parameter pairs — there is **no 10-pair overload** and nothing above 11
  (verified via `javap` on the mapped 1.21.9 jar: `Function9` jumps to `Function11`);
  `UUIDUtil.STREAM_CODEC`, `UUIDUtil.CODEC`, `BlockPos.STREAM_CODEC`.
- Guard-relevant vanilla members: `AbstractContainerMenu.containerId` (public field) +
  `stillValid(Player)`; `ServerCommonPacketListenerImpl.disconnect(Component)`;
  `ServerGamePacketListenerImpl.onDisconnect(DisconnectionDetails)` (real disconnect path;
  `new DisconnectionDetails(Component)`); `Player.hasPermissions(int)` →
  `ServerPlayer.getPermissionLevel()` → `MinecraftServer.getProfilePermissions(NameAndId)` (ops-list
  driven, so `PlayerList.op(NameAndId)` takes effect immediately; `Player.nameAndId()` is public);
  `Level.isLoaded(BlockPos)` queries the chunk source **without** loading chunks;
  `Vec3.atCenterOf(Vec3i)`; `Scoreboard.getPlayersTeam(String)` + `Player.getTeam()`.

### Persistence (SavedData / attachments / components)

- `SavedDataType<T>` is a **record** `(String id, Function<SavedData.Context, T> constructor,
  Function<SavedData.Context, Codec<T>> codec, DataFixTypes dataFixType)` with a convenience ctor
  `(String, Supplier<T>, Codec<T>, DataFixTypes)`. Equality is **by id only**.
- `DataFixTypes` may be **`null`** for mod data: vanilla `DimensionDataStorage.readTagFromDisk`
  calls `dataFixType.update(...)` unconditionally, but Fabric API's
  `PersistentStateManagerMixin` (fabric-object-builder-api-v1) `@WrapOperation`s the call and
  passes the NBT through untouched when the fixer is null (verified in 0.134.1 sources;
  `scripts/server_restart_probe.sh` proves the full disk round-trip at runtime).
- `ServerLevel.getDataStorage()` → `DimensionDataStorage.computeIfAbsent(SavedDataType<T>)`;
  instances are cached (same object back until save); on-disk shape is
  `{DataVersion, data: <codec output>}` parsed with
  `registries.createSerializationContext(NbtOps.INSTANCE)` (a `RegistryOps<Tag>`).
- `SavedData`: `setDirty()/setDirty(boolean)/isDirty()` — nothing else; subclasses carry all state.
- Attachments (experimental, single call site `CuprumAttachments` per plan D5):
  `AttachmentRegistry.create(ResourceLocation, builder -> builder.persistent(Codec)
  .initializer(Supplier).copyOnDeath().syncWith(StreamCodec, AttachmentSyncPredicate.targetOnly()))`;
  `AttachmentTarget.getAttached/setAttached/getAttachedOrCreate/modifyAttached/hasAttached/removeAttached`;
  `AttachmentTarget.onAttachedSet(AttachmentType<A>)` **does exist** (fabric-data-attachment-api-v1
  1.8.28 sources) and returns `Event<AttachmentTarget.OnAttachedSet<A>>` whose callback is
  `onAttachedSet(@Nullable A oldValue, @Nullable A newValue)`.
- Item state (future): `DataComponentType.builder().persistent(Codec).networkSynchronized(StreamCodec)
  .cacheEncoding().build()` + `Registry.register(BuiltInRegistries.DATA_COMPONENT_TYPE, id, type)`;
  `Item.Properties.component(type, value)`.
- BE state envelope (W1C consumers): `ValueOutput.child(String)/putInt/putLong/store(String, Codec<T>, T)`,
  `ValueInput.getIntOr(String, int)/read(String, Codec<T>)/child(String) → Optional<ValueInput>` /
  `childOrEmpty(String)`, `NbtUtils.addCurrentDataVersion(ValueOutput)`.

### Config (cloth-config 20.0.149, bundled AutoConfig + shadowed Jankson)

- `AutoConfig.register(Class<T extends ConfigData>, ConfigSerializer.Factory<T>)` →
  `ConfigHolder<T>` (also `AutoConfig.getConfigHolder(Class<T>)`); holder: `getConfig()`,
  `load()`, `save()`, `registerLoadListener/registerSaveListener`.
  `JanksonConfigSerializer(Config, Class<T>)` matches the `JanksonConfigSerializer::new` factory
  and writes `config/<name>.json5`. `ConfigData.validatePostLoad()` (throws
  `ConfigData.ValidationException`) runs on every load. `AutoConfig`/`JanksonConfigSerializer`
  are jar-env unrestricted (dedicated-server-safe); only `AutoConfig.getConfigScreen` touches
  client classes (never referenced in common code).
- Shadowed Jankson (`me.shedaniel.cloth.clothconfig.shadowed.blue.endless.jankson`):
  `Jankson.builder().build()`, `toJson(Object)` → `JsonElement`/`JsonObject`
  (`keySet()`, `get(Object)`), `fromJson(JsonObject, Class<T>)` — used by the schema-freeze and
  defaults-roundtrip GameTests against the exact serializer AutoConfig uses.

### GameTest facts (mock players)

- `GameTestHelper.makeMockPlayer(GameType)` returns a bare `Player` (no connection) — unusable for
  `ServerPlayer`-typed guard/networking paths. The only vanilla `ServerPlayer` helper,
  `makeMockServerPlayerInLevel()`, is `@Deprecated(forRemoval = true)` (fails `-Werror` lint), so
  the gametest source set replicates its verified recipe in `MockServerPlayers`:
  `CommonListenerCookie.createInitial(GameProfile, false)` →
  `new ServerPlayer(MinecraftServer, ServerLevel, GameProfile, ClientInformation)` →
  `new Connection(PacketFlow.SERVERBOUND)` wrapped in a netty `EmbeddedChannel` →
  `PlayerList.placeNewPlayer(Connection, ServerPlayer, CommonListenerCookie)`. This fires the
  Fabric JOIN event, and every S2C packet lands in `EmbeddedChannel.outboundMessages()` as an
  unencoded `ClientboundCustomPayloadPacket` (a record; `payload()` accessor).
- Mock teardown can drive the **real** Fabric DISCONNECT event: `Connection.disconnect(
  DisconnectionDetails)` closes the embedded channel, whose inline pipeline fires
  `Connection.channelInactive` → Fabric's `ClientConnectionMixin` → `handleDisconnect()` →
  `ServerPlayConnectionEvents.DISCONNECT`; a following `Connection.handleDisconnection()` then
  dispatches `ServerGamePacketListenerImpl.onDisconnect` (PlayerList removal). EmbeddedChannel has
  no event loop — everything runs synchronously on the calling (server) thread.
- `DimensionDataStorage` public surface: `computeIfAbsent/get/set(SavedDataType)`,
  `scheduleSave()` → `CompletableFuture`, `saveAndJoin()` (blocking), `close()`. There is no
  public cache-eviction API, so a same-JVM disk re-read cannot be forced; the restart probe
  script covers the fresh-process re-read.
- `GameTestHelper` assertions take `Component`: `assertTrue(boolean, Component)`,
  `assertFalse(boolean, Component)`, `assertValueEqual(N expected, N actual, Component name)`.
- Client gametest: `ClientGameTestContext.computeOnClient(FailableFunction<Minecraft, T, E>)` /
  `runOnClient(...)`; `TestServerContext.runOnServer(FailableConsumer<MinecraftServer, E>)` /
  `computeOnServer(...)`; network packets are synchronized per tick (a `waitTicks(1)` is enough
  for a C2S/S2C leg each way). `/op` is a dedicated-server-only command — op the singleplayer
  gametest player via `runOnServer(server -> server.getPlayerList().op(player.nameAndId()))`.
