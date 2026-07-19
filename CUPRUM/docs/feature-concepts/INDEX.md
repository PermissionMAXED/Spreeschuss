# CP0B Feature Concepts — INDEX

250 additional player-facing features (global sequence 23–272) in 16 families, complementing the 22 user-requested features U01–U22 (sequence 1–22, already in `catalog/catalog.json`). Totals: **202 core / 48 stretch**. This index plus the 16 family files is the single CONCEPT source of truth for W0B catalog materialization.

Content digest (full-row, authoritative): `c6b8a308f39c6c9e35223f13464af607de7d99881e5ca1fb12cc80fc109075b7`

**Canonical digest formula:** SHA-256 over the UTF-8 bytes of the compact JSON array (`separators=(",",":")`, `ensure_ascii=true`) of 250 arrays, one per feature in global sequence order 23→272, each containing the 12 normalized table cells in column order `[id, name, type, tier, prog, wave, deps, vanilla_overlap, player_behavior, visual_signature, acceptance, test]`, where each cell is the raw Markdown cell content trimmed of surrounding whitespace. Full 64-hex output. Any editor can recompute it from the family tables alone.

## Vocabulary (binding definitions)

- **Cg (Charge):** the mod's energy unit. Anchors: one natural lightning strike deposits **270,000 Cg**; a U05 Leyden Jar stores 100,000 Cg; a small cell (PWR-06) stores 25,000 Cg; base U19 wire carries 200 Cg/t losing a linear 2 percentage points of delivered charge per full 16-block span (HV lines 0.5 pp per span; both clamped at 0% delivered — a 128-block run delivers exactly 84% bare and 96% HV). **Normal passive baseline B = 5 Cg/t** (one standard unattended generator). Formulas: jar fill = 100,000 ÷ 5 = 20,000 ticks (16 min 40 s, inside the 10–20 min window); one strike = 270,000 ÷ 5 = 54,000 ticks (45 min) of baseline. Consumers are storage-fed burst loads by design. All numbers live in `cuprum-common.json5`; gametests read the same config.
- **Canonical effects:** **U03 owns and registers Shock** (interrupt + Slowness IV, 40 ticks; repeat applications within 200 ticks last 20 then 10 ticks; 10-tick per-source re-application cooldown). **U06 owns and registers Corroded** (−10% armor effectiveness per level, cap II = −20%, 200 ticks; reapplication refreshes duration, never exceeds II). All earlier OXI/TES/MOB rows reference these registrations; FX-01 (Overload Shock) and FX-02 (Deep Corrosion) are additional W12 extensions, not re-registrations.
- **progression_tier (Prog 0–3):** a complexity/acquisition band — 0 pre-charge, 1 early grid, 2 powered base, 3 post-boss/endgame. It is explicitly **not** a dependency ordering; a Prog-3 row may depend on a Prog-1 row. Formal ordering lives only in the Deps column (backward-only by sequence).
- **Visual tiers:** **T1** = custom GpuDevice/RenderPipeline shader path; **T2** = vanilla-pipeline fallback (particles/animated textures/billboards); **T3** = minimal static fallback. Every Visual cell carries structured `T2:` and `T3:` clauses so tooling can enforce fallback coverage. Reduced-effects mode (QOL-04) forces T2/T3 globally and never changes gameplay outcomes.
- **Test prefixes:** `server_gametest:` = headless Fabric server gametest (behavior/state; never asserts rendering/HUD/GUI output); `client_gametest:` = client gametest (rendering, HUD, audio, GUI — required for any visual/audio assertion); `unit_test:` = plain JUnit (codecs, math, data audits; never asserts world permissions or GUI rendering). Every target name is unique across the 250 rows.
- **Waves:** cores land W5–W13 as listed per family; **W14 is reserved for integration/perf hardening** — cross-family interaction gametests, the client perf harness (frame-time budgets referenced by QOL-04), and budget regression gates; **W15 carries all 48 stretch features**.

## Binding cross-cutting contracts

1. **Server authority:** every C2S payload (programs, filters, GUI writes, route cards, aiming) is validated server-side for ownership/permission, ≤8-block GUI distance where applicable, size caps, and rate limits (default 4/s per player; golem program uploads 1/s, ≤4 KiB, ≤32 ops; flare launches 1 per 100 ticks; nexus transfers 10/s).
2. **Ownership/teams:** dome policy (SHD-13), turret filters (TES-01), golem commands, stalls and the wrench (QOL-03) respect owner/team; permission nodes (`cuprum.shield.configure`, `cuprum.weather.use`, `cuprum.emp.pvp`, `cuprum.diagnostics`) apply when a permissions provider is present, else owner/OP-level fallback. TES-12 EMP defaults to hostile-owned infrastructure only and exempts allied/neutral/claim-protected machines.
3. **Bounded main-thread scans:** all world scans are time-sliced on the main server thread; TOOL-04 scans ≤4,096 positions at ≤256/tick; TOOL-10 captures ≤32³ with the same slicing; no feature touches `Level` off-thread.
4. **Atomic mutations:** inventory/world mutations are transactional per server tick (remove-then-insert or rollback); QOL-03 wrench pickup is one atomic block-entity-plus-inventory transaction with rollback; GOL-16 shop trades settle atomically; TUB-14 cross-dimension transfers use two-phase commit and recover to the source on crash — never duplicate, never void.
5. **Persistence:** PWR graphs, TUB in-flight stacks, RAIL carts/signals/schedules, GOL programs+program counters, EXO modules/heat and quest/mastery attachments all survive chunk unload/reload and server restart; timed states (EMP disable) expire by game-time comparison.
6. **Bounded world effects, with one sanctioned exception:** EMP, magnets, hail, heatwaves and events are radius-bounded, config-gated and logged. **WEA-03 (cloud seeder) and U21 (weather manipulator) are the only dimension-global weather actions** — both OP/permission-gated (`cuprum.weather.use`), server-authoritative and logged; WEA-03 additionally has a 36,000-tick per-dimension cooldown. GEN-14 places exactly one precomputed template atomically into a newly generated, unclaimed natural chunk inside the world border, replacing only natural-whitelist blocks — it can never touch player builds.
7. **Accessibility invariants:** every color-coded state has a shape variant (QOL-05); SHD-06 dome patterns are shape-coded; every audio cue has a visible counterpart; reduced-effects (QOL-04) is outcome-neutral.

