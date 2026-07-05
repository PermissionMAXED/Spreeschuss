import * as THREE from 'three';
import { hashStr, mulberry32 } from './util.js';

// =====================================================================
// FROZEN INTERFACE — animated decoration (decoration ONLY).
//
//   addAnimatedDecor(group, map, sites)
//     Adds small ambient-motion decor (e.g. flickering signage, rotating
//     vent fans, swaying banners, blinking beacons). `group` is the map
//     group, `map` the raw map-data object (map.spawns holds raw
//     [x, z, rot?] arrays; map.boxes the collider boxes), `sites` the
//     built sites object { KEY: { center: THREE.Vector3, radius, ring } }
//     from addSiteMarkers (map.sites holds the raw data). ALL motion is
//     driven exclusively by onBeforeRender hooks on this module's own
//     meshes (rule 5); animation must never move anything outside
//     decal/proud/overhead limits (rule 3) at any point of its cycle.
//
// DECORATION STAGE ORDER (FROZEN — mapbuilder.js calls these at the END
// of buildMap, AFTER addProps, in exactly this order):
//   addGroundFX -> addDoorDecor -> addLandmark -> addAnimatedDecor ->
//   addLightShafts -> addCallouts -> addAtmosphere
//
// SHARED HARD RULES (identical for all 7 decoration modules):
//   1. ZERO colliders, ZERO lights of any kind — lighting.js owns the
//      <= 4 point-light budget.
//   2. Determinism: use a LOCAL PRNG only —
//        const rnd = mulberry32(hashStr((map.id || map.name || 'map') + ':<modulename>'))
//      from ./util.js. NEVER touch the shared builder `rand`: the
//      existing stage order and shared-PRNG consumption are frozen, and
//      consuming `rand` would change structures/skyline/props visuals.
//   3. Placement safety (same rules as props.js): decor inside the
//      playable area must be one of
//        (a) a flat floor decal <= 0.021 high;
//        (b) mounted <= 0.06 proud of an existing collider face
//            (map.boxes, or the perimeter walls at +-w/2, +-d/2 with
//            thickness 1 / height 6 — see structures.js);
//        (c) overhead with its lowest point >= 2.6 m.
//      Keep >= 1 m XZ clearance from every spawn point (map.spawns
//      holds raw [x, z, rot?] arrays); site ring interiors
//      (center +- radius) may contain nothing except flat decals.
//   4. Disposal: Renderer.clearScene() disposes ALL scene geometries /
//      materials / textures between matches (three.js' shared Sprite
//      geometry excepted). Create FRESH Geometry / Material /
//      CanvasTexture instances on every call; CPU-side canvas caching
//      is allowed but must return fresh THREE.CanvasTexture wrappers
//      (same pattern as engine/textures.js). Never share module-level
//      Geometry/Material singletons.
//   5. Animation only via onBeforeRender hooks on this module's own
//      meshes — the render loop and game.js are frozen and will never
//      tick decorations.
//   6. Budget: <= 10 draw calls added (use mergeInto from ./util.js
//      for static parts), <= 1 THREE.Points system, modest canvas
//      sizes (<= 256 px).
// =====================================================================

export function addAnimatedDecor(group, map, sites) { // eslint-disable-line no-unused-vars
  // Local PRNG (rule 2) — NEVER the shared builder rand.
  const rnd = mulberry32(hashStr((map.id || map.name || 'map') + ':animdecor')); // eslint-disable-line no-unused-vars

  // Stub: empty placeholder container (visually no-op, zero draw calls).
  // Specialists build the stage into this group.
  const anim = new THREE.Group();
  anim.name = 'animdecor';
  group.add(anim);
}
