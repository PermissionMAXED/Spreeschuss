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
  `Context.responseSender()` is the exact per-connection sender also supplied to that connection's
  `ClientPlayConnectionEvents.JOIN`, so it is the payload's source-session identity.
  `Context.player()` is the client's current `LocalPlayer` when the callback executes; it is
  **not** a source identity for a callback queued across reconnect.
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
  - **FX send windows use the same session rule as `NetRateLimiter`.** The map lookup key is the
    UUID, but each `FxSendWindow` is owned by the exact `ServerGamePacketListenerImpl`; JOIN
    replaces the session, sends are get-only and owner-checked, DISCONNECT uses
    `server.execute` plus conditional `Map.remove(key, session)`, and SERVER_STOPPED sweeps.
    Dedicated reconnect/shutdown GameTest environments prove a stale owner cannot erase/reset a
    newer same-UUID window and each live 20-tick window delivers at most 16 payloads.
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

## Charge graph (W1B; compile-pinned by `charge/**`, runtime-pinned by `ChargeGraphGameTest` + `scripts/server_restart_probe.sh`)

### Block API lookup (fabric-api-lookup-api-v1 1.6.106+d17682157d)

- `BlockApiLookup.get(ResourceLocation, Class<A>, Class<C>)` returns the singleton lookup for
  `(id, apiClass, contextClass)` (re-`get` with different classes throws). Registration:
  `registerForBlockEntity(BiFunction<? super T, C, @Nullable A>, BlockEntityType<T>)` (also
  `registerForBlocks`, `registerSelf(BlockEntityType<?>...)` — the latter requires the BE to
  implement the API and bypasses the side gate, so Cuprum uses the BiFunction form to honor
  `canConnect(side)`). Query: `@Nullable A find(Level, BlockPos, C context)`.
- **`find` CAN load chunks** (correction of the earlier claim): the pinned
  `BlockApiLookupImpl.find(Level, BlockPos, @Nullable BlockState, @Nullable BlockEntity, C)`
  fills a null state via `Level.getBlockState(pos)` → `Level.getChunk(secX, secZ)` and a null
  BE (when `state.hasBlockEntity()`) via `Level.getBlockEntity(pos)` →
  `Level.getChunkAt(pos).getBlockEntity(...)` — both are chunk-REQUIRED paths that load (or
  generate) an absent chunk. When state AND BE are passed in, `find` performs **no world
  query** at all. The manager therefore (a) guards `notifyNodeAdded(BlockPos)` with
  `Level.isLoaded(pos)` — which only asks `getChunkSource().hasChunk(...)`, never loading —
  and (b) uses the 5-arg overload with the state/BE already delivered by the lifecycle event
  (`registerNode`); `cgLookupNeverLoadsChunks` proves the far-unloaded-position no-op at
  runtime. `ChargeApi.NODE` context is `Direction` (nullable = any side).
- Lookups are thread-agnostic containers, but Cuprum documents `ChargeApi.NODE` as
  **server-thread-only** and every `ChargeGraphManager` entrypoint asserts
  `MinecraftServer.isSameThread()` (throws `IllegalStateException("Cg: off-thread access")`).

### Server lifecycle events used by the graph (fabric-lifecycle-events-v1 2.6.9+33df5e6e7d)

- `ServerBlockEntityEvents.BLOCK_ENTITY_LOAD` / `BLOCK_ENTITY_UNLOAD`: callbacks
  `onLoad/onUnload(BlockEntity, ServerLevel)`. **Disk-path ordering (correction of the earlier
  claim)**: in the pinned sources the disk path loads BE data BEFORE the event —
  `LevelChunk.promotePendingBlockEntity` → `BlockEntity.loadStatic` calls
  `blockEntity.loadWithComponents(...)` first and only then `addAndRegisterBlockEntity` →
  `setBlockEntity`, whose `Map.put` is where Fabric's `WorldChunkMixin` fires LOAD. The
  earlier text wrongly attributed a pre-data registration to `promotePendingBlockEntity`.
  HOWEVER, Fabric's public javadoc still warns "its data might not be loaded yet, so don't
  rely on it" without pinning callers or ordering (LOAD also fires from every other
  `setBlockEntity` caller, e.g. placement), so the conservative behavior stands: only topology
  is registered on LOAD — stored Cg is pulled lazily by the allocator once the BE is live.
  **UNLOAD also fires after explicit removal** (`LevelChunk.removeBlockEntity` →
  `onBlockEntityRemove`), i.e. after `preRemoveSideEffects` already reported the removal — the
  manager's unload handler must be (and is) an idempotent no-op then. Explicit removal vents
  the live stored value or frozen shadow exactly once; unload only snapshots/freezes. The
  manager retains the source-BE identity token while frozen and refuses to act
  when the unloading BE instance is not the tracked SOURCE BlockEntity of the node (identity
  captured at registration, independent of the lookup/API object) — so a stale unload of ANY
  replaced BE at the position, charge node or not, is a no-op.
