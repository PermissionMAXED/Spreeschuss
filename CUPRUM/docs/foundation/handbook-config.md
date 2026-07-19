# W1 Foundation Concept — Handbook, Config, Localization, Test Infrastructure

Status: CONCEPT (W1). Owner: handbook/config/localization/test-infra specialist.
Every API named below was verified against the decompiled 1.21.9 Mojmap sources and the
remapped Fabric API 0.134.1+1.21.9 / Cloth Config 20.0.149 / Mod Menu 16.0.1 jars in
`.gradle/loom-cache` (same discipline as `docs/API_PROBES.md`).

## 1. Scope and non-goals

W1 gameplay (U04/U05/U06/U07/U16/U20) is owned by other specialists. This concept owns
the cross-cutting W1 infrastructure they plug into:

- Handbook foundation (groundwork for U22 `dynamic_handbook`, wave W4): data model,
  reload, sync, screen, widgets, search, bookmarks, deep links, unlocks.
- Config: Cloth Config common/client split (`cuprum-common.json5` is a binding INDEX.md
  contract — "gametests read the same config"), optional Mod Menu entry.
- Localization: EN/DE key parity as an enforced gate.
- Test infra: feature-page completeness gate, W14 perf-harness foundation, API freeze,
  cross-module integration gates.

Non-goals: catalog-generated U22 chapters (W4), QOL-01 "?" buttons (W13), REI (W13/W14),
gameplay balance. **No Patchouli**: no 1.21.9 Fabric build fits the pinned stack, it
would violate the `toolchainVerify` immutable-pin philosophy, and its format cannot
express charge/multiblock/unlock semantics. `fabric.mod.json` gains no required dep.

## 2. Package ownership

Split env source sets are mandatory (`loom.splitEnvironmentSourceSets()`; server smoke
greps for client-class leaks).

| Package | Source set | Contents |
|---|---|---|
| `dev.cuprum.cuprum.handbook` | main | `HandbookManager` (server reloader + page store), codecs, page/category/widget records, unlock evaluation |
| `dev.cuprum.cuprum.handbook.net` | main | `CustomPacketPayload` records + `StreamCodec`s (S2C only in W1) |
| `dev.cuprum.cuprum.api.handbook` | main | FROZEN API (§11): page/widget model, `HandbookUnlocks.grant(ServerPlayer, ResourceLocation)`, `HandbookTopics` page-id constants |
| `dev.cuprum.cuprum.config` | main | `CuprumCommonConfig` (AutoConfig `ConfigData`), accessors, S2C config-sync payload |
| `dev.cuprum.cuprum.client.handbook` | client | `HandbookScreen`, widget renderers, client page cache, search index, bookmarks store, keybind |
| `dev.cuprum.cuprum.client.api.handbook` | client | FROZEN client API: widget-renderer registration + reusable multiblock preview renderer (TOOL-11 contract) |
| `dev.cuprum.cuprum.client.config` | client | `CuprumClientConfig` (accessibility), Cloth screen builder, Mod Menu entrypoint |
| `dev.cuprum.cuprum.perf` | gametest | W14 harness foundation: `PerfSampler`, `PerfBudget`, JSON report writer |

Datagen additions stay in `dev.cuprum.cuprum.datagen`; validators stay in
`src/catalogTool` (plain Java, no MC classes).

## 3. Handbook content: location, reload, schemas

### 3.1 Location + reload (verified 1.21.9 approach)

Handbook content is **server data**: `data/cuprum/handbook/categories/<id>.json` and
`data/cuprum/handbook/pages/<category>/<id>.json`. Rationale: unlocks are
server-evaluated (INDEX contract 1), datapacks can override pages, and the completeness
gate (§7) runs in the headless server GameTest suite already wired into `check`.

- Reload via `fabric-resource-loader-v1`:
  `ResourceLoader.get(PackType.SERVER_DATA).registerReloader(id, reloader)`
  (`net.fabricmc.fabric.api.resource.v1.ResourceLoader` — v0 `ResourceManagerHelper` is
  legacy; do not use).
- Reloader extends vanilla `SimpleJsonResourceReloadListener<HandbookPage>` with the
  verified ctor `(Codec<T> codec, FileToIdConverter lister)` +
  `FileToIdConverter.json("handbook/pages")` — codec-parsed, per-file error isolation
  (bad page ⇒ logged + skipped, never crashes).