## Retiering note (evaluator-driven, totals preserved)

QOL-11 Copper Flare and QOL-12 Statistics Dashboard are **core** (useful team/monitoring utilities must not be stretch for arithmetic); compensating swaps to **stretch**: WEA-05 Storm Glass (forecast ambiance duplicating WEA-01 information) and TES-16 Conductor's Baton (QA/tuning aid). Family core/stretch splits below reflect the swap; totals remain 202/48.

## Families

| Prefix | File | Catalog family | Sequence | Count | Core | Stretch | Core wave |
|---|---|---|---|---|---|---|---|
| PWR | [PWR.md](PWR.md) | `power_grid` | 23–46 | 24 | 21 | 3 | W5 |
| OXI | [OXI.md](OXI.md) | `oxidation_metallurgy` | 47–64 | 18 | 16 | 2 | W6 |
| SHD | [SHD.md](SHD.md) | `shield_tech` | 65–78 | 14 | 11 | 3 | W7 |
| TES | [TES.md](TES.md) | `tesla_combat` | 79–94 | 16 | 12 | 4 | W7 |
| TUB | [TUB.md](TUB.md) | `tube_logistics` | 95–108 | 14 | 12 | 2 | W8 |
| RAIL | [RAIL.md](RAIL.md) | `mag_transport` | 109–122 | 14 | 11 | 3 | W8 |
| GOL | [GOL.md](GOL.md) | `golemcraft` | 123–142 | 20 | 16 | 4 | W9 |
| WEA | [WEA.md](WEA.md) | `weather_sky` | 143–156 | 14 | 10 | 4 | W9 |
| TOOL | [TOOL.md](TOOL.md) | `gadgets` | 157–178 | 22 | 17 | 5 | W10 |
| EXO | [EXO.md](EXO.md) | `exo_modules` | 179–192 | 14 | 11 | 3 | W9 |
| MOB | [MOB.md](MOB.md) | `creatures` | 193–204 | 12 | 9 | 3 | W11 |
| GEN | [GEN.md](GEN.md) | `worldgen` | 205–218 | 14 | 10 | 4 | W11 |
| FX | [FX.md](FX.md) | `effects_enchants` | 219–234 | 16 | 13 | 3 | W12 |
| ADV | [ADV.md](ADV.md) | `progression` | 235–244 | 10 | 9 | 1 | W12 |
| DEC | [DEC.md](DEC.md) | `decor_building` | 245–260 | 16 | 12 | 4 | W13 |
| QOL | [QOL.md](QOL.md) | `quality_of_life` | 261–272 | 12 | 12 | 0 | W13 |

## Dependency rationale (key fixes)

