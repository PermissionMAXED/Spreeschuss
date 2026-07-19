# Cuprum

Copper-centric technology, diagnostics and defense for **Minecraft 1.21.9 (Fabric)**.
All content is planned in a build-time validated catalog (`catalog/catalog.json`)
holding the **22 binding user-requested features U01–U22** (Storm Shield stack,
lightning power network, oxidation gear, logistics, mobility, utility and the dynamic
handbook). Wave W0 ships the project skeleton plus one diagnostic block, the
**Charge Probe** (`cuprum:charge_probe`) — CP0 infrastructure, deliberately *not* a
catalog entry — which reports the mod version and the canonical catalog SHA-256 when
used.

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
| `./gradlew check build` | Lint gate (`-Xlint -Werror`, all source sets incl. datagen), unit + mutation tests, catalog validation, headless **server GameTests**, jar build |
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
- **Additional entries** (CP0B+) use family ids such as `PWR-01`: numeric-aware,
  per-family contiguous numbering, family-name ↔ id-prefix bijection, and no
  `contract_key` allowed. The tooling is tested at CP0B scale (202 additional core +
  48 additional stretch entries).
- Global `sequence` must be contiguous 1..N in file order; deps must form a DAG over
  known ids; `catalog/expected_counts.json` pins the origin/tier counts
  (currently `user=22`, `additional_core=0`, `additional_stretch=0`).
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
- `src/catalogTool` + `src/test` — plain-Java catalog validator/codegen and its JUnit tests.
- `catalog/` — `schema.json` (strict), `catalog.json` (U01–U22), `expected_counts.json`.
- `docs/API_PROBES.md` — verified 1.21.9 FQNs/signatures; `docs/RENDERING_NOTES.md` —
  1.21.9 extract/submit rendering rules (old `WorldRenderEvents` are gone).
- `scripts/gen_probe_texture.py` — deterministic generator for the committed probe texture.

## License

MIT — see `LICENSE`.
