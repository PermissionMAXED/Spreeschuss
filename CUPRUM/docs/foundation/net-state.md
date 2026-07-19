# Cuprum W1 foundation — networking, ownership, permissions, state, migrations (CONCEPT)

Status: **concept, no gameplay**. Target stack: Minecraft 1.21.9 (Mojmap + Parchment),
Fabric Loader 0.19.3, Fabric API 0.134.1+1.21.9, Java 21. Every signature marked
*(verified)* was read from the decompiled 1.21.9 Mojmap sources or the remapped Fabric
API 0.134.1 module sources in `.gradle/loom-cache/` (networking-api-v1 5.0.13,
data-attachment-api-v1 1.8.28, object-builder-api-v1 21.1.24, lifecycle-events-v1).
Items marked *(probe)* must be compile-proven in W1 before dependent code is written
(same convention as `docs/API_PROBES.md` / `RenderApiProbe`).

Binding upstream contracts: `docs/feature-concepts/INDEX.md` §"Binding cross-cutting
contracts" (server authority, rate limits, ownership/teams, persistence, game-time
expiry) and the QOL/TES/SHD security paragraphs. Constants live in
`cuprum-common.json5`; gametests read the same config.

---

## 1. Verified API base

Networking (Fabric `fabric-networking-api-v1`, all *(verified)*):

- `PayloadTypeRegistry.playC2S()/playS2C()` → `PayloadTypeRegistry<RegistryFriendlyByteBuf>`;
  `configurationC2S()/configurationS2C()` → `PayloadTypeRegistry<FriendlyByteBuf>`;
  `<T extends CustomPacketPayload> CustomPacketPayload.TypeAndCodec<? super B, T>
  register(CustomPacketPayload.Type<T>, StreamCodec<? super B, T>)`.
  Registration must happen on **both sides** at mod init, **before** receiver registration.
- `ServerPlayNetworking.registerGlobalReceiver(CustomPacketPayload.Type<T>, PlayPayloadHandler<T>)`;
  handler runs **on the server thread**; `Context { MinecraftServer server(); ServerPlayer player();
  PacketSender responseSender(); }`; `send(ServerPlayer, CustomPacketPayload)`;
  `canSend(ServerPlayer, CustomPacketPayload.Type<?>)`; `getSendable(...)`.
- `ServerConfigurationNetworking.registerGlobalReceiver/send(ServerConfigurationPacketListenerImpl, ...)`.
- Client side (client-only classes): `ClientPlayNetworking` / `ClientConfigurationNetworking`
  with `registerGlobalReceiver`, `send(CustomPacketPayload)`, `canSend`; play Context
  `{ Minecraft client(); LocalPlayer player(); PacketSender responseSender(); }`.
- `PlayerLookup.all/world/tracking(ServerLevel, ChunkPos)/tracking(Entity)/tracking(BlockEntity)/around`.
- Events: `ServerPlayConnectionEvents.INIT/JOIN/DISCONNECT`,
  `EntityTrackingEvents.START_TRACKING/STOP_TRACKING`,
  `ServerTickEvents.END_SERVER_TICK`, `ServerLifecycleEvents.SERVER_STARTED/SERVER_STOPPING`.

Vanilla networking (all *(verified)*):

- `CustomPacketPayload { Type<? extends CustomPacketPayload> type(); }`,
  `record Type<T>(ResourceLocation id)`, `record TypeAndCodec<B, T>(Type<T>, StreamCodec<B, T>)`.
  NOTE: `CustomPacketPayload.createType(String)` forces the `minecraft` namespace — use
  `new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath("cuprum", ...))`.
- Size caps: C2S `ServerboundCustomPayloadPacket.MAX_PAYLOAD_SIZE = 32767` bytes;
  S2C `ClientboundCustomPayloadPacket` cap = 1_048_576 bytes (both private constants; mirror
  as documented literals, do not reference).
- Bounded codec primitives: `ByteBufCodecs.stringUtf8(max)`, `byteArray(max)`,
  `collection(IntFunction, StreamCodec, int maxSize)`, `list(int maxSize)`, `VAR_INT`,
  `VAR_LONG`, `BOOL`, `idMapper(...)`; `StreamCodec.composite(...)` (up to 11 fields),
  `StreamCodec.of/ofMember/unit`; `UUIDUtil.STREAM_CODEC`; `BlockPos.STREAM_CODEC`.
