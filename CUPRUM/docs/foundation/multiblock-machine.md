# W1 foundation — multiblock patterns + charge-machine layer (FROZEN CONCEPT)

Status: CONCEPT (W1). Infrastructure only, same footing as the Charge Probe ("CP0
infrastructure, deliberately not a catalog entry"). No catalog feature (PWR-07,
SHD-10, OXI kiln, …) is implemented here; broad content stays blocked until CP3, but
the layer is sized so those features later sit on it unchanged. Numbers/authority
follow `docs/feature-concepts/INDEX.md` (#1 server authority, #3 bounded scans,
#5 persistence).

## 1. Verified API facts (decompiled 1.21.9 Mojmap + FAPI 0.134.1+1.21.9)

Read from `.gradle/loom-cache/{minecraftMaven,remapped_mods}` sources in this repo;
append to `docs/API_PROBES.md` once compile-proven (shared file — see §11).

- `ValueInput`/`ValueOutput` (`net.minecraft.world.level.storage`): `read(String,Codec)`,
  `getIntOr`, `getLongOr`, `getStringOr`, `child`/`childOrEmpty`, `store`, `putInt`,
  `putLong`, `putBoolean`, `discard`. FAPI injects `FabricReadView`/`FabricWriteView`.
- `BlockEntity`: protected `loadAdditional(ValueInput)` / `saveAdditional(ValueOutput)`;
  `getUpdateTag(HolderLookup.Provider)` returns `CompoundTag`; `getUpdatePacket()`;
  `saveCustomOnly(HolderLookup.Provider)`; `preRemoveSideEffects(BlockPos, BlockState)` —
  called server-side by `LevelChunk.setBlockState` before `removeBlockEntity` unless
  flag 256 (`Block.UPDATE_SKIP_BLOCK_ENTITY_SIDEEFFECTS`).
- `Block.onRemove` is GONE. Replacement pair: `affectNeighborsAfterRemoval(BlockState,
  ServerLevel, BlockPos, boolean)` + `preRemoveSideEffects`. Neighbor hook:
  `neighborChanged(BlockState, Level, BlockPos, Block,
  @Nullable net.minecraft.world.level.redstone.Orientation, boolean)`.
- `TagValueOutput.createWithContext(ProblemReporter, HolderLookup.Provider)` /
  `.buildResult()`; `TagValueInput.create(ProblemReporter, HolderLookup.Provider,
  CompoundTag)`; `ProblemReporter.DISCARDING` is public.
- Menus: `AbstractContainerMenu(MenuType,int)`, `addDataSlots(ContainerData)`,
  protected static `stillValid(ContainerLevelAccess, Player, Block)`; `ContainerData`,
  `SimpleContainerData`, `DataSlot.forContainer`.
- GOTCHA: `ClientboundContainerSetDataPacket` writes each data-slot value as a
  **16-bit short** (`writeShort`). Values ≥ 2^16 must be lane-split (§6.1).
- `ExtendedScreenHandlerType<T,D>(ExtendedFactory<T,D>, StreamCodec<? super
  RegistryFriendlyByteBuf, D>)`; `ExtendedScreenHandlerFactory<D> extends MenuProvider`
  with `D getScreenOpeningData(ServerPlayer)` (fabric-screen-handler-api-v1 1.3.150).
- `Player.openMenu(@Nullable MenuProvider) → OptionalInt`; `BaseEntityBlock
  .getMenuProvider` returns the BE when it implements `MenuProvider`; 1.21.9
  `BaseEntityBlock` no longer forces an invisible render shape.
- `MenuScreens.register(MenuType<? extends M>, MenuScreens.ScreenConstructor<M,U>)` is
  mod-accessible via Fabric transitive access widener (entry verified in
  `fabric-transitive-access-wideners-v1.accesswidener`). Old `ScreenRegistry` is gone.
- `AbstractContainerScreen`: abstract `renderBg(GuiGraphics, float, int, int)`,
  `renderLabels(GuiGraphics, int, int)`, fields `imageWidth/imageHeight/leftPos/topPos`.
- Resource reload: **fabric-resource-loader-v1** `ResourceLoader.get(PackType)
  .registerReloader(ResourceLocation, PreparableReloadListener)`; v0
  `ResourceManagerHelper` is `@Deprecated`. 1.21.9 `PreparableReloadListener.reload`
  takes a `SharedState` (holds `ResourceManager` + `StateKey` store incl.
  `ResourceLoader.RELOADER_REGISTRY_LOOKUP_KEY`).
- `SimpleJsonResourceReloadListener<T>` protected ctors `(HolderLookup.Provider,
  Codec<T>, ResourceKey<Registry<T>>)` and `(Codec<T>, FileToIdConverter)`; strict JSON
  (`StrictJsonParser`, no comments); duplicate ids throw. Public static
  `scanDirectory(rm, lister, ops, codec, map)` exists as a fallback.
  `FileToIdConverter.json(String)`; `Registries.elementsDirPath` = bare path.
- `Rotation`/`Mirror` enums with `CODEC`; `Rotation.rotate(Direction)`,
  `Mirror.mirror(Direction)`, `BlockPos.rotate(Rotation)`. Vanilla
  `BlockPattern`/`BlockPatternBuilder`/`BlockInWorld` still exist (disposition §3.4).
- `Level.isLoaded(BlockPos)` (Level.java ~line 646), `LevelReader.hasChunkAt`,
  `Level.shouldTickBlocksAt`. Unguarded server `getBlockState` **sync-loads chunks**.
- Fabric events: `ServerChunkEvents.CHUNK_LOAD/CHUNK_UNLOAD` `(ServerLevel,
  LevelChunk)`, `ServerWorldEvents.UNLOAD` `(MinecraftServer, ServerLevel)`,
  `ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD` `(BlockEntity, ServerLevel)`;
  `FabricBlockEntityTypeBuilder.create(factory, blocks…).build()` (non-deprecated).
- GameTest: fabric `@GameTest(structure, maxTicks, rotation, …)`; default structure
  `fabric-gametest-api-v1:empty` is 8×8×8. `GameTestHelper`: `setBlock`,
  `assertBlockState`, `assertBlockEntityData`, `getBlockEntity(BlockPos, Class)`,
  `succeedWhen`, `runAfterDelay`, `startSequence`, `getTestRotation`, `assertValueEqual`.
  Client gametest 4.2.13: `ClientGameTestContext.waitForScreen/takeScreenshot/
  getInput()/setScreen`, `TestInput.pressMouse/pressKey/holdKeyFor`,
  `TestSingleplayerContext.getServer().runCommand`.
- `ByteBufCodecs.VAR_LONG`, `BlockPos.STREAM_CODEC`, `StreamCodec.composite`;
  `StatePropertiesPredicate.CODEC` is registry-ops-free; advancement
  `BlockPredicate.CODEC` needs `RegistryOps` (HolderSet) — deliberately NOT used.

## 2. Package/file ownership

New (N) / modified (M). Modified files are SHARED — flagged in §11.

- N `src/main/java/dev/cuprum/cuprum/multiblock/PatternGeometry.java` — pure-Java
  orientation math (no MC imports; JUnit-safe); N `.../multiblock/PatternShape.java` —
  pure-Java shape validation (layers/key/controller rules; codec validate AND JUnit).
- N `.../multiblock/MultiblockOrientation.java`, `BlockMatcher.java`,
  `MultiblockPattern.java`, `MultiblockMatch.java`, `MultiblockFault.java`,
  `FaultCode.java`, `FormationState.java`.
- N `.../multiblock/MultiblockPatterns.java` — reloader + static lookup + generation.
- N `.../multiblock/MultiblockLevelIndex.java` — per-level transient index + claims.
- N `.../multiblock/MultiblockControllerBehavior.java` — composable state machine.
- N `.../multiblock/MultiblockMemberBlock.java` — member base w/ fast invalidation.
- N `.../machine/ShortSplit.java`, `ChargeBuffer.java` — pure Java (JUnit-safe).
- N `.../machine/ChargeMachineBlockEntity.java`, `ChargeMachineOpenData.java`,
  `ChargeMachineMenu.java`.
- N `.../block/DiagnosticCoilCoreBlock.java`, `DiagnosticCoilFrameBlock.java`,
  `DiagnosticCoilCoreBlockEntity.java`.
- N `.../CuprumBlockEntities.java`, `CuprumMenus.java`.
- M `.../CuprumBlocks.java`, `CuprumItems.java`, `CuprumCreativeTabs.java`,
  `Cuprum.java` (+2 blocks/items, tab entries, reloader + event wiring).
- N `src/client/java/dev/cuprum/cuprum/client/machine/ChargeMachineScreen.java`;
  M `CuprumClient.java` (`MenuScreens.register`).
- N `src/gametest/.../MultiblockTestHelper.java`, `MultiblockGameTest.java`,
  `ChargeMachineGameTest.java`, `ChargeMachineClientGameTest.java`;
  M `src/gametest/resources/fabric.mod.json` (new entrypoints).
  N `src/test/java/dev/cuprum/cuprum/multiblock/PatternGeometryTest.java`,
  `PatternShapeTest.java`, `.../machine/ShortSplitTest.java`, `ChargeBufferTest.java`.
- M all six `src/datagen/...` providers (models=trivial cubes, dropSelf loot,
  en/de lang, pickaxe-mineable tags). Regenerate `src/main/generated` via `runDatagen`.
- N `src/main/resources/data/cuprum/cuprum_multiblock/diagnostic_coil.json`
  (hand-written, committed; no custom-dir datagen provider yet).
- N `assets/cuprum/textures/block/diagnostic_coil_{core,frame}.png`;
  M `scripts/gen_probe_texture.py` (deterministic generation).
- M `docs/API_PROBES.md` (append §1 facts once compile-proven);
  M `build.gradle` — add `systemProperty 'cuprum.mainResourcesDir', ...` to `test`.

## 3. Declarative pattern model

### 3.1 JSON schema — `data/<ns>/cuprum_multiblock/<id>.json`

```json
{
  "format_version": 1,
  "orientation_mode": "any_horizontal",
  "allow_mirror": true,
  "layers": [ [ "WOF", "FCF", "FFF" ] ],
  "key": {
    "W": { "block": "minecraft:waxed_copper_block" },
    "O": { "block": "minecraft:oxidized_copper" },
    "F": { "block": "cuprum:diagnostic_coil_frame" },
    "C": { "block": "cuprum:diagnostic_coil_core" }
  },
  "controller": "C"
}
```

Frozen rules (enforced by `PatternShape` + `Codec.validate`, precise error messages):
- Coordinates: `layers[y]` bottom→top; row index = z (north→south); char index = x
  (west→east). `.` = ignored cell (matches anything, not a member); air-required cells
  use `{"block":"minecraft:air"}`. Single-codepoint keys; every non-`.` char defined;
  unused key entries error; `controller` char occurs exactly once across all layers.
- Matcher: exactly one of `block` (`BuiltInRegistries.BLOCK.byNameCodec()` — unknown id
  fails parse) or `tag` (`TagKey.codec(Registries.BLOCK)`); optional `state` map of
  property-name → value-string (textual match vs `Property.getName(value)`; unknown
  prop/value = no match); optional `facing` (`Direction.CODEC`) — the ONLY
  rotation/mirror-aware check (expected value transformed by orientation first).
  No RegistryOps-dependent codecs → plain-`JsonOps` reloader ctor works.
- Caps: each dimension ≤ 16; non-`.` cells ≤ 512; key ≤ 64; `format_version` == 1.
- `orientation_mode`: `any_horizontal` (search 4 rotations × mirrors) or
  `controller_facing` (orientation from controller state's `facing`; mirror still
  searched when `allow_mirror`).

### 3.2 Core types (frozen signatures)

```java
public enum FormationState { UNFORMED, FORMED, FAULT }
public enum FaultCode implements StringRepresentable { MISMATCH, UNLOADED, CONFLICT, PATTERN_MISSING }
public record MultiblockFault(FaultCode code, Optional<BlockPos> pos, String detail) {}

public record MultiblockOrientation(Rotation rotation, Mirror mirror) {
    public static final List<MultiblockOrientation> HORIZONTAL_UNMIRRORED; // 4: NONE,CW90,CW180,CCW90
    public static final List<MultiblockOrientation> HORIZONTAL_ALL;        // 8, unmirrored first
    public BlockPos transformOffset(Vec3i patternLocalOffset); // mirror FIRST, then rotate (StructureTemplate order)
    public Direction transformFacing(Direction patternLocal);
}

public record MultiblockMatch(ResourceLocation patternId, MultiblockOrientation orientation,
                              long[] memberPositions) {}  // sorted BlockPos.asLong, incl. controller
public record MultiblockMatchResult(Optional<MultiblockMatch> match, Optional<MultiblockFault> bestFault) {}

public final class MultiblockPattern {
    public static final Codec<MultiblockPattern> CODEC;
    public static final int MAX_DIMENSION = 16, MAX_CELLS = 512, MAX_KEY_ENTRIES = 64, FORMAT_VERSION = 1;
    public int sizeX(); public int sizeY(); public int sizeZ();
    public Vec3i controllerCell(); public int memberCount();
    public MultiblockMatchResult tryMatch(ServerLevel level, BlockPos controllerPos);
    public Optional<BlockState> displayState(char key); // exact-block matchers only (test builder / future previews)
}
```

Only `Mirror.NONE` and `Mirror.LEFT_RIGHT` are supported (LEFT_RIGHT negates local z).
`PatternGeometry` holds the int-only math; `MultiblockOrientation` delegates to it.

### 3.3 Matching contract

Anchored at the controller position — never a volume scan. Per orientation: at most
`memberCount` reads, each guarded by `level.isLoaded(pos)`; an unloaded member
short-circuits that orientation with `UNLOADED`. On failure `bestFault` = fault from
the orientation with the most matched cells (tie → earlier canonical order), so faults
name a concrete world coordinate (shape needed later by PWR-07 slot diagnostics).

### 3.4 Vanilla `BlockPattern` disposition

Present in 1.21.9 but NOT used: volume-scanning `matches` (no anchor/controller
notion), no JSON form, no fault reporting; `BlockInWorld` caching can touch unloaded
chunks unless constructed with `loadChunks=false`.

## 4. Resource reload

```java
public final class MultiblockPatterns extends SimpleJsonResourceReloadListener<MultiblockPattern> {
    public static final ResourceLocation RELOADER_ID = ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "multiblock_patterns");
    public static final FileToIdConverter LISTER = FileToIdConverter.json("cuprum_multiblock");
    public MultiblockPatterns() { super(MultiblockPattern.CODEC, LISTER); }
    @Override protected void apply(Map<ResourceLocation, MultiblockPattern> patterns, ResourceManager rm, ProfilerFiller profiler);
    public static Optional<MultiblockPattern> get(ResourceLocation id);
    public static int reloadGeneration(); // bumped every apply; controllers revalidate on change
    public static int loadedCount();
}
// Cuprum.onInitialize():
ResourceLoader.get(PackType.SERVER_DATA).registerReloader(MultiblockPatterns.RELOADER_ID, new MultiblockPatterns());
```

Parse off-thread (vanilla split); `apply` swaps one `volatile Map.copyOf(...)` +
generation bump. SERVER_DATA only — the client never loads patterns; it renders
synced BE state only. Static (JVM-scoped) map is acceptable for W1, documented.

## 5. Index, claims, controller state machine

### 5.1 `MultiblockLevelIndex` (transient, server-only)

```java
public final class MultiblockLevelIndex {
    public static MultiblockLevelIndex get(ServerLevel level);            // lazy, identity-keyed
    public @Nullable BlockPos controllerAt(BlockPos memberPos);           // O(1)
    public boolean claim(BlockPos controllerPos, long[] memberPositions); // all-or-nothing
    public @Nullable BlockPos firstConflict(BlockPos controllerPos, long[] members);
    public void release(BlockPos controllerPos);
    public void requestRevalidation(BlockPos memberOrControllerPos);      // O(1) dirty-mark
    public static void onChunkLoad(ServerLevel l, LevelChunk c);          // ServerChunkEvents.CHUNK_LOAD
    public static void onChunkUnload(ServerLevel l, LevelChunk c);        // ServerChunkEvents.CHUNK_UNLOAD
    public static void onWorldUnload(MinecraftServer s, ServerLevel l);   // ServerWorldEvents.UNLOAD → drop index
    public static void onBlockEntityUnload(BlockEntity be, ServerLevel l);// release claims
}
```

Storage: fastutil `Long2LongOpenHashMap` member→controller,
`Long2ObjectOpenHashMap<long[]>` controller→members, plus per-chunk
(`ChunkPos.asLong`) grouping for O(members-in-chunk) load/unload invalidation.
Ownership rules (frozen):
1. A member position belongs to ≤ 1 controller; `claim` checks all then inserts all.
2. Claims exist only in FORMED (retained in FAULT — see 5.2); released on host
   removal/unload. Never persisted; on load a formed controller re-registers
   *provisional claims* recomputed from persisted orientation + pattern before its
   first verification tick (enables chunk-load invalidation).
3. Stale-claim eviction: on conflict, verify the recorded owner still holds a formed
   controller BE (loaded-chunk check first); if not, evict and retry once.
   Deterministic tie-break: lower `BlockPos.asLong()` wins.

### 5.2 `MultiblockControllerBehavior` (composition, NOT a BE base class)

```java
public final class MultiblockControllerBehavior {
    public static final int REVALIDATION_INTERVAL_TICKS = 20;
    public MultiblockControllerBehavior(BlockEntity host, ResourceLocation patternId);
    public FormationState state();
    public Optional<MultiblockFault> fault();               // present iff FAULT
    public Optional<MultiblockOrientation> orientation();   // present iff FORMED (or FAULT-from-FORMED)
    public void requestRevalidation();                      // idempotent dirty flag
    public void serverTick(ServerLevel level);              // ≤1 tryMatch/call; poll 20t, immediate when dirty/reload-gen changed
    public void save(ValueOutput output);                   // child "multiblock": formed, rotation, mirror
    public void load(ValueInput input);
    public void writeClientData(CompoundTag updateTag);     // "formation_state" byte, opt "fault_code" str + "fault_pos" int[3]
    public void readClientData(ValueInput input);           // client mirror
    public void onHostRemoved(ServerLevel level);           // call from preRemoveSideEffects → release claims
    public void setListener(FormationListener l);
    @FunctionalInterface public interface FormationListener { void formationChanged(FormationState prev, FormationState cur); }
}
```

State machine (server-only transitions):
- `UNFORMED → FORMED`: `tryMatch` succeeds AND `claim` succeeds; claim conflict →
  `FAULT(CONFLICT, firstConflictPos)`.
- `FORMED → FAULT(code,pos)`: revalidation fails. `MISMATCH` names the first failing
  pos; `UNLOADED` the first unloaded member; `PATTERN_MISSING` when the pattern id
  vanished after `/reload`. Claims retained in FAULT (prevents member theft while
  chunks cycle).
- `FAULT → FORMED`: revalidation succeeds again (repair / chunk reload).
- Composition rationale: the diagnostic core is BOTH a charge machine and a controller;
  single inheritance would force an artificial hierarchy.

### 5.3 Neighbor invalidation + chunk unload + no-chunkloading

- Fast path (Cuprum member blocks): `MultiblockMemberBlock extends Block` overrides
  `onPlace(...)` and `affectNeighborsAfterRemoval(...)` →
  `MultiblockLevelIndex.requestRevalidation(pos)`; next-tick revalidation.
  (`neighborChanged` w/ `@Nullable Orientation` available but unused in W1.)
  Vanilla members (waxed/oxidized copper — unhookable): the 20-tick poll catches
  changes; frozen fault-detection bound ≤ 40 ticks.
- Chunk events mark all controllers with members in that chunk dirty (per-chunk
  grouping); an unloaded member yields `FAULT(UNLOADED)` WITHOUT reading the chunk.
- No-chunkloading invariants: every world read preceded by `level.isLoaded(pos)`; no
  `getChunk(x,z,true)`, no ticket/force-load APIs anywhere; controller logic runs only
  from the vanilla BE ticker (only ticking chunks, `Level.shouldTickBlocksAt`).

## 6. Charge-machine BE / menu / screen sync layer

### 6.1 Pure-Java core (JUnit-safe, zero MC imports)

```java
public final class ChargeBuffer {
    public ChargeBuffer(long capacityCg);           // capacity > 0
    public long charge(); public long capacity();
    public long insert(long amountCg);              // returns accepted; IllegalArgumentException on negative
    public long extract(long amountCg);             // returns provided; throws on negative
    public void setCharge(long chargeCg);           // clamped [0, capacity]
    public boolean isEmpty(); public boolean isFull();
    public int scaledTo(int max);                   // 0 iff empty, max iff full, else clamp(floor,1,max-1)
}
public final class ShortSplit {
    public static final int LANES_PER_LONG = 4;     // W1 uses lanes 0..2 (48-bit cap = 2^48-1 Cg)
    public static int lane(long value, int lane);   // (int)((value >>> (16*lane)) & 0xFFFF)
    public static long combine(int lane0, int lane1, int lane2, int lane3);
}
```

Rationale: data slots sync as shorts (§1); 3 lanes cover all catalog magnitudes
(PWR-07 max 2,700,000 Cg).

### 6.2 `ChargeMachineBlockEntity` (ValueInput/ValueOutput only)

```java
public abstract class ChargeMachineBlockEntity extends BlockEntity {
    public static final int DATA_VERSION = 1;
    public static final String KEY_DATA_VERSION = "cuprum_data_version", KEY_CHARGE = "charge";
    public static final int SLOT_CHARGE_LANE0 = 0, SLOT_CHARGE_LANE1 = 1, SLOT_CHARGE_LANE2 = 2,
                            SLOT_STATUS = 3, DATA_SLOT_COUNT = 4;
    protected ChargeMachineBlockEntity(BlockEntityType<?> type, BlockPos pos, BlockState state, long capacityCg);
    public final ChargeBuffer chargeBuffer();
    public ContainerData createMenuData();          // live server view; SLOT_STATUS = formationStateOrdinalForMenu()
    protected int formationStateOrdinalForMenu();   // default FORMED(1); controller machines override
    protected final void markChangedAndSync();      // setChanged() + sendBlockUpdated(pos, s, s, Block.UPDATE_CLIENTS)
    @Override protected void saveAdditional(ValueOutput output);  // version + charge (+ subclass children)
    @Override protected void loadAdditional(ValueInput input);    // getIntOr(version,0) → migrate → getLongOr(charge,0) clamped
    @Override public ClientboundBlockEntityDataPacket getUpdatePacket(); // ClientboundBlockEntityDataPacket.create(this)
    @Override public CompoundTag getUpdateTag(HolderLookup.Provider r);  // saveCustomOnly(r) + transient client extras
}
```

Persistence/versioning (frozen):
- Keys: `cuprum_data_version:int=1`, `charge:long`, child `multiblock { formed:bool,
  rotation:string, mirror:string }` (Rotation/Mirror CODECs). Faults NOT persisted;
  pattern id NOT persisted (each controller BE type binds exactly one pattern id).
- Load: version 0 (absent) = pre-versioned → defaults; version > current → warn +
  best-effort; values clamped. Migrations = pure per-step functions in the BE class.
  Disk vs wire: disk save excludes fault data; `getUpdateTag` = `saveCustomOnly` +
  `writeClientData` extras (Beacon precedent); `CompoundTag` appears ONLY in the two
  vanilla-mandated wire methods.

### 6.3 Menu / open data / screen

```java
public record ChargeMachineOpenData(BlockPos pos, long capacityCg) {
    public static final StreamCodec<RegistryFriendlyByteBuf, ChargeMachineOpenData> STREAM_CODEC =
        StreamCodec.composite(BlockPos.STREAM_CODEC, ChargeMachineOpenData::pos,
                              ByteBufCodecs.VAR_LONG, ChargeMachineOpenData::capacityCg,
                              ChargeMachineOpenData::new);
}
public class ChargeMachineMenu extends AbstractContainerMenu {
    public ChargeMachineMenu(int containerId, Inventory inv, ChargeMachineOpenData data);       // client
    public ChargeMachineMenu(int containerId, Inventory inv, ChargeMachineBlockEntity machine); // server
    public long chargeCg();                   // ShortSplit.combine over slots 0..2
    public long capacityCg();
    public FormationState formationState();   // from SLOT_STATUS
    @Override public ItemStack quickMoveStack(Player player, int index); // ItemStack.EMPTY (no item slots in W1)
    @Override public boolean stillValid(Player player); // stillValid(access, player, coreBlock)
}
// CuprumMenus.java
public static final ExtendedScreenHandlerType<ChargeMachineMenu, ChargeMachineOpenData> CHARGE_MACHINE =
    Registry.register(BuiltInRegistries.MENU,
        ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "charge_machine"),
        new ExtendedScreenHandlerType<>(ChargeMachineMenu::new, ChargeMachineOpenData.STREAM_CODEC));
// client
public class ChargeMachineScreen extends AbstractContainerScreen<ChargeMachineMenu> {
    public ChargeMachineScreen(ChargeMachineMenu menu, Inventory inv, Component title);
    @Override protected void renderBg(GuiGraphics g, float pt, int mx, int my); // GuiGraphics.fill panel + bar (no texture asset)
    @Override protected void renderLabels(GuiGraphics g, int mx, int my);       // "%,d / %,d Cg" + formation line
}
// CuprumClient.onInitializeClient():
MenuScreens.register(CuprumMenus.CHARGE_MACHINE, ChargeMachineScreen::new);
```

Server authority: W1 defines ZERO C2S payloads — read-only menu (no
`clickMenuButton`); open via vanilla `player.openMenu(be)` with
`ExtendedScreenHandlerFactory` S2C open data; `stillValid` enforces vanilla range; all
mutation in the server ticker. Future C2S routes through INDEX.md contract #1 (hook:
`clickMenuButton` + `cuprum:` `CustomPacketPayload` via `PayloadTypeRegistry`).
Lang keys (datagen en+de): `container.cuprum.charge_machine`,
`cuprum.formation.formed|unformed|fault`, `cuprum.charge.readout`.

