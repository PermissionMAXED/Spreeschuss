# Cuprum — agent notes

Fabric mod for Minecraft **1.21.9**, Java 21, Gradle 9.5.1 wrapper. Run everything from
this directory (`CUPRUM/`).

## Standard commands

- `./gradlew toolchainVerify` — every pin is compared against **immutable literals in
  build.gradle** (properties, declared deps, resolved fabric-loader, Loom's
  `LOOM_VERSION`, layered-mappings hash). A wrong `-Ploader_version` etc. must fail.
- `./gradlew check build` — lint gate (`-Xlint:all,-classfile,-processing -Werror`
  over main/client/datagen/gametest/catalogTool/test), JUnit + mutation tests
  (`src/test`), catalog validation and **headless server GameTests** (`runGameTest`
  is wired into `check`), then builds the remapped jar. `.cache` is excluded from
  both `jar` and `sourcesJar`.
- Standalone `./gradlew runGameTest` is hermetic and deletes
  `build/run/gameTest/world` before each normal run. Only restart probes should opt
  into `-Pcuprum.preserveGameTestWorld=true`.
- `./gradlew runDatagen` — regenerates `src/main/generated` (those files are committed;
  keep them in sync). `./scripts/datagen_determinism.sh` runs it twice and compares.
- `./scripts/server_smoke.sh` — dedicated-server boot to `Done` + clean console stop
  (isolated run dir `build/run/serverSmoke`, port 25599, auto-EULA).
- `./scripts/client_smoke.sh` — boots a real client (wraps in `xvfb-run` when `DISPLAY`
  is unset), runs client GameTests, screenshots land in
  `build/run/clientGameTest/screenshots/`.

## Non-obvious 1.21.9 / Loom-remap caveats

- **Loom plugin id is `net.fabricmc.fabric-loom-remap`** (1.17.16). 1.21.9 is an
  obfuscated Minecraft version; the plain `net.fabricmc.fabric-loom` id targets the
  newer unobfuscated versions and will not work here. Mappings are Mojang official
  layered with Parchment `2025.10.05`.
- **Old rendering hooks are gone**: `WorldRenderEvents`/`WorldRenderContext` do not
  exist in Fabric API 0.134.1+1.21.9 and Fabric's `BlockEntityRendererRegistry` is
  deprecated. World rendering uses the extract/submit `BlockEntityRenderer` +
  `SubmitNodeCollector` pipeline; register via vanilla `BlockEntityRenderers.register`.
  Details + verified signatures: `docs/RENDERING_NOTES.md`, `docs/API_PROBES.md`.
- **Registration**: `BlockBehaviour.Properties.of().setId(key)` /
  `Item.Properties().setId(key)` are mandatory before construction;
  `Level.isClientSide()` is a method; `SoundType` is in `net.minecraft.world.level.block`.
- **Split env source sets** are enabled: client-only classes must stay in `src/client`.
  `src/datagen` and `src/gametest` are Loom-generated source sets (see
  `fabricApi.configureDataGeneration/configureTests` in build.gradle) and each carries
  its own `fabric.mod.json` (`cuprum-datagen`, `cuprum-gametest`).
- Datagen runs as its own mod; `CuprumDatagen.getEffectiveModId()` returns `cuprum` so
  output lands in the right namespace. The datagen `.cache` dir is gitignored.
- Server GameTests use the post-1.21.5 data-driven framework: annotate methods with
  `net.fabricmc.fabric.api.gametest.v1.GameTest` (methods take `GameTestHelper`).
  `GameTestHelper.destroyBlock` does not drop loot — use
  `helper.getLevel().destroyBlock(helper.absolutePos(pos), true)`.
- `CuprumCatalog.java` is **generated** into `build/generated/sources/catalog` by the
  `generateCatalog` task from `catalog/catalog.json` — never edit or commit it; edit the
  catalog JSON instead (schema + semantic checks run in `validateCatalog`/`check`).
- **Catalog contracts are binding**: ids U01–U22 must match the contract table in
  `src/catalogTool/.../UserContracts.java` one-to-one — exact `contract_key`,
  canonical `name` and `family` per id are all validator-enforced (mutation tests in
  `src/test` prove renames/swaps/re-familying fail). `summary`/`vanilla_overlap` are
  prose and not machine-checked for U-entries: reviewers own their semantic accuracy.
  Additional content gets family ids (`PWR-01`, …) with `origin: additional` and
  tier `core`/`stretch`; update `catalog/expected_counts.json` when counts change.
  The diagnostic Charge Probe is CP0 infrastructure and intentionally has **no**
  catalog entry.
