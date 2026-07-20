# W1 FOUNDATION PLAN — binding, executable (supersedes conflicting brief text)

Status: **BINDING**. This plan reconciles the five W1 concept briefs
(`charge.md`, `multiblock-machine.md`, `net-state.md`, `client-fx.md`,
`handbook-config.md`) against the committed CP0B tree and the pinned 1.21.9
sources in `.gradle/loom-cache/`. Where a brief conflicts, **this plan wins**;
however, a reviewed implementation/evaluation fix loop may explicitly re-baseline
the affected foundation brief to the accepted repair. That reviewed re-baseline
governs the repaired point alongside this plan; unresolved conflicts still defer
to this plan. This exception never authorizes catalog or `docs/feature-concepts/**`
edits: no catalog/concept-doc change happens in W1 (`verifyConceptParity` digest
untouched). All W1 blocks are diagnostics infrastructure with **no catalog
entries** (Charge Probe precedent) — diagnostics are infrastructure, not features.

Verification evidence below was read from the decompiled Mojmap sources and the
remapped Fabric API 0.134.1 module sources (the `docs/API_PROBES.md` discipline).

---

## 1. Conflict decisions (D1–D12)

### D1 — SavedDataType DataFixTypes: pass `null` (verified), never a vanilla fixer; restart probe mandatory
- Verified in vanilla `DimensionDataStorage`: `readSavedData` calls
  `readTagFromDisk(type.id(), type.dataFixType(), …)` whenever the `.dat` file
  exists, and `readTagFromDisk` calls `dataFixType.update(this.fixerUpper, tag, i,
  version)` unconditionally — a `null` NPEs in *pure vanilla*.