- Menus: `AbstractContainerMenu.containerId` (public final int),
  `abstract boolean stillValid(Player)`; the server auto-closes invalid menus each tick.
- Kick: `ServerCommonPacketListenerImpl.disconnect(Component)`.
- Permission fallback: `Player.hasPermissions(int)`, `ServerPlayer.getPermissionLevel()`
  → `MinecraftServer.getProfilePermissions(nameAndId())`.

Data Attachments (Fabric `fabric-data-attachment-api-v1`, all *(verified)*; API is
`@ApiStatus.Experimental` — every Cuprum use goes through `CuprumAttachments` so an API
break is a one-file fix):

- `AttachmentRegistry.create(ResourceLocation, Consumer<Builder<A>>)`; Builder:
  `persistent(Codec<A>)`, `initializer(Supplier<A>)`, `copyOnDeath()`,
  `syncWith(StreamCodec<? super RegistryFriendlyByteBuf, A>, AttachmentSyncPredicate)`.
- `AttachmentSyncPredicate.all()/targetOnly()/allButTarget()` (BiPredicate<AttachmentTarget, ServerPlayer>).
- Targets *(via mixin)*: `Entity`, `BlockEntity`, `ServerLevel`, `ChunkAccess`;
  `getAttached/getAttachedOrThrow/getAttachedOrCreate/getAttachedOrElse/setAttached/
  hasAttached/removeAttached/modifyAttached/onAttachedSet`.
- Auto-sync machinery: config-phase capability negotiation; initial sync on player JOIN
  (world target + self), on `EntityTrackingEvents.START_TRACKING` (entities), after chunk
  batch send (chunk + contained block entities); per-change size limit ≈ 32767 bytes minus
  padding (`AttachmentChange.MAX_DATA_SIZE_IN_BYTES`). Lifecycle transfer registered on
  `ServerPlayerEvents.AFTER_RESPAWN` (honors `copyOnDeath`),
  `ServerEntityWorldChangeEvents.AFTER_ENTITY_CHANGE_WORLD`,
  `ServerLivingEntityEvents.MOB_CONVERSION`.
- BE update tags: the API strips attachments from `BlockEntity.getUpdateTag` results —
  attachment data on BEs is **not** client-visible unless explicitly synced.

Persistence (all *(verified)*):

- `SavedDataType<T extends SavedData>(String id, Supplier<T>, Codec<T>, DataFixTypes)`;
  `ServerLevel.getDataStorage()` → `DimensionDataStorage.computeIfAbsent(SavedDataType<T>)`;
  parse failure logs and returns default (never crashes); writes go to
  `data/<id>.dat` per dimension with vanilla DataVersion stamped.
- `BlockEntity.loadAdditional(ValueInput)` / `saveAdditional(ValueOutput)`;
  `ValueOutput.child/putInt/putLong/putString/store(String, Codec<T>, T)/list`;
  `ValueInput.getIntOr/getString/read(String, Codec<T>)/child/childOrEmpty/listOrEmpty`;
  `CompoundTag.CODEC` (passthrough-based); `NbtUtils.addCurrentDataVersion(ValueOutput)`.
- Items: `DataComponentType.builder().persistent(Codec).networkSynchronized(StreamCodec)
  .cacheEncoding().build()`; `Registry.register(BuiltInRegistries.DATA_COMPONENT_TYPE, id, type)`;
  `Item.Properties.component(DataComponentType<T>, T)`; `ItemStack.set/get/getOrDefault`.

Optional permissions: `me.lucko:fabric-permissions-api:0.5.0` is the published release for
1.21.9–1.21.10 (Maven Central; mod id `fabric-permissions-api-v0`) — *(verified externally,
resolve + compile is a W1 build probe)*.

---

## 2. SavedData / DataFixTypes — uncertainty for lead resolution

`SavedDataType` requires a `DataFixTypes` argument and `DimensionDataStorage.readSavedData`
calls `dataFixType.update(...)` unconditionally — a naive `null` would NPE in vanilla.
**However** Fabric API's object-builder module (`PersistentStateManagerMixin`, present in
0.134.1 as module 21.1.24) wraps that call and **no-ops when `dataFixTypes == null`**, and
Fabric's own `AttachmentPersistentState` registration passes `null` with the comment
"Object builder API 12.1.0 and later makes this a no-op" *(both verified in loom-cache
sources)*.