- Registry access if needed: `ResourceLoader.RELOADER_REGISTRY_LOOKUP_KEY`
  (`PreparableReloadListener.StateKey<HolderLookup.Provider>`, SERVER_DATA only).
- Client registers one reloader on `PackType.CLIENT_RESOURCES` ordered after
  `ResourceReloaderKeys.Client.LANGUAGES` (verified constant) to rebuild the search
  index on language/resource-pack switch.
- `/reload` re-parses and re-syncs (§4).

### 3.2 Schemas + codecs

Java records with DFU `Codec` (RecordCodecBuilder); strict (unknown keys rejected;
JUnit-enforced). Shape:

```
category: { "id": "cuprum:diagnostics", "title_key": "handbook.cuprum.category.diagnostics",
            "icon": "cuprum:charge_probe", "sort": 900 }

page:     { "id": "cuprum:diagnostics/charge_probe",
            "category": "cuprum:diagnostics",
            "title_key": "handbook.cuprum.page.charge_probe.title",
            "subject": ["cuprum:charge_probe"],   // registry ids documented (drives §7 + deep links)
            "unlock": { "type": "always" },        // or {"type":"key","key":"cuprum:unlock/..."}
            "search_extra_keys": [],
            "widgets": [ ... ] }
```

`widgets` = dispatch codec union on `"type"` (the verified `RecipeDisplay.CODEC`
pattern). W1 widget set:

| type | payload | notes |
|---|---|---|
| `text` | `key` (lang key), optional `style` (`body`/`heading`/`caption`) | prose lives ONLY in lang files ⇒ EN/DE parity gate covers handbook text |
| `image` | `texture`, `width`, `height`, optional `caption_key` | client GameTest asserts texture resolves |
| `recipe` | `recipe` (recipe id) | rendered from synced `RecipeDisplay` (§5) |
| `multiblock` | `palette` (char → block state), `layers` (row strings), codec-capped ≤16³ | rendered by the reusable preview renderer (§5) |
| `charge` | `value_ref` (config path, e.g. `charge.leydenJarCapacityCg`), optional `unit` (`Cg`/`Cg/t`/`ticks`) | reads live `cuprum-common.json5` ⇒ handbook numbers never drift from balance config |

Every record also declares a `StreamCodec<RegistryFriendlyByteBuf, T>`. JUnit proves
`Codec` and `StreamCodec` round-trip equality per widget type (§10).

## 4. Server/client boundaries, save + sync semantics

Payloads via `fabric-networking-api-v1` (verified:
`PayloadTypeRegistry.playS2C().register(CustomPacketPayload.Type, StreamCodec)`,
`ServerPlayNetworking.send(ServerPlayer, payload)`):

| Payload | Dir | When | Contents |
|---|---|---|---|
| `cuprum:handbook/sync` | S2C | join (`ServerPlayConnectionEvents.JOIN`) + datapack reload (`PlayerLookup.all`) | full category+page set (post-parse), encoded size logged |
| `cuprum:handbook/recipes` | S2C | with sync | `Map<recipeId, RecipeDisplay>` for every `recipe` widget, via verified `RecipeDisplay.STREAM_CODEC` |
| `cuprum:handbook/unlock` | S2C | incremental on grant | newly unlocked keys |
| `cuprum:handbook/goto` | S2C | server-initiated deep link (quests later) | page id |
| `cuprum:config/common` | S2C | join + reload | server common-config snapshot (§6) |

**No C2S payload in W1** — the handbook is read-only (QOL security contract); zero
validation surface.

State ownership:

- **Unlocks** — server truth. Player attachment via `fabric-data-attachment-api-v1`:
  `AttachmentRegistry.create(id, b -> b.persistent(CODEC).copyOnDeath()
  .initializer(...).syncWith(packetCodec, AttachmentSyncPredicate.targetOnly()))`
  (all builder methods verified). Value: `Set<ResourceLocation>` with sorted-list codec
  (deterministic NBT). Survives restart (persistent) and respawn (copyOnDeath); synced
  to owning client only.
- **Unlock evaluation**: player join, explicit `HandbookUnlocks.grant()` calls from
  feature code, datapack reload. No per-tick polling. W1 condition types: `always`,
  `key`; later waves add `advancement`/`stat` evaluators behind the same interface.
- **Bookmarks + read position** — client-local, never synced. File:
  `<configDir>/cuprum/handbook_bookmarks.json`, keyed per world/server id, capped 64,
  codec-encoded; corrupt file renamed `.corrupt` + reset (never crashes).
