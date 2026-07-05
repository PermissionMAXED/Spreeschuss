import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Cinematic finish: filmic grade + vignette + animated film grain in ONE
// full-screen pass. Runs on the linear half-float buffer BEFORE OutputPass,
// so tone mapping (which reads toneMappingExposure each frame) and the sRGB
// conversion still happen exactly once, after us. The shader contains no
// tone-mapping/color-space chunks of its own — output stays linear.
//
// uStrength scales every effect; at 0 the pass is a mathematical passthrough
// (the pass stays in the chain, it just does nothing).
//
// Grain samples per DEVICE pixel via gl_FragCoord, so it needs no resolution
// uniform and stays correctly scaled through resize / pixel-ratio changes
// without a custom setSize.
const CinematicFinishShader = {
  name: 'CinematicFinishShader',

  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0.0 },
    uStrength: { value: 1.0 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uStrength;
    varying vec2 vUv;

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    // Cheap, well-distributed screen-space hash (Dave Hoskins style).
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 col = max(texel.rgb, vec3(0.0));
      float s = uStrength;

      // --- 1) GRADE ---------------------------------------------------
      // Gentle filmic S-curve on luma, applied only inside the SDR range:
      // HDR values (>1: bloom cores, muzzle flashes, emissives) keep their
      // full energy so the exposure kick reads exactly like before. The
      // toe (t < 0.06) is protected so night skies / deep shadows are not
      // crushed — keeps enemies readable and avoids banding when the
      // darkest palettes quantize back to 8-bit.
      float luma = dot(col, LUMA);
      float t = clamp(luma, 0.0, 1.0);
      float sCurve = t * t * (3.0 - 2.0 * t);
      float newLuma = luma + (sCurve - t) * 0.22 * s * smoothstep(0.0, 0.06, t);
      col *= newLuma / max(luma, 1e-4);

      // Tiny saturation lift (~1.05 at full strength).
      float luma2 = dot(col, LUMA);
      col = mix(vec3(luma2), col, 1.0 + 0.05 * s);

      // Split toning: teal shadows / warm highlights. Multiplicative so
      // pure black stays pure black (no lifted floor -> no banding) and
      // capped at 0.12 so every palette stays recognizably itself.
      float split = 0.12 * s;
      float shadowM = 1.0 - smoothstep(0.05, 0.45, luma2);
      float highM = smoothstep(0.45, 1.0, luma2);
      col *= mix(vec3(1.0), vec3(0.85, 1.00, 1.12), shadowM * split);
      col *= mix(vec3(1.0), vec3(1.12, 1.02, 0.88), highM * split);

      // --- 2) VIGNETTE ------------------------------------------------
      // d < 0.42 (a wide circle around screen center, well past the
      // crosshair) is 100% untouched; extreme corners (d ~= 0.707) reach
      // the full ~18% darkening.
      float d = length(vUv - 0.5);
      float vig = smoothstep(0.42, 0.72, d) * 0.18 * s;
      col *= 1.0 - vig;

      // --- 3) FILM GRAIN ----------------------------------------------
      // Animated per-frame via uTime, per device pixel via gl_FragCoord.
      // Luminance-weighted: full amplitude in darks, fades in brights.
      // Amplitude is small because we add in LINEAR space pre-OutputPass:
      // the sRGB encode amplifies shadow deltas ~5-10x, so 0.01 linear
      // already reads as clear (but subtle) grain in night skies.
      // Signed noise (zero mean) so average brightness is unchanged; it
      // also acts as dithering against banding in the darkest palettes.
      float n = hash12(gl_FragCoord.xy + vec2(uTime * 971.0, uTime * 557.0));
      float grainW = 1.0 - 0.75 * smoothstep(0.0, 0.65, dot(col, LUMA));
      col += (n - 0.5) * 2.0 * 0.010 * grainW * s;

      gl_FragColor = vec4(max(col, vec3(0.0)), texel.a);
    }
  `,
};

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

    // Cinematic finish (grade + vignette + grain) on the linear buffer,
    // strictly before OutputPass so tone mapping/sRGB still run once, last.
    this.gradePass = new ShaderPass(CinematicFinishShader);
    this._gradeTime = 0;
    this._gradeClock = new THREE.Clock();
    this.composer.addPass(this.gradePass);

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
    // Advance the grain clock; wrap so uTime never grows large enough to
    // degrade hash precision during long sessions.
    this._gradeTime = (this._gradeTime + this._gradeClock.getDelta()) % 64;
    this.gradePass.uniforms.uTime.value = this._gradeTime;

    // The first-person viewmodel is parented to the main camera and rendered
    // in the RenderPass (see Viewmodel). Near plane is small so it doesn't clip.
    this.renderer.autoClear = true;
    this.composer.render();
  }

  // Temporary bloom emphasis (e.g. muzzle flash) on top of the baseline.
  setBloomBoost(amount) {
    this.bloomPass.strength = this.bloomStrength + amount;
  }

  // Master strength for the cinematic finish pass (grade/vignette/grain).
  // 1 = default look, 0 = visually disabled (pass stays in the chain).
  setGradeStrength(v) {
    this.gradePass.uniforms.uStrength.value = v;
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  clearScene() {
    // Dispose and remove all children of the main scene.
    const disposeObj = (obj) => {
      // Sprites share one global geometry in three.js — never dispose it.
      if (obj.geometry && !obj.isSprite) obj.geometry.dispose();
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