- **Recommendation:** pass `null`, rely on the Fabric mixin (we hard-depend on
  `fabric-api >= 0.134.1`), and version with our own `cuprum_schema` int (§7). Passing a
  vanilla `DataFixTypes` constant instead would run vanilla datafixers over modded NBT —
  unpredictable and wrong.
- **Residual risk for lead sign-off:** `null` relies on Fabric implementation behavior,
  not documented vanilla API. Mitigation: W1 `StateApiProbe` constructs a
  `SavedDataType<>(id, supplier, codec, null)` and a server GameTest round-trips a save/load
  through `getDataStorage()` so any regression fails `check` loudly.
- We never register custom DataFixers; vanilla stamps DataVersion on SavedData writes
  automatically, and BE envelopes call `NbtUtils.addCurrentDataVersion(ValueOutput)` so
  vanilla DFU context is always recorded.

---

## 3. Packages and public signatures

`src/main` (common — no client classes):

```
dev.cuprum.cuprum.net
  CuprumNetVersion         public static final int NET_VERSION = 1;
                           static boolean isCompatible(int remote)
  CuprumPayloads           static void register()          // all PayloadTypeRegistry registrations
  payload.HelloPayload     record (int netVersion)         // S2C, configuration phase
  payload.HelloAckPayload  record (int netVersion)         // C2S, configuration phase
  payload.DiagEchoPayload  record (int nonce, String note) // C2S play, note <= 64 chars, perm-gated
  payload.DiagEchoReplyPayload record (int nonce, long gameTime, String catalogSha) // S2C play

dev.cuprum.cuprum.net.server
  CuprumServerNet          static void init()              // Server*Networking receivers (common classes)
  C2SGuard                 static GuardResult check(ServerPlayer, GuardSpec)
  GuardSpec                builder: requireAlive() rate(RateKey) range(ServerLevel, BlockPos, double)
                           menu(int containerId, Class<? extends AbstractContainerMenu>)
                           claim(Claim, ClaimAccess) permission(String node, int fallbackOp)
                           state(BooleanSupplier)
  GuardResult              enum PASS, DROP_SILENT, DROP_LOG, VIOLATION
  NetRateLimiter           boolean tryAcquire(ServerPlayer, RateKey)   // + GLOBAL bucket
  RateKey                  DEFAULT(4/s burst 8) GOLEM_PROGRAM(1/s) FLARE(1 per 100 t)
                           NEXUS(10/s) GLOBAL(16/s aggregate)
  NetViolations            void record(ServerPlayer, ResourceLocation payloadId, String reason)

dev.cuprum.cuprum.ownership
  Owner                    record (UUID uuid, String cachedName)      + CODEC, STREAM_CODEC
  AccessPolicy             enum OWNER_ONLY, TEAM, PUBLIC              + CODEC, STREAM_CODEC (idMapper)
  Claim                    record (Owner owner, AccessPolicy policy)  + CODEC, STREAM_CODEC
                           static Claim ofPlacer(ServerPlayer)
  ClaimAccess              enum VIEW, USE, CONFIGURE, DESTROY
  OwnershipService         static boolean allows(ServerPlayer, @Nullable Claim, ClaimAccess)

dev.cuprum.cuprum.perm
  Perms                    static boolean check(ServerPlayer, String node, int fallbackOpLevel)
  Nodes                    cuprum.shield.configure, cuprum.weather.use, cuprum.emp.pvp,
                           cuprum.diagnostics, cuprum.admin.override
  LuckoPermsBridge         classloaded only when FabricLoader.isModLoaded("fabric-permissions-api-v0")

dev.cuprum.cuprum.state
  CuprumSchema             int ITEM = 1, BLOCK_ENTITY = 1, PLAYER = 1, WORLD = 1;
                           String KEY = "cuprum_schema"
  Versioned                static <T> Codec<T> codec(int current, Codec<T> currentCodec,
                                                     IntFunction<UnaryOperator<Dynamic<?>>> steps)
  StateMigrations          per-domain registry of n -> n+1 Dynamic rewrites (append-only)
  QuarantinedTag           raw preservation via CompoundTag.CODEC (see §7)
  CuprumAttachments        the ONLY class touching the experimental attachment API
  CuprumSavedData          abstract base: schema envelope + quarantine + future-version lock
```