- **Client page cache** — rebuilt only from `handbook/sync`; cleared on
  `ClientPlayConnectionEvents.DISCONNECT`. Client never reads handbook JSON from disk
  ⇒ client/server can never disagree on content or unlock state.

## 5. Client screen, widgets, search, deep links

- Plain `net.minecraft.client.gui.screens.Screen` subclass; **no MenuType/screen
  handler** (no server container — vanilla-correct for book UIs). Open via
  `Minecraft.setScreen`.
- Rendering (verified `GuiGraphics`): `drawString`/`drawWordWrap`,
  `blit(RenderPipeline, ResourceLocation, ...)`/`blitSprite(RenderPipeline, ...)`,
  `renderItem(ItemStack, x, y)`.
- Keybind: `KeyBindingHelper.registerKeyBinding(new KeyMapping("key.cuprum.handbook",
  GLFW_KEY_H, CUPRUM_CATEGORY))` — 1.21.9 takes `KeyMapping.Category(ResourceLocation)`
  (verified; string categories are gone).
- Navigation: category grid → page list → page view; explicit back-stack (deep links
  push, Esc pops); breadcrumb header.
- **Deep links** = page id + anchor (`cuprum:diagnostics/charge_probe#2`). Entry
  points: keybind (last page), client command `/cuprum-handbook <page>`
  (fabric-command-api-v2 client commands), frozen `HandbookClientApi.open(PageRef)`
  (QOL-01/ADV call this later), chat via verified
  `ClickEvent.Custom(ResourceLocation, Optional<Tag>)`, S2C `handbook/goto`. Locked
  page ⇒ lock notice, no content.
- **Recipes**: in 1.21.9 full recipes are NOT on the client (`RecipeManager` is a
  server-side `SimplePreparableReloadListener`; clients only get displays). Server
  resolves each `recipe` widget to a `RecipeDisplay`
  (`ShapedCraftingRecipeDisplay`/`FurnaceRecipeDisplay`/… all verified with
  `CODEC`/`STREAM_CODEC`) at sync time. Widget renders `SlotDisplay` contents with
  `renderItem`, cycling multi-item slots every 20 ticks. Unknown recipe id ⇒ localized
  "recipe unavailable" body + server validation warning (asserted absent in CI).
- **Multiblock preview**: 1.21.9 deferred-GUI picture-in-picture path —
  `net.fabricmc.fabric.api.client.rendering.v1.SpecialGuiElementRegistry.register(
  ctx -> new HandbookMultiblockPipRenderer(...))` (verified; vanilla precedents in
  `net.minecraft.client.gui.render.pip.*`). Isometric render + per-layer step buttons;
  T3 fallback (INDEX visual tiers / `reducedEffects`) = flat per-layer item grid via
  `renderItem` only. Exported in `client.api.handbook` — TOOL-11 (W10) contractually
  reuses it.
- **Search**: client inverted index over localized titles, `text` strings, `subject`
  item names, `search_extra_keys`; lowercase + diacritic folding; prefix/substring,
  ranked title > subject > body. Rebuilt on sync payload and post-`languages` client
  reload. Built off-thread, applied on render thread.
- **Bookmarks**: star toggle per page, bookmark rail on landing view; persisted per §4.

## 6. Config: Cloth split, sync, Mod Menu

Cloth Config 20.0.149 (required dep) bundles AutoConfig + json5
`me.shedaniel.autoconfig.serializer.JanksonConfigSerializer` (verified, shadowed
Jankson; jar env unrestricted ⇒ dedicated-server-safe).

- `CuprumCommonConfig implements ConfigData` (main), registered in `Cuprum.onInitialize`
  via `AutoConfig.register(CuprumCommonConfig.class, JanksonConfigSerializer::new)` →
  `config/cuprum-common.json5`. Holds the binding INDEX vocabulary constants
  (`passiveBaselineCgPerTick=5`, `leydenJarCapacityCg=100000`, `strikeDepositCg=270000`,
  wire loss pp/span, …) in per-family sections. GameTests read the same object.
- `CuprumClientConfig` (client) → `config/cuprum-client.json5`: presentation +
  accessibility only (§7). Two files (not `PartitioningSerializer`) keeps client
  classes out of main and lets the dedicated server ignore client config.
- **Sync**: S2C `cuprum:config/common` snapshot on join + reload; client stores it as an
  "effective config" overlay, restores local values on disconnect. Server wins; the
  client file is never rewritten.
