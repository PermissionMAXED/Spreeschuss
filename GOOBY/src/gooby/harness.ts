import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from "three";
import type { Needs } from "../core/contracts/simulation";
import {
  ProceduralGooby,
  type CharacterReaction,
} from ".";

const REACTIONS: readonly CharacterReaction[] = [
  "pet",
  "tickle",
  "poke",
  "feed",
  "bathe",
  "shiver",
  "fall-asleep",
  "wake-stretch",
  "celebrate",
  "sad",
];

const MOOD_NEEDS: Readonly<Record<string, Needs>> = {
  ecstatic: { hunger: 96, energy: 96, hygiene: 96, fun: 96 },
  hungry: { hunger: 24, energy: 72, hygiene: 72, fun: 72 },
  sleepy: { hunger: 72, energy: 24, hygiene: 72, fun: 72 },
  dirty: { hunger: 72, energy: 72, hygiene: 24, fun: 72 },
  bored: { hunger: 72, energy: 72, hygiene: 72, fun: 24 },
  sad: { hunger: 18, energy: 18, hygiene: 72, fun: 72 },
};

export interface GoobyCharacterHarness {
  readonly actor: ProceduralGooby;
  play(reaction: CharacterReaction): void;
  setNeeds(needs: Needs): void;
  dispose(): void;
}

declare global {
  interface Window {
    __goobyCharacterHarness?: GoobyCharacterHarness;
  }
}

/**
 * Development-only visual stage for reviewing every character animation without
 * coupling specialist controls to the production app shell.
 */
export function mountGoobyCharacterHarness(container: HTMLElement = document.body): GoobyCharacterHarness {
  if (!import.meta.env.DEV) throw new Error("The Gooby character harness is development-only");
  window.__goobyCharacterHarness?.dispose();

  const panel = document.createElement("section");
  panel.dataset.goobyCharacterHarness = "true";
  panel.setAttribute("aria-label", "Gooby character animation harness");
  panel.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:10000",
    "display:grid",
    "grid-template-rows:1fr auto auto",
    "background:#f4cfa7",
    "font:600 12px/1.2 system-ui,sans-serif",
    "color:#583f43",
  ].join(";");

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;height:100%;min-height:0;display:block";
  const status = document.createElement("output");
  status.style.cssText = "position:absolute;top:12px;left:12px;padding:8px 10px;border-radius:12px;background:#fff9";
  const reactionControls = document.createElement("div");
  const moodControls = document.createElement("div");
  reactionControls.style.cssText = "display:flex;gap:6px;overflow:auto;padding:8px;background:#fff6";
  moodControls.style.cssText = reactionControls.style.cssText;
  panel.append(canvas, status, reactionControls, moodControls);
  container.append(panel);

  const scene = new Scene();
  scene.background = new Color(0xf4cfa7);
  const camera = new PerspectiveCamera(34, 1, 0.1, 40);
  camera.position.set(0, 2.5, 9.2);
  camera.lookAt(0, 2.25, 0);
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;

  const actor = new ProceduralGooby();
  actor.root.position.y = 0.08;
  const floorGeometry = new PlaneGeometry(12, 8);
  const floorMaterial = new MeshStandardMaterial({ color: 0xd89f70, roughness: 0.95 });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const ambient = new AmbientLight(0xffe6cc, 2.25);
  const sun = new DirectionalLight(0xfff1d4, 4.2);
  sun.position.set(-4, 7, 6);
  sun.castShadow = true;
  scene.add(actor.root, floor, ambient, sun);

  let frame = 0;
  let previous = performance.now();
  let elapsed = 0;
  let disposed = false;

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const render = (now: number): void => {
    const delta = Math.min(0.05, Math.max(0, (now - previous) / 1_000));
    previous = now;
    elapsed += delta;
    actor.update(delta, elapsed);
    status.value = `${actor.careMood} · ${actor.reactionPhase} · ${actor.triangleCount.toFixed(0)} tris`;
    renderer.render(scene, camera);
    if (!disposed) frame = requestAnimationFrame(render);
  };

  const harness: GoobyCharacterHarness = {
    actor,
    play: (reaction) => actor.react(reaction),
    setNeeds: (needs) => {
      actor.updateNeeds(needs);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      actor.dispose();
      floorGeometry.dispose();
      floorMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      panel.remove();
      if (window.__goobyCharacterHarness === harness) delete window.__goobyCharacterHarness;
    },
  };

  for (const reaction of REACTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = reaction;
    button.dataset.reaction = reaction;
    button.style.cssText = "border:0;border-radius:12px;padding:8px 11px;background:#fff;color:inherit;font:inherit";
    button.addEventListener("click", () => harness.play(reaction));
    reactionControls.append(button);
  }
  for (const [mood, needs] of Object.entries(MOOD_NEEDS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = mood;
    button.dataset.mood = mood;
    button.style.cssText = "border:0;border-radius:12px;padding:8px 11px;background:#fff;color:inherit;font:inherit";
    button.addEventListener("click", () => harness.setNeeds(needs));
    moodControls.append(button);
  }

  window.addEventListener("resize", resize);
  resize();
  frame = requestAnimationFrame(render);
  window.__goobyCharacterHarness = harness;
  return harness;
}
