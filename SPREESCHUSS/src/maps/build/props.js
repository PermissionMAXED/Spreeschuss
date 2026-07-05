// =====================================================================
// FROZEN INTERFACE — gameplay-area props (decoration ONLY, currently a
// no-op stub for a later map specialist to fill).
//
//   addProps(group, map, rand, sites)
//     Adds small decorative props INSIDE the playable area. Called by
//     mapbuilder.js after lighting; receives the map group, the raw map
//     data (map.spawns holds the raw [x, z, rot?] spawn arrays), the
//     shared map-seeded PRNG and the sites object from sites.js.
//
// HARD RULES for any future implementation:
//   - Decoration adds NO colliders, ever. Props must not block movement
//     or hitscan in any way the collider set doesn't already represent:
//       * flat floor decals: <= 0.02 high (below the site rings at 0.02
//         stay under 0.015);
//       * wall-attached props: <= 0.06 proud of the wall colliders;
//       * overhead props: bottom >= 2.6 m (player headroom);
//   - keep >= 1 m clearance (XZ) from every spawn point and stay out of
//     site ring interiors (center + radius from `sites`);
//   - placement must be deterministic from `rand` ONLY (no Math.random),
//     and this stage runs LAST in the rand-consumer chain — do not
//     reorder it in mapbuilder.js;
//   - add NO lights (map point lights are capped at <= 4 in lighting.js
//     and the sun must stay the only shadow caster);
//   - merge geometry by material (see util.mergeInto) to keep draw
//     calls low.
// =====================================================================

export function addProps() {}
