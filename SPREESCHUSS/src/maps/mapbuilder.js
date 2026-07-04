import * as THREE from 'three';
import { tileTexture, skyTexture } from '../engine/textures.js';

// Builds a three.js scene graph from a plain map-data object and returns
// collision + gameplay metadata. Contract:
//   build(scene, mapData) -> {
//     colliders: [{min:THREE.Vector3, max:THREE.Vector3}],
//     spawns: { attackers:[{pos,rot}], defenders:[...], ffa:[...] },
//     sites: { A:{center:THREE.Vector3,radius}, ... },
//     bounds: {min,max}, group: THREE.Group
//   }
export function buildMap(scene, map) {
  const group = new THREE.Group();
  group.name = 'map';
  scene.add(group);

  const pal = map.palette;
  scene.background = skyTexture(pal.skyTop, pal.skyBottom);
  scene.fog = new THREE.Fog(new THREE.Color(pal.fog ?? pal.skyBottom), 30, 140);

  // Lighting — kept bright so procedural maps read clearly and look vivid.
  const hemi = new THREE.HemisphereLight(new THREE.Color(pal.skyTop), new THREE.Color(pal.floor), 1.5);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(30, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0005;
  const sc = sun.shadow.camera;
  sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80;
  group.add(sun);
  // secondary fill light from the opposite side
  const fill = new THREE.DirectionalLight(new THREE.Color(pal.accent), 0.5);
  fill.position.set(-30, 40, -20);
  group.add(fill);
  const amb = new THREE.AmbientLight(0xffffff, 0.6);
  group.add(amb);

  const [w, d] = map.size;

  // Floor
  const floorTex = tileTexture(pal.floor, { tiles: 2, grain: 18 });
  floorTex.repeat.set(w / 4, d / 4);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, metalness: 0.02 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const colliders = [];
  const wallMatCache = new Map();
  const wallMat = (color) => {
    if (!wallMatCache.has(color)) {
      const t = tileTexture(color, { tiles: 3, grain: 16 });
      wallMatCache.set(color, new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0.05 }));
    }
    return wallMatCache.get(color);
  };

  const addBox = (pos, size, color, opts = {}) => {
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const mat = opts.material || wallMat(color || pal.wall);
    const m = mat.map ? mat.clone() : mat;
    if (m.map) {
      m.map = m.map.clone();
      m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
      m.map.repeat.set(Math.max(1, size[0] / 3), Math.max(1, size[1] / 3));
      m.map.needsUpdate = true;
    }
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push({
      min: new THREE.Vector3(pos[0] - size[0] / 2, pos[1] - size[1] / 2, pos[2] - size[2] / 2),
      max: new THREE.Vector3(pos[0] + size[0] / 2, pos[1] + size[1] / 2, pos[2] + size[2] / 2),
    });
    return mesh;
  };

  // Outer perimeter walls
  const H = 6;
  const t = 1;
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.accent), roughness: 0.6, metalness: 0.2 });
  addBox([0, H / 2, -d / 2], [w + t, H, t], pal.wall);
  addBox([0, H / 2, d / 2], [w + t, H, t], pal.wall);
  addBox([-w / 2, H / 2, 0], [t, H, d + t], pal.wall);
  addBox([w / 2, H / 2, 0], [t, H, d + t], pal.wall);

  // Interior boxes / cover / walls
  for (const b of map.boxes || []) {
    addBox(b.pos, b.size, b.color);
  }

  // Site markers (flat glowing pads)
  const sites = {};
  for (const key of Object.keys(map.sites || {})) {
    const s = map.sites[key];
    const center = new THREE.Vector3(s.center[0], 0.02, s.center[1]);
    const ringGeo = new THREE.RingGeometry(s.radius - 0.3, s.radius, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, transparent: true, opacity: 0.75 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(center);
    group.add(ring);
    // Floating letter
    const lbl = makeSiteLabel(key);
    lbl.position.set(center.x, 3.2, center.z);
    group.add(lbl);
    sites[key] = { center, radius: s.radius, ring };
  }

  const spawns = normalizeSpawns(map.spawns);

  return {
    colliders,
    spawns,
    sites,
    bounds: { min: new THREE.Vector3(-w / 2, 0, -d / 2), max: new THREE.Vector3(w / 2, H, d / 2) },
    group,
  };
}

function makeSiteLabel(letter) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 128, 128);
  ctx.font = 'bold 96px Arial';
  ctx.fillStyle = '#ffd166';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(2, 2, 2);
  return sp;
}

function normalizeSpawns(spawns = {}) {
  const conv = (arr = []) => arr.map((s) => ({
    pos: new THREE.Vector3(s[0], 1.6, s[1]),
    rot: s[2] ?? 0,
  }));
  return {
    attackers: conv(spawns.attackers),
    defenders: conv(spawns.defenders),
    ffa: conv(spawns.ffa),
  };
}