## 7. Diagnostic Coil (only structure in W1; NOT a catalog entry)

- `cuprum:diagnostic_coil_core` — `BaseEntityBlock`, `simpleCodec`, BE + server-only
  ticker via `createTickerHelper`; `useWithoutItem` opens menu when FORMED, action-bar
  fault text otherwise. `cuprum:diagnostic_coil_frame` — `MultiblockMemberBlock`.
  Both: `MapColor.COLOR_ORANGE`, `SoundType.COPPER`, strength 1.5F, trivial cubes,
  `dropSelf`, creative tab — Charge Probe conventions (`setId` before construction,
  `useBlockDescriptionPrefix`).
- Pattern `cuprum:diagnostic_coil` (§3.1): single-layer 3×3 ring; waxed-copper NW
  corner + oxidized-copper north edge form an L-asymmetry → all 8 orientations
  distinguishable (mirror ≠ any rotation); both markers oxidation-stable (no
  random-tick faults).
- `DiagnosticCoilCoreBlockEntity extends ChargeMachineBlockEntity implements
  ExtendedScreenHandlerFactory<ChargeMachineOpenData>`; owns
  `MultiblockControllerBehavior(this, DIAGNOSTIC_COIL_PATTERN_ID)`; overrides
  `preRemoveSideEffects` → `behavior.onHostRemoved` then `super`. Constants
  (diagnostic only, NOT the Cg economy): `CAPACITY_CG = 1_000L`,
  `CHARGE_PER_TICK_CG = 5` (INDEX.md baseline B) while FORMED; halts otherwise;
  `markChangedAndSync` ≤ every 10 ticks except on state transitions.