- **Validation**: `ConfigData.validatePostLoad()` clamps + logs; JUnit round-trips
  defaults through Jankson and asserts key-set stability (schema freeze, §11).
- **Mod Menu (optional)**: entrypoint `"modmenu"` →
  `dev.cuprum.cuprum.client.config.CuprumModMenu implements
  com.terraformersmc.modmenu.api.ModMenuApi` (verified in 16.0.1 jar) returning a
  `ConfigScreenFactory` backed by AutoConfig `ConfigScreenProvider`. Mod Menu stays in
  `suggests` only. **Build delta**: add `modCompileOnly` alongside the existing
  `modLocalRuntime` for `com.terraformersmc:modmenu:16.0.1` (version pin unchanged).

### RECONCILIATION FLAG (for lead)

`cuprum-common.json5` is claimed by multiple W1+ owners and needs a single schema
arbiter:

- **Net-state/charge overlap**: the charge-economy constants (baseline Cg/t, jar/strike
  Cg, U19 line-loss pp/span) live in this config per PWR.md/INDEX, but the charge-graph
  (net-state) specialist owns their runtime semantics and W2+ persistence
  (INDEX contract 5). Proposal: config module owns file/serializer/sync/key naming
  (`charge.*`, `wire.*` sections); net-state owns value semantics and is sole reviewer
  of those sections; `charge` handbook widgets are read-only consumers via
  `value_ref` paths — no duplicate literals anywhere.
- **FX overlap**: QOL-04 `reducedEffects` (client config, §7) globally forces T2/T3 and
  particle caps that the FX family (W12) and the W14 FX budget gate
  (`w14_fx_effect_budget`, 500 instances ≤0.20 ms/tick) also read. Proposal: client
  config owns the toggle + a read-only `EffectsTier effectiveTier()` accessor in the
  frozen API; FX owns cap values (in `cuprum-common.json5` `fx.*` section) and the
  budget literals (`PerfBudgets`, §9). Lead to confirm both splits before W2 freezes
  the API hash (§11).

## 7. Accessibility settings (client config; INDEX invariant 7)

All in `cuprum-client.json5`, live-applied, Cloth-editable:

- `reducedEffects` — pre-wires QOL-04: selects T2/T3 assets globally; W1 consumers:
  handbook flip animation off, multiblock PiP → flat grid. Outcome-neutral by
  construction (presentation selection only).
- `shapeCodedIndicators` — pre-wires QOL-05: handbook lock/unlock/bookmark states get
  glyph + color (W1 already ships shape-differentiated lock icons).
- `handbookTextScale` (0.75–2.0, pose scaling around `drawWordWrap`),
  `highContrastHandbook`, `disablePageTurnAnimation`, `keyboardNavigation`
  (focus outlines; traversal itself is always on via vanilla `Screen` focus).
- Narration: every custom widget implements `NarratableEntry` — acceptance criterion,
  not an option.

## 8. Localization: EN/DE parity + diagnostic page

- Convention: every handbook string is a lang key `handbook.cuprum.*` (§3.2 ⇒ zero
  inline prose). Both `FabricLanguageProvider`s already exist in `src/datagen`.
- `unit_test: lang_parity_en_de` — reads committed
  `src/main/generated/assets/cuprum/lang/{en_us,de_de}.json` (path via new
  `test { systemProperty 'cuprum.generatedAssetsDir', ... }`, same pattern as
  `cuprum.catalogDir`); asserts exact key-set equality both ways, no empty values, no
  TODO markers. Objective: missing keys = 0 each direction.
- `unit_test: handbook_lang_coverage` — every `title_key`/`text.key`/`caption_key` in
  `data/cuprum/handbook/**` exists in BOTH lang files. Objective: unresolved = 0.
- Datagen determinism/freshness gates (existing scripts + CI) cover ordering unchanged.

**Diagnostic page (Charge Probe only).** One category `cuprum:diagnostics` (sort 900)
and one page `cuprum:diagnostics/charge_probe`, `unlock: always`:
`text` (CP0 infrastructure; reports mod version + canonical catalog SHA-256 on use —
matches `ChargeProbeBlock` exactly), `image`
(`textures/block/charge_probe.png`), `recipe` (`cuprum:charge_probe`, exists in
generated data), one `charge` widget bound to `charge.passiveBaselineCgPerTick`
(proves the config-bound path). No other pages in this deliverable: the probe has no
catalog entry by design, proving the handbook documents non-catalog infrastructure; the
page doubles as the golden screenshot-comparison sample. W1 feature specialists add
their own pages — §9's completeness gate forces it.