`src/client` (client-only): `dev.cuprum.cuprum.client.net.CuprumClientNet.init()` and
`ClientNetApiProbe`.

Wiring: `Cuprum.onInitialize()` → `CuprumPayloads.register()` **then** `CuprumServerNet.init()`
(registry-before-receiver is an API requirement). `CuprumClient.onInitializeClient()` →
`CuprumClientNet.init()`. Payload id convention: `cuprum:c2s/<domain>/<action>`,
`cuprum:s2c/<domain>/<event>`.

W1 ships **only** infrastructure payloads: `hello`/`hello_ack` (config-phase version
handshake; mismatch → `disconnect(Component.translatable("cuprum.net.version_mismatch"))`;
vanilla clients are already refused by registry sync since Cuprum registers content) and
the `cuprum.diagnostics`-gated `diag/echo` pipeline exerciser (CP0-style infrastructure,
no catalog entry, mirrors the Charge Probe precedent).

---

## 4. Payload/codec contract (binding for all waves)

1. Payloads are immutable records; canonical constructors enforce structural bounds and
   throw `IllegalArgumentException` (decode-time throw disconnects the peer — correct for
   hard protocol violations).
2. Stream codecs use **only** bounded primitives (§1). Forbidden in C2S codecs:
   `TAG`/`COMPOUND_TAG`/`TRUSTED_*`, unbounded `BYTE_ARRAY`/`STRING_UTF8`, `fromCodec*`
   (NBT-backed), ItemStack codecs (clients send slot indices, never stacks). C2S NBT: never.
3. Size budgets, enforced at decode by codec caps and re-checked semantically in handlers:
   C2S default ≤ 512 B, Cuprum C2S max 4096 B (golem programs, ≤ 32 ops — INDEX contract 1);
   S2C default ≤ 8 KiB, max 64 KiB per payload; larger data (handbook, statistics, network
   maps) must paginate. Vanilla hard caps (32767 / 1 MiB) are never approached.
4. Strings NFC-normalized + length-checked server-side; ids travel as `ResourceLocation`.
5. C2S payloads are requests, never authority: the server recomputes positions, targets,
   prices and charge values from its own state.
6. Every C2S handler body is wrapped by `C2SGuard` + top-level `catch (Exception)` that
   logs, counts a violation and never rethrows (no crash-DoS through handlers).
7. S2C event payloads are idempotent and loss-tolerant; durable state flows through BE
   update tags or synced attachments, never one-shot events. Gate optional sends with
   `ServerPlayNetworking.canSend(player, TYPE)`.

---

## 5. C2S guard pipeline (mandatory, in this order)

Handlers run on the server thread *(verified)*, so checks may read world state.

1. **Liveness/phase** — connected, not removed; `requireAlive()` + not-spectator for mutations.
2. **Rate** — `NetRateLimiter.tryAcquire(player, key)` AND the `GLOBAL` bucket.
   Failure = `DROP_SILENT` + counter (legitimate under lag; never a kick by itself).
3. **Range** — same dimension (`player.level() == level`), target chunk loaded (checked
   **before** any `getBlockEntity`; no chunk-load side effects), eye-to-target squared
   distance ≤ 8² (INDEX contract 1).
4. **Menu** (GUI writes) — payload carries `containerId`; require
   `player.containerMenu.containerId == containerId`, `instanceof` expected Cuprum menu,
   and `stillValid(player)`.
5. **Ownership** — `OwnershipService.allows(player, claim, CONFIGURE/USE/DESTROY)`;
   sole bypass `Perms.check(player, Nodes.ADMIN_OVERRIDE, 2)`.
6. **State** — target BE type matches; machine state legally accepts the mutation
   (per-feature predicate from later waves). Stale-state failures = `DROP_LOG`
   (honest races), not violations.
7. **Value** — semantic field validation: enums via `idMapper` (total), numeric ranges
   **rejected not clamped**, list sizes, string content. Impossible-for-honest-client
   value = `VIOLATION`.

Violations: log (player UUID, payload id, reason; ≤ 1 log line/s/player), per-connection
counter; ≥ 8 violations within 6000 ticks → `disconnect(Component)`. Counters feed the
future QOL-10 diagnostics overlay (read-only, `cuprum.diagnostics`-gated).