- `ServerChunkEvents.CHUNK_LOAD` (`(ServerLevel, LevelChunk)`), `CHUNK_UNLOAD`, and
  `CHUNK_LEVEL_TYPE_CHANGE` (`(ServerLevel, LevelChunk, FullChunkStatus oldLevelType,
  FullChunkStatus newLevelType)` — fires on promotion/demotion across `ENTITY_TICKING`): the
  ONLY places the manager queries `ServerLevel.shouldTickBlocksAt(long chunkPosKey)` (no
  per-tick polling). `ChunkPos.asLong(BlockPos)` maps node positions to chunk keys.
- `ServerTickEvents.END_WORLD_TICK` (`(ServerLevel)`) drives the per-level pipeline: budgeted
  rebuild (max 1024 visits) → allocator pass → SavedData snapshot if meaningfully changed.
  `ServerWorldEvents.LOAD/UNLOAD` + `ServerLifecycleEvents.SERVER_STOPPED` create/drop per-level
  managers (no state outlives its server).

### Block entity persistence & removal (1.21.9 Mojmap)

- BE disk I/O is `ValueInput`/`ValueOutput` only: `protected void saveAdditional(ValueOutput)`,
  `protected void loadAdditional(ValueInput)`; public test/tooling wrappers `saveCustomOnly
  (ValueOutput)` / `loadCustomOnly(ValueInput)`. `ValueOutput.child(String)` creates the
  `cuprum_state` envelope child; `ValueInput.childOrEmpty(String)`, `getIntOr`, `getLongOr`
  read it back with defaults (hostile values clamped by the BE, plan D5).
- `BlockEntity.preRemoveSideEffects(BlockPos, BlockState)` is the 1.21.9 explicit-removal hook
  (called from `Block.affectNeighborsAfterRemoval` paths before the BE leaves the chunk);
  override it (call `super`) to report `notifyNodeRemoved` — the following UNLOAD event is the
  idempotent-no-op case above. `BlockEntityType.getKey(BlockEntityType<?>)` (static) yields the
  registry id for warn-once logging.
- Real-tag round-trips in tests: `new ProblemReporter.ScopedCollector(Logger)` (AutoCloseable) +
  `TagValueOutput.createWithContext(ProblemReporter, HolderLookup.Provider)` →
  `CompoundTag buildResult()`, and `TagValueInput.create(ProblemReporter, HolderLookup.Provider,
  CompoundTag)`; `CompoundTag.getCompoundOrEmpty/getIntOr/getLongOr` for envelope assertions.
- Harness BE registration uses
  `FabricBlockEntityTypeBuilder.create(Factory<T>, Block...).build()` (fabric-object-builder);
  one `BlockEntityType` may span several blocks (DEFENSE/MISC sink variants of one type).

### Commands (`/cuprum cg`, permission level 2)

- `CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> ...)`
  (fabric-command-api-v2); build with `Commands.literal(...)` / `Commands.argument(...)`,
  gate with `.requires(source -> source.hasPermission(2))`.
- `BlockPosArgument.blockPos()` + `BlockPosArgument.getBlockPos(context, "pos")` — the plain
  getter does **not** throw `CommandSyntaxException` (only `getLoadedBlockPos` adds the
  loaded/in-bounds checks, which would contradict the "never loads chunks" contract; the
  manager's in-memory `nodeReport` lookup is used instead so unknown/unloaded positions just
  report "no node").

### GameTest facts (charge)

- `GameTestHelper.getBlockEntity(BlockPos, Class<T>)` is the 1.21.9 typed accessor (throws on
  wrong type — no manual casting); `onEachTick(Runnable)` runs every tick until success —
  combined with `succeedWhen(Runnable)` it pins exact-tick invariants. All exact-tick charge
  assertions are anchored to `ChargeGraphManager.allocatorTicks()` (allocator passes), never to
  GameTest tick offsets: the counter and the allocation mutate together in END_WORLD_TICK, so
  every observation sees a consistent (passes, stored) pair regardless of when in the tick the
  test's own tick callback runs.
- Event invokers let `ChargeLifecycleGameTest` drive the real registered BE and chunk listeners
  deterministically: both removal/unload orders, stale replacement callbacks, chunk
  unload/load, `CHUNK_LEVEL_TYPE_CHANGE`, shadow retention, reactivation and no phantom transfer.
