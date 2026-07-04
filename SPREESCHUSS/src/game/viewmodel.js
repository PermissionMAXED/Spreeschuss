import * as THREE from 'three';
import { bus } from '../engine/eventbus.js';

// First-person weapon viewmodel rendered in the renderer's HUD overlay scene.
// Procedurally builds a gun per weapon category and animates sway/recoil.
export class Viewmodel {
  constructor(renderer, game) {
    this.r = renderer;
    this.game = game;
    this.group = new THREE.Group();
    this.currentCat = null;
    this.recoil = 0;
    this.muzzle = null;
    this._mount();
    // clearScene() (called on every loadMatch) wipes the HUD overlay scene,
    // so re-mount the viewmodel + its lights whenever a match starts.
    bus.on('match:start', () => { this._mount(); this.currentCat = null; });
    bus.on('muzzle', () => { this.recoil = 1; if (this.muzzle) this.muzzleTimer = 0.04; });
  }

  _mount() {
    // Parent the viewmodel to the main camera and make sure the camera is part
    // of the scene graph so its children are rendered. clearScene() (run on
    // every loadMatch) wipes the scene, so this must run again on match:start.
    const cam = this.r.camera;
    if (cam.parent !== this.r.scene) this.r.scene.add(cam);
    if (this.group.parent !== cam) cam.add(this.group);
    // dedicated light so the gun is well lit regardless of the map palette
    if (!this._light) {
      this._light = new THREE.PointLight(0xffffff, 2.2, 6);
      this._light.position.set(0.3, 0.1, -0.4);
    }
    if (this._light.parent !== cam) cam.add(this._light);
  }

  _clear() {
    while (this.group.children.length) {
      const c = this.group.children[0];
      this.group.remove(c);
      c.traverse?.((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
  }

  build(cat) {
    this._clear();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5b6673, roughness: 0.4, metalness: 0.7, emissive: 0x1a2028, emissiveIntensity: 0.6 });
    const accMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.6, emissive: 0x0e1216, emissiveIntensity: 0.5 });
    const g = new THREE.Group();

    const dims = {
      sidearm: [0.12, 0.16, 0.45], smg: [0.12, 0.16, 0.7], rifle: [0.12, 0.16, 1.0],
      sniper: [0.12, 0.16, 1.2], shotgun: [0.14, 0.16, 0.95], heavy: [0.16, 0.2, 1.1], melee: [0.06, 0.06, 0.4],
    }[cat] || [0.12, 0.16, 0.8];

    const body = new THREE.Mesh(new THREE.BoxGeometry(dims[0], dims[1], dims[2]), bodyMat);
    body.position.z = -dims[2] / 2;
    g.add(body);
    // bright accent stripe so the weapon reads clearly against dark maps
    const accent = new THREE.Mesh(
      new THREE.BoxGeometry(dims[0] + 0.01, 0.03, dims[2] * 0.8),
      new THREE.MeshStandardMaterial({ color: 0x43b7c7, emissive: 0x43b7c7, emissiveIntensity: 0.9 }),
    );
    accent.position.set(0, dims[1] / 2, -dims[2] / 2);
    g.add(accent);
    // barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, dims[2] * 0.5, 8), accMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -dims[2] - dims[2] * 0.15);
    g.add(barrel);
    // grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.12), accMat);
    grip.position.set(0, -0.16, -0.05);
    grip.rotation.x = 0.3;
    g.add(grip);
    // mag
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), accMat);
    mag.position.set(0, -0.16, -dims[2] * 0.45);
    g.add(mag);
    if (cat === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 10), accMat);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.12, -dims[2] * 0.5);
      g.add(scope);
    }

    // muzzle flash sprite
    const mflash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    mflash.scale.set(0.4, 0.4, 0.4);
    mflash.position.set(0, 0.02, -dims[2] - dims[2] * 0.3);
    g.add(mflash);
    this.muzzle = mflash;

    // position gun bottom-right of view
    g.position.set(0.26, -0.24, -0.55);
    g.rotation.y = -0.09;
    g.scale.setScalar(1.15);
    this.group.add(g);
    this.gun = g;
    this.currentCat = cat;
    this.baseX = g.position.x;
    this.baseY = g.position.y;
    this.baseZ = g.position.z;
  }

  update(dt) {
    const p = this.game.player;
    if (!p) return;
    const cat = p.alive ? p.weapon().cat : null;
    if (cat && cat !== this.currentCat) this.build(cat);
    this.group.visible = !!(p.alive && this.game.state === 'playing' && !this.game.buyOpen && !this.game.scopeActive);
    if (!this.gun) return;

    // recoil recovery + bob
    this.recoil = Math.max(0, this.recoil - dt * 8);
    const t = performance.now() / 1000;
    const moving = (p.vel.x * p.vel.x + p.vel.z * p.vel.z) > 1 && p._onGround;
    const bobX = moving ? Math.sin(t * 10) * 0.006 : 0;
    const bobY = moving ? Math.abs(Math.cos(t * 10)) * 0.006 : 0;
    this.gun.position.z = this.baseZ + this.recoil * 0.08;
    this.gun.position.x = this.baseX + bobX;
    this.gun.position.y = this.baseY + bobY - this.recoil * 0.02;
    this.gun.rotation.x = this.recoil * 0.15;

    if (this.muzzle) {
      this.muzzleTimer = Math.max(0, (this.muzzleTimer || 0) - dt);
      this.muzzle.material.opacity = this.muzzleTimer > 0 ? 0.9 : 0;
      this.muzzle.material.rotation = Math.random() * Math.PI;
    }
  }
}