## 8. GameTest construction helpers (gametest source set)

```java
public final class MultiblockTestHelper {
    public static MultiblockPattern requirePattern(GameTestHelper h, ResourceLocation id);   // fail() if unloaded
    public static void buildPattern(GameTestHelper h, MultiblockPattern p, BlockPos controllerRel,
                                    MultiblockOrientation o); // setBlock per cell via displayState(); fail() on tag-only matchers
    public static BlockPos memberRel(MultiblockPattern p, BlockPos controllerRel, MultiblockOrientation o,
                                     int lx, int ly, int lz);
    public static DiagnosticCoilCoreBlockEntity coilCore(GameTestHelper h, BlockPos rel);
    public static void awaitFormation(GameTestHelper h, BlockPos rel, FormationState expected, Runnable then);
}
```

All tests fit the default 8×8×8 empty structure; `maxTicks = 100` (20-tick poll).

## 9. Test matrix

JUnit (`src/test`, pure Java per repo convention — NO Minecraft classes at runtime):
- `PatternGeometryTest` — 8-orientation transform table pinned by literal coords;
  mirror-before-rotate order; bijectivity; composition.
- `PatternShapeTest` — rectangularity, controller-exactly-once, undefined/unused key
  chars, caps; gson-parses committed `diagnostic_coil.json` via
  `cuprum.mainResourcesDir` system property.