**Token buckets** (`NetRateLimiter`): per connection — created on
`ServerPlayConnectionEvents.JOIN`, discarded on `DISCONNECT` (reconnect resets by design);
one lazy bucket per `RateKey`; long arithmetic; lazy refill against a mod-owned tick
counter incremented in `ServerTickEvents.END_SERVER_TICK` (no dependency on
`MinecraftServer.getTickCount()` *(probe)*). Defaults from INDEX contract 1 (see §3 table);
all constants in `cuprum-common.json5`. Memory ≤ 64 B/bucket, ≤ 32 keys → ≤ 8 KiB/player.

---

## 6. Ownership, teams, permissions

Claim model — `Claim(Owner(uuid, cachedName), AccessPolicy)`:

- Set from placer at placement; stored **in the BE state envelope** (not an attachment:
  it must reach clients via the BE update tag for tooltips/HUD and survive the QOL-03
  wrench pickup → item component → re-place round trip byte-identically). Mirrored on
  picked-up machine items as the `cuprum:claim` data component.
- UUID authoritative; `cachedName` display-only, refreshed when the owner interacts.
- Access semantics: `VIEW`/`USE` allowed at the claim's policy level; `CONFIGURE`
  (filters, IO faces) owner or team per policy; **policy changes and transfers are
  owner-only always**; `DESTROY`/wrench-pickup follows `CONFIGURE`.
- Teams = vanilla scoreboard teams (SHD-13 explicitly consumes scoreboard teams):
  compare `player.getTeam()` with the owner's team via the server scoreboard
  (`Scoreboard.getPlayersTeam(String)` *(probe)*); unresolvable owner team degrades
  `TEAM` → `OWNER_ONLY`.
- Unclaimed (worldgen/legacy) machines behave as `PUBLIC` and become claimed by the first
  `CONFIGURE`-capable interactor. TES-12 EMP "hostile-owned only" and GEN-14 "unclaimed
  chunk" checks later consume this same service.

Permissions — `Perms.check(player, node, fallbackOpLevel)`:

- If `fabric-permissions-api-v0` loaded: delegate via `LuckoPermsBridge`
  (`Permissions.check(player, node, fallbackOpLevel)`); build:
  `modCompileOnly 'me.lucko:fabric-permissions-api:0.5.0'`, `fabric.mod.json`
  `"suggests": { "fabric-permissions-api-v0": "*" }`. Not bundled (no `include`) in W1 —
  the absent path is the fully-tested default.
- Else vanilla fallback `player.hasPermissions(fallbackOpLevel)` *(verified)*.
- Fallback levels: `cuprum.diagnostics` ≥ 2 (QOL-10), `cuprum.weather.use` ≥ 2
  (WEA-03/U21), `cuprum.emp.pvp` default-granted via config, `cuprum.shield.configure`
  owner-based with the node as additional allow, `cuprum.admin.override` ≥ 2.

---

## 7. Versioned state by domain

Envelope: integer `cuprum_schema` per domain (`CuprumSchema`), independent of vanilla
DataVersion.

- **Items** → data components (`persistent` + `networkSynchronized` + `cacheEncoding`);
  evolving components embed the schema int inside `Versioned.codec(...)`; datagen-stable
  defaults via `Item.Properties.component(...)`.
- **Block entities** → `saveAdditional` writes `output.child("cuprum_state")` with
  `putInt(CuprumSchema.KEY, BLOCK_ENTITY)` + typed fields / `store(key, codec, value)`,
  plus `NbtUtils.addCurrentDataVersion(ValueOutput)`; `loadAdditional` reads
  `getIntOr(KEY, 0)` and dispatches `StateMigrations`. Claim, charge and IO config live
  here (drives QOL-03 byte-identical acceptance).
- **Player** → data attachments via `CuprumAttachments`:
  `persistent(codec) + initializer + copyOnDeath() + syncWith(streamCodec, targetOnly())`
  for private progress (quest/mastery, INDEX contract 5); `all()` only for public data.
  Initial sync/respawn/world-change handled by verified Fabric machinery — no custom
  join packets for attachment-backed state.
