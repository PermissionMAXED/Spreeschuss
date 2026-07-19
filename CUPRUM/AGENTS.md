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
  prose and not machine-checked: reviewers own their semantic accuracy. New
  agent-proposed content gets family ids (`PWR-01`, …) with `origin: additional` and
  tier `core`/`stretch`; update `catalog/expected_counts.json` when counts change.
  The diagnostic Charge Probe is CP0 infrastructure and intentionally has **no**
  catalog entry.
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