- `ShortSplitTest` — round-trip at 0, 1, 0xFFFF, 2^48−1; lane bounds.
  `ChargeBufferTest` — clamps, negative rejection, `scaledTo` bands.

Server GameTests (`MultiblockGameTest`, `ChargeMachineGameTest`):
- `multiblockPatternJsonLoaded` — reloader ran; dims 3×3×1, memberCount 9.
- `patternGeometryMatchesVanillaRotation` — parity with `BlockPos.rotate(Rotation)`.
- `diagnosticCoilFormsNone` / `FormsRotated90` / `FormsMirrored` — FORMED + exact
  orientation + claims present.
- `diagnosticCoilFaultOnMemberBreak` — frame destroyed → FAULT/MISMATCH naming the
  pos (fast path ≤ 2 ticks); `diagnosticCoilFaultOnVanillaMemberChange` —
  oxidized_copper → stone → FAULT ≤ 40t; `diagnosticCoilReformsAfterRepair` —
  FAULT → FORMED, charging resumes; `diagnosticCoilConflictSecondController` —
  overlapping core → FAULT/CONFLICT, first stays FORMED.
- `diagnosticCoilPersistenceRoundTrip` — `saveAdditional` →
  `TagValueOutput.createWithContext(ProblemReporter.DISCARDING, level.registryAccess())`
  → fresh BE `loadAdditional` via `TagValueInput.create` → charge/version/orientation.
