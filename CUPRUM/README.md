# Cuprum

Copper-centric technology, diagnostics and defense for **Minecraft 1.21.9 (Fabric)**.
All content is planned in a build-time validated catalog (`catalog/catalog.json`)
holding **272 entries**: the **22 binding user-requested features U01–U22** (Storm
Shield stack, lightning power network, oxidation gear, logistics, mobility, utility
and the dynamic handbook) plus the **250 additional CP0B concept features**
(sequences 23–272, 202 core + 48 stretch across 16 families, PWR → QOL) translated
1:1 from `docs/feature-concepts/`. The additional entries are **planned catalog data
only — none of them is implemented yet**; broad content implementation stays blocked
until CP3 per the master plan. Wave W0 ships the project skeleton plus one diagnostic
block, the **Charge Probe** (`cuprum:charge_probe`) — CP0 infrastructure, deliberately
*not* a catalog entry — which reports the mod version and the canonical catalog
SHA-256 when used.

## Stack (pinned)

| Component | Version |
| --- | --- |
| Java | 21 |
| Gradle | 9.5.1 (wrapper) |
| Minecraft | 1.21.9 |
| Fabric Loader | 0.19.3 |
| Fabric API | 0.134.1+1.21.9 |
| Loom | `net.fabricmc.fabric-loom-remap` 1.17.16 (1.21.9 is obfuscated — the plain `fabric-loom` plugin is for unobfuscated versions and must not be used) |
| Mappings | Mojang official + Parchment `parchment-1.21.9:2025.10.05` |
| Cloth Config | 20.0.149 (required) |
| Mod Menu | 16.0.1 (dev runtime only) |