- `SavedDataType` DataFixTypes stays `null` for `cuprum_charge_graph` (plan D1; see the W1A
  persistence section — Fabric's `PersistentStateManagerMixin` passes the NBT through). The
  restart probe extends to the charge graph: boot 1 must log the anchored
  `[charge] cuprum_charge_graph created dim=... nodes=... vented_total=...` line and leave
  `world/data/cuprum_charge_graph.dat` on disk; the probe replaces that empty initial snapshot
  with a valid one-node/678-Cg fixture. Boot 2 (preserved world) must log exactly
  `nodes=1 vented_total=678` in the `re-read` variant (only ever logged when
  `DimensionDataStorage.get` parsed a non-null instance from disk) and no `created` line;
  fresh boot 3 must be back to `created`.

## Multiblock & charge machine (W1C; compile-pinned by `MachineApiProbe` + `MachineClientApiProbe`, runtime-pinned by `MultiblockGameTest`/`ChargeMachineGameTest`/`ChargeMachineClientGameTest`)

### Resource reload (fabric-resource-loader-v1 1.6.7+0af9a1bc7d)

- `SimpleJsonResourceReloadListener<T>` protected ctor `(Codec<T>, FileToIdConverter)` works
  for mod subclasses (multiblock.md §12.1 — the `scanDirectory` fallback stays unused);
  `apply(Map<ResourceLocation,T>, ResourceManager, ProfilerFiller)` receives only entries
  whose codec parse SUCCEEDED — failures are logged per file and dropped, so `Codec.validate`
  chains double as load-time schema gates. Parsing is off-thread (vanilla prepare/apply
  split); `apply` runs on the reload thread → publish via one `volatile Map.copyOf` swap.
- `ResourceLoader.get(PackType.SERVER_DATA).registerReloader(ResourceLocation,
  PreparableReloadListener)` is the v1 registration (v0 `ResourceManagerHelper` is
  `@Deprecated`); SERVER_DATA reloaders run at server start AND `/reload` — a static
  generation counter (`MultiblockPatterns.reloadGeneration()`) lets controllers revalidate
  after `/reload` without holding pattern references.
- `FileToIdConverter.json("cuprum_multiblock")` lists `data/<ns>/cuprum_multiblock/*.json`
  (bare custom dir — no `Registries.elementsDirPath` needed for non-registry data).

### Pattern codecs & geometry (1.21.9 Mojmap)

- `Codec.validate(Function<T, DataResult<T>>)` exists on the shipped DFU (probe 4; vanilla
  precedent `Direction.VERTICAL_CODEC`) — every §3.1 shape rule (rectangularity, caps,
  controller-exactly-once, undefined/unused key chars) reports through `DataResult.error`
  with the offending char/coordinate in the message.
- Registry-ops-free matcher codecs: `BuiltInRegistries.BLOCK.byNameCodec()` (unknown id fails
  parse), `TagKey.codec(Registries.BLOCK)`, `Direction.CODEC`; state properties matched
  textually against `Property.getName(value)`. Advancement `BlockPredicate.CODEC` needs
  `RegistryOps` (HolderSet) and is deliberately NOT used → the plain-JsonOps reloader ctor
  works.
- Vanilla transform order is mirror FIRST, then rotate (pinned by
  `StructureTemplate.transform(BlockPos, Mirror, Rotation, BlockPos)`); `BlockPos.rotate
  (Rotation)` rotates around (0,0,0); `Mirror.LEFT_RIGHT.mirror(Direction)`/`Rotation.rotate
  (Direction)` transform facings. The MC-free `PatternGeometry` mirrors these exactly —
  `patternGeometryMatchesVanillaRotation` asserts parity at runtime, `PatternGeometryTest`
  pins the 8-orientation literal table in JUnit. Only `Mirror.NONE`/`LEFT_RIGHT` are used
  (LEFT_RIGHT negates local z); `Rotation.CODEC`/`Mirror.CODEC` persist orientation.
- `Level.isLoaded(BlockPos)` guards EVERY member read (matching is anchored at the controller
  — never a volume scan; vanilla `BlockPattern` rejected per multiblock.md §3.4: volume
  scanning, no fault reporting, `BlockInWorld` may load chunks).

### Menus, open data & screens (fabric-screen-handler-api-v1 1.3.150)

- `new ExtendedScreenHandlerType<>(ChargeMachineMenu::new, ChargeMachineOpenData.STREAM_CODEC)`
  infers the `(syncId, inventory, data)` client factory (probe 3);
  `Registry.register(BuiltInRegistries.MENU, id, type)` accepts it (`super(null,
  FeatureFlags.VANILLA_SET)` — no feature-flag gating). Open data:
  `StreamCodec.composite(BlockPos.STREAM_CODEC, …, ByteBufCodecs.VAR_LONG, …, ::new)`.
- Server side: the BE implements `ExtendedScreenHandlerFactory<D>` (`extends MenuProvider`)
  with `D getScreenOpeningData(ServerPlayer)`; `Player.openMenu(MenuProvider) → OptionalInt`
  sends the S2C open packet with the encoded data. Menu ctor rule: `addDataSlots
  (ContainerData)` MUST run in the ctor (vanilla contract) — javac 21 `this-escape` +
  `-Werror` requires `@SuppressWarnings("this-escape")` on the public ctors.
- `ClientboundContainerSetDataPacket` writes each data-slot value as a 16-bit short
  (`writeShort`) — hence `ShortSplit` 3×16-bit charge lanes (48-bit cap) + 1 status slot;
  vanilla `AbstractContainerMenu.broadcastChanges` sends per-slot deltas only.
  `stillValid(ContainerLevelAccess, Player, Block)` (protected static) enforces the vanilla
  8-block range; `ContainerLevelAccess.NULL` is the client-ctor stand-in.
- Client: `MenuScreens.register(MenuType<? extends M>, ScreenConstructor<M,U>)` is
  mod-accessible via Fabric's transitive access widener (probe: `MachineClientApiProbe`);
  duplicate registration throws `IllegalStateException` at first screen open. Texture-free
  screens draw with `GuiGraphics.fill(x1,y1,x2,y2,argb)` + `drawString(Font, Component, x, y,
  color, shadow)` inside `renderBg`/`renderLabels`.

### Machine BE envelope & sync (extends the frozen W1B storage BE)

- **`TagValueOutput.child(String)` REPLACES an existing child** (it `put`s a fresh
  `CompoundTag`) — a subclass that needs to extend the frozen parent's `cuprum_state`
  envelope must run `super.saveAdditional(output)` first, then rewrite the child with
  identical schema/charge values plus its extension (`ChargeMachineBlockEntity` javadoc;
  bytes for non-machine storages unchanged). `ValueInput.childOrEmpty`, `getByteOr`,
  `getIntArray` (returns `Optional<int[]>`) read it back.
- Wire vs disk (plan §3.1): `getUpdateTag(HolderLookup.Provider)` = `saveCustomOnly
  (registries)` + transient client extras (Beacon precedent); `getUpdatePacket()` =
  `ClientboundBlockEntityDataPacket.create(this)`; **client applies the update tag through
  `loadAdditional`** (`loadWithComponents` path) — transient keys (`formation_state`,
  `fault_code`, `fault_pos`) must therefore be namespaced OUTSIDE `cuprum_state` and never
  written to disk. Sync throttle: `level.sendBlockUpdated(pos, state, state,
  Block.UPDATE_CLIENTS)` gated by `level.getGameTime()` deltas (≥10 ticks except
  transitions).
- Removal/invalidations: `Block.onRemove` is GONE — member fast path overrides `onPlace` +
  `affectNeighborsAfterRemoval(BlockState, ServerLevel, BlockPos, boolean)`; the controller
  BE overrides `preRemoveSideEffects(BlockPos, BlockState)` (server-side, before the BE
  leaves the chunk) to release claims. `neighborChanged(BlockState, Level, BlockPos, Block,
  @Nullable redstone.Orientation, boolean)` exists but stays unused in W1.
- Index lifecycle wiring (fabric-lifecycle-events-v1): `ServerChunkEvents.CHUNK_LOAD/
  CHUNK_UNLOAD`, `ServerWorldEvents.UNLOAD`, `ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD` —
  all registered once in `MachineModule.init()`; creative-tab append via
  `ItemGroupEvents.modifyEntriesEvent(CuprumCreativeTabs.CUPRUM_TAB_KEY)` (plan D4 — the
  frozen `CuprumCreativeTabs` is never edited). `BaseEntityBlock` needs `simpleCodec` +
  `codec()` override; server-only ticker via `createTickerHelper(type, expected, ticker)`
  returning `null` on the client.

### GameTest facts (multiblock/machine)

- `TagValueOutput.createWithContext(ProblemReporter.DISCARDING, level.registryAccess())` /
  `TagValueInput.create(...)` classload fine in the gametest source set (probe 5) — the
  persistence round-trip drives `saveAdditional`/`loadAdditional` on a detached BE without
  touching the world copy.
- `GameTestSequence.thenWaitUntil(Runnable)` (assertion-until-pass) is the robust wait;
  the `(long expectedDelay, Runnable)` overload demands an EXACT tick and fails when the
  condition lands earlier — tick budgets are asserted separately via `getLevel().getGameTime()`
  deltas captured around the wait.
- `GameTestHelper.getTestRotation()` feeds the vanilla-parity assertions;
  `helper.absolutePos`/`setBlock` compose with pattern `displayState(char)` to build
  orientation variants; `destroyBlock` exercises the fast removal path, `setBlock` to a
  vanilla block the ≤40-tick poll path.
- Client gametest (fabric-client-gametest-api-v1 4.2.13): `context.worldBuilder().create()`
  (try-with-resources closes the world), `getClientWorld().waitForChunksRender()`,
  `getServer().runCommand("setblock …")` for deterministic structure builds,
  `getInput().holdKeyFor(options -> options.keyUse, 2)` right-clicks reliably under Xvfb
  (multiblock.md §12.8 fallback chosen over `pressMouse` aiming),
  `waitForScreen(ChargeMachineScreen.class)`, `takeScreenshot(name)`. New client tests append
  AFTER `CuprumClientGameTest` in `fabric-client-gametest` entrypoints so the W1A screenshot
  numbering expected by `scripts/client_smoke.sh` is unchanged.

## Custom pipelines & FX foundation (W1D; compile-pinned by `FxApiProbe`, runtime-pinned by `FxCapabilityProbe` + `FxRippleClientGameTest`)

### RenderPipeline registration & the compile probe (Blaze3D, 1.21.9)

- Vertex-format + builder recipe (probes 1/1b): Minecraft 1.21.9 exposes no
  `DefaultVertexFormat.POSITION_COLOR_TEX`, so Cuprum composes the exact contract with
  `VertexFormat.builder().add("Position", VertexFormatElement.POSITION)
  .add("Color", VertexFormatElement.COLOR).add("UV0", VertexFormatElement.UV0).build()`, then
  `RenderPipeline.builder(RenderPipelines.MATRICES_FOG_SNIPPET)`
  `.withLocation(rl).withVertexShader(rl).withFragmentShader(rl)`
  `.withBlend(BlendFunction.LIGHTNING)` (additive: `SRC_ALPHA, ONE`) `.withDepthWrite(false)`
  `.withVertexFormat(positionColorTex, VertexFormat.Mode.QUADS).build()`;
  registration via **static** `net.minecraft.client.renderer.RenderPipelines.register(pipeline)`
  (mod-accessible; must run in client init so the pipeline is in `getStaticPipelines()`
  BEFORE the first `ShaderManager` apply). Shader location resolves to
  `assets/<ns>/shaders/core/<path>.vsh/.fsh`; `#moj_import <minecraft:fog.glsl>` /
  `<minecraft:dynamictransforms.glsl>` / `<minecraft:projection.glsl>` provide the snippet's
  uniform blocks (`ProjMat`, `ModelViewMat`, `ColorModulator`, `Fog*` — all verified in the
  shipped assets). The T1 format is position + packed normalized RGBA + float2 UV0
  (24 bytes/vertex); the emitter probe pins
  `VertexConsumer.addVertex(...).setColor(...).setUv(signedBand, normalizedLife)`.
- **Registered-pipeline failure posture** (verified `ShaderManager.apply` /
  `GlDevice.precompilePipeline`): a static-registered pipeline whose shaders fail to compile
  **hard-fails the resource reload** (`ShaderManager` throws before listeners after
  `minecraft:shaders` run) — graceful demotion therefore CANNOT hinge on catching a source
  compile crash. Registered particle sprite JSON is likewise parsed by vanilla
  `ParticleResources` during reload. JUnit pins required source/processed resources and parses
  particle JSON; the client GameTest is the real shader compile gate.
  The interceptable runtime half is `FxCapabilityProbe.run`:
  `RenderSystem.tryGetDevice()` (nullable accessor, probe 3) then
  `device.precompilePipeline(pipeline).isValid()` — a cache-hit/deferred-backend confirmation.
  Missing/invalid device, invalid result, or runtime exception calls the production T2 demotion
  helper. `FxFailurePathsClientGameTest` invokes these production decision seams (never
  `FxTierPolicy.demote` directly), and a valid `FxReloadListener` pass proves recovery.
- **Built-in GameTime uncertainty (CP0C posture, recorded):** `GameTime` lives in the
  `Globals` UBO (`GLOBALS_SNIPPET`), which `MATRICES_FOG_SNIPPET` does **not** include, and no
  probe proves a custom pipeline may bind `Globals` or any per-draw uniform. W1D therefore
  promises NEITHER: ripple animation is CPU-computed geometry (tick-quantized radius/alpha in
  `RippleMath`, tessellated per-frame in `FxRippleGeometry`), and the shaders touch only
  snippet-provided uniforms. Iris-specific queries stay in W4 U23 — `FxCompat` only logs
  `FabricLoader.isModLoaded("sodium"/"iris")` and always returns compat cap T1 in W1D.

### World RenderTypes over custom pipelines

- `RenderType.create(name, RenderType.TRANSIENT_BUFFER_SIZE /*1536*/, false /*no crumbling*/,
  true /*sorted*/, pipeline, RenderType.CompositeState.builder().createCompositeState(false))`
  (probe 2) — batches through the same `CustomFeatureRenderer` path as vanilla; one
  VertexConsumer per RenderType per frame, so T1 costs exactly **one** extra world batch.
  CP0C census: ≤4 Cuprum world-FX RenderTypes ever (`FxBudgets.MAX_WORLD_FX_RENDER_TYPES`;
  ripple now + reserved arc/dome/aurora slots); `CuprumRenderTypes.worldFxTypes()` is the
  static-asserted census list. T2 adds **zero** types — it rides vanilla
  `RenderType.lightning()` (same additive/no-depth-write recipe, verified).
- BER submit path: `SubmitNodeCollector.submitCustomGeometry(poseStack, renderType, renderer)`
  (W1A probe still valid); the collector callback receives `(PoseStack.Pose, VertexConsumer)`
  and runs at draw time — extraction (`FxDispatcher.extractRipplesAt` → primitive arrays in
  `FxProbeRenderState`) must copy everything, no live refs. `FxRenderSubmission` guards both
  registration and callback execution: only the positive count actually returned after all
  `VertexConsumer.addVertex` calls increments submit/vertex stats. Zero/throwing T1 emitters
  demote T2 with no success counters; a failing T2 emitter demotes T3. `FxFrameStats.beginFrame`
  keys the aggregate on the per-frame camera-position object shared by BER extraction, so the
  2,048-vertex breach check spans all callbacks rather than trusting a precomputed per-BE count.

### Cosmetic event identity and world-key defense

- `FxRipplePayload` needs no extra field: `(center.asLong(), gameTime)` is the event identity.
  The fixed ring's `addIfAbsent` scans at most 16 slots before mutation; an exact duplicate
  cannot recolor/brighten, burst particles, consume capacity, evict, or increment accounting.
- The dispatcher retains the exact `ResourceKey<Level>` for its live pool. Tick/extract/direct
  observation clears old-dimension pool, particle, and frame state. The networking receiver
  captures `context.responseSender()` as source identity, samples only the current
  `context.client().level.dimension()`, then holds the FX session lock across sender validation
  and the complete dispatcher/frame/particle transition. `context.player()` is also current,
  not source. A callback from A after B's JOIN, or from B after B's DISCONNECT, is therefore
  dropped before it can repopulate any current-world state.

### Particles (1.21.9 `SingleQuadParticle` era)

- `TextureSheetParticle` is GONE; sprite particles extend
  `net.minecraft.client.particle.SingleQuadParticle` (ctor `(ClientLevel, x, y, z,
  TextureAtlasSprite)`; abstract `getLayer()` returns a `SingleQuadParticle.Layer` record
  carrying the RenderPipeline — `Layer.TRANSLUCENT` reuses the vanilla particle pipeline, no
  custom type needed). Probe 4a. **The `(level,x,y,z,sprite,xd,yd,zd)` super ctor adds random
  velocity noise** (`±0.4*(random-0.5)` per axis, then normalizes) — deterministic motes must
  overwrite `xd/yd/zd` AFTER `super(...)` (done in `CopperMoteParticle`).
- Sprite wiring: `ParticleFactoryRegistry.getInstance().register(type,
  PendingParticleFactory)` — the factory receives `FabricSpriteProvider` (probe 4b);
  `particles/<name>.json` `{"textures": ["cuprum:copper_mote"]}` maps to
  `textures/particle/copper_mote.png`. Registration client-init; type registration common
  (`FabricParticleTypes.simple()` + `BuiltInRegistries.PARTICLE_TYPE`).
- Spawn: `ClientLevel.addParticle(options, x, y, z, xd, yd, zd)` respects the vanilla particle
  status option; budget gating (`FxParticleBudget`) wraps it with per-tick + live caps. A
  delegated runtime exception rolls back the just-reserved budget slot before the production
  helper demotes the FX cap to OFF, so failed creation is never counted as a live/successful mote.

### Client FX lifecycle & accessibility hooks

- Reload: `ResourceLoader.get(PackType.CLIENT_RESOURCES).registerReloader(id, listener)` +
  `addReloaderOrdering(ResourceReloaderKeys.Client.SHADERS, id)` (probe 6) — guarantees the
  FX listener runs after vanilla shader (re)compilation, so `precompilePipeline` sees the
  fresh cache. Reload is the FX reset point: failure-cap clear → capability probe → compat
  refresh → palette parse → pool clear (leak-free by construction; pools hold primitives).
- Reset events (probe 7 + W1A's connection-event probe): `InvalidateRenderStateCallback.EVENT`
  (F3+A, pack changes, video settings) clears pools + counters, while
  `ClientPlayConnectionEvents.JOIN` clears old FX state under the FX session lock before
  atomically installing both the new handler and exact JOIN response-sender identities.
  DISCONNECT may fire on Netty (W1A threading facts apply) and synchronously clears only the
  matching active handler, or the no-active-session state before a newer JOIN; stale A after B
  is a no-op. Payload delivery uses the response-sender half of the same locked session. The
  nested lock order is FX session lock → synchronized dispatcher, and the any-thread lifecycle
  path touches no Minecraft/world state.
  `ClientTickEvents.END_WORLD_TICK` drives dispatcher aging/mote cadence.
- Accessibility accessors (probe 8): `minecraft.options.hideLightningFlash().get()` (boolean),
  `.screenEffectScale().get()` (double 0..1), `.particles().get()` (`ParticleStatus`) — the
  vanilla side of `FxSettings.effectiveFlash()`; Cuprum-side caps come from the frozen W1A
  `CuprumClientConfig` fields (`fxTierCap`, `flashScale`, `colorblindMode`).
- Colorblind remap is data-driven from `assets/cuprum/fx/colorblind.json` (3×3 row-major RGB
  matrices, MC-free math in `ColorblindCore`); missing/malformed file disables remap with one
  warning — NEVER a tier change.

## Handbook / config / test foundation (W1E; compile- and runtime-pinned by the handbook module + gametests)

### Server-data reloading (bounded JSON)

- Fabric v1 reloader API also serves data packs:
  `ResourceLoader.get(PackType.SERVER_DATA).registerReloader(id, listener)` — same
  `net.fabricmc.fabric.api.resource.v1.ResourceLoader` used for W1D client reloads.
  `HandbookManager extends SimplePreparableReloadListener<…>` (`prepare(ResourceManager,
  ProfilerFiller)` off-thread, `apply(...)` on the reload thread); vanilla
  `net.minecraft.resources.FileToIdConverter.json("handbook/pages")` enumerates
  `data/<ns>/handbook/pages/**.json` and `fileToId` recovers the ResourceLocation.
- Parse with `net.minecraft.util.StrictJsonParser.parse(Reader)` (same strict parser vanilla
  uses for data) + DFU `Codec.parse(JsonOps.INSTANCE, json)`. Reloader posture mirrors
  vanilla `SimpleJsonResourceReloadListener`: a malformed file logs + skips (counted in
  `HandbookManager.skippedFiles()`), NEVER crashes the reload. Note codecs built from
  records can also throw `IllegalArgumentException` out of the canonical constructor —
  strict-parse failure tests must accept both `DataResult.error` and the throw.
- Post-reload resync hook: `ServerLifecycleEvents.END_DATA_PACK_RELOAD.register((server,
  resourceManager, success) -> …)` — fires after `/reload` completes (also on failed reloads
  with `success=false`); Cuprum resyncs the snapshot to every `PlayerLookup.all(server)`.

### Player data attachments (Fabric Attachment API v1)

- `net.fabricmc.fabric.api.attachment.v1.AttachmentRegistry.create(id, builder -> builder
  .persistent(codec).copyOnDeath().syncWith(streamCodec, AttachmentSyncPredicate.targetOnly()))`
  — persistent player attachments ride player NBT (survive restart), `copyOnDeath()` covers
  respawn, `syncWith(..., targetOnly())` auto-syncs to the owning client only. Client read:
  `entity.getAttachedOrElse(type, fallback)`; server mutate:
  `player.modifyAttached(type, fn)` (sync packet sent automatically on change).
- **Gametest caveat:** mock players that skip the CONFIGURATION phase never negotiate
  supported attachment channels, so Fabric silently skips the sync packet — attachment
  gametests must assert server-side state (`getAttached`) and player-NBT round-trips
  (`TagValueOutput.createUnvalidated` → `player.saveWithoutId` →
  `TagValueInput.create(...)` → `player.load`) instead of counting sync payloads.

### Recipe displays (server → client, no client recipe manager)

- 1.21.9 clients no longer hold the recipe tree; the display layer is
  `net.minecraft.world.item.crafting.display.RecipeDisplay` (dispatched:
  `ShapedCraftingRecipeDisplay`/`ShapelessCraftingRecipeDisplay`/`FurnaceRecipeDisplay`) with
  a vanilla `RecipeDisplay.STREAM_CODEC`. Server side:
  `server.getRecipeManager().byKey(ResourceKey.create(Registries.RECIPE, id))` →
  `holder.value().display()` (a `List<RecipeDisplay>`). Client rendering resolves
  `SlotDisplay.resolveForFirstStack(contextMap)`; the empty context is
  `new ContextMap.Builder().create(SlotDisplayContext.CONTEXT)` — `ContextMap.EMPTY` does
  NOT exist in 1.21.9.

### Client UI (Screen/EditBox/Button, 1.21.9 signatures)

- `Screen` subclass hooks used: `init()` (add widgets), `render(GuiGraphics, mouseX, mouseY,
  partialTick)` (call `super.render` first — it paints the blur/background),
  `resize(Minecraft, w, h)`, `onClose()`, `mouseScrolled(x, y, xDelta, yDelta)`,
  `keyPressed(KeyEvent)` — 1.21.9 wraps key/mouse input in `net.minecraft.client.input.KeyEvent`
  / `MouseButtonEvent` (with `MouseButtonInfo`) instead of raw ints.
- `EditBox` fires `setResponder(Consumer<String>)`; `Button.builder(msg, onPress)
  .bounds(x, y, w, h).build()`; `Button.DEFAULT_NARRATION` is **protected** — custom buttons
  needing it must be named subclasses of `Button`, not lambdas/anonymous classes elsewhere.
  Narration: override `updateWidgetNarration(NarrationElementOutput)` and use
  `NarratedElementType.TITLE/HINT`.
- Keybind: `KeyMapping.Category.register(ResourceLocation)` first (1.21.9 replaced free-form
  category strings), then `KeyBindingHelper.registerKeyBinding(new KeyMapping(name, keyCode,
  category))`; poll `while (key.consumeClick())` in `ClientTickEvents.END_CLIENT_TICK`.
- GUI-scale responsiveness comes free by laying out from `this.width`/`this.height` in
  `init()`; `minecraft.options.guiScale().set(n)` + `minecraft.resizeDisplay()` re-inits the
  screen (client gametest-proven).

### Cloth Config / AutoConfig / Mod Menu (dev-runtime UI over frozen W1A config)

- AutoConfig (bundled in cloth-config 20.0.149): `AutoConfig.register(Class,
  JanksonConfigSerializer::new)` once per config class (client init — server stays on the
  frozen W1A hand-rolled loader as authority), then `AutoConfig.getConfigHolder(Class)` /
  `AutoConfig.getConfigScreen(Class, parent).get()`. GUI keys derive from
  `text.autoconfig.<name>.title|category.<cat>|option.<field>`; `@ConfigEntry.Gui.Tooltip`
  adds `.@Tooltip`; enum options localize via `text.autoconfig.<name>.option.<field>.<VALUE>`.
- Mod Menu entrypoint: `"modmenu": ["…client.config.CuprumModMenu"]` in fabric.mod.json,
  implementing `com.terraformersmc.modmenu.api.ModMenuApi#getModConfigScreenFactory`.
  `modCompileOnly` dependency only — Mod Menu is a dev-runtime mod (`modLocalRuntime`).

### Client GameTest additions (beyond the W1A–D facts)

- `ClientGameTestContext.clickScreenButton(text)` matches the **translated display string**,
  not the translation key — locale-dependent. For robust interaction find the widget via
  `screen.children()`, match `TranslatableContents.getKey()` on its message, then
  `input.setCursorPos(windowX, windowY)` + `input.pressMouse(GLFW.GLFW_MOUSE_BUTTON_LEFT)`
  at the widget centre scaled by `window.getGuiScale()`.
- Language switch in-test: `minecraft.options.languageCode = "de_de"` +
  `minecraft.getLanguageManager().setSelected(...)` + `minecraft.reloadResourcePacks()`
  (wait for completion) — used by the EN/DE search assertions; restore in `finally`.
- `context.assertScreenshotEquals(...)`/template bootstrap: templates live in
  `src/gametest/resources/templates/<name>.png`; bootstrap by running once with
  `-Dfabric.client.gametest.testModResourcesPath` pointing at the resources dir.

### API freeze + perf harness (test-infra facts)

- `javap -protected -classpath <classesDirs> <fqcn>` over the compiled main+client trees
  gives a stable public/protected surface once normalized (strip `Compiled from`, constant
  pool indices, sort members); SHA-256 of the normalized dump is pinned in
  `api/cuprum-api.lock` and asserted by `ApiFreezeTest` (regenerate via
  `./gradlew test -Dcuprum.apilock.update=true`).
- Perf sampling: server side `MinecraftServer.getAverageTickTimeNanos()` (smoothed),
  client side `Minecraft.getFrameTimeNs()`; `PerfSampler`/`PerfBudget` (gametest source set)
  aggregate N samples after warmup and assert the mean against `PerfBudgets` literals,
  writing JSON reports under `build/perf/`.