- `chargeMachineChargesWhileFormed` / `StopsAtCapacity` / `HaltsOnFault` — exact
  5 Cg/t between two reads; clamp at 1,000; frozen on fault.
- `chargeMachineMenuLanesEncodeCharge` — server menu lanes recombine to buffer value;
  status slot ordinal (state/dispatch only — no GUI vocabulary, per parity rules).

Client GameTest (`ChargeMachineClientGameTest`, runs under `scripts/client_smoke.sh`):
singleplayer world → `runCommand` builds coil → wait ≥ 40t → `TestInput` aims +
right-clicks core → `waitForScreen(ChargeMachineScreen.class)` → screenshots
`cuprum_diagnostic_coil_formed` + `cuprum_charge_machine_screen`.

## 10. Performance budgets (frozen)

- Match: ≤ memberCount reads × ≤ 8 orientations, anchored; diagnostic worst case 72
  guarded reads. Controller: ≤ 1 full `tryMatch` per tick; steady state 1 per
  20 ticks; events only advance the schedule.
- Index: O(1) member lookup; O(members) claim/release; ≈ 3 long-map entries/member;
  per-chunk grouping bounds unload invalidation.
- Reload: parse off-thread; apply = one map copy + volatile swap + generation bump.
  Sync: BE update packets ≥ 10-tick spacing except transitions; menu via vanilla
  per-slot short deltas.