- Verified in Fabric API 0.134.1 (object-builder-api-v1 21.1.24, which we
  hard-depend on): `PersistentStateManagerMixin` `@WrapOperation`s exactly that
  `DataFixTypes.update` call inside `DimensionDataStorage` and **returns the tag
  unchanged when `dataFixTypes == null`** ("Handle mods passing a null
  DataFixTypes").
- Verified that Fabric itself relies on this: data-attachment-api-v1
  `ServerWorldMixin` constructs its own `SavedDataType<>(…, null)` with the
  comment "Object builder API 12.1.0 and later makes this a no-op".
- The original proposal to use `DataFixTypes.SAVED_DATA_RANDOM_SEQUENCES` is
  **REJECTED**: it
  runs `fixer.update(References.SAVED_DATA_RANDOM_SEQUENCES, …)` over foreign
  Cuprum NBT on every load whose stamped DataVersion differs from current —
  unverifiable against future vanilla fixers and semantically wrong. Never apply
  an unrelated vanilla fixer merely to avoid `null`.
- **Decision:** every Cuprum `SavedDataType` passes `null`; versioning/migration
  lives in our own codec envelope (§3.1). Mandatory proofs:
  1. `StateApiProbe` compile-pins `new SavedDataType<>(id, supplier, codec, null)`.
  2. Server GameTest round-trips a save/load through `getDataStorage()`.
  3. **Restart probe** (W1A): `scripts/server_restart_probe.sh` boots the
     dedicated server **twice against the same world dir**; `cuprum_state_probe`
     SavedData increments a boot counter and logs it; the second boot must log
     `boots=2` (proving the on-disk file was re-read through
     `readTagFromDisk` → Fabric null-DFT path). W1B extends the probe to require
     the `cuprum_charge_graph` re-read log line. The smoke script's existing
     ERROR/FATAL grep catches any NPE regression loudly.

### D2 — One config authority: the config module (handbook-config specialist)
- The config module **solely** owns file loading, serializer, schema, defaults
  persistence and S2C sync: `CuprumCommonConfig` (main) → `config/cuprum-common.json5`
  and `CuprumClientConfig` (client) → `config/cuprum-client.json5`, both via
  AutoConfig + `JanksonConfigSerializer` (verified present in the pinned
  cloth-config 20.0.149 jar). Registered in W1A so charge/FX consume typed
  config from day one; Cloth config *screens* + Mod Menu land W1E.
- Charge, net and FX **expose section contents and defaults and are sole
  semantic reviewers of their sections** (`charge.*`, `net.*`, client FX
  fields); they never register competing serializers or files.
  client-fx.md §8's Gson `config/cuprum-client.json` is **REJECTED**; FX's
  `TierCap`/`flashScale`/`colorblindMode` become fields of the config-module
  `CuprumClientConfig` (§3.3), read through `FxTierPolicy`.
- The original "`ChargeBalance` static defaults, config wiring later" proposal
  is superseded: `ChargeBalance` is a thin typed accessor over
  `CuprumCommonConfig.charge`; code defaults are the INDEX literals. GameTests
  read the same config object (INDEX vocabulary contract).
- FX **budget literals** (`FxBudgets`: 16 ripples, 128 verts/ripple, particle
  caps) are frozen contract constants in code, *not* config (they pin SHD/QOL
  acceptance numbers); user-facing toggles only in client config.

### D3 — One payload registration strategy: net-state owns infrastructure, modules own payloads
- net-state (W1A) creates and owns `dev.cuprum.cuprum.net` infrastructure:
  guard pipeline, rate limiter, violations, and the registration helpers.
  client-fx.md's claim to create `net/CuprumNetworking.java` is **REJECTED**.
- **Module registration hook (binding):** each module owns a
  `<Module>Payloads.register()` (common) and, if it has receivers, a client-side
  registration inside its `<Module>ClientModule.init()`. Inside `register()` the
  module (a) registers its payload types via `PayloadTypeRegistry` directly and
  (b) registers C2S receivers **only** through
  `CuprumNet.registerGuardedC2S(type, guardSpecFactory, handler)` which wraps
  the handler in `C2SGuard` + top-level catch. Fabric requires type-before-
  receiver *per type*; module-local ordering satisfies this. The
  integration-owned bootstrap (§5.1) calls the hooks in deterministic order —
  nobody edits another module's files.
- Payload id convention (net-state, binding): `cuprum:c2s/<domain>/<action>`,
  `cuprum:s2c/<domain>/<event>`. client-fx.md's `cuprum:fx_ripple` is renamed
  `cuprum:s2c/fx/ripple`. The id ledger (§3.4) is authoritative.
- **Config-phase hello/hello_ack handshake is STAGED** (see D10): registry sync
  already refuses vanilla/foreign clients (Cuprum registers content), W1–W3 is a
  single-protocol world, and a version-skewed same-mod client fails loudly on
  codec decode. `CuprumNetVersion.NET_VERSION = 1` is declared now; the
  handshake lands at the first protocol-breaking change or W14, whichever is
  first.

### D4 — Registry ownership: module-owned `*Content` classes + creative-tab event appenders
- Existing `CuprumBlocks`/`CuprumItems`/`CuprumCreativeTabs` are **frozen** to
  their current charge_probe content; no wave appends to them.
- New content registers in module-owned classes: `MachineContent` (W1C: coil
  blocks/items/BE type/menu type), `FxContent` (W1D: fx_probe block/item/BE
  type/particle type). Central `CuprumBlockEntities.java`/`CuprumMenus.java`/
  `CuprumParticles.java` from the briefs are **REJECTED**.
- Creative-tab entries are appended via
  `ItemGroupEvents.modifyEntriesEvent(CuprumCreativeTabs.CUPRUM_TAB_KEY)`
  (verified in fabric-item-group-api-v1) from each module's `init()` — no edits
  to `CuprumCreativeTabs.java`.
- One integration-owned bootstrap: `Cuprum.onInitialize()` /
  `CuprumClient.onInitializeClient()` call module `init()`s in the deterministic
  order of §5.1; each phase appends exactly one line per side.

### D5 — Common/client split, attachments, claims, envelopes, API freeze
- **Split:** payload records, registries, config data classes in `src/main`;
  receivers-with-client-context, screens, renderers, particles, keybinds in
  `src/client`. `scripts/server_smoke.sh` client-leak grep stays the gate.
- **Attachment wrapper:** `dev.cuprum.cuprum.state.CuprumAttachments` is the
  ONLY class calling the experimental `AttachmentRegistry` API and holds ALL
  attachment constants (append-only; net-state owns the file structure; W1E
  appends `HANDBOOK_UNLOCKS` in its phase — sequential edit, allowed).
  handbook-config's direct `AttachmentRegistry.create` call is **REJECTED**.
- **Claims:** net-state owns `ownership` (`Owner`/`AccessPolicy`/`Claim`/
  `ClaimAccess`/`OwnershipService` + MC-free `OwnershipCore` truth logic). W1
  ships the model, codecs and truth-table tests only; **no BE/item wiring in W1**
  (W1 has zero mutating C2S interactions) — first consumer wave wires it.
- **One version envelope (binding, replaces `cg_version` and
  `cuprum_data_version`):** every Cuprum BE writes child `cuprum_state` with
  `putInt("cuprum_schema", <domain version>)` plus module fields; SavedData
  codecs carry `schema_version` (`optionalFieldOf`, default 1); migrations are
  append-only n→n+1 `Dynamic` steps in `StateMigrations`, applied inside codecs
  (`Versioned.codec`), never DataFixers. Forward-version rule (W1 floor):
  stored schema > current ⇒ WARN once, read best-effort with clamps, never
  crash. Full quarantine/state-lock is STAGED (D10).
- **API freeze:** frozen surface = public/protected members of
  `charge`, `charge.core`, `multiblock`, `machine`, `net` (guard API),
  `ownership`, `state`, `config`, `api.handbook`, `client.api.handbook`,
  `client.fx` public entry points. W1E ships `ApiFreezeTest` (src/test): runs
  JDK `ToolProvider.findFirst("javap")` (no new dependency) over the compiled
  class dirs (paths via `test` system properties), normalizes + sorts public
  member descriptors, SHA-256 vs the committed `api/cuprum-api.lock`;
  regeneration only via `-Dcuprum.apilock.update=true` (reviewed two-file
  diff, mirroring the catalog digest discipline). The ASM/`ClassReader` tool
  from handbook-config §11 is **REJECTED** for W1 (new dependency, unproven);
  javap fallback if `ToolProvider` is unavailable: reflection-based freeze test
  in the gametest source set (documented probe, not expected to trigger).

### D6 — Diagnostic content and handbook completeness
- Charge harness nodes (`harness_cell/source/sink/relay`) live **only** in the
  `cuprum-gametest` mod (new `"main"` entrypoint in
  `src/gametest/resources/fabric.mod.json`), namespace `cuprum-gametest` — never
  shipped, automatically outside the completeness gate.
- Diagnostic Coil (core+frame) and FX Probe are **production infrastructure**
  in the `cuprum` namespace. Therefore W1E handbook completeness must cover the
  full shipped id set with EN/DE parity: **charge_probe page, diagnostic_coil
  page (subjects: core + frame), fx_probe page** — 3 pages, 1 category
  `cuprum:diagnostics`, `handbook/exempt.json` present and asserted **empty**.
- No W1 block gets a catalog entry; the completeness gate iterates the `cuprum`
  namespace only.

### D7 — Charge/machine seam
- `ChargeBuffer` moves from the machine brief to **`charge.core`** (W1B, pure
  Java): one clamp/insert/extract source of truth. `ShortSplit` stays in
  `machine` (menu-lane concern; the verified 16-bit `ClientboundContainerSetDataPacket`
  constraint). `AbstractChargeStorageBlockEntity` (charge, W1B) owns the
  envelope + delegates storage to a `ChargeBuffer`; `ChargeMachineBlockEntity`
  (W1C) **extends it**, adding `ContainerData` lanes, sync throttle and menu
  plumbing. The Diagnostic Coil core additionally **registers as a
  `ChargeStorage` node via `ChargeApi.NODE`** so the Charge Probe reports it —
  the W1 cross-module integration proof (gametest `coilCoreReportsAsChargeNode`).
- Allocator semantics, canonical order, freeze rules, surge rule and the
  no-duplication authority rule are adopted exactly as charge.md §3–§5 (BE NBT
  authoritative for stored Cg; SavedData holds topology + read-only shadow,
  never writes charge back into a loaded BE).
- The frozen role-mutation contract returns the **actual applied amount** from
  producer drain, consumer accept, storage insert/extract/surge and absorber
  accept; conservation and every throughput counter use only those returns.
  Normal graph and external storage calls share one lazy game-tick insert/extract
  budget in either order. Surge storage is an explicit capacity-only path and
  remains subject to relay/absorber limits.
- Intentional removal vents the removed node's live stored value or frozen shadow
  exactly once and persists the delta. BE/chunk unload only freezes and snapshots;
  source identity makes both event orderings and stale callbacks idempotent.

### D8 — Solver budget test placement
`cgSolverBudget1000Nodes` as a GameTest is **REJECTED** (1,000 placed blocks
cannot fit the 8×8×8 structure). Replaced by `SolverBudgetTest` in `src/test` on
`ChargeGraphCore` (MC-free): 1,000 synthetic nodes, 100 ticks, assert avg
≤ 1.0 ms, log actual vs the 0.15 ms W5 target.

### D9 — MC-free core discipline (test classpath truth)
`src/test` has **no** Minecraft/DFU/Netty classes (gson + JUnit only —
`fabric-loader-junit` from net-state §9 is REJECTED as an unverified build
probe). Binding rule: every module separates an MC-free core
(`charge.core`, `OwnershipCore`, rate-limiter math, pattern geometry/shape,
`ShortSplit`, pool ring logic on `long` posKeys, colorblind ARGB remap, string
bounds/NFC helpers) tested in `src/test`; everything needing MC classes
(codec/StreamCodec round-trips, config Jankson round-trip, guard-on-player) is
a **server GameTest**. Handbook JSON structural checks stay JUnit via gson +
`cuprum.mainResourcesDir` / `cuprum.generatedAssetsDir` system properties.

### D10 — Staged (not W1; safety not weakened) and REJECTED items
Staged — none is needed for the Storm Shield vertical slice (U01/U02 on W1
contracts); revisit at the wave named:
- Config-phase `hello/hello_ack` handshake + `ServerConfigurationNetworking`
  surface → first protocol break or W14 (D3 rationale).
- Full corruption quarantine (`cuprum_quarantine` verbatim re-emit) +
  future-version state-lock → W14 or the first wave persisting high-value
  player data. W1 floor: version envelope + WARN + clamped best-effort (D5).
- ASM API-freeze tool → replaced by javap digest (D5).
- Full PiP isometric multiblock preview (`SpecialGuiElementRegistry`, verified
  present but unprototyped) → W4/TOOL-11. W1 ships the `multiblock` widget
  codec + **flat item-grid renderer** (the pinned T3 floor, also the screenshot
  target).
- 10,000-buffer fuzz corpus → W14 hardening. W1: seeded `decode(encode(x))==x`
  property tests per payload + ≥512 seeded mutation-fuzz buffers for the single
  C2S codec (diag echo), bounds asserted.
- `me.lucko:fabric-permissions-api` compileOnly dep + `LuckoPermsBridge` →
  wave that first needs external providers (unverifiable offline; no jar in
  loom-cache). W1 `Perms.check(player, node, fallbackOpLevel)` = vanilla
  `hasPermissions` fallback only; node-name indirection kept so the bridge is a
  later drop-in. Nodes declared in W1: `cuprum.diagnostics`,
  `cuprum.admin.override` only (speculative nodes/rate keys trimmed).
- `RateKey` speculative constants (GOLEM_PROGRAM/FLARE/NEXUS) → declared by the
  waves that use them; W1 ships `DEFAULT(4/s, burst 8)` + `GLOBAL(16/s)`.
- Handbook bookmarks, deep links (chat `ClickEvent`, client command, anchors),
  `s2c/handbook/goto`, off-thread search build, page-turn animation,
  `handbookTextScale`/`highContrastHandbook` → W4 (U22).
- `s2c/handbook/unlock` payload → **REJECTED permanently**: the unlocks
  attachment is `syncWith(…, targetOnly())`; Fabric's verified attachment sync
  already mirrors grants to the owning client. One mechanism, not two.
- Iris reflection query in `FxCompat` → W12. W1 `FxCompat` only logs
  `isModLoaded("sodium"/"iris")`; misrender risk is cosmetic-only
  (outcome-neutral) and the capability probe still catches pipeline failures.
- DE-language search client gametest → W4; W1 search test is EN; DE coverage
  is enforced by the lang-parity JUnit gates.

### D11 — Datagen and texture generation cadence
Every content phase regenerates and commits `src/main/generated` itself
(CI freshness gate); multiblock.md's "regenerate ONCE after all W1" is
**REJECTED**. `scripts/gen_probe_texture.py` is frozen; W1C creates
deterministic `scripts/gen_textures.py` (coil core/frame), W1D appends
(copper_mote). Never hand-edit PNGs.

### D12 — Screenshot comparison policy
Client gametests use region-scoped `assertScreenshotEquals` on flat/stable
regions with committed templates. If Mesa/llvmpipe drift makes a comparison
flaky in CI (two consecutive false failures), the Eval loop may downgrade it to
`takeScreenshot` artifact + deterministic counter asserts (`FxFrameStats`,
widget state), recorded in the phase commit message.

---

## 2. Package / API ownership table (final)

| Path (under `src/` unless noted) | Owner | Phase | Notes |
|---|---|---|---|
| `main/.../Cuprum.java`, `client/.../CuprumClient.java` | integration (lead) | W1A shape; +1 init line per phase | bootstrap order §5.1 |
| `main/.../CuprumBlocks|CuprumItems|CuprumCreativeTabs.java` | integration | frozen | charge_probe only |
| `main/.../net/**` (`CuprumNet`, `CuprumPayloads`, `CuprumNetVersion`, `payload/Diag*`, `server/{C2SGuard,GuardSpec,GuardResult,NetRateLimiter,RateKey,NetViolations}`, `NetApiProbe`) | net-state | W1A | guard API frozen after W1A |
| `main/.../ownership/**`, `main/.../perm/**` | net-state | W1A | model only in W1 |
| `main/.../state/**` (`CuprumSchema`, `Versioned`, `StateMigrations`, `CuprumAttachments`, `CuprumSavedData`, `StateProbeSavedData`, `StateApiProbe`) | net-state | W1A | `CuprumAttachments` append-only |
| `main/.../config/**` (`CuprumCommonConfig`, `CuprumConfigs`, `ConfigSyncPayload`) | config module | W1A | sections reviewed by owners (D2) |
| `client/.../net/CuprumClientNet.java`, `ClientNetApiProbe` | net-state | W1A | |
| `client/.../config/CuprumClientConfig.java` | config module | W1A (fields), W1E (screens, `CuprumModMenu`) | FX fields FX-reviewed |
| `main/.../charge/**` (`core/*`, `ChargeApi`, node ifaces, `ChargeGraphManager`, `blockentity/AbstractChargeStorageBlockEntity`, `persist/ChargeGraphSavedData`, `diag/{ChargeCommand,ChargeProbeReport}`) | charge | W1B | public surface frozen after W1B |
| `main/.../block/ChargeProbeBlock.java` | charge (after W1B append) | W1B | report append only |
| `main/.../multiblock/**` | multiblock | W1C | per multiblock.md §2/§3/§5 |
| `main/.../machine/**` (`ShortSplit`, `ChargeMachineBlockEntity`, `ChargeMachineOpenData`, `ChargeMachineMenu`, `MachineContent`), `main/.../block/DiagnosticCoil*` | multiblock | W1C | `ChargeBuffer` lives in charge.core (D7) |
| `client/.../machine/{ChargeMachineScreen,MachineClientModule}.java` | multiblock | W1C | |
| `main/.../fx/**` (`FxContent`, `FxPayloads`, `FxRipplePayload`), `main/.../block/FxProbeBlock.java`, `blockentity/FxProbeBlockEntity.java` | client-fx | W1D | payload record immutable |
| `client/.../fx/**` (tier, probe, compat, stats, budgets, dispatcher, pools, render, particle, reload, `FxApiProbe`, `FxClientModule`) | client-fx | W1D | extension via enqueue/append only |
| `main/.../handbook/**`, `main/.../api/handbook/**` | handbook | W1E | `api.handbook` frozen |
| `client/.../handbook/**`, `client/.../api/handbook/**` | handbook | W1E | flat-grid preview exported |
| `gametest/.../perf/{PerfSampler,PerfBudget,PerfBudgets}.java` | handbook/test-infra | W1E | W14 reuses unchanged |
| `gametest/.../gametest/<module>/**` | respective module | own phase | |
| `gametest/resources/fabric.mod.json` | integration | append per phase | entrypoint lists only |
| `test/.../<module>/**` | respective module | own phase | MC-free only (D9) |
| `main/resources/assets/cuprum/shaders/**`, `particles/copper_mote.json`, `fx/colorblind.json` | client-fx | W1D | |
| `main/resources/data/cuprum/cuprum_multiblock/diagnostic_coil.json` | multiblock | W1C | hand-written, committed |
| `main/resources/data/cuprum/handbook/**` (+ `exempt.json`) | handbook | W1E | |
| `datagen/**` (six providers) | integration-mediated shared | W1C/W1D/W1E append | + `runDatagen` per phase |
| `build.gradle` | integration | W1C (+`cuprum.mainResourcesDir`), W1E (+`cuprum.generatedAssetsDir`, class-dir props, modmenu `modCompileOnly`) | minimal diffs |
| `scripts/server_smoke.sh` (opt-in env vars), `scripts/server_restart_probe.sh` | integration/net-state | W1A | default behavior unchanged |
| `scripts/gen_textures.py` | integration | W1C create, W1D append | deterministic |
| `docs/API_PROBES.md` | shared, append-only | each phase | new section per phase |
| `api/cuprum-api.lock` | integration | W1E | javap digest (D5) |
| repo-root `.github/workflows/cuprum-ci.yml` | integration | W1E | perf artifact glob only |
| `catalog/**`, `docs/feature-concepts/**`, `CuprumCatalog` (generated), `UserContracts` | NOBODY in W1 | — | digest-sealed |

---

## 3. Exact contracts

### 3.1 Data contracts
- **BE envelope (binding):** `saveAdditional` writes child `"cuprum_state"`:
  `putInt("cuprum_schema", 1)`; charge storages add `putLong("charge", stored)`;
  controllers add child `"multiblock" { formed: bool, rotation: string,
  mirror: string }` (Rotation/Mirror CODECs). `loadAdditional` reads
  `getIntOr("cuprum_schema", 0)`; 0 ⇒ pre-versioned defaults; > current ⇒ WARN
  once + best-effort clamped read; values clamped to `[0, capacity]`. Faults and
  pattern ids are never persisted. Disk vs wire: `getUpdateTag` =
  `saveCustomOnly` + transient client extras (`formation_state` byte, optional
  fault code/pos); `CompoundTag` appears only in the two vanilla wire methods.
- **SavedData (binding):** `new SavedDataType<>("cuprum_<domain>", ctx→…,
  ctx→codec, null)` (D1). Codec body: `schema_version` int
  (`optionalFieldOf`, default 1) + fields; migration dispatch inside the codec.
  W1 instances: `cuprum_state_probe` (W1A: `boots` int), `cuprum_charge_graph`
  (W1B: `schema_version`, `nodes` list of `NodeRecord(posKey, roleMask,
  priority, lastKnownStored)`, `vented_total` long). Authority rule: SavedData
  never writes charge into a loaded BE; BE value wins, shadow refreshed from it.
  Charge records mask unknown role bits, default invalid priority to `MISC`, floor
  stored shadows/vent totals at 0, sort by signed position and use last-record-wins
  for duplicate positions. Explicit schema 0 migrates to 1; future schemas are
  best-effort normalized and syntactic codec errors remain errors.
- **Attachments:** all constants in `CuprumAttachments`. W1E:
  `HANDBOOK_UNLOCKS` = sorted `Set<ResourceLocation>` codec, `persistent`,
  `copyOnDeath`, `initializer`, `syncWith(streamCodec, targetOnly())`. Synced
  encodings capped 16 KiB (asserted).
- **Items:** no data components in W1 (claims wiring staged, D5).
- **Timed state rule:** absolute `Level.getGameTime()` deadlines only.

### 3.2 Network contracts
- Registration: D3 hook. Handlers run on the server thread (verified); C2S
  handler bodies wrapped by `C2SGuard` in the binding order: liveness → rate
  (`RateKey` + `GLOBAL`) → range (dimension + chunk-loaded-before-BE-read +
  ≤8² eye distance) → menu (`containerId` + instanceof + `stillValid`) →
  ownership (`OwnershipService.allows`, admin override) → state predicate →
  value validation (reject, never clamp). Results: `PASS`/`DROP_SILENT`
  (rate)/`DROP_LOG` (honest race)/`VIOLATION` (logged ≤1 line/s/player,
  per-connection counter; ≥8 in 6,000 ticks ⇒ kick via an overridable sink so
  gametests assert the request, not a real disconnect).
- Codec rules (binding for all waves): immutable records; canonical ctor
  bounds-check and throw; only bounded primitives (`stringUtf8(max)`,
  `byteArray(max)`, `collection(…, max)`, VAR_INT/VAR_LONG, `idMapper`,
  `UUIDUtil.STREAM_CODEC`, `BlockPos.STREAM_CODEC`, `composite`); C2S NBT/
  ItemStack codecs forbidden; C2S ≤512 B default (4 KiB absolute cap), S2C
  ≤8 KiB default (64 KiB cap; larger paginates); strings NFC-normalized
  server-side; S2C events idempotent; durable state via BE update tags or
  synced attachments, never one-shot events; `canSend` gates optional sends.
- Rate buckets: per connection, created on JOIN, dropped on DISCONNECT; lazy
  refill against a mod-owned `END_SERVER_TICK` counter; long arithmetic;
  wraparound property-tested.
- W1 payloads (full set): `cuprum:c2s/diag/echo` `(int nonce, String note ≤64)`
  perm `cuprum.diagnostics` fallback 2, rate DEFAULT;
  `cuprum:s2c/diag/echo_reply` `(int nonce, long gameTime, String catalogSha)`;
  `cuprum:s2c/config/common` (config snapshot, join + `/reload`);
  `cuprum:s2c/fx/ripple` `(BlockPos center, VAR_INT radiusQ8, VAR_INT colorArgb,
  VAR_LONG gameTime)` ≤32 B, server coalesces ≤16/s/client;
  `cuprum:s2c/handbook/sync`, `cuprum:s2c/handbook/recipes` (join + reload;
  `RecipeDisplay.STREAM_CODEC`).

### 3.3 Config contract
- `config/cuprum-common.json5` (machine-managed; comments live in lang-keyed
  tooltips): section `charge { passiveBaselineCgPerTick=5,
  leydenJarCapacityCg=100000, strikeDepositCg=270000,
  wireLossPpTenthsPerSpanBare=20, wireLossPpTenthsPerSpanHv=5 }` (owner: charge);
  section `net { ratePerSecDefault=4, burstDefault=8, rateGlobalPerSec=16,
  violationKickThreshold=8, violationWindowTicks=6000 }` (owner: net-state).
- `config/cuprum-client.json5`: `fxTierCap` enum `FULL/REDUCED/MINIMAL`
  (→ T1/T2/T3 cap), `flashScale` 0..1 (effective flash = `flashScale ×
  screenEffectScale()`, forced 0 by `hideLightningFlash()` — verified
  accessors), `colorblindMode` enum, `shapeCodedIndicators` bool.
- `validatePostLoad()` clamps + logs. Server wins on join via
  `cuprum:s2c/config/common` overlay; client file never rewritten; overlay
  dropped on disconnect. Schema freeze: `configSchemaFreeze` GameTest asserts
  the exact sorted key set (pinned literal list).
- Handbook `charge` widgets read values via `ConfigValueRefs` — an explicit
  typed map of allowed ref paths (e.g. `charge.passiveBaselineCgPerTick`) →
  supplier; no reflection; unknown ref = validation error.

### 3.4 Id ledger (authoritative; additions require a plan edit)
- Blocks/items: `cuprum:charge_probe` (existing), `cuprum:diagnostic_coil_core`
  + `cuprum:diagnostic_coil_frame` (W1C), `cuprum:fx_probe` (W1D). BE types
  (same ids as their blocks): coil core (W1C), fx_probe (W1D).
- Menu: `cuprum:charge_machine` (W1C). Particle: `cuprum:copper_mote` (W1D).
- Payloads: §3.2. SavedData: `cuprum_state_probe`, `cuprum_charge_graph`.
- Attachment: `cuprum:handbook_unlocks` (W1E).
- Lookup: `cuprum:charge_node` (`BlockApiLookup`).
- Reloaders: `cuprum:multiblock_patterns` (SERVER_DATA, W1C), `cuprum:handbook`
  (SERVER_DATA, W1E), `cuprum:handbook_search` (CLIENT, after
  `ResourceReloaderKeys.Client.LANGUAGES`, W1E), `cuprum:fx` (CLIENT, W1D).
- Data dirs: `data/cuprum/cuprum_multiblock/`, `data/cuprum/handbook/{categories,pages}/`.
- Commands: `/cuprum cg stats|networks|node <pos>` (perm level 2, W1B).
  Keybind: `key.cuprum.handbook` (H, `KeyMapping.Category`, W1E).
- Render: pipeline `cuprum:pipeline/fx_ripple`, rendertype `cuprum:fx_ripple`,
  shaders `assets/cuprum/shaders/core/fx_ripple.{vsh,fsh}` (W1D).
- Perm nodes: `cuprum.diagnostics`, `cuprum.admin.override` (W1A).
- Lang prefixes: `handbook.cuprum.*`, `container.cuprum.charge_machine`,
  `cuprum.formation.*`, `cuprum.charge.readout`, `key.cuprum.*`,
  `text.autoconfig.cuprum-*` (Cloth screen keys).

---

## 4. Phase plan (strictly sequential; one branch; shared files edited only in the listed phase)

Common per-phase process: Concept (done) → **Fable implementation** → **Sol
Eval-A** → **Fable Eval-B** → fix loop (re-run both evals after fixes) →
**commit + push** → next phase. Every phase must leave the full gate green:

```
./gradlew toolchainVerify
./gradlew check build            # lint -Werror, unit tests, catalog+parity, server GameTests, jar
./scripts/datagen_determinism.sh # phases that touch datagen (W1C/W1D/W1E)
./scripts/server_smoke.sh
./scripts/server_restart_probe.sh   # from W1A on
./scripts/client_smoke.sh
```

### W1A — shared net/state/config foundation + integration bootstrap
- **Scope:** D1/D2/D3/D5 infrastructure. Files: `main/.../net/**`,
  `main/.../ownership/**`, `main/.../perm/**`, `main/.../state/**`,
  `main/.../config/**`, `client/.../net/**`, `client/.../config/CuprumClientConfig.java`,
  bootstrap edits to `Cuprum.java`/`CuprumClient.java`,
  `scripts/server_smoke.sh` (add opt-in `PRESERVE_RUN_DIR=1` skip of the
  run-dir wipe + `REQUIRE_LOG_REGEX` post-Done grep; defaults unchanged),
  `scripts/server_restart_probe.sh` (new: fresh run expects `boots=1`, second
  run with `PRESERVE_RUN_DIR=1` expects `boots=2`),
  `gametest/.../gametest/{net,state,config}/**`, `test/.../{net,ownership}/**`,
  `docs/API_PROBES.md` "Networking & state" section.
- **Probes:** `NetApiProbe`, `StateApiProbe` (incl. `SavedDataType<>(…, null)`),
  `ClientNetApiProbe` — compile-pinned per net-state §10.
- **Unit tests (src/test, ≥20):** `RateLimiterTest` (refill/burst/starvation/
  wraparound, seeded), `OwnershipCoreTest` (full truth table policy × access ×
  override), `NetBoundsTest` (NFC/length helpers), `GuardOrderTest` (pure
  decision-order core).
- **Server GameTests (≥8):** SavedData round-trip via `getDataStorage()`;
  state-probe boot counter increments; diag echo happy path (mock player, forged
  payload → handler); permission rejection mutates nothing; rate limit N+1 ⇒
  exactly burst accepted; violation threshold ⇒ kick-requested flag; guard
  range/menu rejection via synthetic `GuardSpec`; config
  `configSchemaFreeze` + `configDefaultsRoundtrip` + sync-on-join payload count.
- **Client GameTest:** diag echo end-to-end (client sends via test hook, reply
  asserted) inside the existing `CuprumClientGameTest` flow.
- **Commit:** `feat(cuprum): W1A net, state and config foundation`

### W1B — charge graph (depends: W1A config/state)
- **Scope:** charge.md §2–§7 with D1/D7/D8 overrides. Files:
  `main/.../charge/**`, `ChargeProbeBlock.java` append (six-neighbor
  `NodeReport` via pure `ChargeProbeReport.format`), `Cuprum.java` +1 line,
  `gametest/resources/fabric.mod.json` `"main"` entrypoint + harness package
  `gametest/.../harness/**`, `gametest/.../gametest/charge/**`,
  `test/.../charge/**`, `build.gradle` (hermetic `runGameTest` world cleanup;
  explicit `-Pcuprum.preserveGameTestWorld=true` restart mode),
  `scripts/server_restart_probe.sh` (+ require a non-empty
  `cuprum_charge_graph` re-read), `docs/API_PROBES.md` append.
- **Config:** reads `CuprumCommonConfig.charge` via `ChargeBalance` accessor.
- **Unit tests (≥30, seeded):** `ChargeMathTest` (incl. PWR-14 pins 84%/96%),
  `ChargeBufferTest`, `AllocationConservationTest`, `AllocationDeterminismTest`
  (insertion-order permutations), `PriorityBrownoutTest`, `FreezeIsolationTest`,
  `IncrementalRebuildEquivalenceTest`, `SharedStorageBudgetTest` (both call
  orders, tick boundary, surge isolation), `RelayEpochRolloverTest`,
  `SolverBudgetTest` (D8).
- **Server GameTests (≥6):** `cgSourceFillsCell` (20 ticks ⇒ exactly 1,000 Cg),
  `cgPriorityBrownout` (100%/0 at 50% supply), `cgSplitOnBreak` (removed stored
  Cg vents once; two network ids; survivor conserved),
  `cgSurgeOverflow` (270,000 into 20,000 cap ⇒ vented
  250,000), `cgPersistenceRoundtrip` (`TagValueOutput/TagValueInput`, envelope
  keys per §3.1), `cgProbeReportsNode`; plus production-listener lifecycle
  order/freeze/reactivation/no-phantom-transfer coverage and non-empty,
  malformed/schema-0/future/duplicate SavedData codec coverage.
- **Runtime probes:** PROBE-2 (BE load/unload vs chunk events ordering,
  gametest-asserted). PROBE-4 (POI widener) is U04-owned, not W1.
- **Commit:** `feat(cuprum): W1B charge graph foundation`

### W1C — multiblock + charge-machine layer + Diagnostic Coil (depends: W1B)
- **Scope:** multiblock-machine.md with D4/D7/D5 overrides (no central
  BE/menu registries; envelope keys per §3.1; `ChargeBuffer` from charge.core).
  Files: `main/.../multiblock/**`, `main/.../machine/**`,
  `main/.../block/DiagnosticCoil*`, `client/.../machine/**`,
  `Cuprum.java`/`CuprumClient.java` +1 line each, pattern JSON, datagen
  provider edits + regenerated `src/main/generated`, `scripts/gen_textures.py`
  (new) + committed coil textures, `build.gradle` (+`cuprum.mainResourcesDir`
  test property), gametest entrypoints, `docs/API_PROBES.md` append.
- **Coil:** capacity 1,000 Cg, +5 Cg/t while FORMED (diagnostic constants in
  code, not config); core registers as `ChargeApi.NODE` storage (D7);
  read-only menu, zero C2S; sync throttle ≥10 ticks except transitions.
- **Unit tests (≥20):** `PatternGeometryTest` (8-orientation literal table,
  mirror-before-rotate, bijectivity), `PatternShapeTest` (gson-parses the
  committed pattern JSON), `ShortSplitTest` (0, 1, 0xFFFF, 2^48−1).
- **Server GameTests (≥11):** pattern loaded; vanilla-rotation parity; forms
  NONE/rotated/mirrored (+claims); fault on member break ≤2t; fault on vanilla
  member change ≤40t; reform after repair; conflict second controller; BE
  persistence round-trip; charges-while-formed / stops-at-capacity /
  halts-on-fault (exact 5 Cg/t); menu lanes recombine (state/dispatch only);
  `coilCoreReportsAsChargeNode` (D7).
- **Client GameTest:** build coil via commands → open screen →
  `waitForScreen(ChargeMachineScreen)` → screenshots (formed coil + screen).
- **Compile probes:** multiblock.md §12 list (reloader generics,
  `ExtendedScreenHandlerType` inference, `MenuScreens.register` TAW,
  `TagValue*` in gametest set, `Codec.validate`).
- **Commit:** `feat(cuprum): W1C multiblock and charge machine foundation`

### W1D — client FX foundation + FX Probe (depends: W1A net hook; W1C only for datagen file adjacency)
- **Scope:** client-fx.md with D2/D3/D4/D10 overrides (config fields from
  config module; payload `cuprum:s2c/fx/ripple` registered via `FxPayloads`;
  `FxContent` owns block/BE/particle; no Iris reflection). Files:
  `main/.../fx/**`, `main/.../block/FxProbeBlock.java`,
  `main/.../blockentity/FxProbeBlockEntity.java`, `client/.../fx/**`,
  shader assets, `particles/copper_mote.json`, `fx/colorblind.json`,
  `scripts/gen_textures.py` append + mote texture, datagen edits + regenerate,
  bootstrap +1 line each side, gametest entrypoints + templates,
  `docs/API_PROBES.md` "Custom pipelines & FX foundation" append.
- **Contracts kept:** tier ladder T1→T2→T3→OFF single gate
  (`FxTierPolicy.effectiveTier()` = min of config/capability/compat caps);
  capability probe order (device → assets → `precompilePipeline().isValid()`);
  extract/submit BER (primitives-only render state; one `RenderType` batch);
  pooled dispatcher (16 ripples, ring eviction, zero steady-state allocation;
  `FxArcPool` declared stub); particle budget gate (≤64 spawn/tick, ≤256 live);
  reload listener resets policy/pools; `InvalidateRenderStateCallback` +
  DISCONNECT clear; outcome neutrality (no C2S, no gameplay mutation).
- **Unit tests (≥8):** pool ring logic (long posKeys), colorblind ARGB remap,
  budget counter math, snapshot radius quantization.
- **Server GameTest:** `fxProbeUsePulses` (pulse counter, dispatch/state only;
  break-drop parity with charge probe test).
- **Client GameTest:** `FxRippleClientGameTest` per brief §12 (T1 screenshot +
  `customPipelineSubmits > 0`; flip config cap to REDUCED ⇒ new custom submits
  == 0 and T2 screenshot), D12 policy applies.
- **Commit:** `feat(cuprum): W1D client FX foundation`

### W1E — handbook + config UI + test-infra + W1 integration close-out (depends: all)
- **Scope:** handbook-config.md with D2/D5/D6/D10 overrides. Files:
  `main/.../handbook/**`, `main/.../api/handbook/**`, `client/.../handbook/**`,
  `client/.../api/handbook/**` (flat-grid multiblock preview),
  `client/.../config/**` (Cloth screens + `CuprumModMenu` + `"modmenu"`
  entrypoint), `state/CuprumAttachments.java` append (`HANDBOOK_UNLOCKS`),
  handbook data JSONs (1 category, 3 pages per D6, empty `exempt.json`),
  datagen lang additions + regenerate, `gametest/.../perf/**`,
  `test/.../handbook/**` + `ApiFreezeTest` + `api/cuprum-api.lock`,
  `build.gradle` (+`cuprum.generatedAssetsDir`, class-dir props, modmenu
  `modCompileOnly`), CI perf-artifact glob, bootstrap +1 line each side,
  `README.md`/`AGENTS.md` W1 documentation refresh, `docs/API_PROBES.md` append.
- **Widgets:** `text`/`image`/`recipe`/`charge`(via `ConfigValueRefs`)/
  `multiblock`(flat grid). Every custom widget implements `NarratableEntry`.
  Unlocks: `always` + `key` conditions; grant via frozen
  `HandbookUnlocks.grant(ServerPlayer, ResourceLocation)`; attachment-synced.
- **Unit tests (≥15):** `lang_parity_en_de` (exact key-set equality both ways,
  no empty/TODO), `handbook_lang_coverage`, `handbook_pages_structural` (gson),
  `handbook_deeplink_targets` (`HandbookTopics` constants resolve),
  `ApiFreezeTest` (D5), search-index core tests (MC-free tokenizer).
- **Server GameTests (≥5):** `handbook_completeness_registry` (uncovered = 0,
  exempt size = 0), `handbook_pages_valid` (strict codec parse, recipe ids
  resolve), `handbook_sync_on_join` (exactly 1 sync + 1 recipes payload; counts
  match), `handbook_unlock_grant_persist` (attachment + NBT round-trip;
  duplicate grant = 0 changes), `handbook_reload_resync` (1 broken page ⇒
  skipped, server up, counts exact), `w1_perf_baseline_idle` (mean tick
  ≤10 ms).
- **Client GameTests (≥3):** `handbook_open_navigate` (keybind → probe page →
  screenshot), `handbook_search_finds_probe` (EN; gibberish ⇒ 0),
  `handbook_widgets_render` (recipe slot = charge_probe; charge text equals
  config literal "5 Cg/t"; region screenshot), `w1_perf_baseline_handbook`
  (mean frame ≤33.3 ms).
- **Commit:** `feat(cuprum): W1E handbook, config UI and W1 integration`

---

## 5. Integration constraints (binding)

1. **Bootstrap order** — `Cuprum.onInitialize()`: `CuprumConfigs.init()` →
   `CuprumNet.init()` (+ diag payloads/receivers) → `CuprumBlocks/Items/
   CreativeTabs.init()` (existing) → `StateProbe.init()` → `ChargeModule.init()`
   (W1B) → `MachineModule.init()` (W1C) → `FxModule.init()` (W1D) →
   `HandbookModule.init()` (W1E). `CuprumClient.onInitializeClient()`:
   `CuprumClientConfigs.init()` → `CuprumClientNet.init()` →
   `MachineClientModule.init()` (W1C) → `FxClientModule.init()` (W1D) →
   `HandbookClientModule.init()` (W1E). Each phase appends exactly its line(s).
2. **Sequential shared-file edits only** — the shared files (§2 table) are
   edited only in their listed phase, append-only where marked; no parallel
   workstreams on one file; phases never start before the previous phase's
   commit is pushed and green.
3. **No new dependencies** beyond the pinned stack except the W1E modmenu
   `modCompileOnly` (same pinned coordinate already in `modLocalRuntime`).
   `toolchainVerify` literals unchanged all wave.
4. **Datagen** regenerated and committed in every content phase (D11);
   `datagen_determinism.sh` green each time.
5. **API_PROBES.md** gains one appended section per phase recording newly
   compile-proven signatures; probes follow the frozen `RenderApiProbe` rules.
6. **No mixins**, no access-widener additions in W1 (nothing verified requires
   one; PROBE-4 is U04's problem).
7. Banned stale APIs per multiblock.md §13 / client-fx.md header apply
   repo-wide (v0 resource loader, `ScreenRegistry`, `BlockEntityRendererRegistry`,
   `Block.onRemove`, CompoundTag BE load/save, `WorldRenderEvents`,
   raw `PacketByteBufs`, vanilla `BlockPattern` volume scans).
8. Gameplay-content firewall: no catalog entry; coil/fx_probe ship **no
   recipes** in W1 (creative/diagnostic acquisition only; revisit when a wave
   ships them as features). Handbook documents them regardless (D6).

## 6. CP1 exit checklist (objective, all required)

1. `./gradlew toolchainVerify` green; pins unchanged.
2. `./gradlew check build` green: lint `-Werror` all six source sets, catalog
   validation + concept parity (digest byte-identical to CP0B), deterministic
   unit tests — **all 134 existing tests untouched and green; total ≥ 225**
   with the suites named in §4 present and seeded/deterministic.
3. `./gradlew runGameTest` green: every §4 server GameTest listed above exists
   and passes headless (real server, mock players).
4. `./scripts/datagen_determinism.sh` green; generated tree committed & fresh.
5. `./scripts/server_smoke.sh` green (boot → Done → clean console stop; no
   client-class leakage; no ERROR/FATAL).
6. `./scripts/server_restart_probe.sh` green: **dedicated server twice on the
   same world**; second boot logs `cuprum_state_probe boots=2` and the
   `cuprum_charge_graph` re-read line (D1 proof).
7. `./scripts/client_smoke.sh` green: client GameTests pass; screenshots
   present for coil screen, FX ripple (T1+T2), handbook page.
8. API contract lock: `api/cuprum-api.lock` committed; `ApiFreezeTest` green;
   any surface change is a reviewed two-file diff.
9. Performance: solver EMA counters + `SolverBudgetTest` (≤1.0 ms CI-soft,
   0.15 ms target logged); `FxFrameStats` counters assertable
   (T1 submits > 0; REDUCED ⇒ 0); `w1_perf_baseline_idle` ≤10 ms mean;
   `w1_perf_baseline_handbook` ≤33.3 ms mean; `build/perf/*.json` uploaded.
10. Handbook completeness: every `cuprum`-namespace block/item documented
    (4 ids, 3 pages), `exempt.json` size 0, EN/DE parity gates green.
11. `verifyConceptParity` digest and `catalog/**` byte-identical to CP0B.

---

## 7. W1A implementation prompt (standalone; hand to the implementer verbatim)

> You are implementing **W1A** of the Cuprum W1 foundation. The binding plan is
> `CUPRUM/docs/foundation/FOUNDATION_PLAN.md` — read §1 (D1/D2/D3/D5/D9/D10),
> §2, §3, §4-W1A, §5 first; where the concept briefs (`docs/foundation/*.md`)
> disagree with the plan, the plan wins. Work only inside `/workspace/CUPRUM`.
>
> **Deliverables (only these; do not touch W1B–W1E files):**
> 1. `dev.cuprum.cuprum.net`: `CuprumNet` (init + `registerGuardedC2S` hook),
>    `CuprumPayloads` (net-owned payload registration), `CuprumNetVersion`
>    (`NET_VERSION=1`, `isCompatible`; **no** config-phase handshake),
>    `payload/DiagEchoPayload` + `DiagEchoReplyPayload` (ids
>    `cuprum:c2s/diag/echo`, `cuprum:s2c/diag/echo_reply`; bounded codecs per
>    plan §3.2), `server/{C2SGuard, GuardSpec, GuardResult, NetRateLimiter,
>    RateKey(DEFAULT,GLOBAL), NetViolations(kick via overridable sink)}`.
> 2. `dev.cuprum.cuprum.ownership` (+ MC-free `OwnershipCore`) and
>    `dev.cuprum.cuprum.perm` (`Perms` vanilla-fallback only, `Nodes` =
>    `cuprum.diagnostics`, `cuprum.admin.override`). No BE/item wiring.
> 3. `dev.cuprum.cuprum.state`: `CuprumSchema`, `Versioned`, `StateMigrations`,
>    `CuprumAttachments` (sole attachment-API caller; no constants yet),
>    `CuprumSavedData` (schema envelope base), `StateProbeSavedData`
>    (`cuprum_state_probe`, `SavedDataType<>(…, null)`, increments+logs a boot
>    counter on SERVER_STARTED, `setDirty`), `StateApiProbe`.
> 4. `dev.cuprum.cuprum.config`: `CuprumCommonConfig` (AutoConfig `ConfigData`,
>    Jankson serializer → `config/cuprum-common.json5`, sections/values per plan
>    §3.3, `validatePostLoad` clamps), `CuprumConfigs` accessor,
>    `ConfigSyncPayload` (`cuprum:s2c/config/common`, sent on JOIN + reload;
>    client overlay, restored on disconnect). Client: `CuprumClientConfig`
>    (`cuprum-client.json5`, fields per §3.3; **no screens yet**).
> 5. `dev.cuprum.cuprum.client.net.CuprumClientNet` (+`ClientNetApiProbe`):
>    receivers for echo reply + config sync; a test hook to send diag echo.
> 6. Bootstrap edits per plan §5.1; `NetApiProbe` compile pins per
>    net-state.md §10; `docs/API_PROBES.md` append "Networking & state".
> 7. Scripts: `server_smoke.sh` opt-in `PRESERVE_RUN_DIR=1` +
>    `REQUIRE_LOG_REGEX` (defaults unchanged, keep its PID discipline);
>    new `scripts/server_restart_probe.sh` (fresh boot expects `boots=1` log,
>    second boot with preserved run dir expects `boots=2`).
> 8. Tests: src/test ≥20 new deterministic MC-free tests (`RateLimiterTest`,
>    `OwnershipCoreTest`, `NetBoundsTest`, `GuardOrderTest`; plus ≥512-buffer
>    seeded mutation fuzz of the diag-echo codec **as a server GameTest** if it
>    needs MC classes, else JUnit); ≥8 server GameTests and the client
>    diag-echo test per plan §4-W1A.
>
> **Hard constraints:** no catalog/concept edits (digest-sealed); no new
> dependencies; no mixins; MC-free `src/test` (plan D9); split env source sets
> respected; `SavedDataType` fixer = `null` (plan D1 — never a vanilla
> `DataFixTypes`); all shared-file edits append-only per plan §2.
>
> **Done =** every command in plan §4 preamble green (including
> `server_restart_probe.sh` proving `boots=2`), then commit exactly
> `feat(cuprum): W1A net, state and config foundation` and push. Report: files
> added, test counts (must state "134 existing + N new"), probe outcomes, and
> any deviation from the plan with justification.

## 8. Evaluator prompts

### 8.1 Sol Eval-A (independent technical audit)

> You are **Sol Eval-A**, auditing phase <PHASE> of the Cuprum W1 foundation
> against the binding plan `CUPRUM/docs/foundation/FOUNDATION_PLAN.md`
> (that plan supersedes the briefs). Do not trust the implementer's report.
> 1. **API truth:** for every new/changed use of a Minecraft/Fabric API, verify
>    the signature against the decompiled sources in
>    `.gradle/loom-cache/minecraftMaven/**-sources.jar` and
>    `.gradle/loom-cache/remapped_mods/**-sources.jar`. Flag any banned stale
>    API (plan §5.7) and any invented member.
> 2. **Plan conformance:** diff the changeset against the phase's file globs,
>    ownership table (§2), id ledger (§3.4), contracts (§3) and decisions (§1).
>    Any file outside the phase scope, any competing serializer/registration
>    path, any `DataFixTypes` other than `null`, any catalog/concept-doc touch,
>    or any new dependency = REJECT.
> 3. **Run the gates yourself** from `CUPRUM/`: `./gradlew toolchainVerify`,
>    `./gradlew check build`, `./gradlew runGameTest`,
>    `./scripts/server_smoke.sh`, `./scripts/server_restart_probe.sh`,
>    `./scripts/client_smoke.sh`, and `./scripts/datagen_determinism.sh` when
>    datagen changed. Confirm the 134 pre-existing unit tests still run and the
>    phase's named suites exist (grep the test report, count assertions).
> 4. **Test honesty:** verify the listed GameTests assert the exact numbers in
>    the plan (e.g. 1,000 Cg after 20 ticks; vented 250,000; exempt size 0);
>    verify determinism (seeded randomness only); verify no test asserts
>    forbidden vocabulary for its scope (server tests: no render/HUD).
> 5. Produce a verdict `PASS` or `REJECT` plus a numbered findings list
>    (severity, file, line, evidence). Minor nits go in a separate list. A
>    single safety/API-truth finding means REJECT.

### 8.2 Fable Eval-B (adversarial second pass + fix verification)

> You are **Fable Eval-B**, the second evaluator for phase <PHASE>. Input: the
> changeset, the plan (`FOUNDATION_PLAN.md`, binding), and Sol Eval-A's
> findings. Your job is different from Eval-A's:
> 1. Verify every Eval-A finding is either fixed or rebutted with source
>    evidence; re-run only the gates affected by the fixes, plus one full
>    `./gradlew check build`.
> 2. **Adversarial review:** hunt for what a conformance audit misses —
>    conservation/duplication holes in the charge allocator (Σ invariant under
>    surge + freeze + rebuild interleavings), guard bypasses (handler code
>    reachable without `C2SGuard`, clamping instead of rejecting, chunk-load
>    side effects in range checks), thread-safety (any `Level` access off the
>    server thread, static state leaking across worlds/disconnects), client/
>    common leaks (`net.minecraft.client.*` imports in `src/main`), silent
>    data loss on version-skew loads, nondeterminism (hash-map iteration in
>    the solver/canonical order, unseeded randomness in tests), and budget
>    counters that could report success without the code path running.
> 3. Check cleanup: no leftover debug code, no disabled tests, no `@Disabled`,
>    no TODO markers in shipped lang/pages, generated datagen committed fresh.
> 4. Verdict `PASS` (phase may commit/push) or `REJECT` with a numbered
>    findings list. If both evaluators pass, the implementer commits with the
>    exact phase commit name from plan §4 and pushes before the next phase
>    starts.