`./gradlew toolchainVerify` checks all of these against **immutable literals** in
`build.gradle` (running Gradle, resolved Java toolchain, effective `-P` properties,
declared dependency coordinates, the resolved `fabric-loader` artifact, the Loom
plugin's own `LOOM_VERSION` and the layered-mappings hash), so a stray property
override or edited pin fails loudly (try `-Ploader_version=0.19.2`).

## Commands

| Command | Purpose |
| --- | --- |
| `./gradlew toolchainVerify` | Assert every pin matches the immutable expected literals |
| `./gradlew check build` | Lint gate (`-Xlint -Werror`, all source sets incl. datagen), unit + mutation tests, catalog validation + concept parity, headless **server GameTests**, jar build |
| `./gradlew verifyConceptParity` | Prove `catalog/catalog.json` matches `docs/feature-concepts/` row-for-row (digest + all 250 additional entries) |
| `./gradlew lint` | Compile main/client/datagen/gametest/catalogTool/test with `-Xlint:all,-classfile,-processing -Werror` |
| `./gradlew runDatagen` | Regenerate `src/main/generated` (committed) |
| `./scripts/datagen_determinism.sh` | Datagen twice + byte-for-byte tree-hash comparison |
| `./scripts/server_smoke.sh` | Dedicated server: auto-EULA, preseeded `server.properties`, boot to `Done`, clean console stop (a forced kill fails the check) |
| `./scripts/client_smoke.sh` | Real client boot (Xvfb-aware) + client GameTests + screenshots + log error scan |
| `./gradlew runClient` / `runServer` | Interactive dev client/server |

CI lives at the repository root: `.github/workflows/cuprum-ci.yml` (path-filtered to
`CUPRUM/**`, runs entirely inside `CUPRUM/`, actions pinned to peeled commit SHAs).

## Catalog model

`catalog/catalog.json` is validated by `validateCatalog` (wired into `check`) against
`catalog/schema.json` **and** semantic rules in `src/catalogTool`:

- Every entry: `id`, `sequence`, `origin` (`user`/`additional`), `family`, `name`,
  `type`, `tier` (`core`/`stretch`), `progression_tier` (0–3), `deps`,
  `vanilla_overlap`, `summary`, `planned_wave`; strict schema (no extra fields).
- **User contracts:** ids `U01`–`U22` must map one-to-one onto the binding contract
  table in `UserContracts.java`, which pins the exact `contract_key`, canonical
  `name` **and** `family` per id (e.g. `U01 → storm_shield_core / "Storm Shield
  Core" / shield`). Renaming, swapping, re-familying or replacing a user contract
  fails validation — mutation tests in `src/test` prove it. The `summary` and
  `vanilla_overlap` fields are prose and are deliberately not NLP-validated;
  reviewers must check them against the bound contract when a catalog diff touches
  them.
- **Additional entries** (CP0B) use family ids such as `PWR-01`: numeric-aware,
  per-family contiguous numbering, family-name ↔ id-prefix bijection, and no
  `contract_key` allowed. All 250 CP0B additional entries (16 families, sequences
  23–272) are present; they are catalog/planning data only — **no additional
  gameplay is implemented yet** (blocked until CP3).
- Global `sequence` must be contiguous 1..N in file order; names must be unique;
  deps must form a DAG over known ids, additional entries may only depend on user
  entries or lower-sequence additional entries (no forward references), and core
  entries never depend on stretch entries (cutting all 48 stretch features leaves
  the 202-core catalog closed under deps); `catalog/expected_counts.json` pins the
  origin/tier counts (currently `user=22`, `additional_core=202`,
  `additional_stretch=48` — total 272).
- **Concept parity** (`verifyConceptParity`, wired into `check`): the additional
  entries were translated 1:1 from `docs/feature-concepts/` (INDEX.md checklist +
  16 family files). `ConceptParity`/`ConceptIndex` in `src/catalogTool` re-parse the
  docs and enforce, with clean `CatalogValidationException` messages:
  - the **full-row digest**: SHA-256 over the compact-JSON encoding of all 250×12
    family-table cells (documented formula in INDEX.md) must equal the single
    authoritative 64-hex literal
    (`c6b8a308f39c6c9e35223f13464af607de7d99881e5ca1fb12cc80fc109075b7`, also pinned
    in `ConceptParityTest`), sealing Visual/Acceptance/Test cells that never reach
    the catalog;
  - full cross-agreement: checklist ↔ family files ↔ catalog on every
    id/sequence/name/family/type/tier/prog/wave/deps/overlap/summary value;
  - row quality: all 12 cells nonblank; unique test ids with a
    `server_gametest:`/`client_gametest:`/`unit_test:` prefix; **every** Visual
    cell carries an **ordered** pair of structured `T2:` then `T3:` clauses whose
    trimmed bodies hold meaningful non-punctuation text (`T2: ; T3:` fails);
    acceptance criteria, after stripping feature-id/`T1`–`T3`/wave labels, must
    contain a number bound to an allowlisted unit/comparator (`Cg`, `ticks`, `%`,
    `blocks`, `ms`, bytes/KiB, entities/items/count, radius, fps, …) or an
    explicit `result/state/returns/equals = VALUE` assertion — free-floating
    ALL_CAPS words no longer count, so `Works at T3.`, `Looks GOOD.` and bare
    digits all fail — and none of the banned vague tokens (`documented`,
    `per spec`, `measurably`, `tolerance`, `rated`, `per curve`, standalone `N`);
  - test-scope suitability (lexical): `server_gametest:` rows never assert
    render/visual/screen/display/pixel/HUD/GUI/client/fps/frame/shader/texture/
    model/audio vocabulary (`Exactly 1 screen display appears` fails) unless the
    cell explicitly says it **only asserts dispatch/state**; `unit_test:` rows
    never assert block/world/level/entity/player/inventory/claim/permission/
    render/screen/display/GUI vocabulary (`Exactly 1 block changes` fails);
    `client_gametest:` rows may assert combined behavior; words that are part of
    the row's own feature name (e.g. the GOL-13 Backpack *Frame* item) refer to
    that named game object and are exempt;
  - acceptance id references: every `Uxx`/`PREFIX-xx` referenced in an acceptance
    cell (other than self, after normalizing Unicode dashes/spaces so lookalike
    hyphens cannot hide an id) must be a declared dependency with an earlier
    global sequence, and core rows may only reference core or user features —
    optional later integrations can never leak into base acceptance;
  - wholesale raw-HTML/entity rejection (no alias-chasing): the concept format
    forbids, anywhere in a file (fences included), **any** raw HTML tag/comment
    construct (`<script>`, `<details>`, `</tag>`, `<!-- -->`, `<!...>`, `<?...>`),
    **any** HTML entity — named or numeric, decimal or hex, case-insensitive
    (`&vert;`, `&verbar;`, `&VerticalLine;`, `&#124;`, `&#x7C;`, `&#45;`, …) —
    and **any** blockquote line, each with a file/line/construct error; an
    entity-encoded id like `PWR&#45;22` therefore fails at parse time, before id
    extraction even runs;
  - CommonMark-aware hidden-content rejection for what remains legal: backtick
    **and** tilde fences (opener marker+length remembered; closed only by a
    same-marker run at least as long; fences may be indented 0–3 spaces; nested
    other-marker/shorter runs stay hidden) and four-space/tab indented code lines
    are invisible — a digest or table row inside them is never authoritative;
    exactly one visible digest line is required (duplicates fail); exact table
    headers/dividers (header substitution fails); INDEX family links must be
    self-consistent (`[X.md](X.md)`, retargeting fails); blank rows inside tables
    and escaped pipes (`\|`) are rejected precisely.
- **Semantic regressions** (`RepairedConceptSemanticsTest`): named tests pin the
  evaluator-repaired contracts independently of the generic parity checks — the
  canonical U03 Shock / U06 Corroded registrations (no pre-W12 row references
  FX-01/FX-02) and the TES-03/FX-01 stacking contract (the base Shock is never
  replaced or re-registered), the charge-economy formulas (100,000 ÷ 5 = 20,000
  ticks jar fill; 270,000 ÷ 5 = 54,000 ticks per strike; 243,000 Cg after 10%
  capture loss), the PWR-14 line-loss percentages (128 blocks = 8 spans → exactly
  84% bare / 96% HV), the SHD ceil upkeep tables (ceil(0.5·R²) = 32/72/128/288;
  ×0.6 → 20/44/77/173; ×0.7 → 23/51/90/202), the numeric FX budget (500 instances
  ≤ 0.20 ms/tick over 1,000 ticks), the EXO-11 heat model (120 ÷ 0.3 = 400 vs
  120 ÷ 0.1 = 1,200 ticks to throttle), the OXI-03/OXI-04 vanilla-material
  bootstraps and the MOB-02/MOB-05 drop sink routes, the repaired
  GEN-09/MOB-05/QOL-01/MOB-02 deps, the GEN-08 vanilla copper-bulb lamp (no DEC
  dependency), the DEC-05 brightness / DEC-15 sway bands, the QOL-07 REI scope
  (client-tested, version-pinned), DEC-08/RAIL-10/GOL-03 independence, ADV-04
  gating only the U21 overdrive mode, and the WEA-03/QOL-03/TES-12/GEN-14
  authority rules.
- `generateCatalog` deterministically emits `CuprumCatalog.java` (ids + canonical
  sorted-key SHA-256 of the catalog).

Every `vanilla_overlap` names the real 1.21.9 vanilla feature it extends or the
closest analogue (1.21.9 ships copper tools/armor/golem/chest, lightning rods,
weighted pressure plates, etc.).

## Layout

- `src/main`, `src/client` — split environment source sets (`dev.cuprum.cuprum`,
  `dev.cuprum.cuprum.client`). `src/client` includes `RenderApiProbe`, a compile-time
  signature probe of the 1.21.9 extract/submit rendering pipeline.
- `src/datagen` — Fabric datagen mod (`cuprum-datagen`), emits into the `cuprum` namespace.
- `src/gametest` — server + client GameTests (`cuprum-gametest`).
- `src/catalogTool` + `src/test` — plain-Java catalog validator/codegen/concept-parity
  tooling and its JUnit tests.
- `catalog/` — `schema.json` (strict), `catalog.json` (U01–U22 + PWR-01..QOL-12),
  `expected_counts.json`.
- `docs/feature-concepts/` — authoritative CP0B concept data (INDEX.md + 16 family
  files) that the 250 additional catalog entries are validated against.
- `docs/API_PROBES.md` — verified 1.21.9 FQNs/signatures; `docs/RENDERING_NOTES.md` —
  1.21.9 extract/submit rendering rules (old `WorldRenderEvents` are gone).
- `scripts/gen_probe_texture.py` — deterministic generator for the committed probe texture.

## License

MIT — see `LICENSE`.