## 9. Test-infra contracts: completeness gate + W14 perf harness

**Feature-page completeness gate** — objective rule: every player-obtainable registered
`cuprum` id must be documented.

- `server_gametest: handbook_completeness_registry` (headless, runs in `check` via
  `runGameTest`): iterate `BuiltInRegistries.BLOCK`/`ITEM` for namespace `cuprum`;
  each id must appear in some loaded page's `subject`, unless listed in the reviewed
  `handbook/exempt.json` (technical blocks only; **must be empty in W1** — asserted
  size = 0, bumped only via reviewed diff). Failure names every uncovered id.
- `unit_test: handbook_pages_valid`: strict-codec parse of all pages, category refs
  resolve, `HandbookTopics` constants resolve, recipe-widget ids exist in
  `src/main/generated/data/cuprum/recipe/`. Objective: parse errors = 0, dangling = 0.
- Ratchet: registry-driven ⇒ U04–U20 PRs cannot pass CI without shipping pages + lang
  keys. This is the cross-module enforcement point; no per-wave bookkeeping.

**W14 perf harness foundation** (W14 = integration/perf hardening per INDEX; budgets:
QOL HUD ≤0.2 ms/frame, FX ≤0.20 ms/tick over 1,000 ticks, reference scene ≤16.6
ms/frame):

- `PerfSampler` (gametest set, shared): server reads
  `MinecraftServer.getAverageTickTimeNanos()`/`getCurrentSmoothedTickTime()` (verified);
  client reads `Minecraft.getFrameTimeNs()`/`getFps()` (verified) once per tick via
  `ClientGameTestContext.waitFor` loops.
- Report: canonical JSON `build/perf/<test>.json` (min/mean/p95/max, samples, budget,
  pass) uploaded as CI artifact (add `build/perf/**` to existing artifact globs).
- `PerfBudget.assertMeanBelow(samples, budgetNs, warmupTicks)` hard-fails the test;
  literals centralized in `PerfBudgets` (FX owns FX literals — see §6 flag).
- W1 calibration gates (deliberately loose): `client_gametest:
  w1_perf_baseline_handbook` (probe page open 200 ticks, mean frame ≤33.3 ms) and
  `server_gametest: w1_perf_baseline_idle` (1,000 idle ticks, mean ≤10 ms). W14 swaps
  scenes (dome + 8 turrets + 64 tube items), reusing sampler/report/gate unchanged;
  `w14_fx_effect_budget` binds to the same API.

## 10. Acceptance tests (objective)

JUnit (`src/test`): `handbook_codec_roundtrip` (decode∘encode = identity per widget,
Codec + StreamCodec), `handbook_pages_valid`, `lang_parity_en_de`,
`handbook_lang_coverage`, `config_defaults_roundtrip` (Jankson round-trip, key-set
equality, 0 post-load corrections), `api_freeze_hash` (§11 digest equals pinned
literal), `handbook_deeplink_targets` (all `HandbookTopics` constants resolve).

Server GameTests (`net.fabricmc.fabric.api.gametest.v1.GameTest`, methods take
`GameTestHelper`; wired into `check`):

| Test | Objective criterion |
|---|---|
| `handbook_completeness_registry` | uncovered ids = 0; exempt list size = 0 (W1) |
| `handbook_sync_on_join` | join ⇒ exactly 1 `handbook/sync` + 1 `handbook/recipes`; decoded page count = server store count |
| `handbook_unlock_grant_persist` | grant ⇒ attachment contains key; player NBT round-trip retains it; duplicate grant adds 0 entries, sends 0 payloads |
| `handbook_reload_resync` | reload with 1 broken page JSON: server up, page skipped, remaining count exact, 1 resync payload |
| `w1_perf_baseline_idle` | mean tick ≤ budget |

Client GameTests (`fabric-client-gametest`; run by `scripts/client_smoke.sh` under
Xvfb; verified `ClientGameTestContext`/`TestInput`: `pressKey(KeyMapping)`,
`typeChars`, `clickScreenButton(translationKey)`, `waitForScreen`, `takeScreenshot`,
`assertScreenshotEquals`):