- **Canonical effects:** U03 registers Shock and U06 registers Corroded (constants above); OXI-09/10, TES-03/04/06/10, MOB-02 and FX-03/05 reference those registrations; FX-01/FX-02 are redefined as W12 extensions (Overload Shock tier, Deep Corrosion durability bleed).
- **Kiln/extract bootstrap:** OXI-03 crafts from vanilla materials and produces OXI-02 (output-registration dep); unpowered ops cost 0 Cg over 200 ticks, the fast path debits exactly 500 Cg upfront for 100 ticks. OXI-04 extract bootstraps from 4 oxidized cut copper + 1 bottle; MOB-06 feathers add only an optional later alternative recipe. OXI-15 casting parts feed only W7+ recipes.
- **Scope separations:** TES-01 per-turret filters vs SHD-13 dome team policy; RAIL-10 Route Cards vs GOL-03 punch cards (separate codecs; DEC-07 reads GOL-03 cards in a later wave); ADV-04 unlocks a U21 overdrive mode (base U21 never gated); GEN-11 grants WEA-13 an upkeep discount without recipe gating; DEC-08 core acceptance is standalone (PWR-23 feed is optional stretch integration); TOOL-17 acceptance is standalone (MOB-07 defines the disarm interaction backward).
- **Acquisition/behavior deps (backward-only):** GEN-01→MOB-05, GEN-02→WEA-06, GEN-04→MOB-04, GEN-07→TUB-08, GEN-08→MOB-08+OXI-02, GEN-09→TOOL-04, ADV-08→GEN-01, ADV-09→MOB-08+ADV-04+PWR-14+SHD-10+TES-08, MOB-07→TOOL-17, MOB-08→OXI-03+GOL-03+TOOL-04, FX-01→TES-03+TES-04, FX-04→FX-03, FX-07→TES-04, FX-11→PWR-19, FX-12→MOB-09, FX-14→OXI-16, WEA-11→PWR-09, EXO-06→PWR-19, EXO-07→U13, TES-10→TES-04+U09, TOOL-08→WEA-06, TOOL-17→U19, QOL-11→WEA-06, QOL-01→OXI-03, DEC-13→GEN-05, MOB-02→OXI-04 (patina-dust alternative extract recipe), MOB-05→OXI-15 (scrap recycle recipe plus mold drop), MOB-06→OXI-04, GEN-09→PWR-06, SHD-02→SHD-01. GOL-20 sources from vanilla ancient city/trial vault loot (no worldgen dep); GEN-08's lamp post uses the vanilla 1.21.9 copper bulb (no DEC dep).
- **Worldgen honesty:** GEN-03 viaduct fragments each fit within 96 blocks of their structure center (inside Minecraft's 128-block jigsaw cap); no custom infinite worldgen exists; GEN-14 is one bounded atomic crater transaction.
- **De-duplication:** OXI-08 is the Patina Transfer Bath (distinct stage-crafting process); GOL-01 is the survival Brass Cortex conversion for the U12 system; TUB-12 is a functional network pressure-relief vent; DEC-06 is a functional warming radiator — both dispositioned against the vanilla 1.21 copper grate; PWR-22 is dispositioned against the redstone-toggleable, oxidation-dependent copper bulb; SHD-06 is a functional shape-coded shield status display.

## Machine-auditable checklist (250 rows)

| Seq | ID | Name | Family | Type | Tier | Prog | Wave | Deps |
|---|---|---|---|---|---|---|---|---|
| 23 | PWR-01 | Copper Bus Bar | `power_grid` | block | core | 1 | W5 | U05 |
| 24 | PWR-02 | Insulated Cable | `power_grid` | block | core | 1 | W5 | U19 |
| 25 | PWR-03 | Overhead Pylon | `power_grid` | block | core | 2 | W5 | U19 |
| 26 | PWR-04 | Charge Meter | `power_grid` | block | core | 1 | W5 | U05 |
| 27 | PWR-05 | Potential Gauge | `power_grid` | item | core | 1 | W5 | U05 |
| 28 | PWR-06 | Small Leyden Cell | `power_grid` | block | core | 1 | W5 | U05 |
| 29 | PWR-07 | Grand Leyden Array | `power_grid` | block | core | 2 | W5 | U05 |
| 30 | PWR-08 | Crank Dynamo | `power_grid` | block | core | 0 | W5 | - |
| 31 | PWR-09 | Thermo Junction | `power_grid` | block | core | 1 | W5 | U05 |
| 32 | PWR-10 | Windlass Turbine | `power_grid` | block | core | 1 | W5 | U05 |
| 33 | PWR-11 | Water Wheel | `power_grid` | block | core | 1 | W5 | U05 |
| 34 | PWR-12 | Solar Verdigris Panel | `power_grid` | block | core | 1 | W5 | U05 |
| 35 | PWR-13 | Surge Protector | `power_grid` | block | core | 1 | W5 | U04 |
| 36 | PWR-14 | Step-Up Transformer | `power_grid` | block | core | 2 | W5 | U19 |
| 37 | PWR-15 | Charge Coupler | `power_grid` | block | core | 2 | W5 | U05 |
| 38 | PWR-16 | Redstone–Charge Converter | `power_grid` | block | core | 1 | W5 | U05 |
| 39 | PWR-17 | Breaker Switch | `power_grid` | block | core | 1 | W5 | U05 |
| 40 | PWR-18 | Load Balancer | `power_grid` | block | core | 2 | W5 | U05 |
| 41 | PWR-19 | Battery Pack | `power_grid` | item | core | 1 | W5 | U05 |
| 42 | PWR-20 | Induction Plinth | `power_grid` | block | core | 2 | W5 | U05 |
| 43 | PWR-21 | Grounding Rod | `power_grid` | block | core | 1 | W5 | U04 |
| 44 | PWR-22 | Static Sentinel Lamp | `power_grid` | block | stretch | 1 | W15 | U05 |
| 45 | PWR-23 | Charge Teleprinter | `power_grid` | block | stretch | 2 | W15 | U05 |
| 46 | PWR-24 | Franklin Kite | `power_grid` | item | stretch | 2 | W15 | U04 |
| 47 | OXI-01 | Verdigris Ingot | `oxidation_metallurgy` | item | core | 1 | W6 | U06 |
| 48 | OXI-02 | Cuprite Alloy | `oxidation_metallurgy` | item | core | 1 | W6 | - |
| 49 | OXI-03 | Alloy Kiln | `oxidation_metallurgy` | block | core | 1 | W6 | OXI-02 |
| 50 | OXI-04 | Patina Extract | `oxidation_metallurgy` | item | core | 1 | W6 | - |
| 51 | OXI-05 | Anti-Patina Wax Blend | `oxidation_metallurgy` | item | core | 1 | W6 | - |
| 52 | OXI-06 | Electrolytic Refinery | `oxidation_metallurgy` | block | core | 2 | W6 | U05, OXI-02 |
| 53 | OXI-07 | Comminution Mill | `oxidation_metallurgy` | block | core | 2 | W6 | U05, OXI-02 |
| 54 | OXI-08 | Patina Transfer Bath | `oxidation_metallurgy` | block | core | 2 | W6 | U06, U07 |
| 55 | OXI-09 | Verdigris Blade | `oxidation_metallurgy` | item | core | 2 | W6 | U06, OXI-01 |
| 56 | OXI-10 | Patina Pike | `oxidation_metallurgy` | item | core | 2 | W6 | U06, OXI-01 |
| 57 | OXI-11 | Galvanic Arc Bow | `oxidation_metallurgy` | item | core | 2 | W6 | U05, OXI-01 |
| 58 | OXI-12 | Verdigris Tool Set | `oxidation_metallurgy` | item | core | 2 | W6 | OXI-01 |
| 59 | OXI-13 | Waxing Station | `oxidation_metallurgy` | block | core | 1 | W6 | OXI-05 |
| 60 | OXI-14 | Weathering Chamber | `oxidation_metallurgy` | block | core | 2 | W6 | U05, OXI-02 |
| 61 | OXI-15 | Casting Table & Molds | `oxidation_metallurgy` | block_item | core | 1 | W6 | OXI-03 |
| 62 | OXI-16 | Conductive Paste | `oxidation_metallurgy` | item | core | 1 | W6 | U19 |
| 63 | OXI-17 | Rusted Iron Set | `oxidation_metallurgy` | block | stretch | 1 | W15 | OXI-04 |
| 64 | OXI-18 | Noble Copper | `oxidation_metallurgy` | item | stretch | 3 | W15 | U04 |
| 65 | SHD-01 | Amplifier Coil I–IV | `shield_tech` | item | core | 2 | W7 | U01 |
| 66 | SHD-02 | Kinetic Modulator | `shield_tech` | item | core | 2 | W7 | U01, U02, SHD-01 |
| 67 | SHD-03 | Biotic Modulator | `shield_tech` | item | core | 2 | W7 | U01, U03 |
| 68 | SHD-04 | Weather Modulator | `shield_tech` | item | core | 2 | W7 | U01, U04 |
| 69 | SHD-05 | Window Emitter | `shield_tech` | block | core | 2 | W7 | U01 |
| 70 | SHD-06 | Hue Prism | `shield_tech` | block | core | 1 | W7 | U01 |
| 71 | SHD-07 | Priority Feed Link | `shield_tech` | block | core | 2 | W7 | U01, PWR-18 |
| 72 | SHD-08 | Shield Alarm Bell | `shield_tech` | block | core | 1 | W7 | U01 |
| 73 | SHD-09 | Micro-Dome Projector | `shield_tech` | item | core | 3 | W7 | U01, U05 |
| 74 | SHD-10 | Resonance Anchor | `shield_tech` | block | core | 3 | W7 | U01 |
| 75 | SHD-11 | Heat Bloom | `shield_tech` | system | core | 2 | W7 | U01, U02 |
| 76 | SHD-12 | Aegis Reader | `shield_tech` | item | stretch | 2 | W15 | U01 |
| 77 | SHD-13 | Storm Bastion Banner | `shield_tech` | block | stretch | 2 | W15 | U01 |
| 78 | SHD-14 | Echo Emitter | `shield_tech` | block | stretch | 3 | W15 | U01, U02 |
| 79 | TES-01 | Targeting Card | `tesla_combat` | item | core | 2 | W7 | U09 |
| 80 | TES-02 | Chain Capacitor | `tesla_combat` | item | core | 2 | W7 | U09 |
| 81 | TES-03 | Overcharge Injector | `tesla_combat` | item | core | 2 | W7 | U03, U09 |
| 82 | TES-04 | Tesla Fence Post | `tesla_combat` | block | core | 1 | W7 | U03, U05 |
| 83 | TES-05 | Arc Welder | `tesla_combat` | item | core | 1 | W7 | U05 |
| 84 | TES-06 | Shock Mine | `tesla_combat` | block | core | 2 | W7 | U03, U05 |
| 85 | TES-07 | Capacitor Gauntlet | `tesla_combat` | item | core | 2 | W7 | U05 |
| 86 | TES-08 | Thunderstick | `tesla_combat` | item | core | 3 | W7 | U05, PWR-06 |
| 87 | TES-09 | Static Aura Emitter | `tesla_combat` | item | core | 2 | W7 | U05 |
| 88 | TES-10 | Faraday Weave | `tesla_combat` | item | core | 3 | W7 | U03, U07, U09, TES-04, OXI-06 |
| 89 | TES-11 | Lightning Lure | `tesla_combat` | block | core | 2 | W7 | U04 |
| 90 | TES-12 | EMP Bomb | `tesla_combat` | item | core | 3 | W7 | U05 |
| 91 | TES-13 | Galvanic Mortar | `tesla_combat` | block | stretch | 3 | W15 | U09, U05 |
| 92 | TES-14 | Tesla Choir | `tesla_combat` | block | stretch | 1 | W15 | U05 |
| 93 | TES-15 | Ion Storm Projector | `tesla_combat` | block | stretch | 3 | W15 | U09, U21 |
| 94 | TES-16 | Conductor's Baton | `tesla_combat` | item | stretch | 1 | W15 | U09 |
| 95 | TUB-01 | Accelerator Segment | `tube_logistics` | block | core | 1 | W8 | U11, U05 |
| 96 | TUB-02 | Filter Valve | `tube_logistics` | block | core | 1 | W8 | U11 |
| 97 | TUB-03 | Sorter Cross | `tube_logistics` | block | core | 2 | W8 | U11, TUB-02 |
| 98 | TUB-04 | Overflow Relief | `tube_logistics` | block | core | 1 | W8 | U11 |
| 99 | TUB-05 | Vacuum Intake | `tube_logistics` | block | core | 1 | W8 | U11, U05 |
| 100 | TUB-06 | Pneumatic Ejector | `tube_logistics` | block | core | 1 | W8 | U11 |
| 101 | TUB-07 | Junction Meter | `tube_logistics` | block | core | 1 | W8 | U11 |
| 102 | TUB-08 | Fluid Capsules | `tube_logistics` | block_item | core | 2 | W8 | U11 |
| 103 | TUB-09 | Transit Tube | `tube_logistics` | block | core | 3 | W8 | U11, U05 |
| 104 | TUB-10 | Painting Kit | `tube_logistics` | item | core | 1 | W8 | U11 |
| 105 | TUB-11 | Pressure Compressor | `tube_logistics` | block | core | 2 | W8 | U11, U05 |
| 106 | TUB-12 | Relief Vent Grate | `tube_logistics` | block | core | 1 | W8 | U11, TUB-11 |
| 107 | TUB-13 | Capsule Post Office | `tube_logistics` | block | stretch | 2 | W15 | U11, TUB-02 |
| 108 | TUB-14 | Ender Tube Nexus | `tube_logistics` | block | stretch | 3 | W15 | U11, U05 |
| 109 | RAIL-01 | Mag-Cart | `mag_transport` | entity | core | 2 | W8 | U10 |
| 110 | RAIL-02 | Booster Coil | `mag_transport` | block | core | 2 | W8 | U10, U05 |
| 111 | RAIL-03 | Brake Damper | `mag_transport` | block | core | 2 | W8 | U10 |
| 112 | RAIL-04 | Station Controller | `mag_transport` | block | core | 2 | W8 | U10, RAIL-01 |
| 113 | RAIL-05 | Mag-Switch Junction | `mag_transport` | block | core | 2 | W8 | U10 |
| 114 | RAIL-06 | Cargo Mag-Sled | `mag_transport` | entity | core | 2 | W8 | RAIL-01 |
| 115 | RAIL-07 | Boarding Gate | `mag_transport` | block | core | 2 | W8 | RAIL-01, RAIL-04 |
| 116 | RAIL-08 | Signal Semaphore | `mag_transport` | block | core | 2 | W8 | U10, RAIL-01 |
| 117 | RAIL-09 | Maglev Elevator | `mag_transport` | block | core | 2 | W8 | U10, U05 |
| 118 | RAIL-10 | Route Programmer Desk | `mag_transport` | block | core | 2 | W8 | RAIL-05 |
| 119 | RAIL-11 | Crossing Chime | `mag_transport` | block | core | 1 | W8 | U10, RAIL-01 |
| 120 | RAIL-12 | Grand Central Beacon | `mag_transport` | block | stretch | 2 | W15 | RAIL-04 |
| 121 | RAIL-13 | Freight Weighbridge | `mag_transport` | block | stretch | 2 | W15 | RAIL-06 |
| 122 | RAIL-14 | Loop Rail | `mag_transport` | block | stretch | 1 | W15 | U10, RAIL-01 |
| 123 | GOL-01 | Brass Cortex | `golemcraft` | item | core | 2 | W9 | U12 |
| 124 | GOL-02 | Programming Bench | `golemcraft` | block | core | 2 | W9 | U12, GOL-01 |
| 125 | GOL-03 | Golem Punch Cards | `golemcraft` | item | core | 2 | W9 | GOL-02 |
| 126 | GOL-04 | Harvester Routine | `golemcraft` | system | core | 2 | W9 | GOL-03 |
| 127 | GOL-05 | Lumberjack Routine | `golemcraft` | system | core | 2 | W9 | GOL-03 |
| 128 | GOL-06 | Miner Routine | `golemcraft` | system | core | 3 | W9 | GOL-03, U15 |
| 129 | GOL-07 | Courier Routine | `golemcraft` | system | core | 2 | W9 | GOL-03 |
| 130 | GOL-08 | Guard Routine | `golemcraft` | system | core | 2 | W9 | GOL-03 |
| 131 | GOL-09 | Fisher Routine | `golemcraft` | system | core | 2 | W9 | GOL-03 |
| 132 | GOL-10 | Waypoint Flag | `golemcraft` | block | core | 1 | W9 | U12 |
| 133 | GOL-11 | Charging Perch | `golemcraft` | block | core | 2 | W9 | U12, U05 |
| 134 | GOL-12 | Golem Toolkit | `golemcraft` | item | core | 2 | W9 | GOL-01 |
| 135 | GOL-13 | Backpack Frame | `golemcraft` | item | core | 2 | W9 | GOL-01 |
| 136 | GOL-14 | Oxide Clock | `golemcraft` | block | core | 2 | W9 | GOL-03 |
| 137 | GOL-15 | Relay Whistle | `golemcraft` | item | core | 2 | W9 | GOL-01 |
| 138 | GOL-16 | Trade Stall | `golemcraft` | block | stretch | 3 | W15 | GOL-07 |
| 139 | GOL-17 | Error Semaphore | `golemcraft` | system | core | 2 | W9 | GOL-01 |
| 140 | GOL-18 | Parade Mode | `golemcraft` | system | stretch | 1 | W15 | GOL-15 |
| 141 | GOL-19 | Blueprint Card Library | `golemcraft` | block | stretch | 2 | W15 | GOL-03 |
| 142 | GOL-20 | Ancient Automaton Frame | `golemcraft` | item | stretch | 3 | W15 | GOL-01 |
| 143 | WEA-01 | Barometer Block | `weather_sky` | block | core | 1 | W9 | - |
| 144 | WEA-02 | Storm Siren | `weather_sky` | block | core | 1 | W9 | WEA-01 |
| 145 | WEA-03 | Cloud Seeder Rocket | `weather_sky` | item | core | 2 | W9 | U05 |
| 146 | WEA-04 | Hygrometer Charm | `weather_sky` | item | core | 1 | W9 | - |
| 147 | WEA-05 | Storm Glass | `weather_sky` | block | stretch | 0 | W15 | WEA-01 |
| 148 | WEA-06 | Fulgurite | `weather_sky` | block | core | 1 | W9 | - |
| 149 | WEA-07 | Wind Sock | `weather_sky` | block | core | 1 | W9 | PWR-10 |
| 150 | WEA-08 | Gust Events | `weather_sky` | system | core | 1 | W9 | PWR-10 |
| 151 | WEA-09 | Rainwater Cistern | `weather_sky` | block | core | 1 | W9 | U05 |
| 152 | WEA-10 | Snow Cannon | `weather_sky` | block | stretch | 2 | W15 | U05 |
| 153 | WEA-11 | Heatwave Emitter | `weather_sky` | block | core | 2 | W9 | U05, PWR-09 |
| 154 | WEA-12 | Storm Chaser's Compass | `weather_sky` | item | core | 2 | W9 | U04 |
| 155 | WEA-13 | Aurora Projector | `weather_sky` | block | stretch | 1 | W15 | U05 |
| 156 | WEA-14 | Hail Volley | `weather_sky` | block | stretch | 3 | W15 | U21 |
| 157 | TOOL-01 | Twin-Hook Rig | `gadgets` | item | core | 2 | W10 | U14 |
| 158 | TOOL-02 | Zipline Anchor Kit | `gadgets` | item | core | 1 | W10 | U14 |
| 159 | TOOL-03 | Magnet Glove | `gadgets` | item | core | 1 | W10 | U05 |
| 160 | TOOL-04 | Prospector's Seismograph | `gadgets` | block | core | 2 | W10 | U05 |
| 161 | TOOL-05 | Tuning Forks | `gadgets` | item | core | 2 | W10 | U15 |
| 162 | TOOL-06 | Copper Compass | `gadgets` | item | core | 1 | W10 | U05 |
| 163 | TOOL-07 | Pocket Fan | `gadgets` | item | core | 1 | W10 | U13 |
| 164 | TOOL-08 | Vent Boots | `gadgets` | item | core | 2 | W10 | U05, WEA-06 |
| 165 | TOOL-09 | Copper Snips | `gadgets` | item | core | 1 | W10 | - |
| 166 | TOOL-10 | Blueprint Scanner | `gadgets` | item | core | 2 | W10 | U05 |
| 167 | TOOL-11 | Ghost Projector | `gadgets` | block | core | 2 | W10 | TOOL-10 |
| 168 | TOOL-12 | XP Condenser | `gadgets` | block | core | 2 | W10 | U18, U05 |
| 169 | TOOL-13 | Echo Whistle | `gadgets` | item | core | 1 | W10 | - |
| 170 | TOOL-14 | Plate Calibration Kit | `gadgets` | item | core | 1 | W10 | U16 |
| 171 | TOOL-15 | Foam Sprayer | `gadgets` | item | core | 1 | W10 | U05 |
| 172 | TOOL-16 | Copper Chisel | `gadgets` | item | core | 1 | W10 | - |
| 173 | TOOL-17 | Insulated Gloves | `gadgets` | item | core | 1 | W10 | U19 |
| 174 | TOOL-18 | Coil Driver | `gadgets` | item | stretch | 3 | W15 | U10, U05 |
| 175 | TOOL-19 | Pocket Golem | `gadgets` | item | stretch | 2 | W15 | U12 |
| 176 | TOOL-20 | Storm-in-a-Bottle | `gadgets` | item | stretch | 3 | W15 | U04, U21 |
| 177 | TOOL-21 | Copper Kazoo | `gadgets` | item | stretch | 0 | W15 | - |
| 178 | TOOL-22 | Circuit Probe Goggles | `gadgets` | item | stretch | 2 | W15 | U05 |
| 179 | EXO-01 | Frame Chassis I–III | `exo_modules` | item | core | 2 | W9 | U08 |
| 180 | EXO-02 | Sprint Servos | `exo_modules` | item | core | 2 | W9 | EXO-01 |
| 181 | EXO-03 | Shock Absorbers | `exo_modules` | item | core | 2 | W9 | EXO-01 |
| 182 | EXO-04 | Power Fists | `exo_modules` | item | core | 2 | W9 | EXO-01 |
| 183 | EXO-05 | Precision Actuators | `exo_modules` | item | core | 2 | W9 | EXO-01 |
| 184 | EXO-06 | Capacitor Hump | `exo_modules` | item | core | 2 | W9 | EXO-01, U05, PWR-19 |
| 185 | EXO-07 | Glider Vanes | `exo_modules` | item | core | 2 | W9 | EXO-01, U13 |
| 186 | EXO-08 | Rib Dynamo | `exo_modules` | item | stretch | 2 | W15 | EXO-01 |
| 187 | EXO-09 | Ore Optics | `exo_modules` | item | core | 3 | W9 | EXO-01, U15 |
| 188 | EXO-10 | Verdigris Ablative Plating | `exo_modules` | item | core | 2 | W9 | EXO-01, OXI-08 |
| 189 | EXO-11 | Coolant Loop | `exo_modules` | item | core | 2 | W9 | EXO-01 |
| 190 | EXO-12 | Maintenance Rack | `exo_modules` | block | core | 2 | W9 | EXO-01 |
| 191 | EXO-13 | Overdrive Core | `exo_modules` | item | stretch | 3 | W15 | EXO-01 |
| 192 | EXO-14 | Mag-Boots | `exo_modules` | item | stretch | 3 | W15 | EXO-01, U19 |
| 193 | MOB-01 | Spark Wisp | `creatures` | entity | core | 1 | W11 | - |
| 194 | MOB-02 | Oxide Creeper | `creatures` | entity | core | 2 | W11 | U06, OXI-04 |
| 195 | MOB-03 | Rust Mite | `creatures` | entity | core | 2 | W11 | OXI-05 |
| 196 | MOB-04 | Storm Elemental | `creatures` | entity | core | 3 | W11 | - |
| 197 | MOB-05 | Junk Golem | `creatures` | entity | core | 1 | W11 | OXI-15 |
| 198 | MOB-06 | Copper Peacock | `creatures` | entity | core | 1 | W11 | OXI-04 |
| 199 | MOB-07 | Magnetized Zombie | `creatures` | entity | core | 2 | W11 | TOOL-17 |
| 200 | MOB-08 | Electrician Villager | `creatures` | system | core | 1 | W11 | OXI-03, GOL-03, TOOL-04 |
| 201 | MOB-09 | Rogue Unit | `creatures` | entity | core | 2 | W11 | GOL-12 |
| 202 | MOB-10 | Leyden Slime | `creatures` | entity | stretch | 2 | W15 | - |
| 203 | MOB-11 | Thundercloud Ray | `creatures` | entity | stretch | 3 | W15 | U14 |
| 204 | MOB-12 | Museum Curator | `creatures` | entity | stretch | 1 | W15 | - |
| 205 | GEN-01 | Weathered Foundry | `worldgen` | system | core | 1 | W11 | MOB-05 |
| 206 | GEN-02 | Lightning Fields | `worldgen` | system | core | 1 | W11 | WEA-06 |
| 207 | GEN-03 | Copper Viaduct Ruins | `worldgen` | system | core | 1 | W11 | U10 |
| 208 | GEN-04 | Stormwatch Spire | `worldgen` | system | core | 2 | W11 | WEA-01, MOB-04 |
| 209 | GEN-05 | Malachite Geodes | `worldgen` | block | core | 1 | W11 | - |
| 210 | GEN-06 | Verdigris Buds | `worldgen` | block | core | 1 | W11 | GEN-05, U05 |
| 211 | GEN-07 | Sunken Cable Ship | `worldgen` | system | core | 1 | W11 | TUB-08 |
| 212 | GEN-08 | Nomad Electrician Camp | `worldgen` | system | core | 1 | W11 | MOB-08, OXI-02 |
| 213 | GEN-09 | Buried Charge Cache | `worldgen` | system | core | 1 | W11 | U05, PWR-06, TOOL-04 |
| 214 | GEN-10 | Oxidized Canyon | `worldgen` | system | core | 1 | W11 | - |
| 215 | GEN-11 | Aurora Grove | `worldgen` | system | stretch | 1 | W15 | WEA-13 |
| 216 | GEN-12 | Machinist's Vault | `worldgen` | system | stretch | 2 | W15 | U05 |
| 217 | GEN-13 | Corrosion Marsh | `worldgen` | system | stretch | 2 | W15 | MOB-03 |
| 218 | GEN-14 | Sky Bolide Event | `worldgen` | system | stretch | 3 | W15 | OXI-18 |
| 219 | FX-01 | Overload Shock | `effects_enchants` | system | core | 2 | W12 | U03, TES-03, TES-04 |
| 220 | FX-02 | Deep Corrosion | `effects_enchants` | system | core | 2 | W12 | U06 |
| 221 | FX-03 | Grounded | `effects_enchants` | system | core | 1 | W12 | U03 |
| 222 | FX-04 | Static Charge | `effects_enchants` | system | core | 1 | W12 | U03, FX-03 |
| 223 | FX-05 | Conductive | `effects_enchants` | system | core | 1 | W12 | U03 |
| 224 | FX-06 | Voltaic Edge | `effects_enchants` | system | core | 2 | W12 | U09, U05 |
| 225 | FX-07 | Insulating Tread | `effects_enchants` | system | core | 1 | W12 | FX-04, TES-04 |
| 226 | FX-08 | Galvanized | `effects_enchants` | system | core | 1 | W12 | U05 |
| 227 | FX-09 | Magnetized Pickup | `effects_enchants` | system | core | 1 | W12 | U05 |
| 228 | FX-10 | Patina Ward | `effects_enchants` | system | core | 1 | W12 | OXI-08 |
| 229 | FX-11 | Capacitor | `effects_enchants` | system | core | 2 | W12 | U05, PWR-19 |
| 230 | FX-12 | Corroding Curse | `effects_enchants` | system | core | 2 | W12 | OXI-13, MOB-09 |
| 231 | FX-13 | Verdigris Cake | `effects_enchants` | block | stretch | 1 | W15 | FX-03 |
| 232 | FX-14 | Bottled Conductivity | `effects_enchants` | item | core | 2 | W12 | FX-05, OXI-16 |
| 233 | FX-15 | Stormcaller's Rod | `effects_enchants` | item | stretch | 3 | W15 | OXI-10, U21 |
| 234 | FX-16 | Ozone Bloom | `effects_enchants` | system | stretch | 2 | W15 | MOB-04 |
| 235 | ADV-01 | Coppersmith Tree | `progression` | system | core | 0 | W12 | U22 |
| 236 | ADV-02 | Milestone Unlocks | `progression` | system | core | 1 | W12 | ADV-01 |
| 237 | ADV-03 | Handbook Quest Chain | `progression` | system | core | 0 | W12 | U22 |
| 238 | ADV-04 | Storm Heart Overdrive | `progression` | system | core | 3 | W12 | U21, MOB-04 |
| 239 | ADV-05 | Relic Collection | `progression` | system | core | 1 | W12 | GEN-01 |
| 240 | ADV-06 | Statistics Codex | `progression` | system | core | 1 | W12 | U22 |
| 241 | ADV-07 | Mastery Discounts | `progression` | system | core | 2 | W12 | ADV-06 |
| 242 | ADV-08 | Prospector's Map Compass | `progression` | item | core | 0 | W12 | U22, GEN-01 |
| 243 | ADV-09 | Elder Electrician Trades | `progression` | system | core | 2 | W12 | MOB-08, ADV-04, PWR-14, SHD-10, TES-08 |
| 244 | ADV-10 | Legacy Vault | `progression` | block | stretch | 2 | W15 | U05 |
| 245 | DEC-01 | Patina Panel Set | `decor_building` | block | core | 1 | W13 | TOOL-16 |
| 246 | DEC-02 | Filigree Glass | `decor_building` | block | core | 1 | W13 | U19, OXI-16 |
| 247 | DEC-03 | Verdigris Roof Tiles | `decor_building` | block | core | 1 | W13 | U06 |
| 248 | DEC-04 | Copper Gutter | `decor_building` | block | core | 1 | W13 | WEA-09 |
| 249 | DEC-05 | Arc Lamp Series | `decor_building` | block | core | 1 | W13 | U05 |
| 250 | DEC-06 | Copper Radiator | `decor_building` | block | core | 1 | W13 | U05 |
| 251 | DEC-07 | Chime Carillon | `decor_building` | block | core | 1 | W13 | GOL-03 |
| 252 | DEC-08 | Bulletin Board | `decor_building` | block | core | 1 | W13 | - |
| 253 | DEC-09 | Weathervane | `decor_building` | block | core | 1 | W13 | PWR-10 |
| 254 | DEC-10 | Gear Wall Kinetics | `decor_building` | block | core | 1 | W13 | U05 |
| 255 | DEC-11 | Patina Fresco Canvas | `decor_building` | block | core | 1 | W13 | OXI-04 |
| 256 | DEC-12 | Workshop Furniture | `decor_building` | block | core | 1 | W13 | OXI-15 |
| 257 | DEC-13 | Holo-Sign Projector | `decor_building` | block | stretch | 2 | W15 | U05, GEN-05 |
| 258 | DEC-14 | Fountain Core | `decor_building` | block | stretch | 1 | W15 | U05 |
| 259 | DEC-15 | Storm Chimes | `decor_building` | block | stretch | 1 | W15 | TES-14 |
| 260 | DEC-16 | Museum Display Case | `decor_building` | block | stretch | 1 | W15 | MOB-04 |
| 261 | QOL-01 | Handbook Quick-Access | `quality_of_life` | system | core | 0 | W13 | U22, OXI-03 |
| 262 | QOL-02 | Machine GUI Standard | `quality_of_life` | system | core | 0 | W13 | U05 |
| 263 | QOL-03 | Wrench | `quality_of_life` | item | core | 0 | W13 | - |
| 264 | QOL-04 | Reduced Effects Mode | `quality_of_life` | system | core | 0 | W13 | - |
| 265 | QOL-05 | Colorblind Indicator Set | `quality_of_life` | system | core | 0 | W13 | - |
| 266 | QOL-06 | Audio Mixer Categories | `quality_of_life` | system | core | 0 | W13 | - |
| 267 | QOL-07 | REI Integration | `quality_of_life` | integration | core | 0 | W13 | - |
| 268 | QOL-08 | Charge HUD Widget | `quality_of_life` | system | core | 1 | W13 | U05 |
| 269 | QOL-09 | Network Overview Map | `quality_of_life` | system | core | 2 | W13 | U05 |
| 270 | QOL-10 | Diagnostics Overlay | `quality_of_life` | system | core | 2 | W13 | - |
| 271 | QOL-11 | Copper Flare | `quality_of_life` | item | core | 1 | W13 | WEA-06 |
| 272 | QOL-12 | Statistics Dashboard | `quality_of_life` | block | core | 2 | W13 | U05 |
