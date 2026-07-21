# W1D FX Ripple Shader Provenance

Authorship date: **2026-07-20**.  
Authors: **Cuprum contributors**.  
Shipped license: **MIT**, under the repository `LICENSE`.

## CP0C provenance rule

All non-Cuprum material is study-only. No external shader source, expression,
tuned constant, asset, or screenshot is copied, translated, or committed.
The CP0C marker vocabulary is:

- `verified — ...`: license text was read at its authoritative source.
- `reported — study only; ...`: a non-authoritative source reports a license.
- `unverified — study only; ...`: no authoritative license was confirmed.

The marker never grants permission to copy: every external row remains
study-only regardless of its status.

| Material | Status | Use |
|---|---|---|
| Cuprum `fx_ripple.vsh` / `fx_ripple.fsh` | verified — repository MIT license, read 2026-07-20 | Original shipped work described below |
| Minecraft 1.21.9 `rendertype_lightning` runtime resources | unverified — study only; no license assertion | Test-only negative-similarity oracle; source is loaded from the test runtime and is never stored in this repository |
| Third-party ripple shaders | reported — study only; no source consulted for this implementation | None |

## Independent derivation

The implementation starts from Cuprum's own data contract: CPU tessellation
already supplies an annular strip, a normalized lifetime, a color, and a
camera-space transform. The custom pipeline uses `POSITION_COLOR_TEX`; UV
coordinates encode:

- `u = -1` at the inner band edge and `u = +1` at the outer edge;
- `v = age / lifetime`, clamped to `[0, 1]`.

Minecraft 1.21.9 exposes no default constant with that exact name/order, so
Cuprum constructs `POSITION_COLOR_TEX` from the public `Position`, `Color`, and
`UV0` vertex elements. No lightmap/normal attribute is smuggled into the
contract.

The fragment profile was derived directly as the even quartic polynomial
`max(0, 1 - u⁴)`. It is zero at both strip edges, peaks at the center, and
requires no sampled texture. The life envelope and copper color evolution are
new Cuprum choices: a cubic-in-remaining-life opacity envelope, a warm
early-life offset, and a cool late-life offset. Every coefficient in those
expressions was selected for this diagnostic on 2026-07-20; none came from
Minecraft or an external shader.

The vertex stage transforms the repository-authored geometry, forwards the
signed band/life pair and base color, and computes the two fog distances
required by Minecraft's public shader include contract. It does not use
`GameTime`, external textures, copied helper functions, or per-draw uniforms.

## Non-derivation gate

`FxRippleShaderProvenanceTest` reads Cuprum's committed shaders from
`src/main/resources`, but obtains Minecraft's comparison shaders only through
the JUnit runtime class loader. The test strips comments, normalizes identifiers
and numeric literals, builds structural token n-grams, and requires each stage
and the combined pair to remain below the pinned similarity threshold. The test
prints scores only; it never writes, snapshots, or embeds Mojang source.

Resource-completeness assertions in the same test pin both shader files, the
`POSITION_COLOR_TEX` attribute contract, the quartic/lifetime expressions, and
the particle JSON. The real client GameTest remains the compile/runtime gate:
the registered static pipeline must precompile successfully and emit actual
callback-counted vertices before its visual template can pass.