| Test | Objective criterion |
|---|---|
| `handbook_open_navigate` | keybind opens `HandbookScreen`; navigation reaches probe page id; screenshot artifact |
| `handbook_search_finds_probe` | "probe" (EN) / "sonde" (DE after language switch) each return ≥1 hit = probe page; gibberish returns 0 |
| `handbook_bookmark_persist` | toggle + reopen ⇒ exactly 1 rail entry; on-disk file parses and contains the page id |
| `handbook_deeplink_locked` | locked page renders 0 content widgets; after server grant + sync, same link renders ≥1 |
| `handbook_widgets_render` | recipe result slot = `cuprum:charge_probe`; image resolves; charge text equals config literal ("5 Cg/t"); `assertScreenshotEquals` vs committed template (region-scoped) |
| `w1_perf_baseline_handbook` | mean frame ≤ budget |

CI: existing `.github/workflows/cuprum-ci.yml` jobs cover everything (`check`+
`runGameTest` in build; client smoke separate); only deltas are the perf artifact glob
and the two `test` system properties.

## 11. API freeze/hash + cross-module integration gates

**Freeze** (protects U22/W4, QOL-01, TOOL-11, ADV-01/03/06), modeled on the repo's
digest discipline (catalog SHA + concept full-row digest pinned in task AND test):

- Frozen surface: `dev.cuprum.cuprum.api.handbook`, `dev.cuprum.cuprum.api.config`
  (main), `dev.cuprum.cuprum.client.api.handbook` (client).
- New `catalogTool` mode `CatalogTool apifreeze`: parses compiled class files of those
  packages (ASM `ClassReader`; new pinned `catalogToolImplementation` dep — the only
  new library), emits canonical sorted JSON of every public/protected member
  descriptor+signature; SHA-256 (compact encoding) compared to the single literal in
  `api/handbook-api.lock` AND pinned in `ApiFreezeTest` ⇒ any change is a reviewed
  two-file diff.
- Gradle task `verifyApiFreeze` (inputs: compiled main+client classes, lock file),
  wired into `check`. Removed/changed member always fails; added member fails until an
  explicit `-Papifreeze.update` regeneration (mirrors explicit datagen regeneration).

**Cross-module integration gates** (named, objective, owned by the wave that must pass):

| Gate | Mechanism | Binds |
|---|---|---|
| `handbook_completeness_registry` | server GameTest in `check` | every wave: new ids ⇒ pages + lang keys |
| `lang_parity_en_de` + `handbook_lang_coverage` | JUnit in `check` | every wave ships EN and DE |
| `verifyApiFreeze` | Gradle task in `check` | QOL-01 (deep-link API), TOOL-11 (multiblock renderer), ADV-01/03/06 (unlock/goto), U22/W4 (page model) |
| `config_schema_freeze` | JUnit key-set assertion on defaults | balance keys in concept acceptance cells never renamed/retyped silently |
| `handbook_deeplink_targets` | JUnit | code-referenced page ids always exist |
| `w14_*` perf gates | GameTests on the W1 `PerfBudget` API | FX budget, QOL-04 harness, reference scene |
| existing `verifyConceptParity` | unchanged | this concept edits no catalog/concept docs; pinned digest untouched |

**W1 build deltas (complete list)**: Mod Menu `modCompileOnly` (§6), ASM for the freeze
tool + `verifyApiFreeze` task (§11), two `test` system properties, perf artifact glob in
CI. Everything else is new source/resources inside the existing architecture.

## 12. Risks / open points

- `SpecialGuiElementRegistry` PiP renderers are per-element-type; one renderer class
  must handle variable structure sizes — prototype early; the flat item-grid T3
  fallback is the guaranteed floor and is what screenshot comparison pins.
- Screenshot comparison on CI (Mesa/llvmpipe) can drift with driver updates; use
  `TestScreenshotComparisonOptions` region-scoped assertions on flat-color UI regions,
  never on 3D renders.
- `handbook/sync` size is trivial in W1 (1 page) but encoded byte size is logged from
  day one so the QOL packet-budget culture (≤1 KiB guidance) has data before W5.
- AutoConfig/Jankson does not preserve hand-written json5 comments on rewrite; document
  `cuprum-common.json5` as machine-managed (explanations belong in config-screen
  tooltips = lang keys = EN/DE-gated).
- Pending lead reconciliation of `cuprum-common.json5` section ownership
  (net-state charge/wire sections; FX caps + `reducedEffects` tier accessor) — see §6
  flag; must resolve before the W2 API-hash freeze.