- **CP0B catalog state**: `catalog/catalog.json` holds all 272 entries — 22 user
  contracts plus the 250 additional concept features (202 core + 48 stretch,
  sequences 23–272, families PWR/OXI/SHD/TES/TUB/RAIL/GOL/WEA/TOOL/EXO/MOB/GEN/FX/
  ADV/DEC/QOL). These are **planning data only: no additional gameplay is
  implemented** — broad content implementation stays blocked until CP3 (playable
  vertical slice). `docs/feature-concepts/` is the authoritative concept source; the
  `verifyConceptParity` task (wired into `check`, plus `ConceptParityTest`) re-parses
  those docs, recomputes the INDEX.md **full-row digest** (SHA-256 over the
  compact-JSON encoding of all 250×12 family-table cells — the exact formula is
  documented in INDEX.md; the current 64-hex literal is also pinned in
  `ConceptParityTest`, so digest changes require a reviewed test diff) and compares
  every additional entry field
  (id/sequence/name/family/type/tier/prog/wave/deps/overlap/summary), so edits to
  either side that drift apart fail the build.   Parity additionally enforces the
  concept row-quality contract (all 12 cells nonblank; unique
  `server_gametest:`/`client_gametest:`/`unit_test:` test ids; every Visual cell
  carries an ordered pair of structured `T2:` then `T3:` clauses with meaningful
  non-punctuation bodies — `T2: ; T3:` fails; acceptance criteria — after
  stripping feature-id/T-tier/wave labels — must carry a number bound to an
  allowlisted unit/comparator or an explicit `result/state/returns/equals =
  VALUE` assertion (free-floating ALL_CAPS like `Looks GOOD.` and bare digits
  fail), with banned vague tokens rejected; lexical test-scope suitability:
  server tests never assert render/visual/screen/display/pixel/HUD/GUI/client/
  fps/frame/shader/texture/model/audio unless the cell explicitly says it only
  asserts dispatch/state, unit tests never assert block/world/level/entity/
  player/inventory/claim/permission/render/screen/display/GUI, and words from the
  row's own feature name are exempt as named game objects; every feature id
  referenced in an acceptance cell — after Unicode dash/space normalization —
  must be a declared, earlier-sequence dependency, core-only for core rows).
  Hidden-content handling: raw HTML tag/comment constructs, **all** HTML entities
  (named or numeric, case-insensitive, including `&VerticalLine;`/`&verbar;` and
  encoded hyphens like `&#45;`) and blockquote lines are rejected outright
  anywhere in a concept file (the docs never need them); backtick and tilde
  fences (marker+length matching at 0–3 indent) and four-space/tab indented code
  remain invisible; exactly one visible digest line; exact headers/dividers;
  self-consistent family links; blank rows and escaped pipes rejected — all
  failing with clean `CatalogValidationException` messages.
  `RepairedConceptSemanticsTest` pins the evaluator-repaired semantic contracts
  (canonical U03/U06 effect values and TES-03/FX-01 stacking, charge-economy,
  PWR-14 line-loss, SHD ceil-upkeep and EXO-11 heat formulas, the numeric FX
  budget, bootstrap/sink-route/authority/dependency rules, GEN-08's vanilla
  copper-bulb lamp, DEC display bands and the QOL-07 REI scope) as named
  regression tests independent of the generic parity path.
  Additional-entry rules the validator also
  enforces: unique names, no forward deps (additional entries may only reference
  user entries or lower-sequence additional ids), and no core→stretch deps.
- The probe block texture is generated deterministically by
  `python3 scripts/gen_probe_texture.py`; rerun it instead of editing the PNG.
- No mixins are used so far (no mixin descriptor exists — add one only when needed).
- Dev runs log `FabricLoader/Knot ... Class path entries reference missing files:
  .../build/resources/client` — **harmless**: the client source set currently has no
  resources, so `processClientResources` is NO-SOURCE and the directory never gets
  created; the built jar is unaffected. Do not commit placeholder/marker files to
  silence it; it disappears by itself once a real client-only resource exists.
- Lint = the `lint` Gradle task (javac `-Xlint` + `-Werror` across all source sets,
  wired into `check`); there is no ESLint/Checkstyle. Full validation =
  `check build` + the smoke scripts.
- CI is the **repo-root** `.github/workflows/cuprum-ci.yml` (path-filtered to
  `CUPRUM/**`, `defaults.run.working-directory: CUPRUM`, artifact paths prefixed with
  `CUPRUM/`, actions pinned to peeled commit SHAs). Do not add a nested workflow under
  `CUPRUM/.github` — GitHub ignores non-root workflow dirs.
- The `git status` check in `scripts/datagen_determinism.sh` and the CI
  `git diff --exit-code -- src/main/generated` gate are only meaningful once the
  CUPRUM tree is committed; the tree-hash comparison works regardless.