- Hard ms/tick gates deferred to W14 (INDEX.md perf harness); W1 pins structural
  budgets deterministic in gametests.

## 11. SHARED-FILE EDITS — flag for lead reconciliation

Likely touched by other W1 workstreams; lead must merge/order: `Cuprum.java`
(`CuprumBlockEntities.init()`, `CuprumMenus.init()`, reloader + 4 event
registrations), `CuprumBlocks.java`/`CuprumItems.java`/`CuprumCreativeTabs.java`
(+2 entries each), `CuprumClient.java` (screen registration), `build.gradle`
(`cuprum.mainResourcesDir` test property), `src/gametest/resources/fabric.mod.json`
(entrypoint lists), all six `src/datagen` providers + `src/main/generated`
(regenerate ONCE after all W1 content lands), `scripts/gen_probe_texture.py`,
`docs/API_PROBES.md` (§1 append), `README.md` if the lead documents W1. Everything
else in §2 is exclusively owned by this workstream.

## 12. Compile probes (uncertainties + fallbacks)

1. `SimpleJsonResourceReloadListener(Codec, FileToIdConverter)` subclass generics —
   fallback: implement `PreparableReloadListener` + public static `scanDirectory`.
2. `ResourceLoader.get(PackType.SERVER_DATA).registerReloader(...)` resolves from the
   fat `fabric-api` compile classpath (module jar present in remapped_mods).