- **World** → per-dimension `DimensionDataStorage`:
  `new SavedDataType<>("cuprum_<domain>", ctx -> new X(ctx.levelOrThrow()), ctx -> X.codec(ctx), null)`
  (§2). One SavedData per subsystem (`cuprum_grid` PWR graphs, `cuprum_journal`
  two-phase-commit logs), each extending `CuprumSavedData`. Small per-world flags may use
  ServerLevel attachments (persisted via Fabric's `fabric_attachments` SavedData).
- Sync-size: synced attachments must fit Fabric's per-change cap (≈32 KiB); Cuprum policy
  caps synced attachment encodings at 16 KiB (unit-tested); big data stays server-side
  behind paginated S2C.

## 8. Migrations, corruption, future versions

Migration rules:

- Pure, total `Dynamic<?> → Dynamic<?>` steps, registered per domain, strictly n → n+1;
  `Versioned.codec` applies steps in sequence before the current codec parses.
- Steps are append-only; every rename/reshape goes through a step (never lenient
  dual-shape parsing in the current codec). No step may throw on any version-n output
  (property-tested).
- No custom DataFixers, ever (§2).

Corruption (parse failure at current-or-older schema): never crash, never silently
delete. Log with target coordinates/id; capture the unparseable subtree via
`CompoundTag.CODEC` into a `cuprum_quarantine` child re-emitted verbatim on every save;
runtime state = domain default; one WARN per target per session. Applies uniformly to BE
envelopes, attachment inner records, SavedData bodies.

Future version (stored `cuprum_schema` > current): do **not** parse or migrate downward.
Preserve raw verbatim (same quarantine mechanism), run with domain defaults, log once,
mark holder **state-locked**: mutating interactions are refused at the feature layer so a
newer mod's data is never overwritten. State-locked SavedData never calls `setDirty()`
except via an explicit admin reset command.

Reconnect / chunk / dimension semantics:

- Timed states (EMP disable, cooldowns) stored as absolute `Level.getGameTime()`
  deadlines (INDEX contract 5) — never wall clock or remaining-ticks.
- Client caches rebuild purely from push machinery on (re)join: registry sync → config
  handshake → JOIN attachment sync (world + self) → chunk batches (chunk/BE attachments,
  BE update tags) → START_TRACKING (entities). Rate buckets and violation counters are
  per-connection. No "send me everything" C2S exists.
- Dimension change: entity/player attachments transfer via verified Fabric events; world
  state is per-dimension by construction. Cross-dimension transfers (future TUB-14)
  journal two-phase commits in the **source** dimension's `cuprum_journal` and recover to
  source on crash (INDEX contract 4).
- Chunk unload: in-flight items/state must be owned and serialized by a chunk-resident BE
  (INDEX contract 5); nothing lives only in tick-transient collections.

---

## 9. Security tests, fuzz/property tests, GameTests, dedicated-server checks, budgets

Classpath note: `src/test` has no Minecraft classes (gson + JUnit only). Split: pure-JVM
logic (token bucket math, migration step functions, guard bounds, ownership truth table)
in Minecraft-free classes tested from `src/test`; codec round-trips need MC bootstrap →
add `testImplementation 'net.fabricmc:fabric-loader-junit:0.19.3'` *(build probe)* or run
as server GameTests as fallback.

1. **Unit/property (deterministic seeds)** — `decode(encode(x)) == x` for every payload
   and state codec; migrations: any value serialized at schema n < current parses at
   current and equals the canonical migrated value; bucket refill/burst/starvation incl.
   tick-counter wraparound; `OwnershipService` truth table (owner/team/public ×
   view/use/configure/destroy × override).
2. **Fuzz (in-suite, seeded)** — per C2S codec ≥ 10,000 random buffers + mutation fuzz of
   valid encodings (truncation, bit flips, length-field inflation). Decode must either
   succeed with all invariants in bounds or throw
   (`DecoderException`/`IndexOutOfBoundsException`/`IllegalArgumentException`); never
   hang; allocations bounded by length-prefix caps. Budget: corpus ≤ 30 s CI, ≤ 256 MiB.
3. **Server GameTests** (`net.fabricmc.fabric.api.gametest.v1.GameTest`, mock players via
   `helper.makeMockPlayer(GameType.SURVIVAL)`) — forged payload objects against handler
   logic: ownership rejection mutates 0 state; range > 8 rejected; menu rejection (wrong/
   closed containerId); rate limit (N+1 in one tick → exactly burst accepted); violation
   threshold; future-version state-lock; quarantine byte-identical across save/load;
   SavedData round-trip through `getDataStorage()` (§2 probe).
4. **Client GameTest** — extend `CuprumClientGameTest`: singleplayer world, trigger
   diag-echo, assert reply received (uses verified `TestSingleplayerContext.getServer().runCommand`).
5. **Dedicated server** — `scripts/server_smoke.sh` stays the gate (boot to `Done`, clean
   stop); add log assertions: payload registration ran once; no `cuprum` channel in
   ignored-payload warnings; handshake adds exactly one config-phase round trip.
6. **Budgets** — guard ≤ 5 µs median/accepted payload (microbench, informational);
   per-player net state ≤ 8 KiB; violation log ≤ 1 line/s/player; synced attachment
   ≤ 16 KiB encoded; fuzz ≤ 30 s; GameTests stay within existing `runGameTest` budget.

---

## 10. W1 compile probes (exact members)

`src/main` `NetApiProbe` — typed references, compile error on drift:
`PayloadTypeRegistry.playC2S()/playS2C()/configurationC2S()/configurationS2C().register(...)`;
a record implementing `CustomPacketPayload` (+ `Type`, `TypeAndCodec`);
`ServerPlayNetworking.registerGlobalReceiver` + `Context.server()/player()/responseSender()`
+ `send`/`canSend`; `ServerConfigurationNetworking.registerGlobalReceiver/send`;
`PlayerLookup.tracking(ServerLevel, ChunkPos)/tracking(BlockEntity)/tracking(Entity)`;
`ServerPlayConnectionEvents.JOIN/DISCONNECT`; `EntityTrackingEvents.START_TRACKING`;
`ServerTickEvents.END_SERVER_TICK`; `ByteBufCodecs.stringUtf8/byteArray/collection(maxSize)/idMapper`;
`StreamCodec.composite`; `UUIDUtil.STREAM_CODEC`; `BlockPos.STREAM_CODEC`;
`AbstractContainerMenu.containerId`/`stillValid`;
`ServerCommonPacketListenerImpl.disconnect(Component)`; `Player.hasPermissions(int)`.

`src/main` `StateApiProbe`:
`AttachmentRegistry.create(id, b -> b.persistent(...).initializer(...).copyOnDeath()
.syncWith(streamCodec, AttachmentSyncPredicate.targetOnly()))`;
`AttachmentTarget.getAttached/setAttached/getAttachedOrCreate/modifyAttached/onAttachedSet`;
`new SavedDataType<>(id, supplier, codec, null)` + `ServerLevel.getDataStorage().computeIfAbsent`;
`ValueOutput.child/putInt/store(key, CompoundTag.CODEC, tag)`; `ValueInput.getIntOr/read/child`;
`NbtUtils.addCurrentDataVersion(ValueOutput)`;
`DataComponentType.builder().persistent().networkSynchronized().cacheEncoding()` +
`Registry.register(BuiltInRegistries.DATA_COMPONENT_TYPE, ...)`; `Item.Properties.component`.

`src/client` `ClientNetApiProbe`:
`ClientPlayNetworking.registerGlobalReceiver` + `Context.client()/player()`;
`ClientPlayNetworking.send/canSend`; `ClientConfigurationNetworking.registerGlobalReceiver/send`;
`ClientPlayConnectionEvents`.

Unresolved names to settle via probes before dependent code (not verified in this pass):
loaded-chunk check (`Level.isLoaded(BlockPos)` or equivalent); interaction-range helper
(`Player.canInteractWithBlock(BlockPos, double)` vs manual squared distance — manual is
the safe default); `MinecraftServer.getTickCount()` (fallback: own END_SERVER_TICK
counter, already the spec); `ServerPlayer.nameAndId()` call sites;
`Scoreboard.getPlayersTeam(String)` / `Player.getTeam()`; `fabric-loader-junit`
coordinate.

Build-level probes: `modCompileOnly 'me.lucko:fabric-permissions-api:0.5.0'` resolves
from Maven Central; `fabric.mod.json` `suggests` gains `fabric-permissions-api-v0`;
`docs/API_PROBES.md` gains a "Networking & state" section recording the above.

Non-goals for W1 (explicit): no gameplay payloads or catalog entries; no custom
DataFixers; no bundled permissions jar; no chunk-attachment gameplay use; no C2S NBT.
