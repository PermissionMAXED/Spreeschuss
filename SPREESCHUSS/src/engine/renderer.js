import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Owns the WebGL renderer, camera, scene and the postprocessing composer.
// Handles resize.
export class Renderer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.02, 500);
    this.camera.position.set(0, 1.6, 0);

    this._setupComposer();

    window.addEventListener('resize', () => this._onResize());
  }

  _setupComposer() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = this.renderer.getPixelRatio();

    // Multisampled half-float target: the composer bypasses canvas MSAA, so
    // request 4x MSAA on the render target itself (WebGL2) to keep edge
    // quality on par with the previous direct-to-canvas render.
    const target = new THREE.WebGLRenderTarget(w * pr, h * pr, {
      samples: 4,
      type: THREE.HalfFloatType,
    });

    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Subtle, competitive-friendly bloom: high threshold so only genuinely
    // bright content (emissive accents, additive tracers, muzzle flashes,
    // site rings) glows — sky gradient and plain walls stay clean.
    this.bloomStrength = 0.45;
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), this.bloomStrength, 0.3, 0.9);
    this.composer.addPass(this.bloomPass);

    // OutputPass applies tone mapping + sRGB conversion. It reads
    // renderer.toneMappingExposure every frame, so the muzzle-flash exposure
    // kick in main.js keeps working unchanged.
    this.composer.addPass(new OutputPass());

    // Normalize all pass-internal targets to device-pixel size right away so
    // the first window resize doesn't change bloom appearance on HiDPI.
    this.composer.setSize(w, h);
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // setPixelRatio + setSize propagate to every pass (incl. the bloom
    // pass's internal mip targets) via pass.setSize.
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }

  render() {
    // The first-person viewmodel is parented to the main camera and rendered
    // in the RenderPass (see Viewmodel). Near plane is small so it doesn't clip.
    this.renderer.autoClear = true;
    this.composer.render();
  }

  // Temporary bloom emphasis (e.g. muzzle flash) on top of the baseline.
  setBloomBoost(amount) {
    this.bloomPass.strength = this.bloomStrength + amount;
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  clearScene() {
    // Dispose and remove all children of the main scene.
    const disposeObj = (obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          for (const k in m) {
            if (m[k] && m[k].isTexture) m[k].dispose();
          }
          m.dispose();
        }
      }
    };
    this.scene.traverse(disposeObj);
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
  }
}