3. `new ExtendedScreenHandlerType<>(ChargeMachineMenu::new, STREAM_CODEC)` lambda
   inference `(syncId, inventory, data)`; `Registry.register(BuiltInRegistries.MENU, …)`
   accepts it (`super(null, FeatureFlags.VANILLA_SET)`); runtime feature-flag smoke.
4. `MenuScreens.register` TAW accessibility from mod client code (AW entry verified);
   watch duplicate-registration `IllegalStateException`; `selfTest()` logs gaps.
5. `TagValueOutput.createWithContext` / `TagValueInput.create` /
   `ProblemReporter.DISCARDING` classloading in the gametest source set.
6. `neighborChanged` override — Parchment param names for `redstone.Orientation`
   (kept unused in W1).
7. `Codec.validate(...)` on the shipped DFU (`Direction.VERTICAL_CODEC` uses it).
8. Client-gametest right-click reliability under Xvfb (tp yaw/pitch aiming +
   `pressMouse`); fallback `getInput().holdKeyFor(o -> o.keyUse, 2)`.

## 13. Banned stale pre-1.21.9 APIs (this module)

`BlockEntity.load/save(CompoundTag)` and `saveAdditional(CompoundTag, Provider)`;
`Block.onRemove`; old `neighborChanged(..., BlockPos fromPos, ...)`; Fabric v0
resource reload (`ResourceManagerHelper`, `IdentifiableResourceReloadListener`, …);
`ScreenRegistry`/`ScreenHandlerRegistry`; deprecated `BlockEntityRendererRegistry`
(no BER in W1 anyway); `FabricGameTest` / vanilla `@GameTest`; `Level.isClientSide`
field access (method now); `BlockEntityType.Builder.of` (use
`FabricBlockEntityTypeBuilder`); raw `PacketByteBufs` payloads (typed
`CustomPacketPayload` + `PayloadTypeRegistry` if C2S ever lands); vanilla
`BlockPattern.matchesAny` volume scanning.
